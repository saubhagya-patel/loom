import { useState } from 'react'
import { convertImage } from '../heic/convert.ts'
import { bytes } from '../ui/format.ts'
import { Dropzone } from './Dropzone.tsx'
import { ToolShell } from './ToolShell.tsx'
import { useRevokeObjectUrl } from './useObjectUrl.ts'

type Shown = { name: string; sourceBytes: number; size: number; url: string }

export function HeicViewer() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shown, setShown] = useState<Shown | null>(null)

  // Replacing this URL revokes the previous one; so does leaving the page.
  useRevokeObjectUrl(shown?.url ?? null)

  async function open(files: File[]): Promise<void> {
    const file = files[0]
    if (!file) return
    setBusy(true)
    setError(null)
    setShown(null)
    try {
      const out = await convertImage(file)
      setShown({
        name: file.name,
        sourceBytes: file.size,
        size: out.size,
        // Created here, in the handler that made the blob — see useRevokeObjectUrl.
        url: URL.createObjectURL(out),
      })
    } catch {
      setError(`${file.name} could not be opened. It may not be an image, or it may be damaged.`)
    } finally {
      setBusy(false)
    }
  }

  const downloadName = shown ? shown.name.replace(/\.[^.]+$/, '') + '.jpg' : ''

  return (
    <ToolShell
      title="See a HEIC, right now"
      lede="Apple's photo format does not open on most of Windows and Android. Drop one here and look at it — no account, no install, no upload."
      other={{ to: '/tools/heic-to-zip', label: 'Convert many →' }}
    >
      <Dropzone
        label={shown ? 'Drop another photo' : 'Drop a .heic photo here'}
        note="It is decoded on your own machine. Large files take a moment the first time, while the decoder loads."
        onFiles={(files) => void open(files)}
      />

      {busy ? <p className="notice mono">Decoding…</p> : null}
      {error ? <p className="notice notice--alert">{error}</p> : null}

      {shown ? (
        <figure className="viewer">
          <img className="viewer-image" src={shown.url} alt={shown.name} />
          <figcaption className="viewer-bar">
            <span className="viewer-name mono">{shown.name}</span>
            <span className="viewer-meta mono">
              {bytes(shown.sourceBytes)} → {bytes(shown.size)} JPEG
            </span>
            {/* The same object URL the <img> is using; the hook still owns its lifetime. */}
            <a className="btn btn--clay" href={shown.url} download={downloadName}>
              Download as JPEG
            </a>
          </figcaption>
        </figure>
      ) : null}
    </ToolShell>
  )
}
