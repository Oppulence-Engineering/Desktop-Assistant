"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircleIcon, Link2Icon, LoaderIcon, XCircleIcon } from "@/lib/icons";
import { Button } from "@oppulence/ui/components/button";
import { IntegrationApiKeyModal } from "@/components/integration-api-key-modal";

interface IntegrationConnectCardProps {
  connectorName: string;
  displayName: string;
  authType?: "oauth" | "api_key";
  status: "pending" | "running" | "completed" | "error";
  alreadyConnected?: boolean;
  onConnected?: (connectorName: string, displayName: string) => void;
}

export function IntegrationConnectCard({
  connectorName,
  displayName,
  authType,
  status,
  alreadyConnected,
  onConnected,
}: IntegrationConnectCardProps) {
  const [connectionState, setConnectionState] = useState<
    "idle" | "connecting" | "connected" | "error"
  >(alreadyConnected ? "connected" : "idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [apiKeyOpen, setApiKeyOpen] = useState(false);
  const [apiKeySubmitting, setApiKeySubmitting] = useState(false);
  const didFireCallback = useRef(alreadyConnected ?? false);

  useEffect(() => {
    const cleanup = window.ipc.on(
      "oauth:didConnect",
      (event: { provider: string; success: boolean; error?: string }) => {
        if (event.provider !== connectorName) return;
        if (event.success) {
          setConnectionState("connected");
          setErrorMessage(null);
          if (!didFireCallback.current) {
            didFireCallback.current = true;
            onConnected?.(connectorName, displayName);
          }
        } else {
          setConnectionState("error");
          setErrorMessage(event.error || "Connection failed");
        }
      },
    );
    return cleanup;
  }, [connectorName, displayName, onConnected]);

  const markConnected = useCallback(() => {
    setConnectionState("connected");
    setErrorMessage(null);
    if (!didFireCallback.current) {
      didFireCallback.current = true;
      onConnected?.(connectorName, displayName);
    }
  }, [connectorName, displayName, onConnected]);

  const handleConnect = useCallback(async () => {
    if (authType === "api_key") {
      setApiKeyOpen(true);
      return;
    }

    setConnectionState("connecting");
    setErrorMessage(null);
    try {
      const result = await window.ipc.invoke("connectors:connect", {
        connector: connectorName,
      });
      if (!result.success) {
        setConnectionState("error");
        setErrorMessage(result.error || "Failed to initiate connection");
      }
    } catch {
      setConnectionState("error");
      setErrorMessage("Failed to initiate connection");
    }
  }, [authType, connectorName]);

  const handleApiKeySubmit = useCallback(
    async (apiKey: string) => {
      setApiKeySubmitting(true);
      setErrorMessage(null);
      try {
        const result = await window.ipc.invoke("connectors:saveApiKey", {
          connector: connectorName,
          apiKey,
        });
        if (!result.success) {
          setConnectionState("error");
          setErrorMessage(result.error || "Failed to save API key");
          return;
        }
        setApiKeyOpen(false);
        markConnected();
      } catch {
        setConnectionState("error");
        setErrorMessage("Failed to save API key");
      } finally {
        setApiKeySubmitting(false);
      }
    },
    [connectorName, markConnected],
  );

  const isToolRunning = status === "pending" || status === "running";
  const name = displayName || connectorName;

  return (
    <>
      <div className="not-prose mb-4 flex items-center gap-3 rounded-none border px-3 py-2.5">
        <div className="size-7 rounded bg-muted flex items-center justify-center flex-shrink-0">
          <span className="text-xs font-bold text-muted-foreground">
            {name.charAt(0).toUpperCase()}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium truncate">{name}</span>
            {connectionState === "connected" && (
              <span className="rounded-full bg-green-500/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-green-600">
                Connected
              </span>
            )}
          </div>
          {connectionState === "error" && errorMessage && (
            <p className="text-xs text-destructive truncate">{errorMessage}</p>
          )}
          {connectionState === "idle" && isToolRunning && (
            <p className="text-xs text-muted-foreground">Waiting to connect...</p>
          )}
        </div>

        {connectionState === "connected" ? (
          <CheckCircleIcon className="size-4 text-green-600 flex-shrink-0" />
        ) : connectionState === "connecting" ? (
          <Button size="sm" disabled className="text-xs h-7 flex-shrink-0">
            <LoaderIcon className="size-3 animate-spin mr-1" />
            Connecting...
          </Button>
        ) : connectionState === "error" ? (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <XCircleIcon className="size-3.5 text-destructive" />
            <Button size="sm" variant="outline" onClick={handleConnect} className="text-xs h-7">
              Retry
            </Button>
          </div>
        ) : isToolRunning ? (
          <LoaderIcon className="size-3.5 animate-spin text-muted-foreground flex-shrink-0" />
        ) : (
          <Button size="sm" onClick={handleConnect} className="text-xs h-7 flex-shrink-0">
            <Link2Icon className="size-3 mr-1" />
            Connect
          </Button>
        )}
      </div>

      <IntegrationApiKeyModal
        open={apiKeyOpen}
        onOpenChange={setApiKeyOpen}
        onSubmit={handleApiKeySubmit}
        isSubmitting={apiKeySubmitting}
        integrationName={name}
      />
    </>
  );
}
