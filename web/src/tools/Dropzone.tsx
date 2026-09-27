import { useRef, useState } from 'react'

export function Dropzone({
  multiple,
  accept = 'image/*,.heic,.heif',
  label,
  note,
  chips,
  onFiles,
}: {
  multiple?: boolean
  accept?: string
  label: string
  note: string
  chips?: string[]
  onFiles: (files: File[]) => void
}) {
  const picker = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  return (
    <div
      className={`ingest${dragging ? ' ingest--live' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const files = [...e.dataTransfer.files]
        if (files.length) onFiles(multiple ? files : files.slice(0, 1))
      }}
    >
      <span className="tick tick--tl" />
      <span className="tick tick--tr" />
      <span className="tick tick--bl" />
      <span className="tick tick--br" />

      <span className="ingest-glyph" aria-hidden>
        <svg viewBox="0 0 24 24" width="22" height="22">
          <rect x="3" y="5" width="18" height="14" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="8.5" cy="10" r="1.6" fill="currentColor" />
          <path d="M4 17l5-5 4 4 3-2.5L20 17" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </span>

      <p className="ingest-title">{label}</p>
      <p className="ingest-note">{note}</p>

      {chips ? (
        <div className="ingest-chips mono">
          {chips.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </div>
      ) : null}

      <div className="ingest-actions">
        <button className="btn btn--clay" onClick={() => picker.current?.click()}>
          Browse {multiple ? 'files' : 'a file'}
        </button>
      </div>

      <input
        ref={picker}
        type="file"
        multiple={multiple}
        // Not `accept="image/heic"` alone: iOS Safari transcodes HEIC to JPEG at selection
        // depending on this attribute, and the tool would silently receive JPEGs.
        accept={accept}
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          if (files.length) onFiles(files)
        }}
      />
    </div>
  )
}
