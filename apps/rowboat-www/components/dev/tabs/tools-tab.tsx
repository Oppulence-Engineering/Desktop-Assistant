"use client";

import Link from "next/link";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@oppulence/ui/components/badge";
import { Button } from "@oppulence/ui/components/button";
import { Checkbox } from "@oppulence/ui/components/checkbox";
import { Label } from "@oppulence/ui/components/label";
import { dashboardFetch, loadBrowserSession } from "@/lib/auth/client";
import { devButtonStyle } from "@/lib/dev/dev-panel-styles";
import { getDevPrefs, setDevPrefs, type DevPrefs } from "@/lib/dev/dev-prefs";
import { copyDebugBundleToClipboard } from "@/lib/dev/debug-bundle";
import { DevHealthResponseSchema } from "@/lib/dev/dev-health";
import { isMswRunning, restartMswBrowser, stopMswBrowser } from "@/lib/dev/msw-browser";
import type { DevPersona } from "@/lib/dev/dev-prefs";
import { applyReactScanDevOptions } from "@/lib/dev/react-scan-config";

type SessionSnapshot = {
  authenticated: boolean;
  email?: string;
  expiresAt?: number;
  organizationId?: string;
};

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 8,
        alignItems: "start",
        cursor: "pointer",
      }}
    >
      <div>
        <Label className="font-medium">{label}</Label>
        <div style={{ opacity: 0.6, marginTop: 2, lineHeight: 1.4 }}>{description}</div>
      </div>
      <Checkbox checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

export function ToolsTab() {
  const { theme, setTheme } = useTheme();
  const [prefs, setPrefs] = useState<DevPrefs>(() => getDevPrefs());
  const [mswActive, setMswActive] = useState(isMswRunning);
  const [session, setSession] = useState<SessionSnapshot | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [health, setHealth] = useState<{
    apiOk?: boolean;
    apiLatencyMs?: number;
    apiError?: string;
  } | null>(null);

  const refreshSession = useCallback(async () => {
    setSessionError(null);
    try {
      const body = await loadBrowserSession();
      if (!body.authenticated) {
        setSession({ authenticated: false });
        return;
      }
      setSession({
        authenticated: true,
        email: body.user?.email,
        expiresAt: body.expiresAt,
        organizationId: body.user?.organizationId,
      });
    } catch {
      setSessionError("Could not read session");
    }
  }, []);

  const refreshHealth = useCallback(async () => {
    try {
      const response = await dashboardFetch("/api/dev/health", {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`Health check failed: ${response.status}`);
      const body = DevHealthResponseSchema.parse(await response.json());
      setHealth({
        apiOk: body.api.ok,
        apiLatencyMs: body.api.latencyMs,
        apiError: body.api.error,
      });
    } catch {
      setHealth({ apiOk: false, apiError: "health route unavailable" });
    }
  }, []);

  useEffect(() => {
    void refreshSession();
    void refreshHealth();
  }, [refreshSession, refreshHealth]);

  const patchPrefs = useCallback(async (patch: Partial<DevPrefs>) => {
    const next = setDevPrefs(patch);
    setPrefs(next);

    if ("mswEnabled" in patch || "persona" in patch) {
      setBusy("msw");
      try {
        if (next.mswEnabled) {
          await restartMswBrowser(next.persona);
          setMswActive(true);
        } else {
          await stopMswBrowser();
          setMswActive(false);
        }
      } finally {
        setBusy(null);
      }
    }

    if ("trackUnnecessaryRenders" in patch) {
      await applyReactScanDevOptions(next.trackUnnecessaryRenders);
    }
  }, []);

  const copySeedCommand = useCallback(async () => {
    const command = "npm run seed:demo";
    await navigator.clipboard.writeText(command);
    console.info(`[dev-toolkit] copied: ${command}`);
  }, []);

  const personas: Array<{ id: DevPersona; label: string }> = [
    { id: "default", label: "Default" },
    { id: "empty-workspace", label: "Empty" },
    { id: "revenue-full", label: "Revenue queue" },
    { id: "session-expired", label: "401 session" },
  ];

  return (
    <div style={{ padding: 10, display: "grid", gap: 12, overflow: "auto" }}>
      <section style={{ display: "grid", gap: 6 }}>
        <strong>Stack health</strong>
        <div style={{ opacity: 0.8 }}>
          API{" "}
          <Badge
            className="rounded-none border-0 bg-transparent p-0 font-normal shadow-none"
            style={{ color: health?.apiOk ? "#22c55e" : "#ef4444" }}
            variant="outline"
          >
            {health?.apiOk ? "ok" : "down"}
          </Badge>
          {health?.apiLatencyMs != null ? ` · ${health.apiLatencyMs}ms` : null}
        </div>
        {health?.apiError ? <div style={{ color: "#f59e0b" }}>{health.apiError}</div> : null}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Button
            style={{ ...devButtonStyle, padding: "4px 8px" }}
            type="button"
            variant="ghost"
            onClick={() => void refreshHealth()}
          >
            Recheck API
          </Button>
          <Link
            href="/dev/routes"
            style={{ ...devButtonStyle, padding: "4px 8px", textDecoration: "none" }}
          >
            Route catalog
          </Link>
        </div>
      </section>

      <section style={{ display: "grid", gap: 10 }}>
        <ToggleRow
          label="MSW mocks"
          description="Intercept /api/rowboat/v1 revenue, LLM, and agent-session calls with Orval fakes."
          checked={prefs.mswEnabled}
          onChange={(checked) => void patchPrefs({ mswEnabled: checked })}
        />
        {busy === "msw" ? <Label className="font-normal opacity-60">Starting worker…</Label> : null}
        {mswActive ? (
          <Badge
            className="rounded-none border-0 bg-transparent p-0 font-normal text-[#22c55e] shadow-none"
            variant="outline"
          >
            MSW worker active
          </Badge>
        ) : null}

        <ToggleRow
          label="PostHog console log"
          description="Mirror capture() events to the browser console in development."
          checked={prefs.posthogLog}
          onChange={(checked) => patchPrefs({ posthogLog: checked })}
        />
        <ToggleRow
          label="Route badge"
          description="Show pathname and segment group in the top-right corner."
          checked={prefs.routeBadge}
          onChange={(checked) => patchPrefs({ routeBadge: checked })}
        />
        <ToggleRow
          label="LoAF observer"
          description="Record long animation frames under Vitals when supported."
          checked={prefs.loafObserver}
          onChange={(checked) => patchPrefs({ loafObserver: checked })}
        />
        <strong>MSW persona</strong>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {personas.map((persona) => (
            <Button
              key={persona.id}
              style={{
                ...devButtonStyle,
                padding: "4px 8px",
                opacity: prefs.persona === persona.id ? 1 : 0.65,
              }}
              type="button"
              variant="ghost"
              onClick={() => void patchPrefs({ persona: persona.id, mswEnabled: true })}
            >
              {persona.label}
            </Button>
          ))}
        </div>

        <ToggleRow
          label="Scan renders"
          description="Outline components when they re-render. React Scan no longer marks 'unnecessary' renders."
          checked={prefs.trackUnnecessaryRenders}
          onChange={(checked) => void patchPrefs({ trackUnnecessaryRenders: checked })}
        />
      </section>

      <section style={{ display: "grid", gap: 6 }}>
        <strong>Theme</strong>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(["light", "dark", "system"] as const).map((value) => (
            <Button
              key={value}
              style={{
                ...devButtonStyle,
                padding: "4px 8px",
                opacity: theme === value ? 1 : 0.65,
              }}
              type="button"
              variant="ghost"
              onClick={() => setTheme(value)}
            >
              {value}
            </Button>
          ))}
        </div>
      </section>

      <section style={{ display: "grid", gap: 6 }}>
        <strong>Session</strong>
        {sessionError ? (
          <Badge
            className="rounded-none border-0 bg-transparent p-0 font-normal text-[#ef4444] shadow-none"
            variant="outline"
          >
            {sessionError}
          </Badge>
        ) : null}
        {session?.authenticated ? (
          <>
            <div style={{ opacity: 0.8 }}>{session.email ?? "signed in"}</div>
            {session.organizationId ? (
              <div style={{ opacity: 0.6 }}>org {session.organizationId}</div>
            ) : null}
            {session.expiresAt ? (
              <div style={{ opacity: 0.6 }}>
                expires {new Date(session.expiresAt * 1000).toLocaleString()}
              </div>
            ) : null}
          </>
        ) : (
          <div style={{ opacity: 0.65 }}>Anonymous — marketing or signed out</div>
        )}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Button
            style={{ ...devButtonStyle, padding: "4px 8px" }}
            type="button"
            variant="ghost"
            onClick={() => void refreshSession()}
          >
            Refresh
          </Button>
          <Link
            href="/sign-in"
            style={{ ...devButtonStyle, padding: "4px 8px", textDecoration: "none" }}
          >
            Sign in
          </Link>
          <Link
            href="/api/auth/logout"
            prefetch={false}
            style={{ ...devButtonStyle, padding: "4px 8px", textDecoration: "none" }}
          >
            Log out
          </Link>
        </div>
      </section>

      <section style={{ display: "grid", gap: 6 }}>
        <strong>Workspace & analysis</strong>
        <Button
          style={devButtonStyle}
          type="button"
          variant="ghost"
          onClick={() => void copySeedCommand()}
        >
          Copy `npm run seed:demo`
        </Button>
        <Button
          style={devButtonStyle}
          type="button"
          variant="ghost"
          onClick={() => void copyDebugBundleToClipboard()}
        >
          Copy debug bundle (path + API log)
        </Button>
        <p style={{ margin: 0, opacity: 0.55, lineHeight: 1.45 }}>
          Run <code>npm run dev:doctor</code> for React Doctor static checks and{" "}
          <code>npm run analyze</code> for bundle graphs.
        </p>
      </section>
    </div>
  );
}
