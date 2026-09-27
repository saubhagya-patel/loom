import { useRef, useState, type ReactNode } from 'react'

export function Dropzone({
  multiple,
  accept = 'image/*,.heic,.heif',
  label,
  note,
  onFiles,
  children,
}: {
  multiple?: boolean
  accept?: string
  label: string
  note: string
  onFiles: (files: File[]) => void
  children?: ReactNode
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
      <span className="tick tick--tl label">+0.0</span>
      <span className="tick tick--tr label">+1.0</span>
      <span className="tick tick--bl label">-0.0</span>
      <span className="tick tick--br label">-1.0</span>

      <p className="ingest-title">{label}</p>
      <p className="ingest-note">{note}</p>
      <div className="ingest-actions">
        <button className="btn btn--clay" onClick={() => picker.current?.click()}>
          Choose {multiple ? 'files' : 'a file'}
        </button>
      </div>
      {children}

      <input
        ref={picker}
        type="file"
        multiple={multiple}
        // No `accept="image/heic"` alone: iOS Safari transcodes HEIC to JPEG at selection
        // depending on this attribute, and a viewer that silently received JPEGs would look
        // like it worked while never doing its job (agent-cache/knowledge.md).
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
