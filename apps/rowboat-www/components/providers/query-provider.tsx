"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { QueryDevtoolsPanel } from "@/components/dev/query-devtools";
import { createAppQueryClient } from "@/lib/query/get-query-client";

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => createAppQueryClient());

  return (
    <QueryClientProvider client={client}>
      {children}
      <QueryDevtoolsPanel />
    </QueryClientProvider>
  );
}
