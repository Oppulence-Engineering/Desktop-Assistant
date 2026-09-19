"use client";

import { Button } from "@oppulence/ui/components/button";

/**
 * Segment error boundary below the root layout. `retry` re-renders the
 * failed tree (Next.js 16.3 error.js).
 */
export default function AppError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-6">
      <section className="flex max-w-md flex-col items-center gap-4 text-center" role="alert">
        <h1 className="font-semibold">This page could not be loaded</h1>
        <p className="text-sm text-muted-foreground">
          Try the request again. If it keeps failing, reload the page.
        </p>
        <Button onClick={() => retry()} type="button">
          Try again
        </Button>
      </section>
    </main>
  );
}
