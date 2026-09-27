import { useState } from 'react'
import { DEFAULT_STRATEGY, STRATEGY_CHOICES, type Strategy } from '../heic/strategy.ts'

// TRD §6's pre-upload modal. Shown only when a batch actually contains HEIC — by magic bytes,
// not by filename.
export function DecisionModal({
  heicCount,
  substitutedCount,
  onChoose,
  onCancel,
}: {
  heicCount: number
  substitutedCount: number
  onChoose: (strategy: Strategy) => void
  onCancel: () => void
}) {
  // On-device is the default and stays the default. The cloud route is the single exception to
  // TRD §1's zero-knowledge claim, so it is always a deliberate choice (docs/plan.md §2.7).
  const [choice, setChoice] = useState<Strategy>(DEFAULT_STRATEGY)

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="heic-title">
      <div className="modal">
        <h2 id="heic-title">
          {heicCount} {heicCount === 1 ? 'photo is' : 'photos are'} in HEIC format
        </h2>
        <p className="muted">
          HEIC is Apple&rsquo;s format. It saves space but does not open everywhere. How would you
          like these handled?
        </p>

        <div className="choices">
          {STRATEGY_CHOICES.map((option) => (
            <label key={option.value} className={`choice${choice === option.value ? ' choice--on' : ''}`}>
              <input
                type="radio"
                name="heic-strategy"
                checked={choice === option.value}
                onChange={() => setChoice(option.value)}
              />
              <span>
                <strong>{option.title}</strong>
                {option.value === DEFAULT_STRATEGY ? <em className="tag">recommended</em> : null}
                <span className="choice-detail">{option.detail}</span>
              </span>
            </label>
          ))}
        </div>

        {substitutedCount > 0 ? (
          <p className="fine">
            {substitutedCount} file{substitutedCount === 1 ? '' : 's'} named .heic turned out to be
            JPEG already — your browser converted {substitutedCount === 1 ? 'it' : 'them'} on
            selection. {substitutedCount === 1 ? 'It' : 'They'} will upload as-is.
          </p>
        ) : null}

        <div className="modal-actions">
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" onClick={() => onChoose(choice)}>
            Upload {heicCount === 1 ? 'it' : 'them'}
          </button>
        </div>
      </div>
    </div>
  )
}
