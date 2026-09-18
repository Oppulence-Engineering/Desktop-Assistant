import { CircleNotchIcon } from "@/lib/icons";

export default function ProductLoading() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <CircleNotchIcon aria-hidden className="size-5 animate-spin" />
        Loading workspace
      </div>
    </main>
  );
}
