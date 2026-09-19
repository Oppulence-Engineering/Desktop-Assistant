"use client";

import "client-only";

import * as React from "react";

/**
 * Device-scoped console preferences (display name, default agent, …).
 * Stored in localStorage under an `oppulence:` prefix; a window event keeps
 * every subscribed component in sync within the tab.
 */

const PREFIX = "oppulence:";
const EVENT = "oppulence-prefs-changed";

export function getPref(key: string): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(PREFIX + key);
}

export function setPref(key: string, value: string | null) {
  if (value === null || value === "") {
    localStorage.removeItem(PREFIX + key);
  } else {
    localStorage.setItem(PREFIX + key, value);
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { key } }));
}

export function usePref(key: string): string | null {
  const subscribe = React.useCallback((onStoreChange: () => void) => {
    const listener = () => onStoreChange();
    window.addEventListener(EVENT, listener);
    window.addEventListener("storage", listener);
    return () => {
      window.removeEventListener(EVENT, listener);
      window.removeEventListener("storage", listener);
    };
  }, []);
  const getSnapshot = React.useCallback(() => getPref(key), [key]);
  return React.useSyncExternalStore(subscribe, getSnapshot, () => null);
}

export function useBooleanPref(
  key: string,
  defaultValue: boolean,
): readonly [boolean, (value: boolean) => void] {
  const stored = usePref(key);
  const setValue = React.useCallback((value: boolean) => setPref(key, value ? "1" : "0"), [key]);
  return [stored === null ? defaultValue : stored === "1", setValue] as const;
}
