/** SYNK mark: three agent nodes converging on one shared node. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path d="M5 6 L12 13 M19 6 L12 13 M12 21 L12 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.55" />
      <circle cx="5" cy="6" r="2.25" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="19" cy="6" r="2.25" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="21" r="2.25" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="13" r="2.75" fill="currentColor" />
    </svg>
  );
}
