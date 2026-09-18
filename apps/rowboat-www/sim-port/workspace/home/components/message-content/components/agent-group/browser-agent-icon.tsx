"use client";

import { Globe } from "@sim/emcn/icons";
import type { AgentGroupItem } from "./agent-group-view";

/** Landing preview — browser agent is workspace-only; show the globe mark. */
export function getBrowserAgentFaviconUrl(_items: AgentGroupItem[]): string | null {
  return null;
}

export function BrowserAgentIcon(_props: { items: AgentGroupItem[] }) {
  return <Globe className="size-full" aria-hidden="true" />;
}
