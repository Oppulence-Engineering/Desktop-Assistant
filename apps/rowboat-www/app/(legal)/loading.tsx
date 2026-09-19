/** Legal-group loading shell so /privacy and /terms navigate immediately. */
export default function LegalLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="min-h-[60vh] bg-[var(--bg)]">
      <span className="sr-only">Loading</span>
    </div>
  );
}
