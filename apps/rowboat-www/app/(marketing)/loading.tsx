/**
 * Marketing App Shell for Partial Prefetching. Instant navigations between
 * public routes show this fallback immediately while the destination streams
 * (see loading.js + linking-and-navigating).
 */
export default function MarketingLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="min-h-[70vh] bg-[var(--bg)]">
      <span className="sr-only">Loading</span>
      <div className="mx-auto w-full max-w-[1280px] px-6 pt-28">
        <div className="h-10 w-2/3 max-w-xl animate-pulse rounded-md bg-[var(--surface-3)]" />
        <div className="mt-6 h-5 w-full max-w-md animate-pulse rounded-md bg-[var(--surface-3)]" />
        <div className="mt-16 aspect-[16/8] w-full animate-pulse rounded-xl bg-[var(--surface-3)]" />
      </div>
    </div>
  );
}
