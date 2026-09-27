/** The loom mark: an obsidian plate with an aperture cut into it. */
export function Emblem({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" aria-hidden focusable="false">
      <rect width="34" height="34" rx="9" fill="var(--ink)" />
      <rect x="10" y="10" width="14" height="14" rx="3" fill="none" stroke="var(--canvas)" strokeWidth="1.6" />
      <circle cx="17" cy="17" r="2.4" fill="var(--canvas)" />
    </svg>
  )
}
