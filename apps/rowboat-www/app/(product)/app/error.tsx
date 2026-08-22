"use client";

import { WarningCircleIcon } from "@phosphor-icons/react";

import { Button } from "@oppulence/ui/components/button";

export default function ProductError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-6">
      <section className="flex max-w-md flex-col items-center gap-4 text-center" role="alert">
        <WarningCircleIcon aria-hidden className="size-8 text-destructive" />
        <div>
          <h1 className="font-semibold">The workspace could not be loaded</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Try the request again. If the problem continues, sign in again from a fresh session.
          </p>
        </div>
        <Button type="button" onClick={reset}>
          Try again
        </Button>
      </section>
    </main>
  );
}
