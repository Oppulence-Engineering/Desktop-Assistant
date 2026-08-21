import type { ReactNode } from "react";

import { QueryProvider } from "@/components/providers/query-provider";
import { requireSession } from "@/lib/auth/session";

// Authentication must complete before response headers are committed so an
// anonymous direct request receives a real HTTP redirect, not an in-stream one.
export const instant = false;

export default async function ProductLayout({ children }: { children: ReactNode }) {
  await requireSession("/app");
  return <QueryProvider>{children}</QueryProvider>;
}
