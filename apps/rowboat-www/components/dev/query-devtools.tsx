"use client";

import dynamic from "next/dynamic";

import { isDevelopment } from "@/lib/environment";

const ReactQueryDevtools = dynamic(
  () => import("@tanstack/react-query-devtools").then((mod) => mod.ReactQueryDevtools),
  { ssr: false },
);

/** TanStack Query inspector — product routes only, development builds. */
export function QueryDevtoolsPanel() {
  if (!isDevelopment()) return null;
  return <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />;
}
