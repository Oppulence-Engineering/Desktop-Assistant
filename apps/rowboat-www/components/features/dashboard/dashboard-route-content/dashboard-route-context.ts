"use client";

import "client-only";

import { createContext, createElement, useContext, type ReactNode } from "react";

import type { ApprovalRequest, ConversationItem } from "@/lib/agent-history";
import type { BrowserSessionResponse } from "@/lib/auth/schemas";
import type { SelectedResource } from "@/lib/dashboard-resource";
import type { RevenueTab, SettingsSection, WorkflowFocus } from "@/lib/product-navigation";

export type { SelectedResource } from "@/lib/dashboard-resource";

export type ArtifactRouteState = {
  resource: SelectedResource;
  title: string;
  subtitle: string;
  text: string;
  original: string;
  fileType: "json" | "markdown";
  readOnly: boolean;
  loading: boolean;
  error: string | null;
  agentOptions: string[];
  onChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
};

export type ChatRouteState = {
  workspace: string;
  processing: boolean;
  conversation: ConversationItem[];
  empty: boolean;
  promptInput: ReactNode;
  artifact: ArtifactRouteState | null;
  onOpenRevenueTab: (tab: RevenueTab) => void;
  onResolveApproval: (approval: ApprovalRequest, decision: "granted" | "denied") => Promise<void>;
};

export type DashboardRouteContextValue = {
  chat: ChatRouteState;
  agents: {
    onAgentsChanged: () => Promise<void>;
    onOpenDefinition: (slug: string) => void;
    onUseAgent: (slug: string) => void;
  };
  revenue: {
    tab: RevenueTab;
    onTabChange: (tab: RevenueTab) => void;
    onOpenConnectors: () => void;
  };
  settings: {
    section: SettingsSection;
    session: Extract<BrowserSessionResponse, { authenticated: true }>;
    onNavigate: (section: SettingsSection) => void;
  };
  workflows: {
    focus: WorkflowFocus;
    selectedResource: SelectedResource | null;
  };
};

const DashboardRouteContext = createContext<DashboardRouteContextValue | null>(null);

export function DashboardRouteProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: DashboardRouteContextValue;
}) {
  return createElement(DashboardRouteContext.Provider, { value }, children);
}

export function useDashboardRouteContext(): DashboardRouteContextValue {
  const value = useContext(DashboardRouteContext);
  if (!value) {
    throw new Error("Dashboard route content must be rendered inside DashboardRouteProvider");
  }
  return value;
}
