/** Dev-only toggles persisted in localStorage for the floating toolkit. */

export type DevPersona = "default" | "empty-workspace" | "revenue-full" | "session-expired";

export type DevPrefs = {
  mswEnabled: boolean;
  posthogLog: boolean;
  routeBadge: boolean;
  loafObserver: boolean;
  trackUnnecessaryRenders: boolean;
  persona: DevPersona;
};

const STORAGE_KEY = "oppulence:dev:prefs";

export const defaultDevPrefs: DevPrefs = {
  mswEnabled: false,
  posthogLog: true,
  routeBadge: true,
  loafObserver: true,
  trackUnnecessaryRenders: true,
  persona: "default",
};

let cached: DevPrefs = { ...defaultDevPrefs };
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

function readStorage(): DevPrefs {
  if (typeof window === "undefined") return cached;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return cached;
    return { ...defaultDevPrefs, ...JSON.parse(raw) } as DevPrefs;
  } catch {
    return cached;
  }
}

function prefsEqual(a: DevPrefs, b: DevPrefs): boolean {
  return (
    a.mswEnabled === b.mswEnabled &&
    a.posthogLog === b.posthogLog &&
    a.routeBadge === b.routeBadge &&
    a.loafObserver === b.loafObserver &&
    a.trackUnnecessaryRenders === b.trackUnnecessaryRenders &&
    a.persona === b.persona
  );
}

/** Stable snapshot for useSyncExternalStore — same reference until prefs change. */
export function getDevPrefs(): DevPrefs {
  if (typeof window === "undefined") {
    return cached;
  }
  const next = readStorage();
  if (!prefsEqual(cached, next)) {
    cached = next;
  }
  return cached;
}

/** SSR snapshot; must stay referentially stable between calls. */
export function getDevPrefsServerSnapshot(): DevPrefs {
  return cached;
}

export function subscribeDevPrefs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setDevPrefs(patch: Partial<DevPrefs>): DevPrefs {
  cached = { ...getDevPrefs(), ...patch };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
  }
  notify();
  return cached;
}
