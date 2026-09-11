"use client";

import "client-only";

import * as React from "react";

import { Button } from "@oppulence/ui/components/button";
import {
  ComposioUnconfiguredError,
  disconnectComposio,
  listComposioConnections,
  listComposioToolkits,
  startComposioConnection,
  type ComposioConnection,
  type ComposioToolkit,
} from "@/lib/api/composio/client";

/**
 * The long-tail connect surface.
 *
 * Unlike the connectors above it, nothing here is an Oppulence connector: the
 * user authorizes a product on Composio's hosted page, and the account lands
 * back inside our project scoped to them.
 */
export function ComposioConnections() {
  const [toolkits, setToolkits] = React.useState<ComposioToolkit[]>([]);
  const [connections, setConnections] = React.useState<ComposioConnection[]>([]);
  const [state, setState] = React.useState<"loading" | "ready" | "unconfigured" | "error">(
    "loading",
  );
  const [busy, setBusy] = React.useState("");
  const [error, setError] = React.useState("");
  const [refreshKey, setRefreshKey] = React.useState(0);

  React.useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      listComposioToolkits(controller.signal),
      listComposioConnections(controller.signal),
    ])
      .then(([kits, linked]) => {
        setToolkits(kits);
        setConnections(linked);
        setState("ready");
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setState(cause instanceof ComposioUnconfiguredError ? "unconfigured" : "error");
      });
    return () => controller.abort();
  }, [refreshKey]);

  const connectedBySlug = new Map(connections.map((c) => [c.toolkit, c]));

  const connect = async (toolkit: string) => {
    setBusy(toolkit);
    setError("");
    try {
      const link = await startComposioConnection(toolkit);
      // The account is not linked until the user finishes on Composio's page,
      // so the list is refreshed when they come back to this tab.
      window.open(link.redirectUrl, "_blank", "noopener,noreferrer");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the connection.");
    } finally {
      setBusy("");
    }
  };

  const disconnect = async (connection: ComposioConnection) => {
    setBusy(connection.toolkit);
    setError("");
    try {
      await disconnectComposio(connection.id);
      setRefreshKey((key) => key + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not disconnect.");
    } finally {
      setBusy("");
    }
  };

  // A server with no project key has nothing to offer; saying so is better than
  // an empty panel that looks broken.
  if (state === "unconfigured") return null;

  return (
    <div className="settings-panel flex flex-col" data-slot="composio-connections">
      <div className="border-b border-primary/10 p-4">
        <h3 className="text-sm font-medium text-primary">More products</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect the tools Oppulence does not track as relationship sources, such as Jira or Asana.
          Agents can act in them; nothing they return counts as evidence for a commitment.
        </p>
      </div>
      {state === "loading" ? (
        <p className="p-4 text-sm text-muted-foreground">Loading products…</p>
      ) : state === "error" ? (
        <p className="p-4 text-sm text-muted-foreground">Could not load products.</p>
      ) : toolkits.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">No products are available to connect.</p>
      ) : (
        <div className="flex flex-col divide-y divide-primary/10">
          {toolkits.map((toolkit) => {
            const connection = connectedBySlug.get(toolkit.slug);
            return (
              <div className="flex items-center justify-between gap-3 p-4" key={toolkit.slug}>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-primary">{toolkit.name || toolkit.slug}</p>
                  <p className="text-xs text-muted-foreground">
                    {connection ? connection.status.toLowerCase() : "not connected"}
                  </p>
                </div>
                {connection ? (
                  <Button
                    disabled={busy === toolkit.slug}
                    onClick={() => void disconnect(connection)}
                    size="sm"
                    variant="outline"
                  >
                    {busy === toolkit.slug ? "Working…" : "Disconnect"}
                  </Button>
                ) : (
                  <Button
                    disabled={busy === toolkit.slug}
                    onClick={() => void connect(toolkit.slug)}
                    size="sm"
                  >
                    {busy === toolkit.slug ? "Opening…" : "Connect"}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {error ? <p className="p-4 pt-0 font-mono text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
