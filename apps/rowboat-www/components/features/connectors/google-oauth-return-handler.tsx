"use client";

import "client-only";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { dashboardFetch } from "@/lib/auth/client";
import { RELATIONSHIP_SOURCE_STATUS_QUERY_KEY } from "@/lib/revenue";

export const GOOGLE_OAUTH_CONNECTED_EVENT = "oppulence:google-oauth-connected";

function replaceOAuthParameters(url: URL, connected: boolean): void {
  url.searchParams.delete("google_session");
  url.searchParams.delete("google_status");
  if (connected && url.pathname === "/app/report") {
    url.searchParams.set("google_connected", "1");
  } else {
    url.searchParams.delete("google_connected");
  }
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

/**
 * Claims web OAuth handoff tickets at the persistent authenticated boundary.
 *
 * Claiming cannot live on the Settings page: Open Promises now returns directly
 * to its own route, and every successful claim must invalidate the same source
 * status cache regardless of which product surface initiated consent.
 */
export function GoogleOAuthReturnHandler() {
  const queryClient = useQueryClient();
  const claimStarted = React.useRef(false);

  React.useEffect(() => {
    const url = new URL(window.location.href);
    const session = url.searchParams.get("google_session");
    const status = url.searchParams.get("google_status");
    if (!session && !status) return;

    if (claimStarted.current) return;
    claimStarted.current = true;

    if (!session || status !== "success") {
      replaceOAuthParameters(url, false);
      toast.error("Google authorization was not completed. Please try again.");
      return;
    }

    void dashboardFetch("/api/rowboat/v1/google-oauth/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session }),
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Could not claim Google connection (${String(response.status)})`);
        }
        await queryClient.invalidateQueries({ queryKey: RELATIONSHIP_SOURCE_STATUS_QUERY_KEY });
        replaceOAuthParameters(url, true);
        window.dispatchEvent(new Event(GOOGLE_OAUTH_CONNECTED_EVENT));
        toast.success("Google connected. Your evidence sync has started.");
      })
      .catch(() => {
        replaceOAuthParameters(url, false);
        toast.error("Google authorization could not be saved. Please reconnect.");
      });
  }, [queryClient]);

  return null;
}
