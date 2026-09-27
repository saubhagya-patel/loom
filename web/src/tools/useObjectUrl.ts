import { useEffect } from 'react'

/**
 * Revokes an object URL when it changes, and when the component unmounts.
 *
 * `docs/trd-utilities.md` §2 names leaking these as the most likely defect in the viewer:
 * every `createObjectURL` holds memory until revoked, and a tool people drop image after image
 * onto will accumulate them until the tab dies.
 *
 * The URL is created by the caller, in the event handler that produced the blob — creating it
 * inside an effect would mean setting state from that effect, and creating it during render
 * would be a side effect in a pure function. Revocation is the half that actually leaks, so
 * that is the half this owns.
 */
export function useRevokeObjectUrl(url: string | null): void {
  useEffect(() => {
    if (!url) return
    return () => URL.revokeObjectURL(url)
  }, [url])
}
