"use client";

import * as React from "react";
import { useState } from "react";
import { AlertTriangle, Loader2, Mic, Mail, Calendar, User } from "@/lib/icons";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { GoogleClientIdModal } from "@/components/google-client-id-modal";
import { ComposioApiKeyModal } from "@/components/composio-api-key-modal";
import { useConnectors } from "@/hooks/useConnectors";
import { PRODUCT_NAME, PRODUCT_PROVIDER_ID, isProductProvider } from "@x/shared/dist/branding.js";

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

  // Check if Gmail is unconnected (for filtering in unconnected mode)
  const isGmailUnconnected = c.useComposioForGoogle ? !c.gmailConnected && !c.gmailLoading : true;
  const isGoogleCalendarUnconnected = c.useComposioForGoogleCalendar
    ? !c.googleCalendarConnected && !c.googleCalendarLoading
    : true;

  // For unconnected mode, check if there's anything to show
  const hasUnconnectedEmailCalendar = (() => {
    if (!isUnconnectedMode) return true;
    if (c.useComposioForGoogle && isGmailUnconnected) return true;
    if (c.useComposioForGoogleCalendar && isGoogleCalendarUnconnected) return true;
    if (!c.useComposioForGoogle && c.providers.includes("google")) {
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

  const isSolomonUnconnected = (() => {
    if (!c.providers.includes(PRODUCT_PROVIDER_ID)) return false;
    const solomonState = c.providerStates[PRODUCT_PROVIDER_ID];
    return !solomonState?.isConnected || solomonState?.isLoading;
  })();

  const allConnected =
    isUnconnectedMode &&
    !isSolomonUnconnected &&
    !hasUnconnectedEmailCalendar &&
    !hasUnconnectedMeetingNotes;

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

                {/* Email & Calendar Section */}
                {(c.useComposioForGoogle ||
                  c.useComposioForGoogleCalendar ||
                  c.providers.includes("google")) &&
                  hasUnconnectedEmailCalendar && (
                    <>
                      <div className="px-2 py-1.5">
                        <span className="text-xs font-medium text-muted-foreground">
                          Email & Calendar
                        </span>
                      </div>
                      {c.useComposioForGoogle ? (
                        // In unconnected mode, only show if not connected
                        !isUnconnectedMode || isGmailUnconnected ? (
                          <div className="flex items-center justify-between gap-3 rounded-none px-3 py-2 hover:bg-accent">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="flex size-8 items-center justify-center rounded-none bg-muted">
                                <Mail className="size-4" />
                              </div>
                              <div className="flex flex-col min-w-0">
                                <span className="text-sm font-medium truncate">Gmail</span>
                                {c.gmailLoading ? (
                                  <span className="text-xs text-muted-foreground">Checking...</span>
                                ) : (
                                  <span className="text-xs text-muted-foreground truncate">
                                    Sync emails
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="shrink-0">
                              {c.gmailLoading ? (
                                <Loader2 className="size-4 animate-spin text-muted-foreground" />
                              ) : c.gmailConnected ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={c.handleDisconnectGmail}
                                  className="h-7 px-2 text-xs"
                                  aria-label="Disconnect Gmail"
                                >
                                  Disconnect
                                </Button>
                              ) : (
                                <Button
                                  variant="default"
                                  size="sm"
                                  onClick={c.handleConnectGmail}
                                  disabled={c.gmailConnecting}
                                  className="h-7 px-2 text-xs"
                                  aria-label="Connect Gmail"
                                >
                                  {c.gmailConnecting ? (
                                    <Loader2 className="size-3 animate-spin" />
                                  ) : (
                                    "Connect"
                                  )}
                                </Button>
                              )}
                            </div>
                          </div>
                        ) : null
                      ) : (
                        renderOAuthProvider(
                          "google",
                          "Google",
                          <Mail className="size-4" />,
                          "Sync emails and calendar",
                        )
                      )}
                      {c.useComposioForGoogleCalendar &&
                        (!isUnconnectedMode || isGoogleCalendarUnconnected) && (
                          <div className="flex items-center justify-between gap-3 rounded-none px-3 py-2 hover:bg-accent">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="flex size-8 items-center justify-center rounded-none bg-muted">
                                <Calendar className="size-4" />
                              </div>
                              <div className="flex flex-col min-w-0">
                                <span className="text-sm font-medium truncate">
                                  Google Calendar
                                </span>
                                {c.googleCalendarLoading ? (
                                  <span className="text-xs text-muted-foreground">Checking...</span>
                                ) : (
                                  <span className="text-xs text-muted-foreground truncate">
                                    Sync calendar events
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="shrink-0">
                              {c.googleCalendarLoading ? (
                                <Loader2 className="size-4 animate-spin text-muted-foreground" />
                              ) : c.googleCalendarConnected ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={c.handleDisconnectGoogleCalendar}
                                  className="h-7 px-2 text-xs"
                                  aria-label="Disconnect Google Calendar"
                                >
                                  Disconnect
                                </Button>
                              ) : (
                                <Button
                                  variant="default"
                                  size="sm"
                                  onClick={c.handleConnectGoogleCalendar}
                                  disabled={c.googleCalendarConnecting}
                                  className="h-7 px-2 text-xs"
                                  aria-label="Connect Google Calendar"
                                >
                                  {c.googleCalendarConnecting ? (
                                    <Loader2 className="size-3 animate-spin" />
                                  ) : (
                                    "Connect"
                                  )}
                                </Button>
                              )}
                            </div>
                          </div>
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
      <ComposioApiKeyModal
        open={c.composioApiKeyOpen}
        onOpenChange={c.setComposioApiKeyOpen}
        onSubmit={c.handleComposioApiKeySubmit}
        isSubmitting={c.gmailConnecting}
      />
    </>
  );
}
