// heic-decode ships no types. Its surface is one function, so this is the whole of it.
declare module 'heic-decode' {
  export type DecodedHeic = {
    width: number
    height: number
    /** Raw RGBA, four bytes per pixel. */
    data: Uint8ClampedArray
  }
  export default function decode(input: { buffer: Uint8Array }): Promise<DecodedHeic>
  export function all(input: { buffer: Uint8Array }): Promise<{ decode: () => Promise<DecodedHeic> }[]>
}
