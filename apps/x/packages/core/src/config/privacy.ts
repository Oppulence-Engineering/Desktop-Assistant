import { writeJsonAtomic } from "../filesystem/atomic_write.js";
import fs from "fs/promises";
import path from "path";
import { PrivacyConfigSchema, type PrivacyConfig } from "@x/shared/privacy";
import { WorkDir } from "./config.js";
import { setAnalyticsEnabled } from "../analytics/posthog.js";

// Privacy preferences. Follows the notifications.ts pattern: tolerant read →
// schema defaults, and a patch only overrides keys the caller explicitly set.

function privacyConfigPath(): string {
  return path.join(WorkDir, "config", "privacy.json");
}

/** The effective privacy config; schema defaults when absent or unreadable. */
export async function getPrivacyConfig(): Promise<PrivacyConfig> {
  try {
    const raw = await fs.readFile(privacyConfigPath(), "utf8");
    return PrivacyConfigSchema.parse(JSON.parse(raw));
  } catch {
    return PrivacyConfigSchema.parse({});
  }
}

export interface PrivacyConfigPatch {
  shareUsageData?: boolean;
}

/** Persist `privacy.json`, merging a partial update over the current config. */
export async function setPrivacyConfig(patch: PrivacyConfigPatch): Promise<PrivacyConfig> {
  const current = await getPrivacyConfig();
  const next = PrivacyConfigSchema.parse({
    ...current,
    ...(patch.shareUsageData !== undefined ? { shareUsageData: patch.shareUsageData } : {}),
  });
  await fs.mkdir(path.dirname(privacyConfigPath()), { recursive: true });
  // Atomic: a torn file reads as defaults — the privacy opt-out reverts.
  await writeJsonAtomic(privacyConfigPath(), next);
  // Apply immediately. Waiting for a restart would mean the next event after
  // opting out still ships, which is the behaviour this whole change exists to
  // remove.
  setAnalyticsEnabled(next.shareUsageData);
  return next;
}

/**
 * Read the stored preference and apply it to the analytics client. Call once
 * during startup, before anything can capture.
 */
export async function applyPrivacyConfig(): Promise<void> {
  const config = await getPrivacyConfig();
  setAnalyticsEnabled(config.shareUsageData);
}
