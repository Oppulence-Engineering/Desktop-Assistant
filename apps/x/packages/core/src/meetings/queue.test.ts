import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { MeetingKeepAudio, MeetingTranscriptionProgress } from "@x/shared/dist/meetings.js";
import { fakeTranscriber, sessionMeta, tone, trackMeta, writeWav } from "./factories.testkit.js";

/**
 * The queue's contract is that the filesystem is the source of truth: pending work is
 * discoverable after a crash, a failed session never blocks the rest, and
 * `transcript.json` only appears complete.
 *
 * Isolated WorkDir because the module graph resolves it at import time.
 */

let tmpDir: string;
let root: string;
let queueModule: typeof import("./queue.js");
let sessionModule: typeof import("./session.js");

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rowboat-meetings-queue-"));
  process.env.SOLOMON_WORKDIR = tmpDir;
  vi.resetModules();
  queueModule = await import("./queue.js");
  sessionModule = await import("./session.js");
}, 30000);

afterAll(async () => {
  await fs
    .rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    .catch(() => {});
  delete process.env.SOLOMON_WORKDIR;
});

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpDir, "recordings-"));
});

/** A finished session on disk: one loud track plus meta.json. */
async function finishedSession(name: string, over: Parameters<typeof sessionMeta>[0] = {}) {
  const dir = path.join(root, name);
  await fs.mkdir(dir, { recursive: true });
  await writeWav(path.join(dir, "mic.wav"), tone(1));
  const meta = sessionMeta({ tracks: [trackMeta()], ...over });
  await sessionModule.writeJsonAtomic(path.join(dir, "meta.json"), meta);
  return dir;
}

function makeQueue(
  over: Partial<Parameters<typeof queueModule.MeetingQueue.prototype.constructor>> = {},
) {
  const progress: MeetingTranscriptionProgress[] = [];
  let keepAudio: MeetingKeepAudio = "always";
  const notes: string[] = [];
  const queue = new queueModule.MeetingQueue(root, {
    transcriber: fakeTranscriber(() => [{ start: 0, end: 1, text: "hello" }]),
    engine: () => "whisper.cpp",
    model: () => "base.en-q5_1",
    keepAudio: () => keepAudio,
    writeNote: async ({ dir }) => {
      const notePath = `knowledge/Meetings/solomon/${path.basename(dir)}.md`;
      notes.push(notePath);
      return notePath;
    },
    onProgress: (p) => progress.push(p),
    ...(over as object),
  });
  return { queue, progress, notes, setKeepAudio: (mode: MeetingKeepAudio) => (keepAudio = mode) };
}

/** The queue drains in the background; wait for it to go quiet. */
async function settle(queue: { depth: number }) {
  for (let i = 0; i < 200 && queue.depth > 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(queue.depth).toBe(0);
}

describe("pendingSessions", () => {
  it("finds sessions with meta.json and no transcript.json, oldest first", async () => {
    await finishedSession("2026.07.29-1000");
    await finishedSession("2026.07.29-0900");
    // Already transcribed → not pending.
    const done = await finishedSession("2026.07.29-0800");
    await fs.writeFile(path.join(done, "transcript.json"), "{}");
    // Still recording → no meta.json yet, so not pending either.
    await fs.mkdir(path.join(root, "2026.07.29-1100"), { recursive: true });

    const pending = await queueModule.pendingSessions(root);
    expect(pending.map((p) => path.basename(p))).toEqual(["2026.07.29-0900", "2026.07.29-1000"]);
  });

  it("returns nothing for a missing root instead of throwing", async () => {
    expect(await queueModule.pendingSessions(path.join(root, "nope"))).toEqual([]);
  });
});

describe("MeetingQueue", () => {
  it("transcribes a session and writes both transcript artifacts and a note", async () => {
    const dir = await finishedSession("2026.07.29-1200");
    const { queue, progress, notes } = makeQueue();

    queue.enqueue(dir);
    await settle(queue);

    const transcript = JSON.parse(await fs.readFile(path.join(dir, "transcript.json"), "utf8"));
    expect(transcript.segments).toEqual([
      { speaker: "me", start_ms: 0, end_ms: 1000, text: "hello" },
    ]);
    const markdown = await fs.readFile(path.join(dir, "transcript.md"), "utf8");
    expect(markdown).toContain("**[0:00] You:** hello");
    expect(notes).toEqual(["knowledge/Meetings/solomon/2026.07.29-1200.md"]);

    expect(progress.map((p) => p.phase)).toEqual([
      "queued",
      "transcribing",
      "transcribing",
      "writing",
      "done",
    ]);
    expect(progress.at(-1)?.notePath).toBe("knowledge/Meetings/solomon/2026.07.29-1200.md");
  });

  it("resumes everything pending at launch", async () => {
    await finishedSession("2026.07.29-1300");
    await finishedSession("2026.07.29-1400");
    const { queue } = makeQueue();

    const resumed = await queue.resumePending();
    expect(resumed).toHaveLength(2);
    await settle(queue);

    for (const name of ["2026.07.29-1300", "2026.07.29-1400"]) {
      expect(await sessionModule.exists(path.join(root, name, "transcript.json"))).toBe(true);
    }
  });

  it("does not enqueue the same session twice", async () => {
    const dir = await finishedSession("2026.07.29-1500");
    const { queue, progress } = makeQueue();

    queue.enqueue(dir);
    queue.enqueue(dir);
    await settle(queue);

    expect(progress.filter((p) => p.phase === "queued")).toHaveLength(1);
  });

  it("keeps draining after a session fails, and records why on that session", async () => {
    const broken = await finishedSession("2026.07.29-1600");
    // Corrupt meta.json so this one session cannot be read.
    await fs.writeFile(path.join(broken, "meta.json"), "{ not json");
    const ok = await finishedSession("2026.07.29-1700");

    const { queue, progress } = makeQueue();
    queue.enqueue(broken);
    queue.enqueue(ok);
    await settle(queue);

    expect(progress.find((p) => p.phase === "failed")?.sessionId).toBe("2026.07.29-1600");
    expect(await sessionModule.exists(path.join(ok, "transcript.json"))).toBe(true);
    const log = await fs.readFile(path.join(broken, "transcribe.log"), "utf8");
    expect(log).toContain("transcription failed");
  });

  it("reports queue depth including the job in flight", async () => {
    const a = await finishedSession("2026.07.29-1800");
    const b = await finishedSession("2026.07.29-1900");
    const { queue } = makeQueue();

    queue.enqueue(a);
    queue.enqueue(b);
    expect(queue.depth).toBe(2);
    await settle(queue);
    expect(queue.transcribingSessionId).toBeUndefined();
  });

  it("retranscribes by dropping the existing transcript", async () => {
    const dir = await finishedSession("2026.07.29-2000");
    const { queue } = makeQueue();

    queue.enqueue(dir);
    await settle(queue);
    const first = JSON.parse(await fs.readFile(path.join(dir, "transcript.json"), "utf8"));

    await queue.retranscribe(dir);
    await settle(queue);
    const second = JSON.parse(await fs.readFile(path.join(dir, "transcript.json"), "utf8"));
    // Same audio in, same segments out — but a fresh `created_at`, since this is a
    // new transcription and provenance should say so.
    expect(second.segments).toEqual(first.segments);
    expect(second.created_at).not.toEqual(first.created_at);
  });

  it("deletes audio after transcribing when retention says so", async () => {
    const dir = await finishedSession("2026.07.29-2100");
    const { queue, setKeepAudio } = makeQueue();
    setKeepAudio("untilTranscribed");

    queue.enqueue(dir);
    await settle(queue);

    expect(await sessionModule.exists(path.join(dir, "mic.wav"))).toBe(false);
    // The transcript survives, and meta records why the audio is gone.
    expect(await sessionModule.exists(path.join(dir, "transcript.json"))).toBe(true);
    const meta = await sessionModule.readMeta(dir);
    expect(meta?.audio_deleted_at).toBeTruthy();
  });
});

describe("writeJsonAtomic", () => {
  it("leaves no partial file behind and cleans up its temp file", async () => {
    const file = path.join(root, "atomic.json");
    await sessionModule.writeJsonAtomic(file, { hello: "world" });

    expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual({ hello: "world" });
    expect(await sessionModule.exists(`${file}.tmp`)).toBe(false);
  });
});

describe("createSessionDir", () => {
  it("suffixes on collision so two meetings in one minute cannot collide", async () => {
    const at = new Date("2026-07-29T14:30:00");
    const first = await sessionModule.createSessionDir(root, at);
    const second = await sessionModule.createSessionDir(root, at);

    expect(path.basename(first)).toBe(sessionModule.sessionId(at));
    expect(path.basename(second)).toBe(`${sessionModule.sessionId(at)}-2`);
  });

  it("names sessions so a plain sort is chronological", async () => {
    const names = [
      new Date("2026-01-02T09:05:00"),
      new Date("2026-01-02T10:00:00"),
      new Date("2026-11-02T09:00:00"),
    ].map(sessionModule.sessionId);
    expect([...names].sort()).toEqual(names);
  });
});

describe("summarization", () => {
  it("summarizes after the note exists, and only then", async () => {
    const dir = await finishedSession("2026.07.30-1000");
    const order: string[] = [];
    const { queue } = makeQueue({
      writeNote: async () => {
        order.push("note");
        return "note.md";
      },
      summarize: async ({ notePath }: { notePath: string }) => {
        order.push(`summarize:${notePath}`);
      },
    });

    queue.enqueue(dir);
    await settle(queue);

    // The summary edits the note in place, so it cannot run before the note exists.
    expect(order).toEqual(["note", "summarize:note.md"]);
  });

  it("does not summarize a transcript with no segments", async () => {
    const dir = await finishedSession("2026.07.30-1100", {
      tracks: [trackMeta({ silent: true, peak: 0 })],
    });
    let summarized = false;
    const { queue } = makeQueue({
      writeNote: async () => "note.md",
      summarize: async () => {
        summarized = true;
      },
    });

    queue.enqueue(dir);
    await settle(queue);
    expect(summarized).toBe(false);
  });

  it("still completes the job when summarizing throws", async () => {
    const dir = await finishedSession("2026.07.30-1200");
    const { queue, progress } = makeQueue({
      writeNote: async () => "note.md",
      summarize: async () => {
        throw new Error("model exploded");
      },
    });

    queue.enqueue(dir);
    await settle(queue);

    // A missing summary must not fail a job that produced a good transcript.
    expect(progress.at(-1)?.phase).toBe("done");
    expect(await sessionModule.exists(path.join(dir, "transcript.json"))).toBe(true);
  });

  it("proposes commitments after the transcript exists, and never before the note", async () => {
    const dir = await finishedSession("2026.07.30-1300");
    const order: string[] = [];
    const { queue } = makeQueue({
      writeNote: async () => {
        order.push("note");
        return "note.md";
      },
      summarize: async () => {
        order.push("summarize");
      },
      proposeCommitments: async ({ notePath }: { notePath?: string }) => {
        order.push(`commitments:${notePath}`);
      },
    });

    queue.enqueue(dir);
    await settle(queue);
    expect(order).toEqual(["note", "summarize", "commitments:note.md"]);
  });

  it("does not propose commitments for a transcript with no segments", async () => {
    const dir = await finishedSession("2026.07.30-1310", {
      tracks: [trackMeta({ silent: true, peak: 0 })],
    });
    let proposed = false;
    const { queue } = makeQueue({
      writeNote: async () => "note.md",
      proposeCommitments: async () => {
        proposed = true;
      },
    });

    queue.enqueue(dir);
    await settle(queue);
    // Nothing was said. Asking a model to find commitments in silence is a wasted call.
    expect(proposed).toBe(false);
  });

  it("still completes the job when proposing commitments throws", async () => {
    const dir = await finishedSession("2026.07.30-1320");
    const { queue, progress } = makeQueue({
      writeNote: async () => "note.md",
      proposeCommitments: async () => {
        throw new Error("model exploded");
      },
    });

    queue.enqueue(dir);
    await settle(queue);

    // This one reaches a model, which is the least reliable step in the pipeline — it
    // must never cost the user the transcript that already succeeded.
    expect(progress.at(-1)?.phase).toBe("done");
    expect(await sessionModule.exists(path.join(dir, "transcript.json"))).toBe(true);
  });

  it("still completes the job when announcing the meeting throws", async () => {
    const dir = await finishedSession("2026.07.30-1330");
    const { queue, progress } = makeQueue({
      writeNote: async () => "note.md",
      onTranscribed: async () => {
        throw new Error("event bus down");
      },
    });

    queue.enqueue(dir);
    await settle(queue);

    // The meeting is fully processed by the time this runs; failing to announce it must
    // not undo any of that.
    expect(progress.at(-1)?.phase).toBe("done");
  });

  it("announces the meeting last, with the note it produced", async () => {
    const dir = await finishedSession("2026.07.30-1340");
    const order: string[] = [];
    let announced: { notePath?: string } | null = null;
    const { queue } = makeQueue({
      writeNote: async () => {
        order.push("note");
        return "note.md";
      },
      onTranscribed: async (args: { notePath?: string }) => {
        order.push("announce");
        announced = args;
      },
    });

    queue.enqueue(dir);
    await settle(queue);
    expect(order.at(-1)).toBe("announce");
    expect(announced!.notePath).toBe("note.md");
  });
});

/**
 * The queue always had a `lang` resolver and forwarded it; the controller never supplied
 * one, so it stayed undefined all the way down to the whisper runner's `-l en` default.
 * These pin both halves of the seam.
 */
describe("language", () => {
  it("forwards the resolver's language to the transcriber", async () => {
    const dir = await finishedSession("lang-forward");
    const transcriber = fakeTranscriber(() => [{ start: 0, end: 1, text: "hola" }]);
    const { queue } = makeQueue({ transcriber, lang: () => "es" } as object);

    queue.enqueue(dir);
    await settle(queue);

    expect(transcriber.calls.length).toBeGreaterThan(0);
    expect(transcriber.calls.every((call) => call.lang === "es")).toBe(true);
  });

  it("reads the language at job time, so a settings change applies to the next job", async () => {
    // Same contract as `model`: the thunk is called per job, not captured at
    // construction, which is what makes changing the language and re-transcribing work.
    const first = await finishedSession("lang-job-1");
    const second = await finishedSession("lang-job-2");
    const transcriber = fakeTranscriber(() => [{ start: 0, end: 1, text: "x" }]);
    let language = "fr";
    const { queue } = makeQueue({ transcriber, lang: () => language } as object);

    queue.enqueue(first);
    await settle(queue);
    const afterFirst = transcriber.calls.length;

    language = "de";
    queue.enqueue(second);
    await settle(queue);

    expect(transcriber.calls.slice(0, afterFirst).every((c) => c.lang === "fr")).toBe(true);
    expect(transcriber.calls.slice(afterFirst).every((c) => c.lang === "de")).toBe(true);
  });
});
