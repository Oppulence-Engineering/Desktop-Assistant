"use client";

import "client-only";

import dynamic from "next/dynamic";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@oppulence/ui/lib/utils";
import { useDashboardChatController } from "@/components/features/dashboard/chat-route-provider/chat-route-provider";
import type { WorkflowFocus } from "@/lib/product-navigation";

const CloudWorkflowsView = dynamic(() =>
  import("@/components/workflows/cloud-workflows-view").then((module) => module.CloudWorkflowsView),
);

export type WorkflowsDashboardRouteProps = ComponentPropsWithoutRef<"section"> & {
  focus: WorkflowFocus;
};

export function WorkflowsDashboardRoute({
  className,
  focus,
  ...props
}: WorkflowsDashboardRouteProps) {
  const { selectedResource: resource } = useDashboardChatController();
  const isTaskResource = resource?.kind === "task" || resource?.kind === "taskrun";
  return (
    <section
      className={cn("flex min-h-0 min-w-0 flex-1 flex-col", className)}
      data-slot="workflows-dashboard-route"
      {...props}
    >
      <CloudWorkflowsView
        key={isTaskResource ? `${focus}:${resource.name}` : focus}
        focus={focus}
        initialRunId={
          resource?.kind === "taskrun" ? resource.name.split("/").slice(1).join("/") : undefined
        }
        initialSlug={
          resource?.kind === "task"
            ? resource.name
            : resource?.kind === "taskrun"
              ? resource.name.split("/")[0]
              : undefined
        }
      />
    </section>
  );
}
