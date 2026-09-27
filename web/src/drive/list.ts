const FILES_URL = 'https://www.googleapis.com/drive/v3/files'
const PAGE_SIZE = 100

// Drive returns a thin default set and omits thumbnailLink entirely unless asked, so every
// property the UI reads has to be named here. A missing field looks like missing data.
const FIELDS =
  'nextPageToken,files(id,name,mimeType,size,createdTime,thumbnailLink,webViewLink)'

export type DriveFile = {
  id: string
  name: string
  mimeType: string
  /** Drive omits size for folders and shortcuts, so this is genuinely nullable. */
  size: number | null
  createdTime: string
  /** Short-lived. Rendered straight into an <img> and never persisted anywhere. */
  thumbnailLink: string | null
  webViewLink: string | null
}

export type Page = { files: DriveFile[]; nextPageToken: string | null }

export type DriveList = {
  page: (folderId: string, pageToken?: string) => Promise<Page>
}

type RawFile = Partial<Record<keyof DriveFile, unknown>>

function toFile(raw: RawFile): DriveFile | null {
  if (typeof raw.id !== 'string' || typeof raw.name !== 'string') return null
  return {
    id: raw.id,
    name: raw.name,
    mimeType: typeof raw.mimeType === 'string' ? raw.mimeType : 'application/octet-stream',
    // Drive sends size as a string, and Number(undefined) is NaN — which would reach the
    // screen as "NaN MB".
    size: typeof raw.size === 'string' ? Number(raw.size) : null,
    createdTime: typeof raw.createdTime === 'string' ? raw.createdTime : '',
    thumbnailLink: typeof raw.thumbnailLink === 'string' ? raw.thumbnailLink : null,
    webViewLink: typeof raw.webViewLink === 'string' ? raw.webViewLink : null,
  }
}

/**
 * Drive's thumbnailLink ends in a size hint, `=s220` by default. At a 120px tile on a retina
 * screen that is visibly soft, so ask for something the display can actually use.
 */
export function thumbnailAt(link: string, px: number): string {
  return link.replace(/=s\d+(-c)?$/, `=s${px}`)
}

export function createDriveList(deps: {
  getToken: () => string | null
  refreshToken: () => Promise<boolean>
}): DriveList {
  async function request(url: string, retried = false): Promise<Response> {
    const token = deps.getToken()
    if (!token) {
      if (retried || !(await deps.refreshToken())) throw new Error('not signed in')
      return request(url, true)
    }

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })

    // The access token lives an hour and the gallery can be open longer. A 401 here is
    // expected, not exceptional — refresh once and retry, and never sign the user out for it.
    if (res.status === 401 && !retried) {
      if (!(await deps.refreshToken())) throw new Error('your session expired')
      return request(url, true)
    }
    return res
  }

  return {
    page: async (folderId, pageToken) => {
      const params = new URLSearchParams({
        // trashed=false or a deleted photo keeps showing up as a broken frame.
        q: `'${folderId}' in parents and trashed = false`,
        orderBy: 'createdTime desc',
        pageSize: String(PAGE_SIZE),
        fields: FIELDS,
      })
      if (pageToken) params.set('pageToken', pageToken)

      const res = await request(`${FILES_URL}?${params.toString()}`)
      if (!res.ok) throw new Error(`drive would not list your files (${res.status})`)

      const body = (await res.json()) as { files?: RawFile[]; nextPageToken?: string }
      return {
        files: (body.files ?? []).map(toFile).filter((f): f is DriveFile => f !== null),
        nextPageToken: body.nextPageToken ?? null,
      }
    },
  }
}
