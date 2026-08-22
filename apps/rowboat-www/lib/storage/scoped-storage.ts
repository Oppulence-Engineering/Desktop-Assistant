"use client";

import "client-only";

import type { ZodType } from "zod";
import { z } from "zod";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type ScopedStorageOptions<T> = {
  organizationId: string;
  userId: string;
  namespace: string;
  version: number;
  ttlMs: number;
  schema: ZodType<T>;
  storage?: StorageLike;
  now?: () => number;
};

/**
 * Creates an account-scoped, versioned browser-storage adapter.
 *
 * Sensitive records such as conversations and tokens must never use this
 * adapter; those belong in memory or behind an authenticated server API.
 */
export function createScopedStorage<T>(options: ScopedStorageOptions<T>) {
  const { organizationId, userId, namespace, version, ttlMs, schema } = options;
  if (!organizationId || !userId)
    throw new Error("Scoped storage requires organization and user IDs");
  if (!namespace) throw new Error("Scoped storage requires a namespace");
  if (!Number.isInteger(version) || version < 1)
    throw new Error("Storage version must be positive");
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("Storage TTL must be positive");

  const key = ["oppulence", organizationId, userId, namespace, `v${String(version)}`]
    .map(encodeURIComponent)
    .join(":");
  const envelopeSchema = z.object({
    version: z.literal(version),
    expiresAt: z.number(),
    value: schema,
  });
  const now = options.now ?? Date.now;

  function backingStore(): StorageLike {
    if (options.storage) return options.storage;
    if (typeof window === "undefined")
      throw new Error("Browser storage is unavailable on the server");
    return window.localStorage;
  }

  return {
    key,
    read(): T | null {
      const storage = backingStore();
      const raw = storage.getItem(key);
      if (!raw) return null;

      try {
        const parsed = envelopeSchema.safeParse(JSON.parse(raw));
        if (!parsed.success || parsed.data.expiresAt <= now()) {
          storage.removeItem(key);
          return null;
        }
        return parsed.data.value;
      } catch {
        storage.removeItem(key);
        return null;
      }
    },
    write(value: T): void {
      const validated = schema.parse(value);
      backingStore().setItem(
        key,
        JSON.stringify({ version, expiresAt: now() + ttlMs, value: validated }),
      );
    },
    remove(): void {
      backingStore().removeItem(key);
    },
  };
}
