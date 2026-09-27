// heic-decode ships no types. Its surface is small, so this is the whole of it.
declare module 'heic-decode' {
  export type DecodedHeic = {
    width: number
    height: number
    /** Raw RGBA, four bytes per pixel. */
    data: Uint8ClampedArray
  }
  /** Each entry reports its size before anything is decoded. `dispose` frees the WASM memory. */
  export type HeicImageList = { width: number; height: number; decode: () => Promise<DecodedHeic> }[] & {
    dispose: () => void
  }
  export default function decode(input: { buffer: Uint8Array }): Promise<DecodedHeic>
  export function all(input: { buffer: Uint8Array }): Promise<HeicImageList>
}
