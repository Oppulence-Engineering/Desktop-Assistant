"use client";

import * as React from "react";
import { CheckCircle2, Link2, Loader2, Mic, Plug } from "@/lib/icons";
import { Button } from "@oppulence/ui/components/button";
import { Separator } from "@oppulence/ui/components/separator";
import { GoogleClientIdModal } from "@/components/google-client-id-modal";
import { IntegrationApiKeyModal } from "@/components/integration-api-key-modal";
import { useConnectors } from "@/hooks/useConnectors";
import type { RelationshipSourceStatus } from "@x/shared/src/relationships.js";
import {
  relationshipSourceHealth,
  relationshipSourceStatusLabel,
} from "@/lib/relationship-source-health";
import {
  GOOGLE_BRAND_ICON,
  HUBSPOT_BRAND_ICON,
  WISPR_FLOW_BRAND_ICON,
} from "@/components/onboarding/brand-icons";

const SLACK_BRAND_ICON =
  "data:image/svg+xml,%3Csvg width='127' height='127' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M27.2 80c0 7.3-5.9 13.2-13.2 13.2C6.7 93.2.8 87.3.8 80c0-7.3 5.9-13.2 13.2-13.2h13.2V80zm6.6 0c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2v33c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V80z' fill='%23E01E5A'/%3E%3Cpath d='M47 27c-7.3 0-13.2-5.9-13.2-13.2C33.8 6.5 39.7.6 47 .6c7.3 0 13.2 5.9 13.2 13.2V27H47zm0 6.7c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H13.9C6.6 60.1.7 54.2.7 46.9c0-7.3 5.9-13.2 13.2-13.2H47z' fill='%2336C5F0'/%3E%3Cpath d='M99.9 46.9c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H99.9V46.9zm-6.6 0c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V13.8C66.9 6.5 72.8.6 80.1.6c7.3 0 13.2 5.9 13.2 13.2v33.1z' fill='%232EB67D'/%3E%3Cpath d='M80.1 99.8c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V99.8h13.2zm0-6.6c-7.3 0-13.2-5.9-13.2-13.2 0-7.3 5.9-13.2 13.2-13.2h33.1c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H80.1z' fill='%23ECB22E'/%3E%3C/svg%3E";

function BrandImage({ src }: { src: string }) {
  return <img src={src} alt="" aria-hidden="true" className="size-5 object-contain" />;
}

interface ConnectedAccountsSettingsProps {
  dialogOpen: boolean;
}

export function ConnectedAccountsSettings({ dialogOpen }: ConnectedAccountsSettingsProps) {
  const c = useConnectors(dialogOpen);
  const [sourceStatuses, setSourceStatuses] = React.useState<RelationshipSourceStatus[]>([]);

  React.useEffect(() => {
    if (!dialogOpen) return;
    let cancelled = false;
    void window.ipc
      .invoke("relationships:sources", null)
      .then((result) => {
        if (!cancelled) setSourceStatuses(result.sources);
      })
      .catch(() => {
        if (!cancelled) setSourceStatuses([]);
      });
    return () => {
      cancelled = true;
    };
  }, [dialogOpen]);

  const relationshipStatusFor = (provider: string) => {
    const normalized = provider.toLowerCase().replaceAll("-ai", "");
    return sourceStatuses.find((source) => {
      const sourceName = source.source.toLowerCase();
      return sourceName.includes(normalized) || normalized.includes(sourceName);
    });
  };
  const sourceNeedsAttention = (provider: string) => {
    const status = relationshipStatusFor(provider);
    return Boolean(status && relationshipSourceHealth(status) === "needs_attention");
  };

  const integrationIcon = (name: string, iconUrl?: string) => {
    const normalized = name.toLowerCase();
    const src = normalized.includes("hubspot")
      ? HUBSPOT_BRAND_ICON
      : normalized.includes("wispr")
        ? WISPR_FLOW_BRAND_ICON
        : iconUrl;
    return src ? <BrandImage src={src} /> : <Plug className="size-5" />;
  };

  const renderOAuthProvider = (
    provider: string,
    displayName: string,
    icon: React.ReactNode,
    description: string,
  ) => {
    const state = c.providerStates[provider] || {
      isConnected: false,
      isLoading: true,
      isConnecting: false,
    };
    const relationshipStatus = relationshipStatusFor(provider);
    const needsReconnect =
      Boolean(c.providerStatus[provider]?.error) ||
      (relationshipStatus ? relationshipSourceHealth(relationshipStatus) === "needs_attention" : false);

    return (
      <div
        key={provider}
        className="flex items-center justify-between gap-3 rounded-2xl border border-border px-3 py-3 transition-colors hover:bg-accent/50"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex size-10 items-center justify-center rounded-xl bg-muted">
            {icon}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-medium truncate">{displayName}</span>
            {state.isLoading ? (
              <span className="text-xs text-muted-foreground">Checking...</span>
            ) : needsReconnect ? (
              <span className="text-xs text-amber-600">
                {relationshipStatus ? relationshipSourceStatusLabel(relationshipStatus) : "Needs reconnect"}
              </span>
            ) : state.isConnected ? (
              <span className="text-xs text-emerald-600">Connected</span>
            ) : (
              <span className="text-xs text-muted-foreground truncate">{description}</span>
            )}
          </div>
        </div>
        <div className="shrink-0">
          {state.isLoading ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : needsReconnect ? (
            <Button
              variant="default"
              size="sm"
              onClick={() => c.handleReconnect(provider)}
              aria-label={`Reconnect ${displayName}`}
            >
              Reconnect
            </Button>
          ) : state.isConnected ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => c.handleDisconnect(provider)}
              aria-label={`Disconnect ${displayName}`}
            >
              Disconnect
            </Button>
          ) : (
            <Button
              variant="default"
              size="sm"
              onClick={() => c.handleConnect(provider)}
              disabled={state.isConnecting}
              aria-label={`Connect ${displayName}`}
            >
              {state.isConnecting ? <Loader2 className="size-3 animate-spin" /> : "Connect"}
            </Button>
          )}
        </div>
      </div>
    );
  };

  const renderIntegration = (integration: (typeof c.integrations)[number]) => {
    const isBusy = c.integrationConnecting[integration.name] ?? false;
    const blocks = integration.templateBlocks ?? [];
    const relationshipStatus = relationshipStatusFor(integration.name);
    return (
      <div key={integration.name} className="rounded-2xl border border-border p-3 transition-colors hover:bg-accent/50">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
              {integrationIcon(integration.name, integration.iconUrl)}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium">{integration.displayName}</span>
                {integration.connected ? <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" /> : null}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{integration.description}</p>
              {relationshipStatus && relationshipSourceHealth(relationshipStatus) === "needs_attention" ? (
                <p className="mt-1 text-xs text-amber-600">{relationshipSourceStatusLabel(relationshipStatus)}</p>
              ) : null}
              {blocks.length ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {blocks.slice(0, 3).map((block) => (
                    <span key={block.id} className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                      {block.title}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          <Button
            variant={integration.connected ? "outline" : "default"}
            size="sm"
            onClick={() => integration.connected ? c.handleDisconnectIntegration(integration) : c.handleConnectIntegration(integration)}
            disabled={isBusy}
          >
            {isBusy ? <Loader2 className="animate-spin" /> : integration.connected ? "Disconnect" : <><Link2 /> Connect</>}
          </Button>
        </div>
      </div>
    );
  };

  const renderSlack = () => {
    const relationshipStatus = relationshipStatusFor("slack");
    const relationshipStatusNeedsAttention = sourceNeedsAttention("slack");
    return (
    <div key="slack" className="flex items-center justify-between gap-3 rounded-2xl border border-border px-3 py-3 transition-colors hover:bg-accent/50">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
          <BrandImage src={SLACK_BRAND_ICON} />
        </div>
        <div className="min-w-0">
          <span className="text-sm font-medium">Slack</span>
          <p className={`truncate text-xs ${c.slackDiscoverError || relationshipStatusNeedsAttention ? "text-amber-600" : "text-muted-foreground"}`}>
            {c.slackDiscoverError || (relationshipStatusNeedsAttention && relationshipStatus
              ? relationshipSourceStatusLabel(relationshipStatus)
              : c.slackEnabled
              ? c.slackWorkspaces.map((workspace) => workspace.name).filter(Boolean).join(", ") || "Connected"
              : "Workspace messages and shared customer context")}
          </p>
        </div>
      </div>
      {c.slackLoading ? <Loader2 className="animate-spin" /> : (
        <Button size="sm" variant={c.slackEnabled ? "outline" : "default"} onClick={c.slackEnabled ? c.handleSlackDisable : c.handleSlackEnable} disabled={c.slackDiscovering}>
          {c.slackDiscovering ? <Loader2 className="animate-spin" /> : c.slackEnabled ? "Disconnect" : "Connect"}
        </Button>
      )}
    </div>
    );
  };

  if (c.providersLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <GoogleClientIdModal
        open={c.googleClientIdOpen}
        onOpenChange={(nextOpen) => {
          c.setGoogleClientIdOpen(nextOpen);
          if (!nextOpen) {
            c.setGoogleClientIdDescription(undefined);
          }
        }}
        onSubmit={c.handleGoogleClientIdSubmit}
        isSubmitting={c.providerStates.google?.isConnecting ?? false}
        description={c.googleClientIdDescription}
      />
      <IntegrationApiKeyModal
        open={c.integrationApiKeyOpen}
        onOpenChange={c.setIntegrationApiKeyOpen}
        onSubmit={c.handleIntegrationApiKeySubmit}
        isSubmitting={c.integrationApiKeySubmitting}
        integrationName={c.integrationApiKeyTarget?.displayName}
      />

      <div className="space-y-6">
        {(() => {
          const connectedIntegrations = c.integrations.filter(
            (integration) => integration.connected && !sourceNeedsAttention(integration.name),
          );
          const attentionIntegrations = c.integrations.filter(
            (integration) =>
              integration.connected &&
              sourceNeedsAttention(integration.name),
          );
          const availableIntegrations = c.integrations.filter((integration) => !integration.connected);
          const google = c.providerStates.google;
          const fireflies = c.providerStates["fireflies-ai"];
          const googleNeedsAttention = Boolean(c.providerStatus.google?.error) || sourceNeedsAttention("google");
          const firefliesNeedsAttention = Boolean(c.providerStatus["fireflies-ai"]?.error) || sourceNeedsAttention("fireflies-ai");
          const slackNeedsAttention = Boolean(c.slackDiscoverError) || sourceNeedsAttention("slack");
          const connected = [
            ...connectedIntegrations.map(renderIntegration),
            ...(c.slackEnabled && !slackNeedsAttention ? [renderSlack()] : []),
            ...(c.providers.includes("google") && google?.isConnected && !googleNeedsAttention
              ? [renderOAuthProvider("google", "Google", <BrandImage src={GOOGLE_BRAND_ICON} />, "Email and calendar")]
              : []),
            ...(c.providers.includes("fireflies-ai") && fireflies?.isConnected && !firefliesNeedsAttention
              ? [renderOAuthProvider("fireflies-ai", "Fireflies", <Mic className="size-5" />, "AI meeting transcripts")]
              : []),
          ];
          const attention = [
            ...attentionIntegrations.map(renderIntegration),
            ...(c.slackEnabled && slackNeedsAttention ? [renderSlack()] : []),
            ...(c.providers.includes("google") && googleNeedsAttention
              ? [renderOAuthProvider("google", "Google", <BrandImage src={GOOGLE_BRAND_ICON} />, "Email and calendar")]
              : []),
            ...(c.providers.includes("fireflies-ai") && firefliesNeedsAttention
              ? [renderOAuthProvider("fireflies-ai", "Fireflies", <Mic className="size-5" />, "AI meeting transcripts")]
              : []),
          ];
          const available = [
            ...availableIntegrations.map(renderIntegration),
            ...(!c.slackEnabled && !c.slackDiscoverError ? [renderSlack()] : []),
            ...(c.providers.includes("google") && !google?.isConnected && !googleNeedsAttention
              ? [renderOAuthProvider("google", "Google", <BrandImage src={GOOGLE_BRAND_ICON} />, "Email and calendar")]
              : []),
            ...(c.providers.includes("fireflies-ai") && !fireflies?.isConnected && !firefliesNeedsAttention
              ? [renderOAuthProvider("fireflies-ai", "Fireflies", <Mic className="size-5" />, "AI meeting transcripts")]
              : []),
          ];
          const section = (title: string, description: string, rows: React.ReactNode[], empty?: string) => (
            <section key={title} aria-label={title}>
              <h3 className="text-sm font-medium text-foreground">{title}</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
              <div className="mt-3 space-y-2">
                {rows.length ? rows : <p className="rounded-2xl border border-dashed border-border p-4 text-xs text-muted-foreground">{empty}</p>}
              </div>
            </section>
          );
          return <>
            {section("Connected", "Sources currently available to your coworker.", connected, "No sources connected yet.")}
            {attention.length ? section("Needs attention", "Reconnect these sources to restore current evidence.", attention) : null}
            <Separator />
            {section("Available", "Add another source when you want its context.", available, "All available sources are connected.")}
          </>;
        })()}
      </div>
    </>
  );
}
