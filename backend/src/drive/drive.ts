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

/**
 * Does the stored folder still exist and is it out of the bin?
 *
 * **Every uncertain answer is `true`.** Creating a second `loom` folder is a worse outcome
 * than a failing upload: it is visible mess in someone's Drive and it silently splits their
 * backup across two places. So only a definite `404`, or `trashed: true`, causes a new one —
 * a network blip, a rate limit or a 5xx all say "assume it is there".
 */
async function stillExists(accessToken: string, folderId: string): Promise<boolean> {
  let res: Response
  try {
    res = await fetch(`${DRIVE_FILES}/${folderId}?fields=id,trashed`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  } catch {
    return true
  }

  if (res.status === 404) return false
  if (!res.ok) return true

  const body: unknown = await res.json().catch(() => null)
  return (body as { trashed?: unknown } | null)?.trashed !== true
}

export function createDrive(): Drive {
  return {
    ensureAppFolder: async (accessToken, existingId) => {
      // Phase 1 deliberately skipped this check to keep a round trip off the sign-in path.
      // Phase 5 puts it back: sign-in happens once a session, so it is not a hot path, and
      // the alternative is a user who deleted the folder in Drive getting upload failures
      // that name nothing. The caller stores whatever id comes back, so a recreated folder
      // is persisted without any further work.
      if (existingId && (await stillExists(accessToken, existingId))) return existingId

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
