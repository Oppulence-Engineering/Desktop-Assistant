"use client";
import { Alert, Button } from "@heroui/react";

// Backstop for project segments without their own error.tsx. retry()
// re-fetches and re-renders the failed segment in place.
export default function Error(props: { error: Error; retry: () => void }) {
  return (
    <Alert color="danger" title="Something went wrong">
      <div className="flex flex-col items-start gap-2">
        <span>{props.error.message}</span>
        <Button size="sm" variant="flat" color="danger" onPress={() => props.retry()}>
          Try again
        </Button>
      </div>
    </Alert>
  );
}
