import type { ReactNode } from "react";

declare function requireSession(): Promise<unknown>;

export default async function ProductLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return children;
}
