import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildArgs,
  parseWhisperJson,
  classify,
  autoThreads,
  timeoutFor,
  spawnWhisper,
  transcribePcm,
  run,
} from "./runner.js";
import { configureWhisperBinary } from "./bin.js";
import { WhisperError } from "./errors.js";

describe("buildArgs", () => {
  it("builds the canonical whisper-cli arg vector", () => {
    const args = buildArgs("/tmp/in.wav", "/tmp/out", {
      modelPath: "/models/ggml-base.en-q5_1.bin",
      threads: 7,
      audioSeconds: 6,
    });
    expect(args).toEqual([
      "-m",
      "/models/ggml-base.en-q5_1.bin",
      "-f",
      "/tmp/in.wav",
      "-l",
      "en",
      "-t",
      "7",
      "-oj",
      "-of",
      "/tmp/out",
      "-nt",
      "-np",
    ]);
  });

  it("appends VAD flags when a VAD model is given, and honors lang", () => {
    const args = buildArgs("/tmp/in.wav", "/tmp/out", {
      modelPath: "/m.bin",
      vadModelPath: "/models/ggml-silero-v5.1.2.bin",
      lang: "auto",
      threads: 4,
      audioSeconds: 1,
    });
    expect(args).toContain("--vad");
    expect(args.slice(args.indexOf("--vad-model"))).toEqual([
      "--vad-model",
      "/models/ggml-silero-v5.1.2.bin",
    ]);
    expect(args[args.indexOf("-l") + 1]).toBe("auto");
  });
});

describe("parseWhisperJson", () => {
  it("maps offsets (ms) → seconds, trims text, and joins segments", () => {
    const { text, segments } = parseWhisperJson({
      transcription: [
        { offsets: { from: 0, to: 3200 }, text: " Hello there." },
        { offsets: { from: 3200, to: 5000 }, text: " General Kenobi. " },
      ],
    });
    expect(segments).toEqual([
      { start: 0, end: 3.2, text: "Hello there." },
      { start: 3.2, end: 5, text: "General Kenobi." },
    ]);
    expect(text).toBe("Hello there. General Kenobi.");
  });

  it("drops empty/whitespace-only segments", () => {
    const { text, segments } = parseWhisperJson({
      transcription: [{ offsets: { from: 0, to: 100 }, text: "   " }],
    });
    expect(segments).toEqual([]);
    expect(text).toBe("");
  });
});

describe("classify", () => {
  it("maps model-load failures to engine_unavailable", () => {
    expect(classify(1, "error: failed to load model").code).toBe("engine_unavailable");
    expect(classify(1, "No such file or directory").code).toBe("engine_unavailable");
  });
  it("maps OOM to engine_crashed", () => {
    expect(classify(1, "std::bad_alloc").code).toBe("engine_crashed");
  });
  it("defaults to engine_crashed", () => {
    expect(classify(2, "something else").code).toBe("engine_crashed");
  });
});

describe("autoThreads / timeoutFor", () => {
  it("leaves a core free and caps at 8", () => {
    const t = autoThreads();
    expect(t).toBeGreaterThanOrEqual(1);
    expect(t).toBeLessThanOrEqual(8);
  });
  it("scales the timeout with audio length but never below 15s", () => {
    expect(timeoutFor(0)).toBe(15000);
    expect(timeoutFor(10)).toBe(30000);
  });
});

describe("spawnWhisper", () => {
  it("SIGKILLs a process that exceeds the timeout", async () => {
    const result = await spawnWhisper(process.execPath, ["-e", "setInterval(() => {}, 1000)"], 150);
    expect(result.signal).toBe("SIGKILL");
  });

  it("rejects with engine_unavailable when the binary does not exist", async () => {
    await expect(spawnWhisper("/nonexistent/whisper-cli-xyz", [], 1000)).rejects.toMatchObject({
      code: "engine_unavailable",
    });
  });

  it("drains stdout while collecting stderr", async () => {
    const result = await spawnWhisper(
      process.execPath,
      ["-e", "process.stdout.write('stdout ok'); process.stderr.write('stderr ok')"],
      1000,
    );
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("stderr ok");
  });
});

// Integration of run() against a fake whisper-cli shell script (POSIX only).
const posix = process.platform !== "win32";
describe.runIf(posix)("run (fake binary)", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "rowboat-runner-test-"));
  });
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
    configureWhisperBinary(""); // reset injection
  });

  async function fakeBin(name: string, body: string): Promise<string> {
    const p = path.join(dir, name);
    await fs.writeFile(p, `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
    return p;
  }

  it("parses the JSON sidecar a successful run writes", async () => {
    const bin = await fakeBin(
      "ok.sh",
      `prev=""; prefix=""
for a in "$@"; do if [ "$prev" = "-of" ]; then prefix="$a"; fi; prev="$a"; done
echo "Core ML model loaded" >&2
printf '%s' '{"transcription":[{"offsets":{"from":0,"to":1200},"text":" Hello there."}]}' > "$prefix.json"`,
    );
    configureWhisperBinary(bin);
    const wav = path.join(dir, "in.wav");
    await fs.writeFile(wav, Buffer.alloc(44));
    const r = await run(wav, { modelPath: "/m.bin", audioSeconds: 1.2 });
    expect(r.text).toBe("Hello there.");
    expect(r.segments[0]).toMatchObject({ start: 0, end: 1.2, text: "Hello there." });
    expect(r.rtf).toBeGreaterThan(0);
    expect(r.engineLog).toContain("Core ML model loaded");
  });

  it("does not leave whisper-cli output beside the input WAV", async () => {
    const bin = await fakeBin(
      "ok-clean.sh",
      `prev=""; prefix=""
for a in "$@"; do if [ "$prev" = "-of" ]; then prefix="$a"; fi; prev="$a"; done
printf '%s' '{"transcription":[{"offsets":{"from":0,"to":500},"text":" Clean."}]}' > "$prefix.json"`,
    );
    configureWhisperBinary(bin);
    const wav = path.join(dir, "clean.wav");
    await fs.writeFile(wav, Buffer.alloc(44));
    await run(wav, { modelPath: "/m.bin", audioSeconds: 0.5 });
    await expect(fs.access(path.join(path.dirname(wav), "out.json"))).rejects.toBeTruthy();
  });

  it("maps a SIGKILL timeout to engine_timeout", async () => {
    const bin = await fakeBin("slow.sh", "sleep 10");
    configureWhisperBinary(bin);
    const wav = path.join(dir, "in.wav");
    await fs.writeFile(wav, Buffer.alloc(44));
    await expect(
      run(wav, { modelPath: "/m.bin", audioSeconds: 1, timeoutMs: 150 }),
    ).rejects.toMatchObject({
      code: "engine_timeout",
    });
  });

  it("maps a non-zero exit to a classified WhisperError", async () => {
    const bin = await fakeBin("crash.sh", 'echo "error: failed to load model" >&2; exit 1');
    configureWhisperBinary(bin);
    const wav = path.join(dir, "in.wav");
    await fs.writeFile(wav, Buffer.alloc(44));
    const err = await run(wav, { modelPath: "/m.bin", audioSeconds: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(WhisperError);
    expect(err.code).toBe("engine_unavailable");
  });

  it("retries without VAD when non-silent audio returns an empty VAD transcript", async () => {
    const argsLog = path.join(dir, "vad-retry-args.log");
    await fs.rm(argsLog, { force: true });
    const bin = await fakeBin(
      "vad-empty-retry.sh",
      `prev=""; prefix=""
has_vad=0
for a in "$@"; do
  if [ "$prev" = "-of" ]; then prefix="$a"; fi
  if [ "$a" = "--vad" ]; then has_vad=1; fi
  prev="$a"
done
printf '%s\\n' "$*" >> ${JSON.stringify(argsLog)}
if [ "$has_vad" = "1" ]; then
  printf '%s' '{"transcription":[]}' > "$prefix.json"
else
  printf '%s' '{"transcription":[{"offsets":{"from":0,"to":900},"text":" Fallback transcript."}]}' > "$prefix.json"
fi`,
    );
    configureWhisperBinary(bin);
    const pcm = new Int16Array(16000);
    for (let i = 0; i < pcm.length; i++) {
      pcm[i] = Math.round(Math.sin((2 * Math.PI * 220 * i) / 16000) * 2000);
    }

    const result = await transcribePcm(pcm, {
      modelPath: "/m.bin",
      vadModelPath: "/vad.bin",
      audioSeconds: 1,
    });

    expect(result.text).toBe("Fallback transcript.");
    const invocations = (await fs.readFile(argsLog, "utf8")).trim().split("\n");
    expect(invocations).toHaveLength(2);
    expect(invocations[0]).toContain("--vad");
    expect(invocations[1]).not.toContain("--vad");
  });

  it("does not retry without VAD when silent audio returns an empty transcript", async () => {
    const argsLog = path.join(dir, "vad-silent-args.log");
    await fs.rm(argsLog, { force: true });
    const bin = await fakeBin(
      "vad-empty-silent.sh",
      `prev=""; prefix=""
for a in "$@"; do if [ "$prev" = "-of" ]; then prefix="$a"; fi; prev="$a"; done
printf '%s\\n' "$*" >> ${JSON.stringify(argsLog)}
printf '%s' '{"transcription":[]}' > "$prefix.json"`,
    );
    configureWhisperBinary(bin);

    const result = await transcribePcm(new Int16Array(16000), {
      modelPath: "/m.bin",
      vadModelPath: "/vad.bin",
      audioSeconds: 1,
    });

    expect(result.text).toBe("");
    const invocations = (await fs.readFile(argsLog, "utf8")).trim().split("\n");
    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toContain("--vad");
  });
});
