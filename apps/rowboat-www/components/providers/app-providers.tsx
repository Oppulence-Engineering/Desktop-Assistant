"use client";

import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import { Toaster } from "@oppulence/ui/components/sonner";
import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";

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
      <AppRouterCacheProvider options={{ key: "css" }}>
        {children}
        <DevProviders enabled={devToolsEnabled} />
        <Toaster richColors closeButton position="bottom-right" />
      </AppRouterCacheProvider>
    </ThemeProvider>
  );
}
