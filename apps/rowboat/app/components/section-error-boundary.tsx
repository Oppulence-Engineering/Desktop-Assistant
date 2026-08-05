"use client";

import { catchError, type ErrorInfo } from "next/error";
import { Alert, Button } from "@heroui/react";

/**
 * Section-scoped error boundary for server-rendered data sections. Unlike a
 * segment error.tsx, retry() re-renders the failed Server Components in
 * place — a transient backend error (e.g. rowboat-api unavailable) recovers
 * without a full page reload or lost client state. Does not interfere with
 * notFound() or redirect().
 */
function SectionErrorFallback(props: { title: string }, { error, retry }: ErrorInfo) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <Alert color="danger" title={props.title}>
      <div className="flex flex-col items-start gap-2">
        <span>{message}</span>
        <Button size="sm" variant="flat" color="danger" onPress={() => retry()}>
          Try again
        </Button>
      </div>
    </Alert>
  );
}

export default catchError(SectionErrorFallback);
