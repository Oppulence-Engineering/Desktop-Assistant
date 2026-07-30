import * as fs from "node:fs/promises";
import * as path from "node:path";
import { MeetingSessionMeta } from "@x/shared/dist/meetings.js";
import { WorkDir } from "../config/config.js";

/**
 * Session directories. One recording is one directory holding both tracks plus a
 * `meta.json`, and the whole queue is built on that: **`meta.json` present and
 * `transcript.json` absent means pending work.** No database, no in-memory job list
 * that a crash forgets.
 *
 * The host owns naming (the sidecar just fills the directory in) so a session has a
 * stable id before capture starts and the note can be created immediately.
 */

export const META_FILE = "meta.json";
export const TRANSCRIPT_JSON = "transcript.json";
export const TRANSCRIPT_MD = "transcript.md";
export const TRANSCRIBE_LOG = "transcribe.log";

export function recordingsRoot(configured?: string): string {
  if (configured && configured.trim()) {
    const expanded = configured.startsWith("~/")
      ? path.join(process.env.HOME ?? "", configured.slice(2))
      : configured;
    return path.resolve(expanded);
  }
  return path.join(WorkDir, "recordings");
}

/** `yyyy.MM.dd-HHmm` — sorts chronologically as a plain string, which is what lets
 *  the queue drain oldest-first with a name sort. */
export function sessionId(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${at.getFullYear()}.${pad(at.getMonth() + 1)}.${pad(at.getDate())}` +
    `-${pad(at.getHours())}${pad(at.getMinutes())}`
  );
}

/**
 * Create the session directory, suffixing on collision so two meetings in the same
 * minute cannot overwrite each other.
 */
export async function createSessionDir(root: string, at = new Date()): Promise<string> {
  const base = sessionId(at);
  await fs.mkdir(root, { recursive: true });
  for (let n = 1; ; n++) {
    const candidate = path.join(root, n === 1 ? base : `${base}-${n}`);
    try {
      // `mkdir` without recursive throws EEXIST, which makes claiming a name atomic
      // — no stat-then-create race between two starts.
      await fs.mkdir(candidate);
      return candidate;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
}

export async function readMeta(dir: string): Promise<MeetingSessionMeta | null> {
  try {
    const raw = await fs.readFile(path.join(dir, META_FILE), "utf8");
    const parsed = MeetingSessionMeta.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Merge fields into an existing `meta.json`. Used for host-owned additions the
 * sidecar knows nothing about (calendar event, app version, audio deletion).
 */
export async function patchMeta(
  dir: string,
  patch: Partial<MeetingSessionMeta>,
): Promise<MeetingSessionMeta | null> {
  const current = await readMeta(dir);
  if (!current) return null;
  const merged = { ...current, ...patch };
  await writeJsonAtomic(path.join(dir, META_FILE), merged);
  return merged;
}

/**
 * Write via temp file + rename. `transcript.json`'s existence is the "already
 * transcribed" predicate, so a partially written one would make the queue skip a
 * session whose transcript is garbage.
 */
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
  await fs.rename(tmp, file);
}

export async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/** Append a timestamped line to the session's own log. Transcription failures land
 *  here instead of only in the app log, so a session carries its own history. */
export async function appendLog(dir: string, message: string): Promise<void> {
  const line = `${new Date().toISOString()} ${message}\n`;
  try {
    await fs.appendFile(path.join(dir, TRANSCRIBE_LOG), line, "utf8");
  } catch {
    /* logging must never be the reason a session fails */
  }
}
