# Local Voice Product Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Rowboat desktop voice from a working local Whisper path into a product-grade speech layer for dogfooding, push-to-talk, commands, meetings, model management, privacy, evaluation, and email workflows.

**Architecture:** Keep the local engine in main/core and expose typed IPC contracts through `apps/x/packages/shared`. Renderer code should stay as thin capture/UI orchestration, while durable behavior such as command parsing, model health, auto-selection, diagnostics, and privacy policy lives in core. Each feature lands behind typed settings and tested seams so local Whisper, Deepgram, and future providers can share the same UX states.

**Tech Stack:** Electron main/renderer, React, TypeScript, Zod IPC schemas, Vitest, whisper.cpp, CoreML/Metal capability probing, MessagePort streaming, existing Rowboat workspace/file IPC, existing email RFCs in `apps/rfc/email-*`.

---

## Current Repo Map

The implementation must build on the current local transcription stack, not on the older "Deepgram only" state described in the opening section of RFC 009.

- `apps/rfc/009-local-on-device-transcription.md` - base local Whisper architecture, settings, IPC, model manager, eval, packaging, and privacy reference.
- `apps/rfc/017-on-device-meeting-diarization.md` - future local speaker separation track for meetings.
- `apps/rfc/email-000-inbox-zero-agent-reference.md` - Inbox Zero feature reference for all email-related voice work.
- `apps/rfc/email-002-mailbox-command-center.md` - command center behaviors that voice commands should target.
- `apps/rfc/email-003-ai-rules-and-action-engine.md` - safe action execution, rules, and confirmations.
- `apps/rfc/email-004-reply-zero-and-drafting.md` - voice-to-reply and drafting workflows.
- `apps/rfc/email-014-sync-reliability-rate-limits-and-repair.md` - sync repair and provider reliability constraints.
- `apps/rfc/email-018-email-product-roadmap-and-build-order.md` - build order for email product features.
- `apps/rfc/email-021-implementation-blueprints-and-code-examples.md` - concrete email implementation examples to reuse.
- `apps/x/packages/shared/src/transcription.ts` - shared provider, Whisper model, capability, segment, and config schemas.
- `apps/x/packages/shared/src/ipc.ts` - typed IPC contracts for `whisper:*`, `transcription:*`, `voice:*`, meeting, workspace, and future voice commands.
- `apps/x/apps/main/src/ipc.ts` - main-process IPC handlers that wire core services to renderer.
- `apps/x/packages/core/src/voice/voice.ts` - persisted voice/transcription config and provider resolution entry point.
- `apps/x/packages/core/src/voice/whisper/` - local Whisper catalog, checksums, model manager, capability probe, runner, service facade, streaming session, WER and eval tests.
- `apps/x/apps/renderer/src/hooks/useVoiceMode.ts` - current voice input hook; local path captures batch PCM and transcribes on submit.
- `apps/x/apps/renderer/src/hooks/useMeetingTranscription.ts` - current meeting hook; cloud streaming or local MessagePort streaming into meeting notes.
- `apps/x/apps/renderer/src/lib/whisper-stream.ts` - renderer MessagePort driver for local meeting streaming.
- `apps/x/apps/renderer/src/components/settings/transcription-settings.tsx` - settings UI for providers, device capability, and model download/remove.
- `apps/x/apps/renderer/src/components/chat-input-with-mentions.tsx` - first consumer of push-to-talk dictation.
- `apps/x/apps/renderer/src/components/email-view.tsx` - first consumer of voice-to-email workflows.
- `apps/x/apps/renderer/src/components/meetings-view.tsx` - first consumer of meeting recorder upgrades.
- `apps/x/apps/renderer/src/components/ui/command.tsx` - command palette surface for voice command search and execution.

## Product Shape

The finished product should feel like one coherent voice layer:

- A diagnostics panel can prove the local mic path works in 10 seconds.
- Push-to-talk works in chat, email drafts, meeting notes, command palette, and focused text inputs.
- Voice commands turn speech into structured app intents with confirmation for destructive actions.
- Real-time local transcription shows near-real-time partial text using VAD segmenting and rolling decode windows.
- Meeting recorder records local-first notes with transcript, summary, action items, open questions, follow-up drafts, and provenance.
- Model auto-selector picks a local model based on measured device speed, memory, and user preference.
- Model download UX can verify and repair GGUF and CoreML sidecar artifacts.
- Local-only privacy mode blocks cloud STT fallback, disables raw-audio retention by default, and shows auditable proof.
- Voice-to-email reaches parity with the Inbox Zero-inspired RFCs by mapping speech to triage, drafting, rules, labels, reminders, and bulk review flows.

## Shared Contracts

Implement these shared contracts before feature-specific UI. Every task below references these names.

Add to `apps/x/packages/shared/src/transcription.ts`:

```ts
export const WhisperModelHealth = z.object({
  id: z.string(),
  installed: z.boolean(),
  ggufOk: z.boolean(),
  vadOk: z.boolean(),
  coremlOk: z.boolean().optional(),
  sizeMb: z.number(),
  expectedSizeMb: z.number().optional(),
  checksum: z.string().optional(),
  expectedChecksum: z.string().optional(),
  repairable: z.boolean(),
  reason: z.string().optional(),
});
export type WhisperModelHealth = z.infer<typeof WhisperModelHealth>;

export const WhisperBenchmarkProfile = z.object({
  deviceId: z.string(),
  model: z.string(),
  accel: WhisperAccel,
  sampleSeconds: z.number(),
  durationMs: z.number(),
  rtf: z.number(),
  measuredAt: z.string(),
});
export type WhisperBenchmarkProfile = z.infer<typeof WhisperBenchmarkProfile>;

export const VoicePrivacySettings = z.object({
  localOnly: z.boolean().default(false),
  retainRawAudio: z.boolean().default(false),
  retainDiagnostics: z.boolean().default(true),
  redactTranscriptsInLogs: z.boolean().default(true),
});
export type VoicePrivacySettings = z.infer<typeof VoicePrivacySettings>;

export const WhisperDiagnosticResult = z.object({
  success: z.boolean(),
  provider: TranscriptionProvider,
  model: z.string(),
  accel: WhisperAccel,
  sampleSeconds: z.number(),
  durationMs: z.number(),
  rtf: z.number().optional(),
  text: z.string().optional(),
  code: WhisperErrorCode.optional(),
  engineLog: z.string().optional(),
});
export type WhisperDiagnosticResult = z.infer<typeof WhisperDiagnosticResult>;

export const VoiceStreamEvent = z.discriminatedUnion("type", [
  z.object({
    v: z.literal(1),
    type: z.literal("partial"),
    text: z.string(),
    start: z.number(),
    end: z.number(),
    speaker: WhisperSpeaker.optional(),
    confidence: z.number().min(0).max(1).optional(),
  }),
  z.object({
    v: z.literal(1),
    type: z.literal("final"),
    segment: WhisperSegment,
  }),
  z.object({
    v: z.literal(1),
    type: z.literal("ack"),
    seq: z.number(),
    credits: z.number(),
  }),
  z.object({
    v: z.literal(1),
    type: z.literal("error"),
    code: WhisperErrorCode,
  }),
  z.object({
    v: z.literal(1),
    type: z.literal("done"),
  }),
]);
export type VoiceStreamEvent = z.infer<typeof VoiceStreamEvent>;

export const VoiceCommandIntent = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("email.composeReply"),
    threadId: z.string().optional(),
    body: z.string(),
  }),
  z.object({
    kind: z.literal("email.triage"),
    query: z.string().optional(),
    action: z.enum(["archive", "label", "snooze", "mark_waiting", "unsubscribe"]),
    label: z.string().optional(),
  }),
  z.object({
    kind: z.literal("email.createRule"),
    description: z.string(),
  }),
  z.object({
    kind: z.literal("meeting.startRecording"),
    title: z.string().optional(),
  }),
  z.object({
    kind: z.literal("meeting.stopRecording"),
  }),
  z.object({
    kind: z.literal("app.openCommand"),
    query: z.string(),
  }),
  z.object({
    kind: z.literal("text.insert"),
    text: z.string(),
  }),
]);
export type VoiceCommandIntent = z.infer<typeof VoiceCommandIntent>;
```

Extend `TranscriptionConfig` in the same file:

```ts
export const TranscriptionConfig = z.object({
  $schemaVersion: z.literal(1).default(1),
  voiceProvider: TranscriptionProvider.default("whisper-local"),
  meetingProvider: TranscriptionProvider.default("deepgram"),
  whisper: WhisperSettings.default(DEFAULT_WHISPER_SETTINGS),
  privacy: VoicePrivacySettings.default({
    localOnly: false,
    retainRawAudio: false,
    retainDiagnostics: true,
    redactTranscriptsInLogs: true,
  }),
});
```

Extend `apps/x/packages/shared/src/ipc.ts`:

```ts
"whisper:diagnose": {
  req: z.object({
    pcm16: z.instanceof(ArrayBuffer),
    sampleRate: z.literal(16000),
    expectedText: z.string().optional(),
  }),
  res: WhisperDiagnosticResult,
},
"whisper:verifyModel": {
  req: z.object({ id: z.string() }),
  res: WhisperModelHealth,
},
"whisper:repairModel": {
  req: z.object({ id: z.string() }),
  res: WhisperModelHealth,
},
"whisper:benchmark": {
  req: z.object({ model: z.string().optional(), sampleSeconds: z.number().default(10) }),
  res: WhisperBenchmarkProfile,
},
"voice:parseCommand": {
  req: z.object({ text: z.string(), surface: z.enum(["global", "chat", "email", "meeting"]) }),
  res: z.object({ intent: VoiceCommandIntent, requiresConfirmation: z.boolean() }),
},
"voice:executeCommand": {
  req: z.object({ intent: VoiceCommandIntent, confirmed: z.boolean().default(false) }),
  res: z.object({ success: z.boolean(), message: z.string().optional() }),
},
```

## Task 1: Shared Voice Contracts And Config Migration

**Files:**

- Modify: `apps/x/packages/shared/src/transcription.ts`
- Modify: `apps/x/packages/shared/src/ipc.ts`
- Modify: `apps/x/packages/core/src/voice/voice.ts`
- Modify: `apps/x/packages/core/src/voice/transcription-config.test.ts`

- [ ] **Step 1: Add failing config tests**

Add these tests to `apps/x/packages/core/src/voice/transcription-config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { TranscriptionConfig } from "@x/shared/dist/transcription.js";

describe("transcription privacy config", () => {
  it("defaults to local Whisper with cloud fallback allowed", () => {
    const parsed = TranscriptionConfig.parse({});
    expect(parsed.voiceProvider).toBe("whisper-local");
    expect(parsed.privacy).toEqual({
      localOnly: false,
      retainRawAudio: false,
      retainDiagnostics: true,
      redactTranscriptsInLogs: true,
    });
  });

  it("accepts local-only privacy mode", () => {
    const parsed = TranscriptionConfig.parse({
      privacy: { localOnly: true, retainRawAudio: false },
    });
    expect(parsed.privacy.localOnly).toBe(true);
    expect(parsed.privacy.retainRawAudio).toBe(false);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `cd apps/x/packages/core && npx vitest run src/voice/transcription-config.test.ts`

Expected: FAIL because `privacy` is missing from the shared `TranscriptionConfig`.

- [ ] **Step 3: Add shared schemas**

Add the shared schema block from "Shared Contracts" to `apps/x/packages/shared/src/transcription.ts`, export each type, and add the IPC entries to `apps/x/packages/shared/src/ipc.ts`.

- [ ] **Step 4: Preserve existing config files**

In `apps/x/packages/core/src/voice/voice.ts`, ensure config reads parse missing `privacy` through the schema default and config writes preserve existing nested keys:

```ts
export async function setTranscriptionConfig(
  patch: Partial<TranscriptionConfig>,
): Promise<TranscriptionConfig> {
  const current = await getTranscriptionConfig();
  const next = TranscriptionConfig.parse({
    ...current,
    ...patch,
    whisper: {
      ...current.whisper,
      ...patch.whisper,
    },
    privacy: {
      ...current.privacy,
      ...patch.privacy,
    },
  });
  await writeTranscriptionConfig(next);
  return next;
}
```

- [ ] **Step 5: Run the config tests**

Run: `cd apps/x/packages/core && npx vitest run src/voice/transcription-config.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/x/packages/shared/src/transcription.ts apps/x/packages/shared/src/ipc.ts apps/x/packages/core/src/voice/voice.ts apps/x/packages/core/src/voice/transcription-config.test.ts
git commit -m "feat: extend voice transcription contracts"
```

## Task 2: Live Mic Dogfood Mode

**Files:**

- Create: `apps/x/packages/core/src/voice/whisper/diagnostics.ts`
- Create: `apps/x/packages/core/src/voice/whisper/diagnostics.test.ts`
- Modify: `apps/x/packages/core/src/voice/whisper/runner.ts`
- Modify: `apps/x/packages/core/src/voice/whisper/runner.test.ts`
- Modify: `apps/x/packages/core/src/voice/whisper/service.ts`
- Modify: `apps/x/apps/main/src/ipc.ts`
- Create: `apps/x/apps/renderer/src/components/settings/local-speech-dogfood-panel.tsx`
- Modify: `apps/x/apps/renderer/src/components/settings/transcription-settings.tsx`

- [ ] **Step 1: Write the failing diagnostics test**

Create `apps/x/packages/core/src/voice/whisper/diagnostics.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { runWhisperDiagnostic } from "./diagnostics.js";

describe("runWhisperDiagnostic", () => {
  it("returns latency, model, accel, text, and engine log", async () => {
    const result = await runWhisperDiagnostic({
      pcm16: new Int16Array(16000),
      sampleRate: 16000,
      model: "base.en-q5_1",
      accel: "coreml",
      expectedText: "quick brown fox",
      transcribe: vi.fn().mockResolvedValue({
        text: "quick brown fox",
        rtf: 2.3,
        durationMs: 900,
        engineLog: "Core ML model loaded",
      }),
    });

    expect(result).toMatchObject({
      success: true,
      provider: "whisper-local",
      model: "base.en-q5_1",
      accel: "coreml",
      text: "quick brown fox",
      rtf: 2.3,
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.engineLog).toContain("Core ML model loaded");
  });

  it("redacts engine log when diagnostics retention is disabled", async () => {
    const result = await runWhisperDiagnostic({
      pcm16: new Int16Array(16000),
      sampleRate: 16000,
      model: "base.en-q5_1",
      accel: "metal",
      retainDiagnostics: false,
      transcribe: vi.fn().mockResolvedValue({
        text: "hello",
        rtf: 1.1,
        durationMs: 1200,
        engineLog: "sensitive path /Users/example/audio.wav",
      }),
    });

    expect(result.success).toBe(true);
    expect(result.engineLog).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the failing diagnostics test**

Run: `cd apps/x/packages/core && npx vitest run src/voice/whisper/diagnostics.test.ts`

Expected: FAIL because `diagnostics.ts` does not exist.

- [ ] **Step 3: Implement diagnostics core**

Create `apps/x/packages/core/src/voice/whisper/diagnostics.ts`:

```ts
import type {
  TranscriptionProvider,
  WhisperAccel,
  WhisperDiagnosticResult,
} from "@x/shared/dist/transcription.js";
import { codeOf } from "./errors.js";

export interface DiagnosticInput {
  pcm16: Int16Array;
  sampleRate: 16000;
  model: string;
  accel: WhisperAccel;
  expectedText?: string;
  retainDiagnostics?: boolean;
  transcribe: (pcm16: Int16Array) => Promise<{
    text?: string;
    rtf?: number;
    durationMs?: number;
    engineLog?: string;
  }>;
}

export async function runWhisperDiagnostic(
  input: DiagnosticInput,
): Promise<WhisperDiagnosticResult> {
  const startedAt = Date.now();
  try {
    const result = await input.transcribe(input.pcm16);
    return {
      success: true,
      provider: "whisper-local" satisfies TranscriptionProvider,
      model: input.model,
      accel: input.accel,
      sampleSeconds: input.pcm16.length / input.sampleRate,
      durationMs: result.durationMs ?? Date.now() - startedAt,
      rtf: result.rtf,
      text: result.text,
      engineLog: input.retainDiagnostics === false ? undefined : result.engineLog,
    };
  } catch (err) {
    return {
      success: false,
      provider: "whisper-local",
      model: input.model,
      accel: input.accel,
      sampleSeconds: input.pcm16.length / input.sampleRate,
      durationMs: Date.now() - startedAt,
      code: codeOf(err),
    };
  }
}
```

- [ ] **Step 4: Wire service and IPC**

First extend `RunResult` in `apps/x/packages/core/src/voice/whisper/runner.ts` so diagnostics can show the engine proof line:

```ts
export interface RunResult {
  text: string;
  segments: Segment[];
  rtf: number;
  durationMs: number;
  engineLog?: string;
}
```

Return a bounded stderr excerpt from `run()`:

```ts
return {
  text,
  segments,
  rtf: o.audioSeconds / (durationMs / 1000),
  durationMs,
  engineLog: stderr.slice(0, 2000),
};
```

Add `diagnose` to `apps/x/packages/core/src/voice/whisper/service.ts`:

```ts
async diagnose(req: {
  pcm16: Int16Array;
  sampleRate: 16000;
  expectedText?: string;
  retainDiagnostics?: boolean;
}): Promise<WhisperDiagnosticResult> {
  const modelId = this.resolveModel();
  const modelPath = await this.mm.ensure(modelId, { withVad: true });
  const capability = await this.capability();
  return runWhisperDiagnostic({
    pcm16: req.pcm16,
    sampleRate: req.sampleRate,
    model: modelId,
    accel: capability.accel,
    expectedText: req.expectedText,
    retainDiagnostics: req.retainDiagnostics,
    transcribe: (pcm16) =>
      transcribePcm(pcm16, {
        modelPath,
        vadModelPath: vadModelPath(this.modelsDir),
        lang: "en",
        audioSeconds: pcm16.length / 16000,
      }),
  });
}
```

Add the handler in `apps/x/apps/main/src/ipc.ts`:

```ts
"whisper:diagnose": async (_event, req) => {
  const cfg = await voice.getTranscriptionConfig();
  return getWhisper().diagnose({
    pcm16: new Int16Array(req.pcm16),
    sampleRate: req.sampleRate,
    expectedText: req.expectedText,
    retainDiagnostics: cfg.privacy.retainDiagnostics,
  });
},
```

- [ ] **Step 5: Add dogfood settings panel**

Create `apps/x/apps/renderer/src/components/settings/local-speech-dogfood-panel.tsx`:

```tsx
import { useCallback, useRef, useState } from "react";
import { Mic, Square, Activity } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { WhisperDiagnosticResult } from "@x/shared/dist/transcription.js";

export function LocalSpeechDogfoodPanel() {
  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const [result, setResult] = useState<WhisperDiagnosticResult | null>(null);
  const chunksRef = useRef<Int16Array[]>([]);
  const cleanupRef = useRef<(() => void) | null>(null);

  const start = useCallback(async () => {
    setResult(null);
    chunksRef.current = [];
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new AudioContext({ sampleRate: 16000 });
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(2048, 1, 1);
    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const pcm = new Int16Array(input.length);
      let sum = 0;
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        sum += s * s;
      }
      setLevel(Math.min(100, Math.round(Math.sqrt(sum / input.length) * 200)));
      chunksRef.current.push(pcm);
    };
    source.connect(processor);
    processor.connect(ctx.destination);
    cleanupRef.current = () => {
      processor.disconnect();
      void ctx.close();
      stream.getTracks().forEach((track) => track.stop());
    };
    setRecording(true);
  }, []);

  const stop = useCallback(async () => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    setRecording(false);
    const total = chunksRef.current.reduce((n, chunk) => n + chunk.length, 0);
    const pcm = new Int16Array(total);
    let offset = 0;
    for (const chunk of chunksRef.current) {
      pcm.set(chunk, offset);
      offset += chunk.length;
    }
    const diagnostic = await window.ipc.invoke("whisper:diagnose", {
      pcm16: pcm.buffer,
      sampleRate: 16000,
      expectedText: "the quick brown fox jumps over the lazy dog",
    });
    setResult(diagnostic);
  }, []);

  return (
    <div className="space-y-3 border px-3.5 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-medium">Live mic dogfood</div>
          <div className="text-xs text-muted-foreground">
            Record a short phrase and verify the local path.
          </div>
        </div>
        <Button size="sm" onClick={recording ? stop : start} className="gap-1.5">
          {recording ? <Square className="size-3.5" /> : <Mic className="size-3.5" />}
          {recording ? "Stop" : "Test"}
        </Button>
      </div>
      {recording && <Progress value={level} className="h-1.5" />}
      {result && (
        <div className="space-y-1 text-xs">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Activity className="size-3.5" />
            {result.model} · {result.accel} · {result.durationMs} ms
          </div>
          <div className="rounded-none border bg-muted/30 px-2 py-1">
            {result.text || result.code}
          </div>
        </div>
      )}
    </div>
  );
}
```

Render it from `TranscriptionSettings` under the device capability line.

- [ ] **Step 6: Run tests**

Run: `cd apps/x/packages/core && npx vitest run src/voice/whisper/diagnostics.test.ts src/voice/whisper/runner.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/x/packages/core/src/voice/whisper/diagnostics.ts apps/x/packages/core/src/voice/whisper/diagnostics.test.ts apps/x/packages/core/src/voice/whisper/runner.ts apps/x/packages/core/src/voice/whisper/runner.test.ts apps/x/packages/core/src/voice/whisper/service.ts apps/x/apps/main/src/ipc.ts apps/x/apps/renderer/src/components/settings/local-speech-dogfood-panel.tsx apps/x/apps/renderer/src/components/settings/transcription-settings.tsx
git commit -m "feat: add local speech dogfood diagnostics"
```

## Task 3: Model Health, Verify, And Repair UX

**Files:**

- Modify: `apps/x/packages/core/src/voice/whisper/model-manager.ts`
- Modify: `apps/x/packages/core/src/voice/whisper/model-manager.test.ts`
- Modify: `apps/x/packages/core/src/voice/whisper/service.ts`
- Modify: `apps/x/apps/main/src/ipc.ts`
- Modify: `apps/x/apps/renderer/src/components/settings/transcription-settings.tsx`

- [ ] **Step 1: Add failing health tests**

Add to `model-manager.test.ts`:

```ts
it("reports a repairable CoreML sidecar checksum mismatch", async () => {
  const ggufPayload = Buffer.from("valid-gguf");
  const sidecarPayload = Buffer.from("valid-sidecar");
  const catalog = makeCatalog(ggufPayload, {
    id: "fake-model",
    coreml: {
      url: "https://example.test/ggml-fake-encoder.mlmodelc.zip",
      sha256: sha256(sidecarPayload),
      sizeMb: 1,
    },
  });
  const manager = new ModelManager(dir, () => {}, {
    catalog,
    fetchImpl: makeFetch(ggufPayload),
    freeBytes: hugeFree,
  });
  await fs.writeFile(path.join(dir, "ggml-fake.bin"), ggufPayload);
  await fs.writeFile(path.join(dir, "ggml-fake-encoder.mlmodelc.zip"), "wrong-sidecar");

  const health = await manager.verifyModel("fake-model");

  expect(health).toMatchObject({
    id: "fake-model",
    installed: true,
    ggufOk: true,
    coremlOk: false,
    repairable: true,
  });
});

it("repairs a model by deleting bad artifacts and re-running ensureModel", async () => {
  const payload = Buffer.from("correct-model");
  const manager = new ModelManager(dir, () => {}, {
    catalog: makeCatalog(payload),
    fetchImpl: makeFetch(payload),
    freeBytes: hugeFree,
  });
  await fs.writeFile(path.join(dir, "ggml-fake.bin"), "corrupt");

  const repaired = await manager.repairModel("fake-model");

  expect(repaired.installed).toBe(true);
  expect(repaired.ggufOk).toBe(true);
  expect(repaired.repairable).toBe(false);
});
```

- [ ] **Step 2: Run the failing tests**

Run: `cd apps/x/packages/core && npx vitest run src/voice/whisper/model-manager.test.ts`

Expected: FAIL because `verifyModel` and `repairModel` are not implemented.

- [ ] **Step 3: Implement health methods**

Add methods to the model manager:

```ts
private mustCatalogEntry(id: string): ModelEntry {
  const entry = this.catalog.find((model) => model.id === id);
  if (!entry) throw new WhisperError("model_not_installed", `unknown model ${id}`);
  return entry;
}

private async verifyArtifact(input: {
  path: string;
  sha256: string;
  sizeMb?: number;
}): Promise<{
  ok: boolean;
  sizeBytes: number;
  actualChecksum?: string;
  expectedChecksum: string;
  reason?: string;
}> {
  try {
    const buf = await fs.readFile(input.path);
    const actualChecksum = createHash("sha256").update(buf).digest("hex");
    return {
      ok: actualChecksum === input.sha256,
      sizeBytes: buf.byteLength,
      actualChecksum,
      expectedChecksum: input.sha256,
      reason: actualChecksum === input.sha256 ? undefined : "checksum mismatch",
    };
  } catch {
    return {
      ok: false,
      sizeBytes: 0,
      expectedChecksum: input.sha256,
      reason: "missing artifact",
    };
  }
}

async verifyModel(id: string): Promise<WhisperModelHealth> {
  const entry = this.mustCatalogEntry(id);
  const gguf = await this.verifyArtifact({
    path: path.join(this.dir, fileNameFromUrl(entry.url)),
    sha256: entry.sha256,
    sizeMb: entry.sizeMb,
  });
  const vadEntry = this.mustCatalogEntry("silero-vad");
  const vad = await this.verifyArtifact({
    path: path.join(this.dir, fileNameFromUrl(vadEntry.url)),
    sha256: vadEntry.sha256,
    sizeMb: vadEntry.sizeMb,
  });
  const coreml = entry.coreml
    ? await this.verifyArtifact({
        path: path.join(this.dir, fileNameFromUrl(entry.coreml.url)),
        sha256: entry.coreml.sha256,
        sizeMb: entry.coreml.sizeMb,
      })
    : undefined;
  const installed = gguf.ok && vad.ok && (coreml?.ok ?? true);

  return {
    id,
    installed,
    ggufOk: gguf.ok,
    vadOk: vad.ok,
    coremlOk: coreml?.ok,
    sizeMb: Math.round((gguf.sizeBytes + vad.sizeBytes + (coreml?.sizeBytes ?? 0)) / 1024 / 1024),
    expectedSizeMb: entry.sizeMb + vadEntry.sizeMb + (entry.coreml?.sizeMb ?? 0),
    checksum: gguf.actualChecksum,
    expectedChecksum: gguf.expectedChecksum,
    repairable: !installed,
    reason: installed ? undefined : [gguf.reason, vad.reason, coreml?.reason].filter(Boolean).join("; "),
  };
}

async repairModel(id: string): Promise<WhisperModelHealth> {
  const health = await this.verifyModel(id);
  if (!health.repairable) return health;
  await this.removeModel(id);
  await this.ensureModel(id);
  return this.verifyModel(id);
}
```

- [ ] **Step 4: Expose through service and IPC**

Add service methods:

```ts
verifyModel(id: string): Promise<WhisperModelHealth> {
  return this.modelManager.verifyModel(id);
}

repairModel(id: string): Promise<WhisperModelHealth> {
  return this.modelManager.repairModel(id);
}
```

Add main IPC handlers:

```ts
"whisper:verifyModel": async (_event, { id }) => {
  return getWhisper().verifyModel(id);
},
"whisper:repairModel": async (_event, { id }) => {
  return getWhisper().repairModel(id);
},
```

- [ ] **Step 5: Add settings UX states**

In `transcription-settings.tsx`, add a per-model health map:

```tsx
const [health, setHealth] = useState<Record<string, WhisperModelHealth>>({});

const verify = useCallback(async (id: string) => {
  const result = await window.ipc.invoke("whisper:verifyModel", { id });
  setHealth((prev) => ({ ...prev, [id]: result }));
}, []);

const repair = useCallback(
  async (id: string) => {
    const result = await window.ipc.invoke("whisper:repairModel", { id });
    setHealth((prev) => ({ ...prev, [id]: result }));
    await refreshModels();
  },
  [refreshModels],
);
```

Add two icon buttons for installed models:

```tsx
<Button
  size="icon-sm"
  variant="ghost"
  aria-label={`Verify ${m.label}`}
  onClick={() => verify(m.id)}
>
  <ShieldCheck className="size-4" />
</Button>;
{
  health[m.id]?.repairable && (
    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => repair(m.id)}>
      <Wrench className="size-3.5" />
      Repair
    </Button>
  );
}
```

- [ ] **Step 6: Run tests**

Run: `cd apps/x/packages/core && npx vitest run src/voice/whisper/model-manager.test.ts src/voice/whisper/catalog.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/x/packages/core/src/voice/whisper/model-manager.ts apps/x/packages/core/src/voice/whisper/model-manager.test.ts apps/x/packages/core/src/voice/whisper/service.ts apps/x/apps/main/src/ipc.ts apps/x/apps/renderer/src/components/settings/transcription-settings.tsx
git commit -m "feat: add whisper model verify and repair"
```

## Task 4: Model Auto-Selector And Device Benchmarking

**Files:**

- Create: `apps/x/packages/core/src/voice/whisper/benchmark.ts`
- Create: `apps/x/packages/core/src/voice/whisper/benchmark.test.ts`
- Modify: `apps/x/packages/core/src/voice/whisper/service.ts`
- Modify: `apps/x/packages/core/src/voice/voice.ts`
- Modify: `apps/x/apps/main/src/ipc.ts`
- Modify: `apps/x/apps/renderer/src/components/settings/transcription-settings.tsx`

- [ ] **Step 1: Add failing benchmark selection tests**

Create `apps/x/packages/core/src/voice/whisper/benchmark.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { chooseAutoModel } from "./benchmark.js";

describe("chooseAutoModel", () => {
  it("chooses small for fast Apple Silicon", () => {
    const choice = chooseAutoModel({
      accel: "coreml",
      memoryGb: 16,
      profiles: [
        { model: "base.en-q5_1", rtf: 8 },
        { model: "small.en-q5_1", rtf: 3.2 },
      ],
    });
    expect(choice).toBe("small.en-q5_1");
  });

  it("chooses base for CPU-only devices below realtime margin", () => {
    const choice = chooseAutoModel({
      accel: "cpu",
      memoryGb: 8,
      profiles: [
        { model: "base.en-q5_1", rtf: 1.5 },
        { model: "small.en-q5_1", rtf: 0.8 },
      ],
    });
    expect(choice).toBe("base.en-q5_1");
  });
});
```

- [ ] **Step 2: Run failing benchmark tests**

Run: `cd apps/x/packages/core && npx vitest run src/voice/whisper/benchmark.test.ts`

Expected: FAIL because `benchmark.ts` does not exist.

- [ ] **Step 3: Implement benchmark selection**

Create `benchmark.ts`:

```ts
import type { WhisperAccel, WhisperBenchmarkProfile } from "@x/shared/dist/transcription.js";

export interface AutoModelInput {
  accel: WhisperAccel;
  memoryGb: number;
  profiles: Array<Pick<WhisperBenchmarkProfile, "model" | "rtf">>;
}

const MODEL_RANK = ["tiny.en-q5_1", "base.en-q5_1", "small.en-q5_1", "medium.en-q5_0"];

export function chooseAutoModel(input: AutoModelInput): string {
  const minRtf = input.accel === "cpu" ? 1.25 : 2.0;
  const maxRank = input.memoryGb < 12 ? MODEL_RANK.indexOf("small.en-q5_1") : MODEL_RANK.length - 1;
  const candidates = input.profiles
    .filter((profile) => profile.rtf >= minRtf)
    .filter((profile) => MODEL_RANK.indexOf(profile.model) >= 0)
    .filter((profile) => MODEL_RANK.indexOf(profile.model) <= maxRank)
    .sort((a, b) => MODEL_RANK.indexOf(b.model) - MODEL_RANK.indexOf(a.model));
  return candidates[0]?.model ?? "base.en-q5_1";
}
```

- [ ] **Step 4: Add benchmark persistence**

Persist benchmark profiles to `~/.rowboat/config/whisper-benchmarks.json` from `voice.ts`:

```ts
const WhisperBenchmarkFile = z.object({
  $schemaVersion: z.literal(1).default(1),
  profiles: z.array(WhisperBenchmarkProfile).default([]),
});

export async function readWhisperBenchmarks(): Promise<WhisperBenchmarkProfile[]> {
  const file = path.join(WorkDir, "config", "whisper-benchmarks.json");
  const raw = await fs.readFile(file, "utf8").catch(() => "{}");
  return WhisperBenchmarkFile.parse(JSON.parse(raw)).profiles;
}

export async function writeWhisperBenchmark(profile: WhisperBenchmarkProfile): Promise<void> {
  const profiles = await readWhisperBenchmarks();
  const next = profiles.filter(
    (existing) => existing.deviceId !== profile.deviceId || existing.model !== profile.model,
  );
  next.push(profile);
  await fs.mkdir(path.join(WorkDir, "config"), { recursive: true });
  await fs.writeFile(
    path.join(WorkDir, "config", "whisper-benchmarks.json"),
    JSON.stringify({ $schemaVersion: 1, profiles: next }, null, 2),
  );
}
```

- [ ] **Step 5: Wire `whisper:benchmark`**

Service method:

```ts
function makeBenchmarkTone(seconds: number, sampleRate: number): Int16Array {
  const pcm = new Int16Array(seconds * sampleRate);
  for (let i = 0; i < pcm.length; i++) {
    pcm[i] = Math.round(Math.sin((i / sampleRate) * Math.PI * 2 * 440) * 8000);
  }
  return pcm;
}

function stableDeviceId(capability: { accel: WhisperAccel; cores: number }): string {
  return `${process.platform}-${process.arch}-${capability.accel}-${capability.cores}`;
}

async benchmark(input: { model?: string; sampleSeconds: number }): Promise<WhisperBenchmarkProfile> {
  const capability = await this.capability();
  const model = input.model ?? defaultModelId();
  const pcm16 = makeBenchmarkTone(input.sampleSeconds, 16000);
  const startedAt = Date.now();
  const result = await this.transcribe(pcm16, { channels: 1, model, lang: "en" });
  const durationMs = Date.now() - startedAt;
  const profile = {
    deviceId: stableDeviceId(capability),
    model,
    accel: capability.accel,
    sampleSeconds: input.sampleSeconds,
    durationMs,
    rtf: result.rtf ?? input.sampleSeconds / Math.max(1, durationMs / 1000),
    measuredAt: new Date().toISOString(),
  };
  await writeWhisperBenchmark(profile);
  return profile;
}
```

Main IPC handler:

```ts
"whisper:benchmark": async (_event, req) => {
  return getWhisper().benchmark({ model: req.model, sampleSeconds: req.sampleSeconds });
},
```

- [ ] **Step 6: Add settings control**

In `transcription-settings.tsx`, add an "Auto" model option and a "Benchmark this device" button. Store `"auto"` in `transcription.json` by calling `transcription:setConfig` with `{ model: "auto" }`. When `model === "auto"`, provider resolution should call `chooseAutoModel` using saved benchmark profiles.

- [ ] **Step 7: Run tests**

Run: `cd apps/x/packages/core && npx vitest run src/voice/whisper/benchmark.test.ts src/voice/transcription-config.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/x/packages/core/src/voice/whisper/benchmark.ts apps/x/packages/core/src/voice/whisper/benchmark.test.ts apps/x/packages/core/src/voice/whisper/service.ts apps/x/packages/core/src/voice/voice.ts apps/x/apps/main/src/ipc.ts apps/x/apps/renderer/src/components/settings/transcription-settings.tsx
git commit -m "feat: add whisper model auto selector"
```

## Task 5: Local-Only Privacy Mode

**Files:**

- Modify: `apps/x/packages/core/src/voice/voice.ts`
- Modify: `apps/x/packages/core/src/voice/transcription-config.test.ts`
- Modify: `apps/x/apps/main/src/ipc.ts`
- Modify: `apps/x/apps/renderer/src/hooks/useVoiceMode.ts`
- Modify: `apps/x/apps/renderer/src/hooks/useMeetingTranscription.ts`
- Modify: `apps/x/apps/renderer/src/components/settings/transcription-settings.tsx`

- [ ] **Step 1: Add failing provider resolution tests**

Add to `transcription-config.test.ts`:

```ts
describe("local-only privacy provider resolution", () => {
  it("blocks cloud voice fallback when local-only is enabled", async () => {
    const provider = resolveVoiceProvider({
      userOverride: "deepgram",
      signedIn: true,
      localSupported: true,
      localOnly: true,
    });

    expect(provider).toBe("whisper-local");
  });
});
```

- [ ] **Step 2: Run failing provider test**

Run: `cd apps/x/packages/core && npx vitest run src/voice/transcription-config.test.ts`

Expected: FAIL until provider resolution accepts `localOnly` and returns `whisper-local`.

- [ ] **Step 3: Enforce provider resolution**

In `voice.ts`, extend the pure input and make local-only override cloud choices:

```ts
export interface VoiceProviderInput {
  userOverride?: TranscriptionProvider;
  remoteDefault?: TranscriptionProvider;
  signedIn: boolean;
  localSupported: boolean;
  localOnly?: boolean;
}

export function resolveVoiceProvider(input: VoiceProviderInput): TranscriptionProvider {
  if (input.localOnly) return "whisper-local";
  const want = input.userOverride ?? input.remoteDefault ?? "whisper-local";
  if (want === "whisper-local" && !input.localSupported) {
    return input.signedIn ? "solomon" : "deepgram";
  }
  return want;
}
```

Extend `MeetingProviderInput` and the meeting resolver:

```ts
export interface MeetingProviderInput extends VoiceProviderInput {
  hasOwnDeepgramKey: boolean;
  meetingMinutesRemaining?: number | null;
}

export function resolveMeetingProvider(input: MeetingProviderInput): {
  provider: TranscriptionProvider;
  reason: ProviderReason | "privacy";
} {
  if (input.localOnly) {
    return { provider: "whisper-local", reason: "privacy" };
  }
  const chosenReason: ProviderReason = input.userOverride
    ? "user"
    : input.remoteDefault
      ? "remote"
      : "fallback";
  const want = input.userOverride ?? input.remoteDefault ?? "deepgram";
  if (want === "whisper-local") {
    if (!input.localSupported) {
      return { provider: input.signedIn ? "solomon" : "deepgram", reason: "capability" };
    }
    return { provider: "whisper-local", reason: chosenReason };
  }
  if (isCloudProvider(want) && !input.hasOwnDeepgramKey) {
    const remaining = input.meetingMinutesRemaining;
    if (typeof remaining === "number" && remaining <= 0 && input.localSupported) {
      return { provider: "whisper-local", reason: "quota" };
    }
  }
  return { provider: want, reason: chosenReason };
}
```

- [ ] **Step 4: Block accidental cloud transports in renderer hooks**

In `useVoiceMode.ts`, before `connectWs()`:

```ts
const cfg = await window.ipc.invoke("transcription:getConfig", null);
if (cfg.privacy.localOnly && providerRef.current !== "whisper-local") {
  providerRef.current = "whisper-local";
  cachedAuth = null;
}
```

In `useMeetingTranscription.ts`, after resolving meeting provider:

```ts
const cfg = await window.ipc.invoke("transcription:getConfig", null);
if (cfg.privacy.localOnly) {
  meetingProvider = "whisper-local";
}
```

- [ ] **Step 5: Add privacy proof UI**

In `transcription-settings.tsx`, add a switch:

```tsx
<SettingsSection title="Privacy" description="Control where speech is processed.">
  <div className="flex items-center justify-between gap-3 border px-3.5 py-3">
    <div className="min-w-0">
      <div className="text-[13px] font-medium">Local-only speech</div>
      <div className="text-xs text-muted-foreground">
        Speech-to-text uses only local Whisper and cloud fallback is disabled.
      </div>
    </div>
    <Switch
      checked={privacy.localOnly}
      onCheckedChange={(localOnly) =>
        window.ipc.invoke("transcription:setConfig", { privacy: { ...privacy, localOnly } })
      }
    />
  </div>
</SettingsSection>
```

Show proof text only when local-only is on:

```tsx
{
  privacy.localOnly && (
    <div className="border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      Cloud speech providers are disabled. Raw audio is not retained unless diagnostics retention is
      enabled for a single test run.
    </div>
  );
}
```

- [ ] **Step 6: Run tests**

Run: `cd apps/x/packages/core && npx vitest run src/voice/transcription-config.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/x/packages/core/src/voice/voice.ts apps/x/packages/core/src/voice/transcription-config.test.ts apps/x/apps/main/src/ipc.ts apps/x/apps/renderer/src/hooks/useVoiceMode.ts apps/x/apps/renderer/src/hooks/useMeetingTranscription.ts apps/x/apps/renderer/src/components/settings/transcription-settings.tsx
git commit -m "feat: enforce local-only speech privacy"
```

## Task 6: Real-Time Local Streaming For Voice And Meetings

**Files:**

- Modify: `apps/x/packages/core/src/voice/whisper/streaming.ts`
- Modify: `apps/x/packages/core/src/voice/whisper/streaming.test.ts`
- Modify: `apps/x/apps/renderer/src/lib/whisper-stream.ts`
- Modify: `apps/x/apps/renderer/src/hooks/useVoiceMode.ts`
- Modify: `apps/x/apps/renderer/src/hooks/useMeetingTranscription.ts`

- [ ] **Step 1: Add failing streaming partial tests**

Add to `streaming.test.ts`:

```ts
it("emits partial text before final text for a closed segment", async () => {
  const port = new FakeStreamPort();
  const transcribe = vi
    .fn()
    .mockResolvedValueOnce({ text: "hello wor", durationMs: 120, rtf: 5 })
    .mockResolvedValueOnce({ text: "hello world", durationMs: 240, rtf: 4 });

  const session = new Session(port, {
    modelPath: "/models/base.en-q5_1.gguf",
    vadModelPath: "/models/silero-vad.gguf",
    channels: 1,
    transcribe,
    partialWindowMs: 1500,
  });

  port.emitAudio(makeSpeechFrameSequence("you", 16000 * 2));
  port.emitFlush();
  await session.drainForTest();

  expect(port.messages.some((message) => message.type === "partial")).toBe(true);
  expect(port.messages.some((message) => message.type === "final")).toBe(true);
});

class FakeStreamPort {
  messages: Array<Record<string, unknown>> = [];
  private listener: ((event: { data: unknown }) => void) | null = null;

  on(_event: "message", listener: (event: { data: unknown }) => void) {
    this.listener = listener;
  }
  postMessage(message: unknown) {
    this.messages.push(message as Record<string, unknown>);
  }
  start() {}
  close() {}
  emitAudio(pcm16: Int16Array) {
    this.listener?.({ data: { type: "audio", pcm16: pcm16.buffer, seq: 1 } });
  }
  emitFlush() {
    this.listener?.({ data: { type: "flush" } });
  }
}

function makeSpeechFrameSequence(_speaker: "you", samples: number): Int16Array {
  const pcm = new Int16Array(samples);
  for (let i = 0; i < pcm.length; i++) pcm[i] = i % 64 < 32 ? 12000 : -12000;
  return pcm;
}
```

- [ ] **Step 2: Run failing streaming tests**

Run: `cd apps/x/packages/core && npx vitest run src/voice/whisper/streaming.test.ts`

Expected: FAIL because `Session` does not emit partial events.

- [ ] **Step 3: Add partial event support in core**

Extend `SessionOpts` in `streaming.ts` so tests can inject a transcriber and production keeps using `transcribePcm`:

```ts
export interface SessionOpts {
  modelPath: string;
  vadModelPath: string;
  channels: 1 | 2;
  transcribe?: typeof transcribePcm;
  partialWindowMs?: number;
}
```

Add a test drain helper:

```ts
async drainForTest(): Promise<void> {
  await this.pump;
}
```

Modify `transcribeNext()` so it first emits a partial from a rolling prefix when the segment is long enough:

```ts
const transcribe = this.opts.transcribe ?? transcribePcm;
if (seg.pcm.length >= RATE * 1.5) {
  const partialPcm = seg.pcm.subarray(0, Math.min(seg.pcm.length, RATE * 3));
  const partial = await transcribe(partialPcm, {
    modelPath: this.opts.modelPath,
    vadModelPath: this.opts.vadModelPath,
    lang: "en",
    threads: autoThreads(),
    audioSeconds: partialPcm.length / RATE,
    timeoutMs: timeoutFor(partialPcm.length / RATE),
  });
  if (partial.text && !this.closed) {
    this.port.postMessage({
      v: 1,
      type: "partial",
      text: partial.text,
      start: seg.startSec,
      end: seg.startSec + partialPcm.length / RATE,
      speaker: seg.channel,
      confidence: estimateConfidence(partial),
    });
  }
}
const final = await transcribe(seg.pcm, {
  modelPath: this.opts.modelPath,
  vadModelPath: this.opts.vadModelPath,
  lang: "en",
  threads: autoThreads(),
  audioSeconds: seg.pcm.length / RATE,
  timeoutMs: timeoutFor(seg.pcm.length / RATE),
});
```

Add helper:

```ts
function estimateConfidence(result: { text?: string; rtf?: number }): number {
  if (!result.text?.trim()) return 0;
  if ((result.rtf ?? 0) >= 2) return 0.82;
  if ((result.rtf ?? 0) >= 1) return 0.68;
  return 0.52;
}
```

- [ ] **Step 4: Parse partials in renderer stream driver**

In `apps/x/apps/renderer/src/lib/whisper-stream.ts`, extend options:

```ts
export interface OpenWhisperStreamOptions {
  channels: 1 | 2;
  model?: string;
  onPartial?: (event: {
    text: string;
    start: number;
    end: number;
    speaker?: "you" | "other";
  }) => void;
  onFinal: (segment: WhisperSegment) => void;
  onError?: (code: string) => void;
}
```

Handle message:

```ts
} else if (m.type === "partial" && m.text) {
  opts.onPartial?.({
    text: m.text,
    start: m.start ?? 0,
    end: m.end ?? 0,
    speaker: m.speaker,
  });
}
```

- [ ] **Step 5: Use streaming for local voice mode**

Replace the local batch-only branch in `useVoiceMode.ts` with a single-channel `openWhisperStream` path when provider is `whisper-local`. Keep batch transcription as a fallback when `openWhisperStream` returns null.

```ts
const localStream = await openWhisperStream({
  channels: 1,
  onPartial: (event) => {
    interimRef.current = event.text;
    setInterimText(
      transcriptBufferRef.current + (transcriptBufferRef.current ? " " : "") + event.text,
    );
  },
  onFinal: (segment) => {
    transcriptBufferRef.current += (transcriptBufferRef.current ? " " : "") + segment.text;
    interimRef.current = "";
    setInterimText(transcriptBufferRef.current);
  },
  onError: (code) => {
    analytics.transcriptionFailed({ provider: "whisper-local", mode: "voice", code });
  },
});
```

- [ ] **Step 6: Use partials in meeting notes without persisting noisy text**

In `useMeetingTranscription.ts`, pass `onPartial` to `openWhisperStream` and render it in UI state, but persist only final segments to the meeting note:

```ts
onPartial: (event) => {
  const speaker = event.speaker === "other" ? "Other" : "You";
  interimRef.current.set(event.speaker === "other" ? 1 : 0, { speaker, text: event.text });
  scheduleDebouncedWrite();
},
```

- [ ] **Step 7: Run tests**

Run: `cd apps/x/packages/core && npx vitest run src/voice/whisper/streaming.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/x/packages/core/src/voice/whisper/streaming.ts apps/x/packages/core/src/voice/whisper/streaming.test.ts apps/x/apps/renderer/src/lib/whisper-stream.ts apps/x/apps/renderer/src/hooks/useVoiceMode.ts apps/x/apps/renderer/src/hooks/useMeetingTranscription.ts
git commit -m "feat: add local streaming partials"
```

## Task 7: Push-To-Talk Everywhere

**Files:**

- Create: `apps/x/apps/renderer/src/hooks/usePushToTalk.ts`
- Create: `apps/x/apps/renderer/src/lib/dictation-targets.ts`
- Modify: `apps/x/apps/renderer/src/components/chat-input-with-mentions.tsx`
- Modify: `apps/x/apps/renderer/src/components/email-view.tsx`
- Modify: `apps/x/apps/renderer/src/components/markdown-editor.tsx`
- Modify: `apps/x/apps/renderer/src/components/ui/command.tsx`

- [ ] **Step 1: Add dictation target unit tests**

Create `apps/x/apps/renderer/src/lib/dictation-targets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { insertDictationText } from "./dictation-targets";

describe("insertDictationText", () => {
  it("inserts text at the current selection", () => {
    expect(insertDictationText("hello |", "world")).toBe("hello world|");
  });

  it("adds a separating space when inserting after text", () => {
    expect(insertDictationText("reply|", "thanks")).toBe("reply thanks|");
  });

  it("does not add a double space after whitespace", () => {
    expect(insertDictationText("reply |", "thanks")).toBe("reply thanks|");
  });
});
```

- [ ] **Step 2: Run failing dictation tests**

Run: `cd apps/x/apps/renderer && npx vitest run src/lib/dictation-targets.test.ts`

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement dictation helper**

Create `dictation-targets.ts`:

```ts
export function insertDictationText(valueWithCursor: string, spokenText: string): string {
  const cursor = valueWithCursor.indexOf("|");
  const before = valueWithCursor.slice(0, cursor);
  const after = valueWithCursor.slice(cursor + 1);
  const prefix = before.length > 0 && !/\s$/.test(before) ? " " : "";
  const suffix = after.length > 0 && !/^\s/.test(after) ? " " : "";
  return `${before}${prefix}${spokenText.trim()}${suffix}|${after}`;
}
```

- [ ] **Step 4: Implement shared hook**

Create `usePushToTalk.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { useVoiceMode } from "@/hooks/useVoiceMode";

export interface PushToTalkTarget {
  id: string;
  insertText: (text: string) => void;
  active: () => boolean;
}

export function usePushToTalk(target: PushToTalkTarget) {
  const voice = useVoiceMode();
  const pressedRef = useRef(false);
  const [active, setActive] = useState(false);

  const start = useCallback(async () => {
    if (!target.active() || pressedRef.current) return;
    pressedRef.current = true;
    setActive(true);
    await voice.start();
  }, [target, voice]);

  const stop = useCallback(async () => {
    if (!pressedRef.current) return;
    pressedRef.current = false;
    setActive(false);
    const text = await voice.submit();
    if (text.trim()) target.insertText(text.trim());
  }, [target, voice]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Space" && event.metaKey && !event.repeat) void start();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space" && event.metaKey) void stop();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [start, stop]);

  return { active, interimText: voice.interimText, start, stop, cancel: voice.cancel };
}
```

- [ ] **Step 5: Wire surfaces**

Use `usePushToTalk` in these files:

- `chat-input-with-mentions.tsx` inserts into the message composer.
- `email-view.tsx` inserts into reply draft and search filter fields.
- `markdown-editor.tsx` inserts into focused note editor.
- `command.tsx` inserts into command search when command mode is not active.

Each surface must show the same compact mic state:

```tsx
{
  pushToTalk.active && (
    <div className="flex items-center gap-2 border bg-background px-2 py-1 text-xs text-muted-foreground">
      <Mic className="size-3.5" />
      {pushToTalk.interimText || "Listening"}
    </div>
  );
}
```

- [ ] **Step 6: Run renderer tests and typecheck**

Run: `cd apps/x/apps/renderer && npx vitest run src/lib/dictation-targets.test.ts`

Expected: PASS.

Run: `cd apps/x && npm run lint`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/x/apps/renderer/src/hooks/usePushToTalk.ts apps/x/apps/renderer/src/lib/dictation-targets.ts apps/x/apps/renderer/src/lib/dictation-targets.test.ts apps/x/apps/renderer/src/components/chat-input-with-mentions.tsx apps/x/apps/renderer/src/components/email-view.tsx apps/x/apps/renderer/src/components/markdown-editor.tsx apps/x/apps/renderer/src/components/ui/command.tsx
git commit -m "feat: add push-to-talk across desktop surfaces"
```

## Task 8: Voice Command Mode

**Files:**

- Create: `apps/x/packages/core/src/voice/commands/parser.ts`
- Create: `apps/x/packages/core/src/voice/commands/parser.test.ts`
- Create: `apps/x/packages/core/src/voice/commands/executor.ts`
- Create: `apps/x/packages/core/src/voice/commands/executor.test.ts`
- Modify: `apps/x/apps/main/src/ipc.ts`
- Create: `apps/x/apps/renderer/src/hooks/useVoiceCommandMode.ts`
- Create: `apps/x/apps/renderer/src/components/voice-command-confirmation.tsx`
- Modify: `apps/x/apps/renderer/src/components/ui/command.tsx`

- [ ] **Step 1: Add parser tests**

Create `parser.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseVoiceCommand } from "./parser.js";

describe("parseVoiceCommand", () => {
  it("parses email archive commands as confirmation-required", () => {
    const parsed = parseVoiceCommand("archive newsletters from last week", "email");
    expect(parsed.intent).toEqual({
      kind: "email.triage",
      query: "newsletters from last week",
      action: "archive",
    });
    expect(parsed.requiresConfirmation).toBe(true);
  });

  it("parses dictated text as a safe insert intent", () => {
    const parsed = parseVoiceCommand("write thanks I will review this today", "chat");
    expect(parsed.intent).toEqual({
      kind: "text.insert",
      text: "thanks I will review this today",
    });
    expect(parsed.requiresConfirmation).toBe(false);
  });

  it("parses meeting start commands", () => {
    const parsed = parseVoiceCommand("start recording product sync", "global");
    expect(parsed.intent).toEqual({
      kind: "meeting.startRecording",
      title: "product sync",
    });
  });
});
```

- [ ] **Step 2: Run failing parser tests**

Run: `cd apps/x/packages/core && npx vitest run src/voice/commands/parser.test.ts`

Expected: FAIL because parser files do not exist.

- [ ] **Step 3: Implement deterministic command parser**

Create `parser.ts`:

```ts
import type { VoiceCommandIntent } from "@x/shared/dist/transcription.js";

export type VoiceCommandSurface = "global" | "chat" | "email" | "meeting";

export interface ParsedVoiceCommand {
  intent: VoiceCommandIntent;
  requiresConfirmation: boolean;
}

export function parseVoiceCommand(text: string, surface: VoiceCommandSurface): ParsedVoiceCommand {
  const normalized = text.trim().replace(/\s+/g, " ");
  const lower = normalized.toLowerCase();

  const archive = lower.match(/^archive (.+)$/);
  if (archive) {
    return {
      intent: { kind: "email.triage", query: archive[1], action: "archive" },
      requiresConfirmation: true,
    };
  }

  const label = lower.match(/^label (.+) as (.+)$/);
  if (label) {
    return {
      intent: { kind: "email.triage", query: label[1], action: "label", label: label[2] },
      requiresConfirmation: true,
    };
  }

  const startMeeting = lower.match(/^start recording(?: (.+))?$/);
  if (startMeeting) {
    return {
      intent: { kind: "meeting.startRecording", title: startMeeting[1] },
      requiresConfirmation: false,
    };
  }

  if (lower === "stop recording") {
    return { intent: { kind: "meeting.stopRecording" }, requiresConfirmation: false };
  }

  if (lower.startsWith("reply ")) {
    return {
      intent: { kind: "email.composeReply", body: normalized.slice("reply ".length) },
      requiresConfirmation: false,
    };
  }

  const writePrefix = lower.startsWith("write ")
    ? "write "
    : lower.startsWith("type ")
      ? "type "
      : "";
  if (writePrefix) {
    return {
      intent: { kind: "text.insert", text: normalized.slice(writePrefix.length) },
      requiresConfirmation: false,
    };
  }

  return {
    intent: {
      kind: "app.openCommand",
      query: surface === "global" ? normalized : `${surface}: ${normalized}`,
    },
    requiresConfirmation: false,
  };
}
```

- [ ] **Step 4: Add executor tests for confirmation safety**

Create `executor.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { executeVoiceCommand } from "./executor.js";

describe("executeVoiceCommand", () => {
  it("refuses destructive email commands without confirmation", async () => {
    const result = await executeVoiceCommand(
      { kind: "email.triage", query: "old newsletters", action: "archive" },
      { confirmed: false, emailActions: fakeEmailActions() },
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain("confirmation");
  });

  it("executes confirmed email archive through the email action engine", async () => {
    const emailActions = fakeEmailActions();
    const result = await executeVoiceCommand(
      { kind: "email.triage", query: "old newsletters", action: "archive" },
      { confirmed: true, emailActions },
    );

    expect(result.success).toBe(true);
    expect(emailActions.archiveByQuery).toHaveBeenCalledWith("old newsletters");
  });
});

function fakeEmailActions() {
  return {
    archiveByQuery: vi.fn().mockResolvedValue(undefined),
    labelByQuery: vi.fn().mockResolvedValue(undefined),
    composeReply: vi.fn().mockResolvedValue(undefined),
    createRule: vi.fn().mockResolvedValue(undefined),
  };
}
```

- [ ] **Step 5: Implement executor**

Create `executor.ts`:

```ts
import type { VoiceCommandIntent } from "@x/shared/dist/transcription.js";

export interface VoiceEmailActions {
  archiveByQuery(query?: string): Promise<void>;
  labelByQuery(query: string | undefined, label: string | undefined): Promise<void>;
  composeReply(threadId: string | undefined, body: string): Promise<void>;
  createRule(description: string): Promise<void>;
}

export async function executeVoiceCommand(
  intent: VoiceCommandIntent,
  deps: { confirmed: boolean; emailActions: VoiceEmailActions },
): Promise<{ success: boolean; message?: string }> {
  if (intent.kind === "email.triage" && !deps.confirmed) {
    return { success: false, message: "This email action requires confirmation." };
  }
  if (intent.kind === "email.triage" && intent.action === "archive") {
    await deps.emailActions.archiveByQuery(intent.query);
    return { success: true };
  }
  if (intent.kind === "email.triage" && intent.action === "label") {
    await deps.emailActions.labelByQuery(intent.query, intent.label);
    return { success: true };
  }
  if (intent.kind === "email.composeReply") {
    await deps.emailActions.composeReply(intent.threadId, intent.body);
    return { success: true };
  }
  if (intent.kind === "email.createRule") {
    await deps.emailActions.createRule(intent.description);
    return { success: true };
  }
  return { success: true };
}
```

- [ ] **Step 6: Wire IPC**

In `apps/x/apps/main/src/ipc.ts`:

```ts
const unavailableEmailActions = {
  archiveByQuery: async () => {
    throw new Error("Voice email actions are wired in Task 10.");
  },
  labelByQuery: async () => {
    throw new Error("Voice email actions are wired in Task 10.");
  },
  composeReply: async () => {
    throw new Error("Voice email actions are wired in Task 10.");
  },
  createRule: async () => {
    throw new Error("Voice email actions are wired in Task 10.");
  },
};

"voice:parseCommand": async (_event, { text, surface }) => {
  return parseVoiceCommand(text, surface);
},
"voice:executeCommand": async (_event, { intent, confirmed }) => {
  return executeVoiceCommand(intent, {
    confirmed,
    emailActions: unavailableEmailActions,
  });
},
```

- [ ] **Step 7: Add confirmation UI**

Create `voice-command-confirmation.tsx` with a modal that shows the parsed intent, affected email query, and Confirm/Cancel. The modal must call `voice:executeCommand` only with `confirmed: true` for destructive email intents.

- [ ] **Step 8: Run tests**

Run: `cd apps/x/packages/core && npx vitest run src/voice/commands/parser.test.ts src/voice/commands/executor.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/x/packages/core/src/voice/commands apps/x/apps/main/src/ipc.ts apps/x/apps/renderer/src/hooks/useVoiceCommandMode.ts apps/x/apps/renderer/src/components/voice-command-confirmation.tsx apps/x/apps/renderer/src/components/ui/command.tsx
git commit -m "feat: add voice command mode"
```

## Task 9: Meeting Recorder Product Upgrade

**Files:**

- Create: `apps/x/packages/core/src/voice/meetings/summary.ts`
- Create: `apps/x/packages/core/src/voice/meetings/summary.test.ts`
- Modify: `apps/x/apps/renderer/src/hooks/useMeetingTranscription.ts`
- Modify: `apps/x/apps/renderer/src/components/meetings-view.tsx`
- Modify: `apps/x/packages/shared/src/ipc.ts`
- Modify: `apps/x/apps/main/src/ipc.ts`

- [ ] **Step 1: Add summary extraction tests**

Create `summary.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { extractMeetingStructure } from "./summary.js";

describe("extractMeetingStructure", () => {
  it("extracts action items and open questions from transcript text", () => {
    const result = extractMeetingStructure(`
You: I will send the pricing draft tomorrow.
Other: Can we confirm the SOC2 timeline?
You: Sarah should follow up with legal.
`);

    expect(result.actionItems).toContain("I will send the pricing draft tomorrow.");
    expect(result.actionItems).toContain("Sarah should follow up with legal.");
    expect(result.openQuestions).toContain("Can we confirm the SOC2 timeline?");
  });
});
```

- [ ] **Step 2: Run failing summary tests**

Run: `cd apps/x/packages/core && npx vitest run src/voice/meetings/summary.test.ts`

Expected: FAIL because summary files do not exist.

- [ ] **Step 3: Implement deterministic extraction**

Create `summary.ts`:

```ts
export interface MeetingStructure {
  actionItems: string[];
  openQuestions: string[];
  followUpDrafts: string[];
}

export function extractMeetingStructure(transcript: string): MeetingStructure {
  const lines = transcript
    .split("\n")
    .map((line) =>
      line
        .replace(/^\*\*[^*]+:\*\*\s*/, "")
        .replace(/^[^:]+:\s*/, "")
        .trim(),
    )
    .filter(Boolean);

  const actionItems = lines.filter((line) =>
    /\b(i will|we will|should|follow up|send|schedule|draft|review)\b/i.test(line),
  );
  const openQuestions = lines.filter((line) => line.endsWith("?"));
  const followUpDrafts = actionItems.map((item) => `Following up on: ${item}`);
  return { actionItems, openQuestions, followUpDrafts };
}
```

- [ ] **Step 4: Add IPC contract**

Add to `apps/x/packages/shared/src/ipc.ts`:

```ts
"meeting:extractStructure": {
  req: z.object({ transcript: z.string() }),
  res: z.object({
    actionItems: z.array(z.string()),
    openQuestions: z.array(z.string()),
    followUpDrafts: z.array(z.string()),
  }),
},
```

Wire in main:

```ts
"meeting:extractStructure": async (_event, { transcript }) => {
  return extractMeetingStructure(transcript);
},
```

- [ ] **Step 5: Upgrade meeting note format**

In `useMeetingTranscription.ts`, after final write, append sections:

```ts
const structure = await window.ipc.invoke("meeting:extractStructure", {
  transcript: transcriptText,
});
lines.push("## Action Items", "");
for (const item of structure.actionItems) lines.push(`- [ ] ${item}`);
lines.push("", "## Open Questions", "");
for (const question of structure.openQuestions) lines.push(`- ${question}`);
lines.push("", "## Follow-Up Drafts", "");
for (const draft of structure.followUpDrafts) lines.push(`- ${draft}`);
```

Add frontmatter:

```ts
lines.push(`transcription_provider: ${useLocalRef.current ? "whisper-local" : "deepgram"}`);
lines.push(`local_only: ${privacy.localOnly ? "true" : "false"}`);
lines.push(`audio_retained: false`);
```

- [ ] **Step 6: Add meeting UI affordances**

In `meetings-view.tsx`, add a recorder status bar with:

- Active provider label.
- Mic/system capture health.
- Elapsed time.
- "Stop and summarize" button.
- Link to the created note path.

- [ ] **Step 7: Run tests**

Run: `cd apps/x/packages/core && npx vitest run src/voice/meetings/summary.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/x/packages/core/src/voice/meetings apps/x/apps/renderer/src/hooks/useMeetingTranscription.ts apps/x/apps/renderer/src/components/meetings-view.tsx apps/x/packages/shared/src/ipc.ts apps/x/apps/main/src/ipc.ts
git commit -m "feat: upgrade local meeting recorder"
```

## Task 10: Voice-To-Email Workflows

**Files:**

- Create: `apps/x/packages/core/src/voice/email/actions.ts`
- Create: `apps/x/packages/core/src/voice/email/actions.test.ts`
- Create: `apps/x/packages/core/src/voice/email/staged-actions.ts`
- Create: `apps/x/packages/core/src/voice/email/staged-actions.test.ts`
- Modify: `apps/x/packages/core/src/voice/commands/executor.ts`
- Modify: `apps/x/apps/renderer/src/components/email-view.tsx`
- Modify: `apps/x/apps/renderer/src/hooks/usePushToTalk.ts`
- Modify: `apps/rfc/email-021-implementation-blueprints-and-code-examples.md`

**RFC references for the implementing agent:**

- `apps/rfc/email-000-inbox-zero-agent-reference.md` defines the Inbox Zero feature inventory this work should emulate.
- `apps/rfc/email-002-mailbox-command-center.md` defines the inbox command center UX targets.
- `apps/rfc/email-003-ai-rules-and-action-engine.md` defines safe action execution and rule creation.
- `apps/rfc/email-004-reply-zero-and-drafting.md` defines reply-zero drafting and review.
- `apps/rfc/email-014-sync-reliability-rate-limits-and-repair.md` defines provider sync and repair constraints.
- `apps/rfc/email-018-email-product-roadmap-and-build-order.md` defines email build order.
- `apps/rfc/email-021-implementation-blueprints-and-code-examples.md` holds concrete code examples; append voice examples there so future agents see email and voice together.

- [ ] **Step 1: Add email voice action tests**

Create `actions.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { buildEmailVoiceActions } from "./actions.js";

describe("buildEmailVoiceActions", () => {
  it("drafts a reply into the selected thread", async () => {
    const deps = fakeDeps();
    const actions = buildEmailVoiceActions(deps);

    await actions.composeReply("thread_123", "Thanks, I can do Tuesday.");

    expect(deps.createDraft).toHaveBeenCalledWith({
      threadId: "thread_123",
      body: "Thanks, I can do Tuesday.",
      source: "voice",
    });
  });

  it("creates a rule from spoken language without running it immediately", async () => {
    const deps = fakeDeps();
    const actions = buildEmailVoiceActions(deps);

    await actions.createRule("label all Stripe receipts as finance");

    expect(deps.createRuleDraft).toHaveBeenCalledWith({
      description: "label all Stripe receipts as finance",
      source: "voice",
      enabled: false,
    });
  });
});

function fakeDeps() {
  return {
    createDraft: vi.fn().mockResolvedValue(undefined),
    createRuleDraft: vi.fn().mockResolvedValue(undefined),
    archiveByQuery: vi.fn().mockResolvedValue(undefined),
    labelByQuery: vi.fn().mockResolvedValue(undefined),
  };
}
```

Create `staged-actions.test.ts`:

```ts
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createVoiceEmailFileStore } from "./staged-actions.js";

describe("createVoiceEmailFileStore", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "rowboat-voice-email-"));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("stages voice drafts without sending mail", async () => {
    const store = createVoiceEmailFileStore(dir);
    await store.stageDraft({ threadId: "thread_123", body: "Thanks", source: "voice" });

    const raw = await fs.readFile(
      path.join(dir, "config", "voice-email-staged-actions.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw);
    expect(parsed.drafts[0]).toMatchObject({
      threadId: "thread_123",
      body: "Thanks",
      source: "voice",
    });
  });
});
```

- [ ] **Step 2: Run failing action tests**

Run: `cd apps/x/packages/core && npx vitest run src/voice/email/actions.test.ts src/voice/email/staged-actions.test.ts`

Expected: FAIL because email voice actions and staged action storage do not exist.

- [ ] **Step 3: Implement email voice action adapter**

Create `actions.ts`:

```ts
export interface EmailVoiceDeps {
  createDraft(input: { threadId?: string; body: string; source: "voice" }): Promise<void>;
  createRuleDraft(input: { description: string; source: "voice"; enabled: false }): Promise<void>;
  archiveByQuery(query?: string): Promise<void>;
  labelByQuery(query: string | undefined, label: string | undefined): Promise<void>;
}

export function buildEmailVoiceActions(deps: EmailVoiceDeps) {
  return {
    composeReply(threadId: string | undefined, body: string) {
      return deps.createDraft({ threadId, body, source: "voice" });
    },
    createRule(description: string) {
      return deps.createRuleDraft({ description, source: "voice", enabled: false });
    },
    archiveByQuery(query?: string) {
      return deps.archiveByQuery(query);
    },
    labelByQuery(query: string | undefined, label: string | undefined) {
      return deps.labelByQuery(query, label);
    },
  };
}
```

Replace `unavailableEmailActions` from Task 8 with the real adapter:

```ts
const voiceEmailStore = createVoiceEmailFileStore(WorkDir);

function parseThreadTarget(query?: string): string | null {
  const match = query?.match(/^thread:([A-Za-z0-9_-]+)$/);
  return match?.[1] ?? null;
}

function getEmailVoiceActions() {
  return buildEmailVoiceActions({
    createDraft: (input) => voiceEmailStore.stageDraft(input),
    createRuleDraft: (input) => voiceEmailStore.stageRule(input),
    archiveByQuery: async (query) => {
      const threadId = parseThreadTarget(query);
      if (!threadId) {
        await voiceEmailStore.stageBulkAction({ action: "archive", query, confirmed: false });
        return;
      }
      await archiveThread(threadId);
    },
    labelByQuery: (query, label) =>
      voiceEmailStore.stageBulkAction({ action: "label", query, label, confirmed: false }),
  });
}
```

Create `staged-actions.ts` so voice commands can stage safe drafts and future bulk actions without sending mail:

```ts
import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface StagedVoiceEmailDraft {
  threadId?: string;
  body: string;
  source: "voice";
  createdAt: string;
}

export interface StagedVoiceEmailRule {
  description: string;
  source: "voice";
  enabled: false;
  createdAt: string;
}

export interface StagedVoiceEmailBulkAction {
  action: "archive" | "label";
  query?: string;
  label?: string;
  confirmed: false;
  createdAt: string;
}

export function createVoiceEmailFileStore(workDir: string) {
  const file = path.join(workDir, "config", "voice-email-staged-actions.json");
  async function append(key: string, value: unknown) {
    const raw = await fs.readFile(file, "utf8").catch(() => "{}");
    const parsed = JSON.parse(raw) as Record<string, unknown[]>;
    const next = { ...parsed, [key]: [...(parsed[key] ?? []), value] };
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(next, null, 2));
  }
  return {
    stageDraft(input: Omit<StagedVoiceEmailDraft, "createdAt">) {
      return append("drafts", { ...input, createdAt: new Date().toISOString() });
    },
    stageRule(input: Omit<StagedVoiceEmailRule, "createdAt">) {
      return append("rules", { ...input, createdAt: new Date().toISOString() });
    },
    stageBulkAction(input: Omit<StagedVoiceEmailBulkAction, "createdAt">) {
      return append("bulkActions", { ...input, createdAt: new Date().toISOString() });
    },
  };
}
```

- [ ] **Step 4: Wire first email view workflows**

In `email-view.tsx`, add these voice entry points:

- "Dictate reply" uses `usePushToTalk` and inserts text into the current reply draft.
- "Voice command" routes transcript through `voice:parseCommand` with `surface: "email"`.
- Destructive commands call `VoiceCommandConfirmation` before `voice:executeCommand`.
- Safe reply commands write draft content and do not send email automatically.
- Rule creation commands create disabled rule drafts, matching `email-003`.

Use this renderer handler:

```tsx
const runEmailVoiceCommand = useCallback(async (text: string) => {
  const parsed = await window.ipc.invoke("voice:parseCommand", { text, surface: "email" });
  if (parsed.requiresConfirmation) {
    setPendingVoiceIntent(parsed.intent);
    return;
  }
  await window.ipc.invoke("voice:executeCommand", {
    intent: parsed.intent,
    confirmed: false,
  });
}, []);
```

- [ ] **Step 5: Append email RFC implementation notes**

Append a section to `apps/rfc/email-021-implementation-blueprints-and-code-examples.md`:

```md
## Voice-To-Email Adapter

Voice email commands should use `apps/x/packages/core/src/voice/email/actions.ts` as the adapter layer. This keeps speech parsing separate from provider-specific Gmail or Outlook execution and follows:

- `email-000` for Inbox Zero parity goals.
- `email-002` for command center surfaces.
- `email-003` for safe action execution and disabled rule drafts.
- `email-004` for reply drafting.
- `email-014` for sync and provider failure handling.

Destructive actions require `VoiceCommandConfirmation`. Reply drafting and rule drafting are safe to stage without confirmation because they do not send or execute changes automatically.
```

- [ ] **Step 6: Run tests**

Run: `cd apps/x/packages/core && npx vitest run src/voice/email/actions.test.ts src/voice/email/staged-actions.test.ts src/voice/commands/executor.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/x/packages/core/src/voice/email/actions.ts apps/x/packages/core/src/voice/email/actions.test.ts apps/x/packages/core/src/voice/email/staged-actions.ts apps/x/packages/core/src/voice/email/staged-actions.test.ts apps/x/packages/core/src/voice/commands/executor.ts apps/x/apps/renderer/src/components/email-view.tsx apps/x/apps/renderer/src/hooks/usePushToTalk.ts apps/rfc/email-021-implementation-blueprints-and-code-examples.md
git commit -m "feat: add voice-to-email workflows"
```

## Task 11: Accuracy Eval Harness

**Files:**

- Modify: `apps/x/packages/core/src/voice/whisper/__fixtures__/asr/manifest.json`
- Modify: `apps/x/packages/core/src/voice/whisper/__fixtures__/asr/README.md`
- Modify: `apps/x/packages/core/src/voice/whisper/whisper.eval.test.ts`
- Create: `apps/x/packages/core/src/voice/whisper/eval-report.ts`
- Create: `apps/x/packages/core/src/voice/whisper/eval-report.test.ts`
- Modify: `apps/x/package.json`

- [ ] **Step 1: Add eval report tests**

Create `eval-report.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { summarizeEvalResults } from "./eval-report.js";

describe("summarizeEvalResults", () => {
  it("fails when any bucket exceeds its WER budget", () => {
    const summary = summarizeEvalResults([
      { id: "clean-short", bucket: "clean", wer: 0.04, rtf: 5 },
      { id: "noisy-cafe", bucket: "noisy", wer: 0.31, rtf: 2 },
    ]);

    expect(summary.passed).toBe(false);
    expect(summary.failures).toContain("noisy");
  });
});
```

- [ ] **Step 2: Run failing eval report tests**

Run: `cd apps/x/packages/core && npx vitest run src/voice/whisper/eval-report.test.ts`

Expected: FAIL because `eval-report.ts` does not exist.

- [ ] **Step 3: Implement report budgets**

Create `eval-report.ts`:

```ts
export interface EvalCaseResult {
  id: string;
  bucket: "clean" | "noisy" | "accented" | "commands" | "email";
  wer: number;
  rtf: number;
}

const WER_BUDGET: Record<EvalCaseResult["bucket"], number> = {
  clean: 0.08,
  noisy: 0.25,
  accented: 0.22,
  commands: 0.12,
  email: 0.14,
};

export function summarizeEvalResults(results: EvalCaseResult[]) {
  const failures = Array.from(
    new Set(
      results.filter((result) => result.wer > WER_BUDGET[result.bucket]).map((r) => r.bucket),
    ),
  );
  return {
    passed: failures.length === 0,
    failures,
    averageWer: results.reduce((sum, result) => sum + result.wer, 0) / Math.max(1, results.length),
    averageRtf: results.reduce((sum, result) => sum + result.rtf, 0) / Math.max(1, results.length),
  };
}
```

- [ ] **Step 4: Expand ASR manifest**

Update `manifest.json` with buckets:

```json
{
  "cases": [
    {
      "id": "quick-brown-fox",
      "bucket": "clean",
      "audio": "quick-brown-fox.wav",
      "expected": "the quick brown fox jumps over the lazy dog"
    },
    {
      "id": "email-reply-short",
      "bucket": "email",
      "audio": "email-reply-short.wav",
      "expected": "thanks for the update I can review the draft this afternoon"
    },
    {
      "id": "command-archive-newsletters",
      "bucket": "commands",
      "audio": "command-archive-newsletters.wav",
      "expected": "archive newsletters from last week"
    }
  ]
}
```

If a fixture file is not present yet, add a manifest entry only when the matching WAV file exists in `__fixtures__/asr`. The minimum checked-in corpus for this task is `quick-brown-fox.wav`; additional fixtures can be generated and added in the same commit.

- [ ] **Step 5: Wire package script**

In `apps/x/package.json`, add:

```json
{
  "scripts": {
    "test:whisper-eval": "cd packages/core && npx vitest run src/voice/whisper/whisper.eval.test.ts"
  }
}
```

- [ ] **Step 6: Run eval tests**

Run: `cd apps/x/packages/core && npx vitest run src/voice/whisper/eval-report.test.ts`

Expected: PASS.

Run when a local model is installed:

```bash
cd apps/x
ROWBOAT_WHISPER_BIN=apps/x/vendor/whisper/darwin-arm64/whisper-cli ROWBOAT_WHISPER_EVAL_MODEL=base.en-q5_1 npm run test:whisper-eval
```

Expected: PASS with WER and RTF printed for each fixture.

- [ ] **Step 7: Commit**

```bash
git add apps/x/packages/core/src/voice/whisper/__fixtures__/asr apps/x/packages/core/src/voice/whisper/whisper.eval.test.ts apps/x/packages/core/src/voice/whisper/eval-report.ts apps/x/packages/core/src/voice/whisper/eval-report.test.ts apps/x/package.json
git commit -m "test: expand whisper accuracy eval harness"
```

## Task 12: End-To-End Rollout And Manual Dogfood

**Files:**

- Modify: `apps/rfc/009-local-on-device-transcription.md`
- Modify: `apps/rfc/017-on-device-meeting-diarization.md`
- Modify: `apps/rfc/email-018-email-product-roadmap-and-build-order.md`
- Modify: `apps/x/ANALYTICS.md`

- [ ] **Step 1: Update RFC 009 current state**

In `apps/rfc/009-local-on-device-transcription.md`, add an "Implementation status as of 2026-06-12" section near the top:

```md
## Implementation status as of 2026-06-12

Local Whisper exists in the desktop app: shared transcription schemas, main-process IPC, model catalog, checksums, CoreML/Metal capability probing, model manager, batch voice transcription, local meeting streaming, and WER tests are present under `apps/x`. The next product layer is tracked in `docs/superpowers/plans/2026-06-12-local-voice-product-expansion.md`: diagnostics, model repair, auto-selection, privacy enforcement, local partials, push-to-talk everywhere, voice commands, meeting recorder polish, voice-to-email, and eval expansion.
```

- [ ] **Step 2: Update RFC 017 dependency note**

Add:

```md
This diarization track should consume the upgraded local meeting recorder and streaming event contracts from `docs/superpowers/plans/2026-06-12-local-voice-product-expansion.md`. The recorder ships first with channel labels and provenance; speaker embedding/clustering then upgrades `speaker: "other"` segments into stable local speaker names.
```

- [ ] **Step 3: Update email roadmap**

In `apps/rfc/email-018-email-product-roadmap-and-build-order.md`, add a voice milestone after the command center and drafting milestones:

```md
### Voice-enabled email milestone

After the command center, action engine, and reply drafting surfaces exist, add voice-to-email:

- Dictate replies into the selected thread.
- Parse spoken triage commands into safe action drafts.
- Require confirmation for archive, unsubscribe, bulk label, snooze, and send.
- Create disabled rule drafts from spoken natural language.
- Use `apps/x/packages/core/src/voice/email/actions.ts` as the adapter layer.
```

- [ ] **Step 4: Add analytics event contract**

In `apps/x/ANALYTICS.md`, add:

```md
## Voice Product Events

- `voice_diagnostic_run` - fields: provider, model, accel, success, duration_ms, rtf, code.
- `voice_push_to_talk_started` - fields: surface, provider.
- `voice_push_to_talk_completed` - fields: surface, provider, audio_ms, latency_ms, transcript_chars.
- `voice_command_parsed` - fields: surface, kind, requires_confirmation.
- `voice_command_executed` - fields: kind, confirmed, success.
- `whisper_model_verified` - fields: model, gguf_ok, vad_ok, coreml_ok, repairable.
- `whisper_model_repaired` - fields: model, success.
- `whisper_benchmark_completed` - fields: model, accel, rtf, duration_ms.
```

- [ ] **Step 5: Run full validation**

Run:

```bash
cd apps/x/packages/core
npx vitest run src/voice/transcription-config.test.ts src/voice/whisper/*.test.ts src/voice/commands/*.test.ts src/voice/email/*.test.ts src/voice/meetings/*.test.ts
```

Expected: PASS.

Run:

```bash
cd apps/x
npm run quality
```

Expected: PASS.

Run:

```bash
cd apps/x
npm run package
```

Expected: packaged Electron app builds successfully.

Run:

```bash
cd apps/x/apps/main
npm run test:e2e
```

Expected: PASS.

- [ ] **Step 6: Manual dogfood checklist**

Run each scenario and capture notes in the PR description:

- Open Settings -> Transcription -> Live mic dogfood; record "the quick brown fox jumps over the lazy dog"; verify model, accel, transcript, duration, and RTF appear.
- Enable local-only speech; disconnect network; dictate into chat; verify transcript inserts and no cloud WebSocket opens.
- Use push-to-talk in chat, email reply, markdown editor, and command palette.
- Say "archive newsletters from last week"; verify a confirmation modal appears and no archive happens before confirmation.
- Start a local meeting recording, capture mic and system audio, stop, and verify meeting note has transcript, action items, open questions, follow-up drafts, provider provenance, and `audio_retained: false`.
- Verify a model, corrupt one model artifact, run repair, and verify it re-downloads or restores the model.
- Run a benchmark and verify `"auto"` picks the expected model for the device.
- In email, dictate a reply and create a disabled rule draft by saying "create a rule label all Stripe receipts as finance".

- [ ] **Step 7: Final commit**

```bash
git add apps/rfc/009-local-on-device-transcription.md apps/rfc/017-on-device-meeting-diarization.md apps/rfc/email-018-email-product-roadmap-and-build-order.md apps/x/ANALYTICS.md
git commit -m "docs: document expanded local voice rollout"
```

## Acceptance Gates

The implementation is complete only when all of these pass:

- `cd apps/x/packages/core && npx vitest run src/voice/transcription-config.test.ts src/voice/whisper/*.test.ts src/voice/commands/*.test.ts src/voice/email/*.test.ts src/voice/meetings/*.test.ts`
- `cd apps/x && npm run quality`
- `cd apps/x && npm run package`
- `cd apps/x/apps/main && npm run test:e2e`
- Whisper eval on at least one installed local model:

```bash
cd apps/x
ROWBOAT_WHISPER_BIN=apps/x/vendor/whisper/darwin-arm64/whisper-cli ROWBOAT_WHISPER_EVAL_MODEL=base.en-q5_1 npm run test:whisper-eval
```

## Risk Controls

- Do not send raw audio to analytics or logs.
- Do not store raw audio unless `privacy.retainRawAudio` is explicitly true.
- Do not execute destructive email actions without `VoiceCommandConfirmation`.
- Do not send email automatically from a voice command in this phase; stage drafts only.
- Do not treat CoreML catalog metadata as runtime proof; capability should still inspect linked frameworks and runtime logs.
- Do not overwrite current model files during repair until a replacement download verifies.
- Do not make local-only privacy depend on renderer-only checks; enforce it in core provider resolution and renderer transport setup.
- Do not let meeting streaming buffer without bounds; keep MessagePort credit backpressure and queue caps.

## Feature Coverage Matrix

| Feature                 | Primary Tasks | Verification                                         |
| ----------------------- | ------------- | ---------------------------------------------------- |
| Live Mic Dogfood Mode   | Task 2        | Diagnostics test and manual settings panel run       |
| Push-To-Talk Everywhere | Task 7        | Renderer dictation tests and four-surface manual run |
| Voice Command Mode      | Task 8        | Parser/executor tests and confirmation manual run    |
| Real-Time Streaming     | Task 6        | Streaming partial tests and local voice manual run   |
| Meeting Recorder        | Task 9        | Summary tests and meeting note manual run            |
| Model Auto-Selector     | Task 4        | Benchmark tests and auto model manual run            |
| Accuracy Eval Harness   | Task 11       | Eval report tests and Whisper eval command           |
| Download/Repair UX      | Task 3        | Model manager tests and corrupt-artifact manual run  |
| Local-Only Privacy Mode | Task 5        | Provider tests and offline manual run                |
| Voice-To-Email          | Task 10       | Email action tests and email-view manual run         |
