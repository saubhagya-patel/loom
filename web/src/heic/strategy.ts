// TRD §6's three routes. An `as const` object rather than an enum: Node's type erasure cannot
// load an enum (docs/plan.md §2.10), and these types are shared with the backend half.
export const STRATEGIES = ['device', 'cloud', 'raw'] as const
export type Strategy = (typeof STRATEGIES)[number]

export const DEFAULT_STRATEGY: Strategy = 'device'

export type StrategyChoice = {
  value: Strategy
  title: string
  detail: string
  /** True where the file leaves the browser unconverted through our server (TRD §1's exception). */
  touchesServer: boolean
}

export const STRATEGY_CHOICES: readonly StrategyChoice[] = [
  {
    value: 'device',
    title: 'Convert on this device',
    detail:
      'Your photos are converted to JPEG here in your browser. Nothing about them reaches any ' +
      'server. Slower on older phones.',
    touchesServer: false,
  },
  {
    value: 'cloud',
    title: 'Convert on our server',
    detail:
      'Faster on older or budget phones. Your photo passes through our server while it is ' +
      'converted — it is never written to disk and never stored, but it does leave your device ' +
      'unencrypted to us.',
    touchesServer: true,
  },
  {
    value: 'raw',
    title: 'Upload as HEIC',
    detail:
      'Fastest, and keeps the original quality. Goes straight to your Drive, but HEIC will not ' +
      'open on every device.',
    touchesServer: false,
  },
]
