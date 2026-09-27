import { useState } from 'react'
import { convertImage, DEFAULT_QUALITY } from '../heic/convert.ts'
import { checkHeic } from '../heic/detect.ts'
import { bytes } from '../ui/format.ts'
import { Dropzone } from './Dropzone.tsx'
import { ToolShell } from './ToolShell.tsx'
import { useRevokeObjectUrl } from './useObjectUrl.ts'

// 1.00 is labelled "Maximum", not "Lossless". JPEG at maximum quality is still lossy, and the
// source is an already-lossy HEIC — calling it lossless would be the one kind of untrue thing
// this product cannot afford to say.
const PRESETS = [
  { q: 0.5, label: 'Compact' },
  { q: 0.82, label: 'Social' },
  { q: DEFAULT_QUALITY, label: 'Optimal' },
  { q: 1, label: 'Maximum' },
]

type Loaded = {
  name: string
  sourceBytes: number
  brand: string
  magicHex: string
  isHeic: boolean
  width: number
  height: number
  url: string
  outBytes: number
  ms: number
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

export function HeicViewer() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [quality, setQuality] = useState(DEFAULT_QUALITY)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  // Kept so changing the quality re-encodes the same photo rather than asking for it again.
  const [source, setSource] = useState<File | null>(null)
  useRevokeObjectUrl(loaded?.url ?? null)

  async function open(files: File[], q = quality): Promise<void> {
    const file = files[0] ?? source
    if (!file) return
    setSource(file)
    setBusy(true)
    setError(null)
    try {
      const probe = await checkHeic(file)
      const started = performance.now()
      const out = await convertImage(file, { quality: q })
      const ms = Math.round(performance.now() - started)

      // Dimensions come from the decoded output rather than a parsed header — the numbers a
      // person actually cares about, and no EXIF is read to get them.
      const bmp = await createImageBitmap(out)
      const { width, height } = bmp
      bmp.close()

      setLoaded({
        name: file.name,
        sourceBytes: file.size,
        brand: probe.brand,
        magicHex: probe.magicHex,
        isHeic: probe.isHeic,
        width,
        height,
        url: URL.createObjectURL(out),
        outBytes: out.size,
        ms,
      })
    } catch {
      setError(`${file.name} could not be decoded. It may not be an image, or it may be damaged.`)
      setLoaded(null)
    } finally {
      setBusy(false)
    }
  }

  const divisor = loaded ? gcd(loaded.width, loaded.height) : 1
  const delta = loaded ? Math.round((1 - loaded.outBytes / loaded.sourceBytes) * 100) : 0

  return (
    <ToolShell
      eyebrow="Client-side decoding sandbox"
      title="HEIC inspector & direct transcoder"
      lede="Open an Apple photo that Windows and Android refuse to show, read what is actually inside it, and take a JPEG away. Nothing is uploaded."
      other={{ to: '/tools/heic-to-zip', label: 'Switch to HEIC to ZIP' }}
    >
      <div className="viewer-grid">
        <div className="viewer-left">
          <Dropzone
            label={loaded ? 'Drop another photo to inspect' : 'Drop a HEIC here to inspect and decode'}
            note="Supports .heic and .heif. Decoded on this device — the first decode may also fetch the WebAssembly decoder, which takes a moment."
            chips={['No upload', 'No account', 'Released when you close the tab']}
            onFiles={(files) => void open(files)}
          />

          {busy ? <p className="notice mono">Decoding…</p> : null}
          {error ? <p className="notice notice--alert">{error}</p> : null}

          {loaded ? (
            <figure className="canvas-panel">
              <figcaption className="canvas-bar mono">
                <span className="label">Decoded pixel buffer</span>
                <span className="canvas-dims">
                  {loaded.width} × {loaded.height}
                </span>
              </figcaption>
              <img className="canvas-image" src={loaded.url} alt={loaded.name} />
            </figure>
          ) : null}
        </div>

        <div className="viewer-right">
          {loaded ? (
            <>
              <section className="panel">
                <header className="panel-head">
                  <span className="label">Header inspection</span>
                  <span className={`pill-tag mono${loaded.isHeic ? ' pill-tag--ok' : ''}`}>
                    {loaded.isHeic ? `Valid ISO-BMFF · ${loaded.brand}` : 'Not HEIC'}
                  </span>
                </header>
                <dl className="spec">
                  <Row k="File name" v={loaded.name} />
                  <Row k="Container brand" v={loaded.brand ? `ftyp ${loaded.brand}` : 'not an ISO-BMFF container'} />
                  <Row k="Magic bytes" v={loaded.magicHex} />
                  <Row k="Original payload" v={`${bytes(loaded.sourceBytes)} (${loaded.sourceBytes.toLocaleString()} bytes)`} />
                  <Row k="Decoded dimensions" v={`${loaded.width} × ${loaded.height} px (${((loaded.width * loaded.height) / 1e6).toFixed(1)} MP)`} />
                  <Row k="Aspect ratio" v={`${loaded.width / divisor}:${loaded.height / divisor}`} />
                </dl>
                <p className="panel-note mono">
                  Read from the container header and the decode. No EXIF is parsed — Loom never
                  reads it anywhere.
                </p>
              </section>

              <section className="panel">
                <header className="panel-head">
                  <span className="label">Client transcode</span>
                  <span className="pill-tag mono">OffscreenCanvas</span>
                </header>

                <div className="quality">
                  <div className="quality-top">
                    <span className="label">JPEG quality</span>
                    <span className="quality-value mono">{quality.toFixed(2)}</span>
                  </div>
                  <input
                    className="quality-range"
                    type="range"
                    min={0.4}
                    max={1}
                    step={0.01}
                    value={quality}
                    disabled={busy}
                    onChange={(e) => setQuality(Number(e.target.value))}
                    // Re-encode on release rather than on every pixel of drag: each one is a
                    // full decode and encode.
                    onPointerUp={() => void open([], quality)}
                    onKeyUp={() => void open([], quality)}
                  />
                  <div className="quality-presets">
                    {PRESETS.map((p) => (
                      <button
                        key={p.q}
                        className={`preset mono${Math.abs(quality - p.q) < 0.005 ? ' preset--on' : ''}`}
                        disabled={busy}
                        onClick={() => {
                          setQuality(p.q)
                          void open([], p.q)
                        }}
                      >
                        {p.q.toFixed(2)} {p.label}
                      </button>
                    ))}
                  </div>
                  <p className="panel-note mono">
                    1.00 is maximum, not lossless — JPEG is lossy at every setting, and this
                    source is an already-lossy HEIC.
                  </p>
                </div>

                <div className="measure-row">
                  <div className="measure">
                    <span className="label">Output size</span>
                    <span className="measure-value mono">{bytes(loaded.outBytes)}</span>
                    <span className="measure-note mono">
                      {delta >= 0 ? `${delta}% smaller` : `${-delta}% larger`} than the source
                    </span>
                  </div>
                  <div className="measure">
                    <span className="label">Decode + encode</span>
                    <span className="measure-value mono">{loaded.ms} ms</span>
                    <span className="measure-note mono">on this device</span>
                  </div>
                </div>

                <a
                  className="btn btn--clay btn--block"
                  href={loaded.url}
                  download={loaded.name.replace(/\.[^.]+$/, '') + '.jpg'}
                >
                  Download JPEG
                </a>
                <p className="panel-note mono">
                  Decoded locally · zero analytics · memory released when you close this tab.
                </p>
              </section>
            </>
          ) : (
            <section className="panel panel--waiting">
              <span className="label">Header inspection</span>
              <p className="panel-waiting mono">
                Drop a file to read its container brand, magic bytes and decoded dimensions.
              </p>
            </section>
          )}
        </div>
      </div>

      <section className="mechanics">
        <span className="eyebrow label">How it works</span>
        <h2 className="display display--sm">Client-side HEIC pipeline</h2>
        <p className="lede">
          Most web converters upload your photographs to someone else&rsquo;s transcoding
          server. This one never makes a request at all.
        </p>
        <ol className="mechanics-list">
          <li>
            <span className="mechanics-n mono">01</span>
            <h3 className="mechanics-title">Native decode first</h3>
            <p>
              Safari and modern Chrome can open HEIC themselves, so on those the browser does
              the work and no decoder is downloaded at all.
            </p>
          </li>
          <li>
            <span className="mechanics-n mono">02</span>
            <h3 className="mechanics-title">WebAssembly fallback</h3>
            <p>
              Where the browser refuses — which is most of Windows and Android, and the reason
              this tool exists — libheif runs compiled to WebAssembly in a worker thread.
            </p>
          </li>
          <li>
            <span className="mechanics-n mono">03</span>
            <h3 className="mechanics-title">Memory released on exit</h3>
            <p>
              The decoded frame is closed as soon as it is drawn, and the object URL is revoked
              when you replace the image or leave the page.
            </p>
          </li>
        </ol>
      </section>
    </ToolShell>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="spec-row">
      <dt className="spec-k">{k}</dt>
      <dd className="spec-v mono">{v}</dd>
    </div>
  )
}
