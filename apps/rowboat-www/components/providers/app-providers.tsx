"use client";

import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import { Toaster } from "@oppulence/ui/components/sonner";
import { ThemeProvider } from "next-themes";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Suspense, type ReactNode } from "react";

import { DevProviders } from "@/components/providers/dev-providers";

/**
 * Root client boundary for the whole app. Mirrors the Better Auth docs shell:
 * theme class on `<html>`, global toasts, and MUI's App Router cache for any
 * remaining Material icons used on marketing pages.
 */
export function AppProviders({
  children,
  devToolsEnabled,
}: {
  children: ReactNode;
  devToolsEnabled: boolean;
}) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {/*
        Nuqs reads searchParams. Next.js Cache Components requires that
        request-time API behind a Suspense boundary so the root layout can
        still emit a static shell (see Request-time APIs in the production
        checklist).
      */}
      <Suspense fallback={null}>
        <NuqsAdapter>
          <AppRouterCacheProvider options={{ key: "css" }}>
            {children}
            <DevProviders enabled={devToolsEnabled} />
            <Toaster richColors closeButton position="bottom-right" />
          </AppRouterCacheProvider>
        </NuqsAdapter>
      </Suspense>
    </ThemeProvider>
  );
}
