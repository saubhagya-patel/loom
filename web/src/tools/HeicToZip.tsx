import { useState } from 'react'
import { convertImage, type ConvertType } from '../heic/convert.ts'
import { Dropzone } from './Dropzone.tsx'
import { ToolShell } from './ToolShell.tsx'

// docs/trd-utilities.md §1: decoding several images and holding a zip alongside them is what
// crashes a tab on the low-end device these tools are for. The cap is a queue, not a refusal —
// over it, the batch becomes "archive 1 of 3" and keeps going.
const MAX_FILES = 20
const MAX_BYTES = 100 * 1024 * 1024

type Progress = { archive: number; archives: number; done: number; total: number } | null

function planBatches(files: File[]): File[][] {
  const batches: File[][] = []
  let current: File[] = []
  let size = 0
  for (const file of files) {
    if (current.length >= MAX_FILES || (current.length > 0 && size + file.size > MAX_BYTES)) {
      batches.push(current)
      current = []
      size = 0
    }
    current.push(file)
    size += file.size
  }
  if (current.length) batches.push(current)
  return batches
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  // The click is synchronous but the download is not, so give the browser the tick it needs
  // before the URL stops resolving.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function HeicToZip() {
  const [type, setType] = useState<ConvertType>('image/jpeg')
  const [progress, setProgress] = useState<Progress>(null)
  const [failed, setFailed] = useState<string[]>([])
  const [finished, setFinished] = useState<{ archives: number; files: number } | null>(null)

  async function run(files: File[]): Promise<void> {
    const batches = planBatches(files)
    const failures: string[] = []
    let converted = 0
    setFailed([])
    setFinished(null)

    // Imported here so the viewer never downloads it.
    const { default: JSZip } = await import('jszip')
    const extension = type === 'image/png' ? '.png' : '.jpg'

    for (const [index, batch] of batches.entries()) {
      const zip = new JSZip()
      let added = 0

      for (const [n, file] of batch.entries()) {
        setProgress({ archive: index + 1, archives: batches.length, done: n, total: batch.length })
        try {
          const out = await convertImage(file, { type })
          // The source is not held past this point: keeping both copies of twenty photos is
          // the crash the cap exists to prevent.
          zip.file(file.name.replace(/\.[^.]+$/, '') + extension, out)
          added++
          converted++
        } catch {
          failures.push(file.name)
        }
      }

      if (added > 0) {
        const name = batches.length === 1 ? 'converted-photos.zip' : `converted-photos-${index + 1}.zip`
        download(await zip.generateAsync({ type: 'blob' }), name)
      }
    }

    setProgress(null)
    setFailed(failures)
    setFinished({ archives: batches.length, files: converted })
  }

  return (
    <ToolShell
      title="Convert a pile of HEICs at once"
      lede="Drop as many as you like. They are converted on your machine and come back as one zip — nothing is uploaded anywhere."
      other={{ to: '/tools/heic-viewer', label: '← View just one' }}
    >
      <div className="format-choice">
        <span className="label muted">Convert to</span>
        <div className="segmented segmented--sm">
          <button aria-current={type === 'image/jpeg'} onClick={() => setType('image/jpeg')}>
            JPEG
          </button>
          <span className="segmented-rule" />
          <button aria-current={type === 'image/png'} onClick={() => setType('image/png')}>
            PNG
          </button>
        </div>
        <span className="fine">
          {type === 'image/png'
            ? 'Lossless, and several times larger.'
            : 'Opens everywhere, much smaller.'}
        </span>
      </div>

      <Dropzone
        multiple
        label="Drop your .heic photos here"
        note={`Up to ${MAX_FILES} per zip — drop more and you will get several, rather than a refusal.`}
        onFiles={(files) => void run(files)}
      />

      {progress ? (
        <p className="notice mono">
          {progress.archives > 1 ? `Archive ${progress.archive} of ${progress.archives} · ` : ''}
          Converting {progress.done + 1} of {progress.total}…
        </p>
      ) : null}

      {finished ? (
        <p className="notice notice--verified">
          Converted {finished.files} {finished.files === 1 ? 'photo' : 'photos'} into{' '}
          {finished.archives === 1 ? 'one zip' : `${finished.archives} zips`}. Check your
          downloads.
        </p>
      ) : null}

      {failed.length > 0 ? (
        <div className="notice notice--alert">
          <p>
            {failed.length} {failed.length === 1 ? 'file' : 'files'} could not be converted — the
            rest are in your zip:
          </p>
          <ul className="fail-list mono">
            {failed.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </ToolShell>
  )
}
