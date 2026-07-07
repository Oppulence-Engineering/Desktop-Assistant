"use client";

import * as React from "react";
import { CheckCircle2, Link2, Loader2, Mic, Mail, MessageSquare, Plug } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { GoogleClientIdModal } from "@/components/google-client-id-modal";
import { IntegrationApiKeyModal } from "@/components/integration-api-key-modal";
import { useConnectors } from "@/hooks/useConnectors";

interface ConnectedAccountsSettingsProps {
  dialogOpen: boolean;
}

export function ConnectedAccountsSettings({ dialogOpen }: ConnectedAccountsSettingsProps) {
  const c = useConnectors(dialogOpen);

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
    const needsReconnect = Boolean(c.providerStatus[provider]?.error);

    return (
      <div
        key={provider}
        className="flex items-center justify-between gap-2 rounded-none px-3 py-2 hover:bg-accent/50 transition-colors"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex size-8 items-center justify-center rounded-none bg-muted">
            {icon}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-medium truncate">{displayName}</span>
            {state.isLoading ? (
              <span className="text-xs text-muted-foreground">Checking...</span>
            ) : needsReconnect ? (
              <span className="text-xs text-amber-600">Needs reconnect</span>
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
              className="h-7 px-3 text-xs"
              aria-label={`Reconnect ${displayName}`}
            >
              Reconnect
            </Button>
          ) : state.isConnected ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => c.handleDisconnect(provider)}
              className="h-7 px-3 text-xs"
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
              className="h-7 px-3 text-xs"
              aria-label={`Connect ${displayName}`}
            >
              {state.isConnecting ? <Loader2 className="size-3 animate-spin" /> : "Connect"}
            </Button>
          )}
        </div>
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

      <div className="space-y-1">
        {/* Rowboat Integrations */}
        <div className="px-3 pt-1 pb-0.5">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Integrations
          </span>
        </div>
        {c.integrationsLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : c.integrations.length > 0 ? (
          <div className="space-y-1">
            {c.integrations.map((integration) => {
              const isBusy = c.integrationConnecting[integration.name] ?? false;
              const blocks = integration.templateBlocks ?? [];
              return (
                <div
                  key={integration.name}
                  className="rounded-none px-3 py-2.5 hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <div className="flex size-8 items-center justify-center rounded-none bg-muted">
                        <Plug className="size-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium truncate">
                            {integration.displayName}
                          </span>
                          {integration.connected && (
                            <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" />
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {integration.description}
                        </p>
                        {blocks.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {blocks.slice(0, 3).map((block) => (
                              <span
                                key={block.id}
                                className="border border-border px-1.5 py-0.5 text-[10px] leading-4 text-muted-foreground"
                              >
                                {block.title}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0">
                      {integration.connected ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => c.handleDisconnectIntegration(integration)}
                          disabled={isBusy}
                          className="h-7 px-3 text-xs"
                          aria-label={`Disconnect ${integration.displayName}`}
                        >
                          {isBusy ? <Loader2 className="size-3 animate-spin" /> : "Disconnect"}
                        </Button>
                      ) : (
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => c.handleConnectIntegration(integration)}
                          disabled={isBusy}
                          className="h-7 px-3 text-xs"
                          aria-label={`Connect ${integration.displayName}`}
                        >
                          {isBusy ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <>
                              <Link2 className="mr-1 size-3" />
                              Connect
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="px-3 py-4 text-sm text-muted-foreground">
            No integrations are available for this account.
          </div>
        )}

        <Separator className="my-2" />

        {/* Messaging Section */}
        <div className="px-3 pt-1 pb-0.5">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Messaging
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 rounded-none px-3 py-2 hover:bg-accent/50 transition-colors">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex size-8 items-center justify-center rounded-none bg-muted">
              <MessageSquare className="size-4" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-medium truncate">Slack</span>
              {c.slackLoading ? (
                <span className="text-xs text-muted-foreground">Checking...</span>
              ) : c.slackEnabled ? (
                <span className="text-xs text-emerald-600 truncate">
                  {c.slackWorkspaces.map((workspace) => workspace.name).filter(Boolean).join(", ") ||
                    "Connected"}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground truncate">Workspace connection</span>
              )}
            </div>
          </div>
          <div className="shrink-0">
            {c.slackLoading ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : c.slackEnabled ? (
              <Button
                variant="outline"
                size="sm"
                onClick={c.handleSlackDisable}
                className="h-7 px-3 text-xs"
                aria-label="Disconnect Slack"
              >
                Disconnect
              </Button>
            ) : (
              <Button
                variant="default"
                size="sm"
                onClick={c.handleSlackEnable}
                disabled={c.slackDiscovering}
                className="h-7 px-3 text-xs"
                aria-label="Connect Slack"
              >
                {c.slackDiscovering ? <Loader2 className="size-3 animate-spin" /> : "Connect"}
              </Button>
            )}
          </div>
        </div>

        <Separator className="my-2" />

        {/* Email & Calendar Section */}
        {c.providers.includes("google") && (
          <>
            <div className="px-3 pt-1 pb-0.5">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Email & Calendar
              </span>
            </div>
            {renderOAuthProvider(
              "google",
              "Google",
              <Mail className="size-4" />,
              "Sync emails and calendar",
            )}
            <Separator className="my-2" />
          </>
        )}

        {/* Meeting Notes Section */}
        {c.providers.includes("fireflies-ai") && (
          <>
            <div className="px-3 pt-1 pb-0.5">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Meeting Notes
              </span>
            </div>

            {/* Fireflies */}
            {renderOAuthProvider(
              "fireflies-ai",
              "Fireflies",
              <Mic className="size-4" />,
              "AI meeting transcripts",
            )}
          </>
        )}
      </div>
    </>
  );
}
