"use client";

import "client-only";

import dynamic from "next/dynamic";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@oppulence/ui/lib/utils";
import { useDashboardChatController } from "@/components/features/dashboard/chat-route-provider/chat-route-provider";

const AgentsView = dynamic(() =>
  import("@/components/features/agents/agents-view/agents-view").then(
    (module) => module.AgentsView,
  ),
);

export type AgentsDashboardRouteProps = ComponentPropsWithoutRef<"section">;

export function AgentsDashboardRoute({ className, ...props }: AgentsDashboardRouteProps) {
  const chat = useDashboardChatController();
  return (
    <section
      className={cn("flex min-h-0 min-w-0 flex-1 flex-col", className)}
      data-slot="agents-dashboard-route"
      {...props}
    >
      <AgentsView
        onAgentsChanged={chat.onAgentsChanged}
        onOpenDefinition={chat.onOpenAgent}
        onUseAgent={chat.onUseAgent}
      />
    </section>
  );
}
