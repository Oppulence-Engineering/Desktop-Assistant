import type { CSSProperties } from "react";

export const devPanelStyle: CSSProperties = {
  position: "fixed",
  bottom: 52,
  left: 12,
  zIndex: 9998,
  width: 380,
  maxHeight: "min(460px, 58vh)",
  display: "flex",
  flexDirection: "column",
  borderRadius: 10,
  border: "1px solid color-mix(in oklab, var(--foreground) 14%, transparent)",
  background: "color-mix(in oklab, var(--background) 92%, transparent)",
  backdropFilter: "blur(10px)",
  boxShadow: "0 12px 40px rgb(0 0 0 / 0.18)",
  fontFamily: "var(--font-geist-mono, ui-monospace, monospace)",
  fontSize: 11,
  color: "var(--foreground)",
};

export const devFabStyle: CSSProperties = {
  position: "fixed",
  bottom: 52,
  left: 12,
  zIndex: 9998,
  borderRadius: 999,
  border: "1px solid color-mix(in oklab, var(--foreground) 18%, transparent)",
  background: "color-mix(in oklab, var(--background) 90%, transparent)",
  backdropFilter: "blur(8px)",
  padding: "6px 12px",
  cursor: "pointer",
  fontFamily: "var(--font-geist-mono, ui-monospace, monospace)",
  fontSize: 11,
  color: "var(--foreground)",
  boxShadow: "0 8px 24px rgb(0 0 0 / 0.12)",
};

export function devTabStyle(active: boolean): CSSProperties {
  return {
    flex: 1,
    padding: "6px 6px",
    border: "none",
    borderBottom: active ? "2px solid var(--foreground)" : "2px solid transparent",
    background: "transparent",
    color: active ? "var(--foreground)" : "color-mix(in oklab, var(--foreground) 55%, transparent)",
    cursor: "pointer",
    font: "inherit",
  };
}

export const devButtonStyle: CSSProperties = {
  border: "1px solid color-mix(in oklab, var(--foreground) 18%, transparent)",
  background: "color-mix(in oklab, var(--foreground) 6%, transparent)",
  borderRadius: 8,
  padding: "8px 10px",
  cursor: "pointer",
  color: "inherit",
  font: "inherit",
  textAlign: "left",
};

export function formatMs(value?: number) {
  if (value == null) return "—";
  return `${value.toFixed(0)}ms`;
}

export function statusTone(status?: number) {
  if (status == null) return "color-mix(in oklab, var(--foreground) 50%, transparent)";
  if (status === 0) return "#ef4444";
  if (status >= 500) return "#ef4444";
  if (status >= 400) return "#f59e0b";
  if (status >= 300) return "#3b82f6";
  return "#22c55e";
}
