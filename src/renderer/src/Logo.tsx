/** OpenPDF's mark: a page with a folded corner and an open ring. Original artwork for this project. */
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <path d="M7 3h12l7 7v17a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="var(--accent)" />
      <path d="M19 3v5a2 2 0 0 0 2 2h5z" fill="#fff" opacity="0.55" />
      <circle cx="15.5" cy="19" r="5.2" fill="none" stroke="#fff" strokeWidth="2.6" />
      <path d="M19.2 15.3l3.2-3.2" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  )
}
