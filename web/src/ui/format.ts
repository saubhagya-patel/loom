// Everything mechanical the UI prints. Kept together because the design treats counts, sizes
// and states as one typographic register (Space Mono, tabular) and they should agree.

export function bytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}

export function rate(bytesPerSecond: number): string {
  return bytesPerSecond > 0 ? `${bytes(bytesPerSecond)}/s` : '—'
}

/**
 * The short badge on a contact-sheet frame. Derived from the MIME type Drive reports, so it
 * says what the file *is* rather than what its name claims — the same asymmetry the HEIC
 * detector relies on.
 */
export function kindOf(mimeType: string, name: string): string {
  const map: Record<string, string> = {
    'image/heic': 'HEIC',
    'image/heif': 'HEIC',
    'image/jpeg': 'JPEG',
    'image/png': 'PNG',
    'image/webp': 'WEBP',
    'image/gif': 'GIF',
    'image/avif': 'AVIF',
    'video/quicktime': 'MOV',
    'video/mp4': 'MP4',
  }
  if (map[mimeType]) return map[mimeType]
  if (mimeType.startsWith('video/')) return 'VIDEO'
  if (mimeType.startsWith('image/')) return 'IMAGE'
  const ext = name.split('.').pop()
  return ext && ext.length <= 4 ? ext.toUpperCase() : 'FILE'
}

const DAY = 24 * 60 * 60 * 1000

/** "Today" / "Yesterday" / "12 Mar 2026" — the contact sheet groups by the day it was stored. */
export function dayLabel(iso: string): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return 'Undated'

  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((midnight(new Date()) - midnight(then)) / DAY)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

/** The key a day groups on — the local date, so two photos on one evening stay together. */
export function dayKey(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? 'undated' : d.toLocaleDateString('en-CA')
}
