import { notFound } from "next/navigation";
import type { ReactNode } from "react";

/** Dev-only routes — never ship tooling pages in production. */
export default function DevLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  return (
    <div className="min-h-dvh bg-background text-foreground font-mono text-sm p-8">{children}</div>
  );
}
