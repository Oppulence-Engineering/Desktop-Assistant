import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { WorkDir } from "./config.js";

/**
 * One-time UI flags: things the app has shown once and should not show again.
 *
 * These kept landing in whatever config file was nearest — `onboardingComplete` is in
 * `note_creation.json`, which is about note strictness and has nothing to do with
 * onboarding. Every such flag added there makes that file harder to reason about and
 * ties an unrelated feature's state to a schema that might change under it.
 *
 * Deliberately a flat bag of booleans with a permissive parse: a flag we cannot read is
 * a prompt shown twice, which is a far better failure than a config read that throws
 * during startup.
 */

const UiState = z
  .object({
    /** The 10-second dual-track check has been run (or explicitly skipped). */
    meetingCaptureCheckDone: z.boolean().default(false),
  })
  .partial()
  .passthrough();
export type UiState = z.infer<typeof UiState>;

/** Resolved per call, not at import: `WorkDir` can be reconfigured after this module
 *  loads, and a module-level constant would silently keep pointing at the old one. */
function stateFile(): string {
  return path.join(WorkDir, "config", "ui_state.json");
}

export async function getUiState(): Promise<UiState> {
  try {
    const parsed = UiState.safeParse(JSON.parse(await fs.readFile(stateFile(), "utf8")));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/**
 * Merge `patch` into the stored state.
 *
 * Merged rather than replaced, and written via a temp file and rename, because two
 * surfaces can set different flags at once and a torn write here would silently reset
 * every flag in the file.
 */
export async function setUiState(patch: UiState): Promise<UiState> {
  const file = stateFile();
  const next = { ...(await getUiState()), ...patch };
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
  await fs.rename(tmp, file);
  return next;
}
