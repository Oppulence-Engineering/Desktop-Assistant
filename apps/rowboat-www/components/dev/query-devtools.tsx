"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const ReactQueryDevtools = dynamic(
  () => import("@tanstack/react-query-devtools").then((mod) => mod.ReactQueryDevtools),
  { ssr: false },
);

/** TanStack Query inspector — product routes only, development builds. */
export function QueryDevtoolsPanel() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (process.env.NODE_ENV !== "development" || !mounted) return null;
  return <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />;
}
