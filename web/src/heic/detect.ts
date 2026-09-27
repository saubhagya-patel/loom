// A HEIC file is an ISO base-media container: bytes 4-7 are the literal `ftyp`, and 8-11 are a
// brand. MP4 and friends share that header, so the brand is what separates them.
const HEIC_BRANDS = new Set([
  'heic', 'heix', 'heim', 'heis', // still images
  'hevc', 'hevx', 'hevm', 'hevs', // image sequences
  'mif1', 'msf1', // generic HEIF, which iOS also emits
])

const HEIC_EXTENSIONS = ['.heic', '.heif']
const HEADER_BYTES = 12

export type HeicCheck = {
  /** The only answer that matters for routing. Decided by the bytes, never by the name. */
  isHeic: boolean
  /** The filename claims HEIC. A hint, and on its own worth nothing. */
  claimedByName: boolean
  /**
   * Named `.heic` but the bytes say otherwise — iOS Safari substituting a JPEG at selection
   * time, depending on the input's `accept` attribute (agent-cache/knowledge.md). Surfaced
   * rather than swallowed: without it the pipeline looks like it works while never once
   * receiving a HEIC, and every check passes on a laptop.
   */
  substituted: boolean
  /**
   * The first slice could not be read. A photo still in iCloud gives a File with a plausible
   * `size` that fails at read time, not at selection time, so `file.size` proves nothing.
   */
  unreadable: boolean
  /** The ftyp brand, e.g. `heic`, `mif1`. Empty when the header could not be read. */
  brand: string
  /** The first 12 bytes, for the inspector panel in the standalone viewer. */
  magicHex: string
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end))
}

export async function checkHeic(file: File): Promise<HeicCheck> {
  const claimedByName = HEIC_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))

  const blank = { isHeic: false, claimedByName, substituted: false, unreadable: true, brand: '', magicHex: '' }

  let head: Uint8Array
  try {
    head = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer())
  } catch {
    return blank
  }
  if (head.length < HEADER_BYTES) return blank

  const magicHex = [...head].map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')
  const brand = ascii(head, 4, 8) === 'ftyp' ? ascii(head, 8, 12) : ''
  const isHeic = brand !== '' && HEIC_BRANDS.has(brand)

  return { isHeic, claimedByName, substituted: claimedByName && !isHeic, unreadable: false, brand, magicHex }
}

export async function isHeic(file: File): Promise<boolean> {
  return (await checkHeic(file)).isHeic
}
