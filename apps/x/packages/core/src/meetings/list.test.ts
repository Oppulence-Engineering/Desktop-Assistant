import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { sessionMeta, tone, trackMeta, writeWav } from "./factories.testkit.js";

/**
 * The sessions list is what the recordings UI renders, so the fields it offers actions
 * on have to be true: `hasAudio` gates "transcribe again", and `notePath` gates
 * "open note". Offering to open a note the user has since deleted is worse than
 * offering nothing.
 */

let tmpDir: string;
let root: string;
let list: typeof import("./list.js");
let session: typeof import("./session.js");

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rowboat-meetings-list-"));
  process.env.SOLOMON_WORKDIR = tmpDir;
  vi.resetModules();
  list = await import("./list.js");
  session = await import("./session.js");
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

async function finished(name: string, over: Parameters<typeof sessionMeta>[0] = {}) {
  const dir = path.join(root, name);
  await fs.mkdir(dir, { recursive: true });
  await writeWav(path.join(dir, "mic.wav"), tone(1));
  await session.writeJsonAtomic(
    path.join(dir, "meta.json"),
    sessionMeta({ tracks: [trackMeta()], ...over }),
  );
  return dir;
}

describe("listSessionSummaries", () => {
  it("is newest first and reports audio and transcript state", async () => {
    await finished("2026.07.29-0900");
    const later = await finished("2026.07.29-1000");
    await fs.writeFile(
      path.join(later, "transcript.json"),
      JSON.stringify({
        schema: 1,
        engine: "e",
        model: "m",
        created_at: "x",
        segments: [{ speaker: "me", start_ms: 0, end_ms: 1, text: "hi" }],
      }),
    );

    const summaries = await list.listSessionSummaries(root);
    expect(summaries.map((s) => s.id)).toEqual(["2026.07.29-1000", "2026.07.29-0900"]);
    expect(summaries[0]).toMatchObject({ transcribed: true, hasAudio: true, segmentCount: 1 });
    expect(summaries[1]).toMatchObject({ transcribed: false, hasAudio: true });
  });

  it("reports no audio once retention has removed it", async () => {
    const dir = await finished("2026.07.29-1100");
    await fs.rm(path.join(dir, "mic.wav"));

    const [summary] = await list.listSessionSummaries(root);
    // Drives the UI's "audio removed" line and hides "transcribe again".
    expect(summary.hasAudio).toBe(false);
  });

  it("only offers a note path when the note is actually there", async () => {
    const dir = await finished("2026.07.29-1200");
    expect((await list.listSessionSummaries(root))[0].notePath).toBeUndefined();

    // Same derivation the writer uses.
    const { meetingNotePath } = await import("./note.js");
    const meta = (await session.readMeta(dir))!;
    const rel = meetingNotePath({
      startedAt: new Date(meta.started),
      sessionId: "2026.07.29-1200",
    });
    await fs.mkdir(path.join(tmpDir, path.dirname(rel)), { recursive: true });
    await fs.writeFile(path.join(tmpDir, rel), "# note");

    expect((await list.listSessionSummaries(root))[0].notePath).toBe(rel);
  });

  it("skips a session that is still recording", async () => {
    // No meta.json yet — it has not finished, so there is nothing to act on.
    await fs.mkdir(path.join(root, "2026.07.29-1300"), { recursive: true });
    expect(await list.listSessionSummaries(root)).toEqual([]);
  });
});
