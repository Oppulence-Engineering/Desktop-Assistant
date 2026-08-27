// Crash-safe JSON persistence: write a sibling tmp file, then rename.
//
// A bare `writeFileSync(file, json)` truncates the file first and fills it
// after; a crash or power loss in between leaves valid-path, invalid-content
// JSON. Every state loader in this codebase deliberately treats a corrupt file
// as "start fresh" — which turns that torn write into a silent, expensive
// reset: a fresh labeling state re-sends every unlabeled email to the LLM
// (priced in labeling_state.ts at ~21,600 credits for one sweep), a fresh
// gmail state is a full re-sync, a fresh security.json drops every grant the
// user ever approved and re-prompts for all of them.
//
// rename(2) on the same filesystem is atomic: readers see the old complete
// file or the new complete file, never a torn one. Five modules already do
// this by hand and say why — notify_calendar_meetings ("a mid-write crash
// can't leave the JSON corrupt"), auth/repo ("Crash-atomic … only copy of
// rotating refresh tokens"), memory/store (manifest renamed last as the commit
// marker), meetings/session, mailbox/store-fs. This is the shared version for
// everyone else; the five keep their local copies, which are working code.
//
// Deliberately imports nothing from the codebase, so any module can use it
// without creating a cycle. No implicit mkdir — call sites own their
// directories, and a typo'd path should fail loudly here rather than
// materialize a new tree.
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";

/**
 * Tmp path beside the target, unique per call.
 *
 * The pid alone is not enough. Two concurrent writers *in the same process* —
 * two permission grants approved in one tick, two scheduled agents updating
 * their state — would share one tmp path, interleave their writes into it, and
 * both rename it into place, splicing two JSON documents into one. That is the
 * exact corruption this module exists to prevent. voice/voice.ts:250 already
 * got this right; the shared helper was weaker than one of its own call sites.
 */
function tmpPathFor(file: string): string {
  return `${file}.${process.pid}.${randomUUID()}.tmp`;
}

/**
 * Serialize `value` and write it to `file` atomically (tmp + rename).
 *
 * @param file - Final path. Its directory must already exist.
 * @param value - JSON-serializable value.
 * @param space - Indentation, as in JSON.stringify. Defaults to 2 like nearly
 *                every state/config file here; pass 0 for the size-sensitive
 *                caches (gmail thread snapshots) that were compact before.
 */
export function writeJsonAtomicSync(file: string, value: unknown, space: number = 2): void {
  const tmp = tmpPathFor(file);
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, space));
    fs.renameSync(tmp, file);
  } catch (error) {
    // Never leave the tmp behind: a later glob or a confused reader must not
    // find a half-written sibling.
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* removal is best-effort */
    }
    throw error;
  }
}

/** Async variant of {@link writeJsonAtomicSync}. */
export async function writeJsonAtomic(
  file: string,
  value: unknown,
  space: number = 2,
): Promise<void> {
  await writeAtomic(file, JSON.stringify(value, null, space));
}

async function writeAtomic(
  file: string,
  value: string,
  options?: { encoding: BufferEncoding; mode?: number },
): Promise<void> {
  const tmp = tmpPathFor(file);
  try {
    await fsp.writeFile(tmp, value, options);
    await fsp.rename(tmp, file);
  } catch (error) {
    await fsp.rm(tmp, { force: true }).catch(() => {
      /* removal is best-effort */
    });
    throw error;
  }
}

/** Atomically replace UTF-8 text while preserving an existing target's mode. */
export async function writeTextAtomic(file: string, value: string): Promise<void> {
  const mode = await fsp
    .stat(file)
    .then((stat) => stat.mode)
    .catch((cause: NodeJS.ErrnoException) => {
      if (cause.code === "ENOENT") return undefined;
      throw cause;
    });
  await writeAtomic(file, value, {
    encoding: "utf8",
    ...(mode === undefined ? {} : { mode }),
  });
}
