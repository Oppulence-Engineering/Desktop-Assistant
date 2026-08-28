"use client";

import "client-only";

import * as React from "react";

import { Badge } from "@oppulence/ui/components/badge";
import { Button } from "@oppulence/ui/components/button";
import { Input } from "@oppulence/ui/components/input";

import {
  getDeleteConnectionUrl,
  getListConnectorsUrl,
  getSetConnectionAPIKeyUrl,
} from "@/lib/api/generated/client/connectors/connectors";
import type { Connector, ConnectorScope } from "@/lib/api/generated/client/model";
import { startHostedOAuth } from "@/lib/api/connectors/hosted-oauth";
import { parseConnectorsResponse } from "@/lib/api/connectors/schema";
import { dashboardFetch } from "@/lib/auth/client";
import {
  hostedOAuthUnsupportedReason,
  requiredConnectorScopes,
  safeAuthorizationURL,
  type HostedOAuthOutcome,
} from "@/lib/connectors/hosted-oauth";

const OUTCOME_MESSAGES: Record<HostedOAuthOutcome, string> = {
  active: "Authorization was claimed and the connection is active.",
  entitlement: "Your current workspace entitlement does not allow this connector or scope set.",
  error: "Authorization could not be completed. No connector grant was stored.",
  expired: "The one-time authorization ticket expired. Start a new connection.",
  replay:
    "That one-time authorization ticket was already used. The existing connection was not changed.",
  restart: "Authorization needs to restart. No partial connector grant was kept.",
  retry: "The connector broker is busy. Wait a moment, then try again.",
  scope: "The provider returned an invalid or broader scope set. Review permissions and reconnect.",
};

function proxyPath(path: string): string {
  return `/api/rowboat${path}`;
}

function displayDate(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toLocaleString();
}

function healthLabel(connector: Connector): string {
  if (connector.connected && connector.connectionHealth === "healthy") return "Healthy";
  return connector.connectionHealth.charAt(0).toUpperCase() + connector.connectionHealth.slice(1);
}

function ConnectorScopeList({ scopes }: { scopes: ConnectorScope[] }) {
  if (scopes.length === 0) return null;
  return (
    <details className="rounded-[3px] border border-primary/10 bg-primary/[0.02] px-3 py-2">
      <summary className="cursor-pointer text-xs font-medium text-primary/70">Permissions</summary>
      <div className="mt-2 flex flex-col gap-2">
        {scopes.map((scope) =>
          scope.grantTier === "required" ? (
            <div className="flex items-start gap-2 text-xs text-muted-foreground" key={scope.name}>
              <input
                aria-label={scope.displayName}
                name="requested_scope"
                type="hidden"
                value={scope.name}
              />
              <span>
                <span className="font-medium text-primary/80">{scope.displayName}</span> · Required
                {scope.requiredPlan ? ` · ${scope.requiredPlan} plan` : ""}
                <span className="block">{scope.description}</span>
              </span>
            </div>
          ) : (
            <label
              className="flex items-start gap-2 text-xs text-muted-foreground"
              htmlFor={`connector-scope-${scope.name}`}
              key={scope.name}
            >
              <input
                aria-label={scope.displayName}
                className="mt-0.5"
                id={`connector-scope-${scope.name}`}
                name="requested_scope"
                type="checkbox"
                value={scope.name}
              />
              <span>
                <span className="font-medium text-primary/80">{scope.displayName}</span> · Optional
                {scope.requiredPlan ? ` · ${scope.requiredPlan} plan` : ""}
                <span className="block">{scope.description}</span>
              </span>
            </label>
          ),
        )}
      </div>
    </details>
  );
}

function ConnectorRow({ connector, onChanged }: { connector: Connector; onChanged: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState(false);
  const [keyOpen, setKeyOpen] = React.useState(false);
  const [apiKey, setApiKey] = React.useState("");
  const unsupportedReason = hostedOAuthUnsupportedReason(connector);
  const connectedAt = displayDate(connector.connectedAt);
  const lastUsedAt = displayDate(connector.lastUsedAt);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };

  const saveKey = () =>
    run(async () => {
      const response = await dashboardFetch(proxyPath(getSetConnectionAPIKeyUrl(connector.name)), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      if (!response.ok) throw new Error(`Saving key failed (${response.status})`);
      setApiKey("");
      setKeyOpen(false);
    });

  const disconnect = () =>
    run(async () => {
      const response = await dashboardFetch(proxyPath(getDeleteConnectionUrl(connector.name)), {
        method: "DELETE",
      });
      if (!response.ok) throw new Error(`Disconnect failed (${response.status})`);
      setConfirming(false);
    });

  const startOAuth = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (unsupportedReason || busy) return;

    const action = event.currentTarget.action;
    const body = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const result = await startHostedOAuth(action, body, AbortSignal.timeout(15_000));
      if (result.kind === "sign-in") {
        window.location.assign(new URL(result.signInUrl, window.location.origin).toString());
        return;
      }
      if (result.kind === "failure") {
        setError(OUTCOME_MESSAGES[result.outcome]);
        return;
      }
      const safeURL = safeAuthorizationURL(result.authorizationUrl);
      if (!safeURL) {
        setError(OUTCOME_MESSAGES.error);
        return;
      }
      window.location.assign(safeURL.toString());
    } catch {
      setError(OUTCOME_MESSAGES.error);
    } finally {
      setBusy(false);
    }
  };

  const apiKeyUnavailable = connector.status !== "enabled" || connector.health === "unavailable";
  const requiredScopes = requiredConnectorScopes(connector);

  return (
    <div className="flex flex-col gap-3 px-4 py-3" data-testid={`connector-${connector.name}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-primary">
              {connector.displayName}
            </span>
            {connector.connected ? (
              <Badge className="shrink-0 rounded-[2px] border-oppulence-green/40 text-oppulence-green">
                Active
              </Badge>
            ) : (
              <Badge className="shrink-0 rounded-[2px] text-primary/50" variant="outline">
                Not connected
              </Badge>
            )}
            <Badge className="shrink-0 rounded-[2px] capitalize" variant="outline">
              {healthLabel(connector)}
            </Badge>
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">{connector.description}</span>
          <span className="mt-1 block font-mono text-[11px] text-primary/45">
            Lifecycle: {connector.status}
            {connectedAt ? ` · Connected ${connectedAt}` : ""}
            {lastUsedAt ? ` · Last used ${lastUsedAt}` : ""}
          </span>
          {connector.connectionReason ? (
            <span
              className="mt-1 block font-mono text-[11px] text-oppulence-orange"
              id={`connector-support-${connector.name}`}
            >
              {connector.connectionReason}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {connector.connected ? (
            confirming ? (
              <>
                <Button disabled={busy} onClick={disconnect} size="sm" variant="destructive">
                  {busy ? "Disconnecting…" : "Confirm"}
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => setConfirming(false)}
                  size="sm"
                  variant="ghost"
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button onClick={() => setConfirming(true)} size="sm" variant="outline">
                Disconnect
              </Button>
            )
          ) : connector.authType === "api_key" ? (
            <Button
              disabled={busy || apiKeyUnavailable}
              onClick={() => setKeyOpen((open) => !open)}
              size="sm"
              variant="outline"
            >
              {keyOpen ? "Cancel" : "Add API key"}
            </Button>
          ) : connector.authType === "oauth" ? (
            <form
              action={`/api/connectors/${encodeURIComponent(connector.name)}/start`}
              method="post"
              onSubmit={startOAuth}
            >
              {requiredScopes.map((scope) => (
                <input key={scope} name="requested_scope" type="hidden" value={scope} />
              ))}
              <Button
                aria-describedby={
                  unsupportedReason ? `connector-support-${connector.name}` : undefined
                }
                aria-label={`Connect ${connector.displayName}`}
                disabled={Boolean(unsupportedReason) || busy}
                size="sm"
                type="submit"
              >
                Connect
              </Button>
            </form>
          ) : (
            <Button disabled size="sm" variant="outline">
              Unavailable
            </Button>
          )}
        </div>
      </div>

      {!connector.connected && connector.authType === "oauth" ? (
        <form
          action={`/api/connectors/${encodeURIComponent(connector.name)}/start`}
          className="flex flex-col gap-2"
          method="post"
          onSubmit={startOAuth}
        >
          <ConnectorScopeList scopes={connector.availableScopes ?? []} />
          {unsupportedReason && !connector.connectionReason ? (
            <p
              className="font-mono text-xs text-oppulence-orange"
              id={`connector-support-${connector.name}`}
            >
              {unsupportedReason}
            </p>
          ) : !unsupportedReason ? (
            <Button
              aria-label={`Authorize ${connector.displayName} with selected permissions`}
              className="self-start"
              disabled={busy}
              size="sm"
              type="submit"
              variant="outline"
            >
              Authorize selected permissions
            </Button>
          ) : null}
        </form>
      ) : null}

      {connector.connected && connector.grantedScopes?.length ? (
        <p className="font-mono text-[11px] text-primary/50">
          Granted scopes: {connector.grantedScopes.map((scope) => scope.name).join(", ")}
        </p>
      ) : null}

      {keyOpen && !connector.connected ? (
        <div className="flex items-center gap-2">
          <Input
            className="max-w-sm"
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="Vendor API key"
            type="password"
            value={apiKey}
          />
          <Button disabled={!apiKey.trim() || busy} onClick={saveKey} size="sm">
            {busy ? "Saving…" : "Save key"}
          </Button>
        </div>
      ) : null}
      {error ? <p className="font-mono text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

export function ConnectorSettings() {
  const [connectors, setConnectors] = React.useState<Connector[]>([]);
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [notice, setNotice] = React.useState<{ outcome: HostedOAuthOutcome; connector?: string }>();

  React.useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    const outcome = parameters.get("connector_oauth") as HostedOAuthOutcome | null;
    const connector = parameters.get("connector") || undefined;
    if (outcome && outcome in OUTCOME_MESSAGES) {
      setNotice({ outcome, connector });
      if (outcome === "active") setRefreshKey((key) => key + 1);
      parameters.delete("connector_oauth");
      parameters.delete("connector");
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${parameters.size ? `?${parameters.toString()}` : ""}${window.location.hash}`,
      );
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    dashboardFetch(`${proxyPath(getListConnectorsUrl())}?r=${refreshKey}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`Could not load connectors (${response.status})`);
        return parseConnectorsResponse(JSON.parse(await response.text()));
      })
      .then((data) => {
        if (cancelled) return;
        setConnectors(data.connectors);
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return (
    <section className="settings-section-block" data-slot="connector-settings">
      <div className="settings-section-heading">
        <div>
          <h2 className="settings-section-title">Connectors</h2>
          <p className="settings-section-description">
            Managed connections your agents can use. OAuth grants complete through the authenticated
            broker claim flow; provider credentials remain server-side.
          </p>
        </div>
      </div>
      {notice ? (
        <div className="settings-inline-notice" role="status">
          <strong className="capitalize">{notice.connector || "Connector"}:</strong>{" "}
          {OUTCOME_MESSAGES[notice.outcome]}
        </div>
      ) : null}
      <div className="settings-panel flex flex-col">
        {state === "loading" ? (
          <p className="p-4 text-sm text-muted-foreground">Loading connectors…</p>
        ) : state === "error" ? (
          <p className="p-4 text-sm text-muted-foreground">Could not load connectors.</p>
        ) : connectors.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No connectors are available yet.</p>
        ) : (
          <div className="flex flex-col divide-y divide-primary/10">
            {connectors.map((connector) => (
              <ConnectorRow
                connector={connector}
                key={connector.name}
                onChanged={() => setRefreshKey((key) => key + 1)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
