import type { PrismaClient } from '../../generated/prisma/client.ts'
import { AppError } from '../api/errors.ts'
import { decryptToken, encryptToken } from '../auth/token-crypto.ts'

// The shape that flows out to handlers. It deliberately has no token field: the decrypted
// value is reachable only through refreshTokenOf, so nothing can serialise it by accident.
export type User = { id: string; email: string; appFolderId: string | null }

export type Users = {
  upsert: (u: { id: string; email: string; refreshToken?: string }) => Promise<void>
  get: (id: string) => Promise<User | null>
  refreshTokenOf: (id: string) => Promise<string | null>
  setAppFolderId: (id: string, folderId: string) => Promise<void>
}

export function createUsers(prisma: PrismaClient, keyB64: string): Users {
  return {
    // Split into an explicit create/update rather than a single upsert, because the two
    // cases have genuinely different rules about a missing refresh token: on a first sign-in
    // its absence is fatal, and on a later one it is normal and must change nothing.
    upsert: async ({ id, email, refreshToken }) => {
      const existing = await prisma.users.findUnique({ where: { id }, select: { id: true } })

      if (!existing) {
        if (!refreshToken) {
          // Without one we could never refresh, so the account would work for an hour and
          // then fail in a way that looks nothing like its cause. Google omits it when
          // consent was already granted but the account is new to us — re-consent is the fix.
          throw new AppError(
            401,
            'google_no_refresh_token',
            'google returned no refresh token; revoke access and sign in again',
          )
        }
        await prisma.users.create({
          data: { id, email, refresh_token: encryptToken(refreshToken, keyB64) },
        })
        return
      }

      // A refresh token is issued on first consent and usually not afterwards, so a naive
      // upsert would blank a working credential on the user's second sign-in — and the
      // damage would only surface when the access token expired an hour later.
      await prisma.users.update({
        where: { id },
        data: {
          email,
          ...(refreshToken ? { refresh_token: encryptToken(refreshToken, keyB64) } : {}),
        },
      })
    },

    get: async (id) => {
      const row = await prisma.users.findUnique({
        where: { id },
        select: { id: true, email: true, app_folder_id: true },
      })
      return row ? { id: row.id, email: row.email, appFolderId: row.app_folder_id } : null
    },

    refreshTokenOf: async (id) => {
      const row = await prisma.users.findUnique({
        where: { id },
        select: { refresh_token: true },
      })
      // Any failure to decrypt throws out of here rather than returning null: a null would
      // read as "no such user" and send the caller looking in the wrong place.
      return row ? decryptToken(row.refresh_token, keyB64) : null
    },

    setAppFolderId: async (id, folderId) => {
      await prisma.users.update({ where: { id }, data: { app_folder_id: folderId } })
    },
  }
}
