/** Dev-only toggles persisted for the floating toolkit. */

import { z } from "zod";

import { createScopedStorage } from "@/lib/storage/scoped-storage";

const DevPersonaSchema = z.enum(["default", "empty-workspace", "revenue-full", "session-expired"]);

const DevPrefsSchema = z.object({
  mswEnabled: z.boolean(),
  posthogLog: z.boolean(),
  routeBadge: z.boolean(),
  loafObserver: z.boolean(),
  trackUnnecessaryRenders: z.boolean(),
  persona: DevPersonaSchema,
});

export type DevPersona = z.infer<typeof DevPersonaSchema>;
export type DevPrefs = z.infer<typeof DevPrefsSchema>;

/**
 * Dev preferences are intentionally device-scoped: they are available before
 * authentication and contain no customer data. Fixed local identities still
 * give the record the adapter's versioning, validation, and expiry guarantees.
 */
const devPrefsStorage = createScopedStorage({
  organizationId: "local-development",
  userId: "developer",
  namespace: "dev-prefs",
  version: 1,
  ttlMs: 10 * 365 * 24 * 60 * 60 * 1_000,
  schema: DevPrefsSchema,
});

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
    return devPrefsStorage.read() ?? cached;
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
  cached = DevPrefsSchema.parse({ ...getDevPrefs(), ...patch });
  if (typeof window !== "undefined") {
    try {
      devPrefsStorage.write(cached);
    } catch {
      // Preferences remain usable in memory when browser storage is unavailable.
    }
  }
  notify();
  return cached;
}
