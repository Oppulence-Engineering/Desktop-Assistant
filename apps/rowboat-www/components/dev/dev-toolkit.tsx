"use client";

import type { Result } from "axe-core";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from "web-vitals";

import { Badge } from "@oppulence/ui/components/badge";
import { Button } from "@oppulence/ui/components/button";
import { Label } from "@oppulence/ui/components/label";
import { ToolsTab } from "@/components/dev/tabs/tools-tab";
import {
  clearBffFetchLog,
  getBffFetchLog,
  installBffFetchInstrumentation,
  subscribeBffFetchLog,
} from "@/lib/dev/bff-fetch-log";
import {
  devButtonStyle,
  devFabStyle,
  devPanelStyle,
  devTabStyle,
  formatMs,
  statusTone,
} from "@/lib/dev/dev-panel-styles";
import { getDevPrefs, getDevPrefsServerSnapshot, subscribeDevPrefs } from "@/lib/dev/dev-prefs";
import {
  clearLoafLog,
  getLoafLog,
  installLoafObserver,
  subscribeLoafLog,
} from "@/lib/dev/loaf-observer";
import { applyReactScanDevOptions } from "@/lib/dev/react-scan-config";
import { startMswBrowser } from "@/lib/dev/msw-browser";

type VitalsState = Partial<Record<Metric["name"], Metric>>;

type AxeSummary = {
  violationCount: number;
  incompleteCount: number;
  results: Result[];
};

type TabId = "vitals" | "bff" | "a11y" | "tools";

function VitalsTab({
  vitals,
  loafEntries,
  loafEnabled,
  onClearLoaf,
}: {
  vitals: VitalsState;
  loafEntries: ReturnType<typeof getLoafLog>;
  loafEnabled: boolean;
  onClearLoaf: () => void;
}) {
  const rows: Array<{ label: string; metric?: Metric; good: number; poor: number }> = [
    { label: "LCP", metric: vitals.LCP, good: 2500, poor: 4000 },
    { label: "INP", metric: vitals.INP, good: 200, poor: 500 },
    { label: "CLS", metric: vitals.CLS, good: 0.1, poor: 0.25 },
    { label: "FCP", metric: vitals.FCP, good: 1800, poor: 3000 },
    { label: "TTFB", metric: vitals.TTFB, good: 800, poor: 1800 },
  ];

  return (
    <div style={{ padding: 10, display: "grid", gap: 10, overflow: "auto" }}>
      {rows.map(({ label, metric, good, poor }) => {
        const value = metric?.value;
        const rating =
          value == null ? "—" : value <= good ? "good" : value <= poor ? "needs work" : "poor";
        return (
          <div
            key={label}
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 8,
              alignItems: "baseline",
            }}
          >
            <Label className="font-normal opacity-70">{label}</Label>
            <Label className="font-normal">
              {value == null ? "—" : label === "CLS" ? value.toFixed(3) : formatMs(value)}
              {" · "}
              <Badge
                className="rounded-none border-0 bg-transparent p-0 font-normal opacity-65 shadow-none"
                variant="outline"
              >
                {rating}
              </Badge>
            </Label>
          </div>
        );
      })}

      {loafEnabled ? (
        <section
          style={{
            borderTop: "1px solid color-mix(in oklab, var(--foreground) 10%, transparent)",
            paddingTop: 8,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <strong>Long frames</strong>
            <Button
              style={{ ...devButtonStyle, padding: "2px 8px" }}
              type="button"
              variant="ghost"
              onClick={onClearLoaf}
            >
              Clear
            </Button>
          </div>
          {loafEntries.length === 0 ? (
            <p style={{ margin: 0, opacity: 0.55 }}>No LoAF entries yet.</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 16, display: "grid", gap: 4 }}>
              {loafEntries.slice(0, 6).map((entry) => (
                <li key={entry.id}>
                  {formatMs(entry.duration)}
                  {entry.source ? ` · ${entry.source}` : ""}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}

function BffTab({
  entries,
  onClear,
}: {
  entries: ReturnType<typeof getBffFetchLog>;
  onClear: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 10px 6px",
          borderBottom: "1px solid color-mix(in oklab, var(--foreground) 10%, transparent)",
        }}
      >
        <Label className="font-normal opacity-65">{entries.length} recent BFF calls</Label>
        <Button
          style={{ ...devButtonStyle, padding: "2px 8px" }}
          type="button"
          variant="ghost"
          onClick={onClear}
        >
          Clear
        </Button>
      </div>
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 8,
          overflow: "auto",
          display: "grid",
          gap: 6,
        }}
      >
        {entries.length === 0 ? (
          <li style={{ opacity: 0.55, padding: "4px 2px" }}>
            Hit a dashboard route that calls /api/rowboat/…
          </li>
        ) : (
          entries.map((entry) => (
            <li
              key={entry.id}
              style={{
                border: "1px solid color-mix(in oklab, var(--foreground) 8%, transparent)",
                borderRadius: 8,
                padding: "6px 8px",
                lineHeight: 1.35,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <Badge
                  className="rounded-none border-0 bg-transparent p-0 font-normal shadow-none"
                  variant="outline"
                >
                  {entry.method}
                </Badge>
                <Badge
                  className="rounded-none border-0 bg-transparent p-0 font-normal shadow-none"
                  style={{ color: statusTone(entry.status) }}
                  variant="outline"
                >
                  {entry.status ?? "…"} · {formatMs(entry.durationMs)}
                </Badge>
              </div>
              <div
                style={{ marginTop: 4, wordBreak: "break-all", opacity: 0.75 }}
                title={entry.url}
              >
                {entry.url}
              </div>
              {entry.requestId ? (
                <div style={{ marginTop: 4, opacity: 0.65 }}>req {entry.requestId}</div>
              ) : null}
              {entry.errorCode ? (
                <div style={{ marginTop: 4, color: "#f59e0b" }}>{entry.errorCode}</div>
              ) : null}
              {entry.error ? (
                <div style={{ marginTop: 4, color: "#ef4444" }}>{entry.error}</div>
              ) : null}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

function A11yTab({
  summary,
  scanning,
  onScan,
}: {
  summary: AxeSummary | null;
  scanning: boolean;
  onScan: () => void;
}) {
  return (
    <div style={{ padding: 10, display: "grid", gap: 10, overflow: "auto" }}>
      <Button
        disabled={scanning}
        style={devButtonStyle}
        type="button"
        variant="ghost"
        onClick={onScan}
      >
        {scanning ? "Scanning page…" : "Scan page for WCAG issues"}
      </Button>
      {summary ? (
        <>
          <div>
            <strong>{summary.violationCount}</strong> violations ·{" "}
            <Label className="font-normal opacity-70">{summary.incompleteCount} need review</Label>
          </div>
          <ul style={{ margin: 0, paddingLeft: 16, display: "grid", gap: 6 }}>
            {summary.results.slice(0, 8).map((result) => (
              <li key={`${result.id}-${result.help}`}>
                <Badge
                  className="rounded-none border-0 bg-transparent p-0 font-normal text-[#f59e0b] shadow-none"
                  variant="outline"
                >
                  {result.impact ?? "unknown"}
                </Badge>{" "}
                · {result.help}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p style={{ margin: 0, opacity: 0.55, lineHeight: 1.45 }}>
          Run a scan to list WCAG violations for the current page. Results also log to the console.
        </p>
      )}
    </div>
  );
}

const TABS: Array<[TabId, string]> = [
  ["vitals", "Vitals"],
  ["bff", "API"],
  ["a11y", "A11y"],
  ["tools", "Tools"],
];

/**
 * Dev-only floating panel: tiers 1–4 tooling (vitals, BFF, a11y, MSW, session, theme).
 */
export function DevToolkit() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TabId>("vitals");
  const [vitals, setVitals] = useState<VitalsState>({});
  const [axeSummary, setAxeSummary] = useState<AxeSummary | null>(null);
  const [scanning, setScanning] = useState(false);

  const prefs = useSyncExternalStore(subscribeDevPrefs, getDevPrefs, getDevPrefsServerSnapshot);
  const bffEntries = useSyncExternalStore(subscribeBffFetchLog, getBffFetchLog, getBffFetchLog);
  const loafEntries = useSyncExternalStore(subscribeLoafLog, getLoafLog, getLoafLog);

  useEffect(() => {
    installBffFetchInstrumentation();
  }, []);

  useEffect(() => {
    const store = (metric: Metric) =>
      setVitals((current) => ({ ...current, [metric.name]: metric }));
    onCLS(store);
    onINP(store);
    onLCP(store);
    onFCP(store);
    onTTFB(store);
  }, []);

  useEffect(() => {
    void applyReactScanDevOptions(prefs.trackUnnecessaryRenders);
  }, [prefs.trackUnnecessaryRenders]);

  useEffect(() => {
    if (!prefs.mswEnabled) return;
    void startMswBrowser(prefs.persona);
  }, [prefs.mswEnabled, prefs.persona]);

  useEffect(() => {
    if (!prefs.loafObserver) return;
    return installLoafObserver();
  }, [prefs.loafObserver]);

  const runAxeScan = useCallback(async () => {
    setScanning(true);
    try {
      const { default: axe } = await import("axe-core");
      const results = await axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "best-practice"] },
      });
      setAxeSummary({
        violationCount: results.violations.length,
        incompleteCount: results.incomplete.length,
        results: results.violations,
      });
      if (results.violations.length > 0) {
        console.group("[dev-toolkit] axe violations");
        for (const violation of results.violations) console.warn(violation.help, violation.nodes);
        console.groupEnd();
      }
    } finally {
      setScanning(false);
    }
  }, []);

  if (!open) {
    return (
      <Button
        aria-label="Open developer toolkit"
        style={devFabStyle}
        type="button"
        variant="ghost"
        onClick={() => setOpen(true)}
      >
        Dev
      </Button>
    );
  }

  return (
    <section aria-label="Developer toolkit" style={devPanelStyle}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 10px 0",
          gap: 8,
        }}
      >
        <strong style={{ fontSize: 12 }}>Dev toolkit</strong>
        <Button
          aria-label="Close developer toolkit"
          style={{
            border: "none",
            background: "transparent",
            cursor: "pointer",
            color: "inherit",
            opacity: 0.65,
          }}
          type="button"
          variant="ghost"
          onClick={() => setOpen(false)}
        >
          Close
        </Button>
      </header>
      <div
        style={{
          display: "flex",
          borderBottom: "1px solid color-mix(in oklab, var(--foreground) 10%, transparent)",
        }}
      >
        {TABS.map(([id, label]) => (
          <Button
            key={id}
            style={devTabStyle(tab === id)}
            type="button"
            variant="ghost"
            onClick={() => setTab(id)}
          >
            {label}
          </Button>
        ))}
      </div>
      <div style={{ overflow: "auto", minHeight: 0, flex: 1 }}>
        {tab === "vitals" ? (
          <VitalsTab
            vitals={vitals}
            loafEntries={loafEntries}
            loafEnabled={prefs.loafObserver}
            onClearLoaf={clearLoafLog}
          />
        ) : null}
        {tab === "bff" ? <BffTab entries={bffEntries} onClear={clearBffFetchLog} /> : null}
        {tab === "a11y" ? (
          <A11yTab summary={axeSummary} scanning={scanning} onScan={runAxeScan} />
        ) : null}
        {tab === "tools" ? <ToolsTab /> : null}
      </div>
    </section>
  );
}
