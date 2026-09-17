"use client";

import "client-only";

import type { ReactNode } from "react";

import { AuthGate } from "@/components/auth-gate";
import { GoogleOAuthReturnHandler } from "@/components/features/connectors/google-oauth-return-handler";
import { ChatRouteProvider } from "@/components/features/dashboard/chat-route-provider/chat-route-provider";
import { DashboardShell } from "@/components/features/dashboard/dashboard-shell/dashboard-shell";
import type { BrowserSessionResponse } from "@/lib/auth/schemas";

export type ProductDashboardClientProps = {
  children: ReactNode;
  initialSession: Extract<BrowserSessionResponse, { authenticated: true }>;
};

/**
 * Keeps authentication hydration at the persistent product-layout boundary.
 * Chat state is mounted above route children so App Router navigation replaces
 * only the leaf route and cannot discard an in-progress conversation.
 */
export default function ProductDashboardClient({
  children,
  initialSession,
}: ProductDashboardClientProps) {
  return (
    <AuthGate initialSession={initialSession}>
      <GoogleOAuthReturnHandler />
      <ChatRouteProvider>
        <DashboardShell>{children}</DashboardShell>
      </ChatRouteProvider>
    </AuthGate>
  );
}
