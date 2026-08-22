"use client";

import * as React from "react";
import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Link2,
  Loader2,
  Mail,
  MessageSquare,
  Mic,
  Plug,
  User,
} from "@/lib/icons";

import { Popover, PopoverContent, PopoverTrigger } from "@oppulence/ui/components/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@oppulence/ui/components/tooltip";
import { Button } from "@oppulence/ui/components/button";
import { Separator } from "@oppulence/ui/components/separator";
import { GoogleClientIdModal } from "@/components/google-client-id-modal";
import { IntegrationApiKeyModal } from "@/components/integration-api-key-modal";
import { useConnectors } from "@/hooks/useConnectors";
import { PRODUCT_NAME, PRODUCT_PROVIDER_ID, isProductProvider } from "@x/shared/branding";

interface ConnectorsPopoverProps {
  children: React.ReactNode;
  tooltip?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  mode?: "all" | "unconnected";
}

export function ConnectorsPopover({
  children,
  tooltip,
  open: openProp,
  onOpenChange,
  mode = "all",
}: ConnectorsPopoverProps) {
  const [openInternal, setOpenInternal] = useState(false);
  const isControlled = typeof openProp === "boolean";
  const open = isControlled ? openProp : openInternal;
  const setOpen = onOpenChange ?? setOpenInternal;

  const c = useConnectors(open);

  const isUnconnectedMode = mode === "unconnected";

  // Helper to render an OAuth provider row
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

    // In unconnected mode, skip connected providers (unless they need reconnect)
    if (isUnconnectedMode && state.isConnected && !needsReconnect && !state.isLoading) {
      return null;
    }

    return (
      <div
        key={provider}
        className="flex items-center justify-between gap-3 rounded-none px-3 py-2 hover:bg-accent"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex size-8 items-center justify-center rounded-none bg-muted">
            {icon}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-medium truncate">{displayName}</span>
            {state.isLoading ? (
              <span className="text-xs text-muted-foreground">Checking...</span>
            ) : needsReconnect ? (
              <span className="text-xs text-amber-600">Needs reconnect</span>
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
              className="h-7 px-2 text-xs"
              aria-label={`Reconnect ${displayName}`}
            >
              Reconnect
            </Button>
          ) : state.isConnected ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => c.handleDisconnect(provider)}
              className="h-7 px-2 text-xs"
              aria-label={`${isProductProvider(provider) ? "Log out of" : "Disconnect"} ${displayName}`}
            >
              {isProductProvider(provider) ? "Log Out" : "Disconnect"}
            </Button>
          ) : (
            <Button
              variant="default"
              size="sm"
              onClick={() => c.handleConnect(provider)}
              disabled={state.isConnecting}
              className="h-7 px-2 text-xs"
              aria-label={`${isProductProvider(provider) ? "Log in to" : "Connect"} ${displayName}`}
            >
              {state.isConnecting ? (
                <Loader2 className="size-3 animate-spin" />
              ) : isProductProvider(provider) ? (
                "Log In"
              ) : (
                "Connect"
              )}
            </Button>
          )}
        </div>
      </div>
    );
  };

  // For unconnected mode, check if there's anything to show
  const hasUnconnectedEmailCalendar = (() => {
    if (!isUnconnectedMode) return true;
    if (c.providers.includes("google")) {
      const googleState = c.providerStates["google"];
      if (!googleState?.isConnected || c.providerStatus["google"]?.error) return true;
    }
    return false;
  })();

  const hasUnconnectedMeetingNotes = (() => {
    if (!isUnconnectedMode) return true;
    if (c.providers.includes("fireflies-ai")) {
      const firefliesState = c.providerStates["fireflies-ai"];
      if (!firefliesState?.isConnected || c.providerStatus["fireflies-ai"]?.error) return true;
    }
    return false;
  })();

  const visibleIntegrations = c.integrations.filter(
    (integration) => !isUnconnectedMode || !integration.connected,
  );
  const hasUnconnectedIntegrations = !isUnconnectedMode || visibleIntegrations.length > 0;
  const hasUnconnectedSlack = !isUnconnectedMode || c.slackLoading || !c.slackEnabled;

  const isSolomonUnconnected = (() => {
    if (!c.providers.includes(PRODUCT_PROVIDER_ID)) return false;
    const solomonState = c.providerStates[PRODUCT_PROVIDER_ID];
    return !solomonState?.isConnected || solomonState?.isLoading;
  })();

  const allConnected =
    isUnconnectedMode &&
    !isSolomonUnconnected &&
    !hasUnconnectedEmailCalendar &&
    !hasUnconnectedMeetingNotes &&
    !hasUnconnectedIntegrations &&
    !hasUnconnectedSlack;

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
      <Popover open={open} onOpenChange={setOpen}>
        {tooltip ? (
          <Tooltip open={open ? false : undefined}>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>{children}</PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              {tooltip}
            </TooltipContent>
          </Tooltip>
        ) : (
          <PopoverTrigger asChild>{children}</PopoverTrigger>
        )}
        <PopoverContent side="right" align="end" sideOffset={4} className="w-80 p-0">
          <div className="p-4 border-b">
            <h4 className="font-semibold text-sm flex items-center gap-1.5">
              {isUnconnectedMode ? "Connect Accounts" : "Connected accounts"}
              {!isUnconnectedMode && c.hasProviderError && (
                <AlertTriangle className="size-3 text-amber-500/80 animate-pulse" />
              )}
            </h4>
            <p className="text-xs text-muted-foreground mt-1">
              {isUnconnectedMode ? "Add new account connections" : "Connect accounts to sync data"}
            </p>
          </div>
          <div className="p-2">
            {c.providersLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : allConnected ? (
              <div className="flex flex-col items-center py-6 px-4 gap-2">
                <p className="text-sm text-muted-foreground text-center">All accounts connected</p>
                <p className="text-xs text-muted-foreground text-center">
                  Manage your connections in Settings
                </p>
              </div>
            ) : (
              <>
                {/* Solomon AI Account - show in "all" mode always, or in "unconnected" mode only when not connected */}
                {c.providers.includes(PRODUCT_PROVIDER_ID) &&
                  (() => {
                    const solomonState = c.providerStates[PRODUCT_PROVIDER_ID];
                    const isSolomonConnected =
                      solomonState?.isConnected && !solomonState?.isLoading;
                    if (isUnconnectedMode && isSolomonConnected) return null;
                    return (
                      <>
                        <div className="px-2 py-1.5">
                          <span className="text-xs font-medium text-muted-foreground">Account</span>
                        </div>
                        {renderOAuthProvider(
                          PRODUCT_PROVIDER_ID,
                          PRODUCT_NAME,
                          <User className="size-4" />,
                          `Log in to your ${PRODUCT_NAME} account`,
                        )}
                        <Separator className="my-2" />
                      </>
                    );
                  })()}

                {/* Managed Integrations */}
                {hasUnconnectedIntegrations && (
                  <>
                    <div className="px-2 py-1.5">
                      <span className="text-xs font-medium text-muted-foreground">
                        Integrations
                      </span>
                    </div>
                    {c.integrationsLoading ? (
                      <div className="flex items-center justify-center py-4">
                        <Loader2 className="size-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : (
                      visibleIntegrations.slice(0, 6).map((integration) => {
                        const isConnecting = c.integrationConnecting[integration.name] ?? false;
                        return (
                          <div
                            key={integration.name}
                            className="flex items-center justify-between gap-3 rounded-none px-3 py-2 hover:bg-accent"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="flex size-8 items-center justify-center rounded-none bg-muted">
                                <Plug className="size-4" />
                              </div>
                              <div className="flex flex-col min-w-0">
                                <span className="text-sm font-medium truncate">
                                  {integration.displayName}
                                </span>
                                <span className="text-xs text-muted-foreground truncate">
                                  {integration.description}
                                </span>
                              </div>
                            </div>
                            <div className="shrink-0">
                              {integration.connected ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => c.handleDisconnectIntegration(integration)}
                                  disabled={isConnecting}
                                  className="h-7 px-2 text-xs"
                                  aria-label={`Disconnect ${integration.displayName}`}
                                >
                                  {isConnecting ? (
                                    <Loader2 className="size-3 animate-spin" />
                                  ) : (
                                    <>
                                      <CheckCircle2 className="mr-1 size-3" />
                                      Connected
                                    </>
                                  )}
                                </Button>
                              ) : (
                                <Button
                                  variant="default"
                                  size="sm"
                                  onClick={() => c.handleConnectIntegration(integration)}
                                  disabled={isConnecting}
                                  className="h-7 px-2 text-xs"
                                  aria-label={`Connect ${integration.displayName}`}
                                >
                                  {isConnecting ? (
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
                        );
                      })
                    )}
                    <Separator className="my-2" />
                  </>
                )}

                {/* Messaging */}
                {hasUnconnectedSlack && (
                  <>
                    <div className="px-2 py-1.5">
                      <span className="text-xs font-medium text-muted-foreground">Messaging</span>
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-none px-3 py-2 hover:bg-accent">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex size-8 items-center justify-center rounded-none bg-muted">
                          <MessageSquare className="size-4" />
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="text-sm font-medium truncate">Slack</span>
                          {c.slackLoading ? (
                            <span className="text-xs text-muted-foreground">Checking...</span>
                          ) : c.slackEnabled ? (
                            <span className="text-xs text-muted-foreground truncate">
                              {c.slackWorkspaces
                                .map((workspace) => workspace.name)
                                .filter(Boolean)
                                .join(", ") || "Connected"}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground truncate">
                              Workspace connection
                            </span>
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
                            className="h-7 px-2 text-xs"
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
                            className="h-7 px-2 text-xs"
                            aria-label="Connect Slack"
                          >
                            {c.slackDiscovering ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              "Connect"
                            )}
                          </Button>
                        )}
                      </div>
                    </div>
                    <Separator className="my-2" />
                  </>
                )}

                {/* Email & Calendar Section */}
                {c.providers.includes("google") && hasUnconnectedEmailCalendar && (
                    <>
                      <div className="px-2 py-1.5">
                        <span className="text-xs font-medium text-muted-foreground">
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
                {hasUnconnectedMeetingNotes && (
                  <>
                    <div className="px-2 py-1.5">
                      <span className="text-xs font-medium text-muted-foreground">
                        Meeting Notes
                      </span>
                    </div>

                    {/* Fireflies */}
                    {c.providers.includes("fireflies-ai") &&
                      renderOAuthProvider(
                        "fireflies-ai",
                        "Fireflies",
                        <Mic className="size-4" />,
                        "AI meeting transcripts",
                      )}

                    <Separator className="my-2" />
                  </>
                )}
              </>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}
