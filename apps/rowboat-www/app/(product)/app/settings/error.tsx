"use client";

import { WarningCircleIcon } from "@/lib/icons";

import { Button } from "@oppulence/ui/components/button";

export default function SettingsError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section
      className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center"
      role="alert"
    >
      <WarningCircleIcon aria-hidden className="size-8 text-destructive" />
      <div>
        <h1 className="font-semibold">Settings could not be loaded</h1>
        <p className="mt-1 text-sm text-muted-foreground">Try the request again.</p>
      </div>
      <Button type="button" onClick={reset}>
        Try again
      </Button>
    </section>
  );
}
