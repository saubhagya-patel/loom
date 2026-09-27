import { useCallback, useEffect, useRef, useState } from 'react'
import { getAccessToken, refreshAccessToken } from '../auth/token.ts'
import { createDriveList, type DriveFile } from './list.ts'

export type Gallery = {
  files: DriveFile[]
  loading: boolean
  error: string | null
  /** No further pages to fetch. */
  complete: boolean
  loadMore: () => void
  refresh: () => void
}

export function useGallery(folderId: string): Gallery {
  const [files, setFiles] = useState<DriveFile[]>([])
  // Starts true because the first page is always fetched on mount. Initialising it here rather
  // than setting it from the effect keeps the effect free of synchronous state updates.
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [complete, setComplete] = useState(false)

  const drive = useRef(createDriveList({ getToken: getAccessToken, refreshToken: refreshAccessToken }))
  const nextToken = useRef<string | null>(null)
  const inFlight = useRef(false)
  // Bumped whenever the list is cleared. A page that was already in the air when that happened
  // discards itself instead of appending to a list that no longer exists.
  const generation = useRef(0)

  const load = useCallback(
    async (pageToken: string | undefined, gen: number) => {
      if (inFlight.current) return
      inFlight.current = true
      try {
        const page = await drive.current.page(folderId, pageToken)
        if (gen !== generation.current) return
        nextToken.current = page.nextPageToken
        setComplete(page.nextPageToken === null)
        setFiles((prev) => (pageToken ? [...prev, ...page.files] : page.files))
        setError(null)
      } catch (err) {
        if (gen === generation.current) {
          setError(err instanceof Error ? err.message : 'could not load your photos')
        }
      } finally {
        inFlight.current = false
        if (gen === generation.current) setLoading(false)
      }
    },
    [folderId],
  )

  // Called from events — a tab switch, a retry — so flipping state synchronously is fine here.
  const refresh = useCallback(() => {
    // thumbnailLink URLs are short-lived, so a stale list is worse than no list: its frames
    // would quietly stop loading. Refreshing re-reads the metadata rather than caching harder.
    generation.current += 1
    nextToken.current = null
    inFlight.current = false
    setLoading(true)
    setComplete(false)
    void load(undefined, generation.current)
  }, [load])

  const loadMore = useCallback(() => {
    if (inFlight.current || nextToken.current === null) return
    setLoading(true)
    void load(nextToken.current, generation.current)
  }, [load])

  useEffect(() => {
    // Only refs are touched here; `loading` already starts true, so the effect synchronises
    // with Drive without kicking off a second render of its own.
    generation.current += 1
    nextToken.current = null
    inFlight.current = false
    void load(undefined, generation.current)
  }, [load])

  return { files, loading, error, complete, loadMore, refresh }
}
