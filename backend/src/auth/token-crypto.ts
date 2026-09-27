import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

// The only module in the codebase that sees a refresh token in the clear. Everything else
// moves the `v1:` string around (docs/plan.md §2.2).
//
// This exists because TRD §4 stores the token as plain TEXT, and a Google refresh token for
// drive.file is a durable, self-renewing key to every file this app has ever touched. A
// plaintext column makes one database dump permanent, silent access to all of it. Encryption
// does not defeat an attacker holding the database *and* the process environment — it turns
// "a database dump is game over" into "a dump plus the running host is game over", which is
// the difference between an accident and a breach.

const VERSION = 'v1'
const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12 // GCM's standard nonce length; 96 bits is what the mode is built around
const TAG_BYTES = 16

// The version prefix is the only reason key rotation has somewhere to go: a v2 reader can
// recognise v1 ciphertext and re-encrypt it rather than failing on it.
export function encryptToken(plain: string, keyB64: string): string {
  // A fresh IV per call. Reusing one under the same key breaks GCM completely — it leaks the
  // XOR of the plaintexts and, worse, the authentication key itself.
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, Buffer.from(keyB64, 'base64'), iv)
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])

  // getAuthTag is only valid after final(), and it is what makes this tamper-evident rather
  // than merely unreadable.
  const tag = cipher.getAuthTag()
  return [
    VERSION,
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':')
}

export function decryptToken(payload: string, keyB64: string): string {
  const parts = payload.split(':')
  const [version, ivB64, tagB64, ctB64] = parts

  // Errors here never quote the payload. It is ciphertext, but the failure most likely to be
  // pasted into a bug report is exactly the one where it is not what we think it is.
  if (parts.length !== 4 || version !== VERSION || !ivB64 || !tagB64 || !ctB64) {
    throw new Error('stored token is not a recognised v1 payload')
  }

  const iv = Buffer.from(ivB64, 'base64')
  const tag = Buffer.from(tagB64, 'base64')
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error('stored token has a malformed iv or auth tag')
  }

  const decipher = createDecipheriv(ALGORITHM, Buffer.from(keyB64, 'base64'), iv)
  decipher.setAuthTag(tag)

  // final() throws if the tag does not verify. That throw *is* the tamper detection, so it
  // must never be caught and turned into a fallback — a caller that recovers here has
  // accepted an attacker-chosen token.
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}
