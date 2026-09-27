import { useState } from 'react'
import { DEFAULT_STRATEGY, STRATEGY_CHOICES, type Strategy } from '../heic/strategy.ts'

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
  // On-device stays the default. The cloud route is the one exception to the privacy claim,
  // so it is always a deliberate choice (docs/plan.md §2.7).
  const [choice, setChoice] = useState<Strategy>(DEFAULT_STRATEGY)

  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-labelledby="heic-title">
      <div className="sheet-panel">
        <span className="eyebrow label">Pre-flight decision</span>
        <h2 id="heic-title" className="headline headline--sm">
          {heicCount} {heicCount === 1 ? 'photo is' : 'photos are'} HEIC
        </h2>
        <p className="lede">
          Apple&rsquo;s format saves space but does not open everywhere. How should these be
          handled?
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
              <span className="choice-body">
                <span className="choice-head">
                  <span className="choice-title">{option.title}</span>
                  {option.value === DEFAULT_STRATEGY ? (
                    <span className="tag label">Recommended</span>
                  ) : null}
                  {option.touchesServer ? <span className="tag tag--warn label">Leaves device</span> : null}
                </span>
                <span className="choice-detail">{option.detail}</span>
              </span>
            </label>
          ))}
        </div>

        {substitutedCount > 0 ? (
          <p className="log-detail mono">
            {substitutedCount} other file{substitutedCount === 1 ? '' : 's'} named .heic turned out
            to already be JPEG and will upload as-is.
          </p>
        ) : null}

        <div className="sheet-actions">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn--clay" onClick={() => onChoose(choice)}>
            Upload {heicCount === 1 ? 'it' : 'them'}
          </button>
        </div>
      </div>
    </div>
  )
}
