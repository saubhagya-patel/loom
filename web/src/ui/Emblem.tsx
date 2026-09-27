/** The loom mark: an obsidian plate with an aperture cut into it. */
export function Emblem({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" aria-hidden focusable="false">
      <rect width="30" height="30" rx="6" fill="var(--ink)" />
      <rect x="8.5" y="8.5" width="13" height="13" rx="2.5" fill="none" stroke="var(--canvas)" strokeWidth="1.5" />
      <circle cx="15" cy="15" r="2.25" fill="var(--canvas)" />
    </svg>
  )
}
