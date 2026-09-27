import { AppError } from '../api/errors.ts'

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

// Deliberately not TRD §5.3's "Storage Relief Backup" nor docs/plan.md's "Loom Backup" —
// both predate the rename. Nothing resolves the folder by name: the id is stored on the user
// row and that is the only way it is ever found, so this string is for the user's eyes alone.
const FOLDER_NAME = 'loom'

export type Drive = {
  ensureAppFolder: (accessToken: string, existingId: string | null) => Promise<string>
}

export function createDrive(): Drive {
  return {
    ensureAppFolder: async (accessToken, existingId) => {
      // The stored id wins. We do not re-check that the folder still exists on every
      // sign-in: under drive.file we could only see it if we created it, a HEAD costs a
      // round trip on the hot path, and a user who deleted the folder is a Phase 4 concern
      // (the gallery will surface it) rather than a reason to slow down auth.
      if (existingId) return existingId

      let res: Response
      try {
        res = await fetch(`${DRIVE_FILES}?fields=id`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
        })
      } catch {
        // Nothing from the underlying error crosses this boundary: a fetch failure carries
        // the request URL, and on the Phase 3 transcode path that URL is a resumable session
        // URI — a bearer credential (docs/plan.md §2.8, confirmed by the Phase 0 Task 9 spike).
        throw new AppError(502, 'drive_unreachable', 'could not reach google drive')
      }

      if (!res.ok) {
        throw new AppError(502, 'drive_folder_failed', `drive refused to create the folder (${res.status})`)
      }

      const json: unknown = await res.json().catch(() => null)
      const id = (json as { id?: unknown } | null)?.id
      if (typeof id !== 'string') {
        throw new AppError(502, 'drive_bad_response', 'drive returned no folder id')
      }
      return id
    },
  }
}
