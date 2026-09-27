// A queue record has to survive a reload, a reorder, and the file being re-selected from a
// different directory. An array index survives none of those, so records are keyed by the
// file's own properties (docs/plan.md §2.9) — which also gives V2's Live Photo grouping
// something stable to attach to.
//
// SHA-256 because crypto.subtle has it natively. (It has no MD5, which is why the per-chunk
// integrity check is a separate, deferred task rather than free.)
export async function fileIdOf(file: File): Promise<string> {
  const material = `${file.name}|${file.size}|${file.lastModified}`
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material))
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
}

// Used when a reload asks the user to re-select a file: re-selecting the *wrong* one must be
// refused, not appended to someone else's upload.
export async function matchesFileId(file: File, expectedId: string): Promise<boolean> {
  return (await fileIdOf(file)) === expectedId
}
