"use client";

/**
 * Marketing-segment error boundary. Keeps the public chrome from the
 * group layout and recovers with `retry`.
 */
export default function MarketingError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main className="flex min-h-[60vh] items-center justify-center px-6">
      <section className="flex max-w-md flex-col items-center gap-4 text-center" role="alert">
        <h1 className="font-medium text-[var(--text-primary)] text-[28px] leading-tight">
          This page could not be loaded
        </h1>
        <p className="text-[15px] text-[var(--text-body)] leading-6">
          Try again. If it keeps failing, go back to the homepage.
        </p>
        <button
          className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 text-[14px] text-[var(--text-primary)]"
          onClick={() => retry()}
          type="button"
        >
          Try again
        </button>
      </section>
    </main>
  );
}
