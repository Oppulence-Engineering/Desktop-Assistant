import { useEffect, useState, useCallback } from "react";
import {
  Download,
  CircleCheck,
  Trash2,
  Check,
  Laptop,
  Cloud,
  Loader2,
  ShieldCheck,
  Wrench,
} from "@/lib/icons";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import * as analytics from "@/lib/analytics";
import { SettingsSection } from "./settings-ui";
import { LocalSpeechDogfoodPanel } from "./local-speech-dogfood-panel";
import type {
  WhisperModelSummary,
  WhisperCapability,
  WhisperModelHealth,
  TranscriptionProvider,
  WhisperBenchmarkProfile,
} from "@x/shared/dist/transcription.js";
import type { MeetingResolvedEngine, MeetingsSettings } from "@x/shared/dist/meetings.js";

const TRANSCRIPTION_CONFIG_CHANGED_EVENT = "transcription-config-changed";

interface BenchmarkResultState {
  requestedModel: string;
  profile: WhisperBenchmarkProfile;
}

interface BenchmarkFailureState {
  requestedModel: string;
  kind: "audio_invalid" | "generic";
  message: string;
}

function benchmarkMatchesActiveModel(result: BenchmarkResultState, activeModel: string): boolean {
  if (activeModel === "auto") return result.requestedModel === "auto";
  return result.profile.model === activeModel;
}

function benchmarkFailureMatchesActiveModel(
  failure: BenchmarkFailureState,
  activeModel: string,
): boolean {
  return activeModel === failure.requestedModel;
}

function classifyBenchmarkFailure(err: unknown): Omit<BenchmarkFailureState, "requestedModel"> {
  const maybeError = err as { code?: unknown; message?: unknown };
  const code = typeof maybeError?.code === "string" ? maybeError.code : undefined;
  const message = typeof maybeError?.message === "string" ? maybeError.message : String(err ?? "");
  if (
    code === "audio_invalid" ||
    message.includes("audio_invalid") ||
    message.toLowerCase().includes("did not produce a transcript")
  ) {
    return {
      kind: "audio_invalid",
      message: "Benchmark failed: selected model produced no transcript.",
    };
  }
  return {
    kind: "generic",
    message: "Benchmark failed. Verify the selected model and try again.",
  };
}

/**
 * Transcription settings (RFC 009 §17). Provider choice (on-device vs cloud) for
 * voice + meetings, a model picker with download progress, and a device line that
 * surfaces the capability probe. Writes `transcription.json` via typed IPC.
 */
export function TranscriptionSettings({ dialogOpen }: { dialogOpen: boolean }) {
  const [models, setModels] = useState<WhisperModelSummary[]>([]);
  const [capability, setCapability] = useState<WhisperCapability | null>(null);
  const [voiceProvider, setVoiceProvider] = useState<TranscriptionProvider>("whisper-local");
  const [meetingProvider, setMeetingProvider] = useState<TranscriptionProvider>("deepgram");
  const [localOnly, setLocalOnly] = useState(false);
  // RFC 017: on-device meeting diarization (beta). Off by default.
  const [diarizationEnabled, setDiarizationEnabled] = useState(false);
  const [meetings, setMeetings] = useState<MeetingsSettings | null>(null);
  // What a start would actually use, as opposed to what is configured — the
  // difference is the whole point of showing it.
  const [resolvedEngine, setResolvedEngine] = useState<MeetingResolvedEngine | null>(null);
  const [fastModels, setFastModels] = useState<{ ready: boolean; available: boolean } | null>(null);
  const [modelDownload, setModelDownload] = useState<number | null>(null);
  const [activeModel, setActiveModel] = useState<string>("base.en-q5_1");
  // Per-model download progress in [0, 1]; absent until a download starts.
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [health, setHealth] = useState<Record<string, WhisperModelHealth>>({});
  const [healthOp, setHealthOp] = useState<Record<string, "verify" | "repair">>({});
  const [benchmarkBusy, setBenchmarkBusy] = useState(false);
  const [benchmarkResult, setBenchmarkResult] = useState<BenchmarkResultState | null>(null);
  const [benchmarkFailure, setBenchmarkFailure] = useState<BenchmarkFailureState | null>(null);

  const refreshModels = useCallback(async () => {
    const result = await window.ipc.invoke("whisper:listModels", null);
    setModels(result.models);
    setProgress({});
    setBenchmarkResult((current) =>
      current && benchmarkMatchesActiveModel(current, activeModel) ? current : null,
    );
    setBenchmarkFailure((current) =>
      current && benchmarkFailureMatchesActiveModel(current, activeModel) ? current : null,
    );
  }, [activeModel]);

  useEffect(() => {
    setBenchmarkResult((current) =>
      current && benchmarkMatchesActiveModel(current, activeModel) ? current : null,
    );
    setBenchmarkFailure((current) =>
      current && benchmarkFailureMatchesActiveModel(current, activeModel) ? current : null,
    );
  }, [activeModel]);

  useEffect(() => {
    if (!dialogOpen) return;
    void window.ipc
      .invoke("whisper:listModels", null)
      .then((r) => setModels(r.models))
      .catch(() => {});
    void window.ipc
      .invoke("whisper:capability", null)
      .then(setCapability)
      .catch(() => {});
    void window.ipc
      .invoke("transcription:getConfig", null)
      .then((cfg) => {
        setVoiceProvider(cfg.voiceProvider);
        setMeetingProvider(cfg.meetingProvider);
        setLocalOnly(cfg.privacy.localOnly);
        setActiveModel(cfg.whisper.model);
        setDiarizationEnabled(cfg.diarization?.enabled ?? false);
        setMeetings(cfg.meetings);
      })
      .catch(() => {});
    void window.ipc
      .invoke("meeting:captureEngine", null)
      .then((r) => setResolvedEngine(r.engine))
      .catch(() => {});
    void window.ipc
      .invoke("meeting:transcriptionModels", null)
      .then((r) => setFastModels({ ready: r.ready, available: r.available }))
      .catch(() => {});

    const offMeetingModels = window.ipc.on("meeting:modelProgress", (p) => {
      setModelDownload(p.fraction);
    });
    const off = window.ipc.on("whisper:modelProgress", (p) => {
      setProgress((prev) => {
        if (p.phase !== "download") {
          const next = { ...prev };
          delete next[p.id];
          return next;
        }
        return { ...prev, [p.id]: p.totalMb ? p.receivedMb / p.totalMb : 0 };
      });
    });
    return () => {
      off?.();
      offMeetingModels?.();
    };
  }, [dialogOpen]);

  const downloadFastModels = useCallback(async () => {
    setModelDownload(0);
    try {
      const result = await window.ipc.invoke("meeting:ensureTranscriptionModels", null);
      setFastModels((current) => (current ? { ...current, ready: result.ready } : current));
      if (!result.ready)
        toast.error(result.error ?? "Could not download the transcription models.");
    } finally {
      setModelDownload(null);
    }
  }, []);

  const changeVoiceProvider = useCallback(
    async (next: TranscriptionProvider) => {
      const from = voiceProvider;
      setVoiceProvider(next);
      await window.ipc.invoke("transcription:setConfig", { voiceProvider: next });
      analytics.transcriptionProviderChanged({ feature: "voice", from, to: next, reason: "user" });
    },
    [voiceProvider],
  );

  const changeMeetingProvider = useCallback(
    async (next: TranscriptionProvider) => {
      const from = meetingProvider;
      setMeetingProvider(next);
      await window.ipc.invoke("transcription:setConfig", { meetingProvider: next });
      analytics.transcriptionProviderChanged({
        feature: "meeting",
        from,
        to: next,
        reason: "user",
      });
    },
    [meetingProvider],
  );

  const changeLocalOnly = useCallback(
    async (next: boolean) => {
      const previous = localOnly;
      setLocalOnly(next);
      try {
        const cfg = await window.ipc.invoke("transcription:setConfig", {
          privacy: { localOnly: next },
        });
        setLocalOnly(cfg.privacy.localOnly);
        window.dispatchEvent(
          new CustomEvent(TRANSCRIPTION_CONFIG_CHANGED_EVENT, {
            detail: { privacy: cfg.privacy },
          }),
        );
      } catch {
        setLocalOnly(previous);
      }
    },
    [localOnly],
  );

  const changeMeetings = useCallback(
    async (patch: Partial<MeetingsSettings>) => {
      const previous = meetings;
      setMeetings((current) => (current ? { ...current, ...patch } : current));
      try {
        const cfg = await window.ipc.invoke("transcription:setConfig", { meetings: patch });
        setMeetings(cfg.meetings);
        // The engine can change as a result (auto → renderer when forced off).
        const { engine } = await window.ipc.invoke("meeting:captureEngine", null);
        setResolvedEngine(engine);
      } catch {
        setMeetings(previous);
      }
    },
    [meetings],
  );

  const changeDiarizationEnabled = useCallback(
    async (next: boolean) => {
      const previous = diarizationEnabled;
      setDiarizationEnabled(next);
      try {
        // Enabling the beta also turns on the beta UI surface (RFC 017 flags).
        const cfg = await window.ipc.invoke("transcription:setConfig", {
          diarization: { enabled: next, betaUI: next },
        });
        setDiarizationEnabled(cfg.diarization?.enabled ?? false);
      } catch {
        setDiarizationEnabled(previous);
      }
    },
    [diarizationEnabled],
  );

  const selectModel = useCallback(
    async (id: string) => {
      if (benchmarkBusy) return;
      setBenchmarkResult(null);
      setBenchmarkFailure(null);
      setActiveModel(id);
      await window.ipc.invoke("transcription:setConfig", { model: id });
    },
    [benchmarkBusy],
  );

  const benchmarkDevice = useCallback(async () => {
    const requestedModel = activeModel;
    setBenchmarkBusy(true);
    setBenchmarkFailure(null);
    try {
      const result = await window.ipc.invoke("whisper:benchmark", {
        ...(requestedModel === "auto" ? {} : { model: requestedModel }),
        sampleSeconds: 10,
      });
      setBenchmarkFailure(null);
      setBenchmarkResult({ requestedModel, profile: result });
    } catch (err) {
      setBenchmarkResult(null);
      setBenchmarkFailure({ requestedModel, ...classifyBenchmarkFailure(err) });
    } finally {
      setBenchmarkBusy(false);
    }
  }, [activeModel]);

  const download = useCallback(
    async (id: string, sizeMb: number) => {
      if (benchmarkBusy) return;
      setProgress((prev) => ({ ...prev, [id]: 0 }));
      const startedAt = performance.now();
      const res = await window.ipc.invoke("whisper:ensureModel", { id });
      setProgress((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (res.success) {
        analytics.whisperModelDownloaded({ id, sizeMb, durationMs: performance.now() - startedAt });
        setHealth((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        await refreshModels();
      } else {
        // ... (ERRORS.md E59) ensureModel resolves {success:false,code} instead
        // of throwing; surface it so the bar doesn't just vanish silently.
        toast.error("Couldn't download model", {
          description: res.code ? `Reason: ${res.code}` : undefined,
        });
      }
    },
    [benchmarkBusy, refreshModels],
  );

  const removeModel = useCallback(
    async (id: string) => {
      if (benchmarkBusy) return;
      setBenchmarkResult(null);
      setBenchmarkFailure(null);
      await window.ipc.invoke("whisper:removeModel", { id });
      setProgress((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setHealth((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      await refreshModels();
    },
    [benchmarkBusy, refreshModels],
  );

  const verifyModel = useCallback(async (id: string) => {
    setHealthOp((prev) => ({ ...prev, [id]: "verify" }));
    try {
      const result = await window.ipc.invoke("whisper:verifyModel", { id });
      setHealth((prev) => ({ ...prev, [id]: result }));
    } finally {
      setHealthOp((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  }, []);

  const repairModel = useCallback(
    async (id: string) => {
      if (benchmarkBusy) return;
      setHealthOp((prev) => ({ ...prev, [id]: "repair" }));
      try {
        const result = await window.ipc.invoke("whisper:repairModel", { id });
        setProgress((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setHealth((prev) => ({ ...prev, [id]: result }));
        await refreshModels();
      } catch (err) {
        // ... (ERRORS.md E60) repairModel can reject; surface it and re-check
        // health so the UI doesn't silently keep showing stale state.
        toast.error("Couldn't repair model", {
          description: err instanceof Error ? err.message : undefined,
        });
        try {
          const health = await window.ipc.invoke("whisper:verifyModel", { id });
          setHealth((prev) => ({ ...prev, [id]: health }));
        } catch {
          /* health refresh is best-effort */
        }
      } finally {
        setHealthOp((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    },
    [benchmarkBusy, refreshModels],
  );

  const accelLabel = capability
    ? capability.accel === "coreml" || capability.accel === "metal"
      ? "Apple Silicon · fast"
      : capability.accel === "vulkan" || capability.accel === "cuda"
        ? "GPU · fast"
        : capability.supported
          ? "CPU only · may be slow"
          : "CPU only · not recommended on this device"
    : "Detecting…";
  const visibleBenchmarkResult =
    benchmarkResult && benchmarkMatchesActiveModel(benchmarkResult, activeModel)
      ? benchmarkResult.profile
      : null;
  const visibleBenchmarkFailure =
    benchmarkFailure && benchmarkFailureMatchesActiveModel(benchmarkFailure, activeModel)
      ? benchmarkFailure
      : null;

  return (
    <div className="space-y-8">
      <SettingsSection title="Privacy" description="Controls whether speech can leave this device.">
        <div className="flex items-center justify-between gap-4 rounded-none border bg-muted/20 px-3.5 py-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-none border bg-card text-muted-foreground">
              <ShieldCheck className="size-4" />
            </span>
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-foreground">
                Local-only transcription
              </div>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                When enabled, speech stays on this device and cloud transcription/sign-in paths are
                not used.
              </p>
            </div>
          </div>
          <Switch
            checked={localOnly}
            onCheckedChange={(next) => void changeLocalOnly(next)}
            aria-label="Use local-only transcription"
            className="shrink-0"
          />
        </div>
      </SettingsSection>

      <SettingsSection
        title="Voice input"
        description="Speech-to-text for the mic and push-to-talk."
      >
        <div className="space-y-2">
          <ProviderOption
            icon={Laptop}
            selected={voiceProvider === "whisper-local"}
            onSelect={() => changeVoiceProvider("whisper-local")}
            title="On-device (Whisper)"
            hint="Private · offline · free"
            disabled={capability?.supported === false}
          />
          <ProviderOption
            icon={Cloud}
            selected={voiceProvider === "deepgram"}
            onSelect={() => changeVoiceProvider("deepgram")}
            title="Cloud (Deepgram)"
            hint="Most accurate · live partials"
          />
        </div>
        <div className="inline-flex items-center gap-1.5 rounded-none border bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
          {capability ? (
            <Laptop className="size-3.5" />
          ) : (
            <Loader2 className="size-3.5 animate-spin" />
          )}
          This device: {accelLabel}
        </div>
        <LocalSpeechDogfoodPanel />
      </SettingsSection>

      <SettingsSection
        title="On-device models"
        description="Whisper models for on-device transcription — download once, then used offline."
      >
        <div className="flex items-center justify-between gap-3 rounded-none border bg-muted/20 px-3.5 py-2.5 text-sm">
          <div
            className={cn(
              "min-w-0 text-xs text-muted-foreground",
              visibleBenchmarkFailure && "text-destructive",
            )}
          >
            {visibleBenchmarkResult ? (
              <span className="truncate">
                Benchmark: {visibleBenchmarkResult.model} · {visibleBenchmarkResult.rtf.toFixed(1)}x
                RTF
              </span>
            ) : visibleBenchmarkFailure ? (
              <span className="truncate">{visibleBenchmarkFailure.message}</span>
            ) : (
              <span className="truncate">
                Model: {activeModel === "auto" ? "Auto" : activeModel}
              </span>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 shrink-0 gap-1.5 px-2 text-xs"
            disabled={benchmarkBusy}
            onClick={benchmarkDevice}
          >
            {benchmarkBusy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Laptop className="size-3.5" />
            )}
            {benchmarkBusy ? "Benchmarking" : "Benchmark this device"}
          </Button>
        </div>
        <div className="overflow-hidden rounded-none border">
          <div
            className={cn(
              "flex items-center gap-3 px-3.5 py-2.5 text-sm transition-colors",
              activeModel === "auto" && "bg-primary/[0.04]",
              activeModel !== "auto" && "hover:bg-muted/20",
            )}
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2.5 text-left disabled:cursor-default"
              onClick={() => selectModel("auto")}
              disabled={benchmarkBusy}
              aria-pressed={activeModel === "auto"}
            >
              <span
                className={cn(
                  "flex size-3.5 shrink-0 items-center justify-center rounded-full border",
                  activeModel === "auto" ? "border-primary" : "border-muted-foreground/40",
                )}
              >
                {activeModel === "auto" && <span className="size-1.5 rounded-full bg-primary" />}
              </span>
              <span className={cn("truncate", activeModel === "auto" && "font-medium")}>Auto</span>
              {activeModel === "auto" && <Badge className="shrink-0">Active</Badge>}
            </button>
          </div>
          {models.map((m) => {
            const pct = progress[m.id];
            const downloading = pct != null && !m.installed;
            const active = activeModel === m.id;
            const modelHealth = health[m.id];
            const healthBusy = healthOp[m.id];
            const healthOk =
              modelHealth &&
              modelHealth.ggufOk &&
              modelHealth.vadOk &&
              modelHealth.coremlOk !== false &&
              !modelHealth.repairable;
            return (
              <div
                key={m.id}
                className={cn(
                  "flex items-center gap-3 px-3.5 py-2.5 text-sm transition-colors",
                  "border-t",
                  active && "bg-primary/[0.04]",
                  m.installed && !active && "hover:bg-muted/20",
                )}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left disabled:cursor-default"
                  onClick={() => m.installed && selectModel(m.id)}
                  disabled={!m.installed || benchmarkBusy}
                  aria-pressed={active}
                >
                  {m.installed && (
                    <span
                      className={cn(
                        "flex size-3.5 shrink-0 items-center justify-center rounded-full border",
                        active ? "border-primary" : "border-muted-foreground/40",
                      )}
                    >
                      {active && <span className="size-1.5 rounded-full bg-primary" />}
                    </span>
                  )}
                  <span className={cn("truncate", active && "font-medium")}>{m.label}</span>
                  {m.recommended && (
                    <Badge variant="secondary" className="shrink-0">
                      Recommended
                    </Badge>
                  )}
                  {active && <Badge className="shrink-0">Active</Badge>}
                </button>
                <div className="flex shrink-0 items-center gap-2.5">
                  <span className="tabular-nums text-xs text-muted-foreground">{m.sizeMb} MB</span>
                  {m.installed ? (
                    <>
                      <span className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                        <CircleCheck className="size-4" />
                        Installed
                      </span>
                      {modelHealth?.repairable && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1.5 px-2 text-xs"
                          title={modelHealth.reason ?? `Repair ${m.label}`}
                          aria-label={`Repair ${m.label}`}
                          disabled={!!healthBusy || benchmarkBusy}
                          onClick={() => repairModel(m.id)}
                        >
                          {healthBusy === "repair" ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Wrench className="size-3.5" />
                          )}
                          Repair
                        </Button>
                      )}
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className={cn(
                          "text-muted-foreground",
                          healthOk && "text-green-600 hover:text-green-700 dark:text-green-400",
                          modelHealth?.repairable && "text-amber-600 hover:text-amber-700",
                        )}
                        title={
                          modelHealth?.reason
                            ? `Verify ${m.label}: ${modelHealth.reason}`
                            : `Verify ${m.label}`
                        }
                        aria-label={`Verify ${m.label}`}
                        disabled={!!healthBusy}
                        onClick={() => verifyModel(m.id)}
                      >
                        {healthBusy === "verify" ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <ShieldCheck className="size-4" />
                        )}
                      </Button>
                    </>
                  ) : downloading ? (
                    <span className="flex items-center gap-2">
                      <Progress value={Math.round((pct ?? 0) * 100)} className="h-1.5 w-20" />
                      <span className="tabular-nums text-xs">{Math.round((pct ?? 0) * 100)}%</span>
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      disabled={benchmarkBusy}
                      onClick={() => download(m.id, m.sizeMb)}
                    >
                      <Download className="size-3.5" />
                      Get
                    </Button>
                  )}
                  {m.installed && !m.recommended && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={`Remove ${m.label}`}
                      disabled={benchmarkBusy}
                      onClick={() => removeModel(m.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </SettingsSection>

      <SettingsSection title="Meetings" description="Transcription for recorded meetings.">
        <div className="space-y-2">
          <ProviderOption
            icon={Cloud}
            selected={meetingProvider === "deepgram" || meetingProvider === "solomon"}
            onSelect={() => changeMeetingProvider("deepgram")}
            title="Cloud (Deepgram)"
            hint="Speaker labels · system audio"
          />
          <ProviderOption
            icon={Laptop}
            selected={meetingProvider === "whisper-local"}
            onSelect={() => changeMeetingProvider("whisper-local")}
            title="On-device"
            hint={
              meetingProvider === "whisper-local" && diarizationEnabled
                ? "Private · local beta speaker labels"
                : "Private · no speaker labels"
            }
            disabled={capability?.supported === false}
          />
          {meetingProvider === "whisper-local" && (
            <button
              type="button"
              onClick={() => void changeDiarizationEnabled(!diarizationEnabled)}
              aria-pressed={diarizationEnabled}
              className={cn(
                "flex w-full items-center justify-between gap-3 rounded-none border px-3.5 py-3 text-left transition-all",
                diarizationEnabled
                  ? "border-primary bg-primary/[0.03] ring-2 ring-primary/20"
                  : "border-border hover:border-primary/40 hover:bg-muted/40",
              )}
            >
              <span className="flex flex-col">
                <span className="text-sm font-medium">Local diarization (beta)</span>
                <span className="text-xs text-muted-foreground">
                  Anonymous speaker labels on-device · falls back to no labels when uncertain
                </span>
              </span>
              <span
                className={cn(
                  "shrink-0 rounded-none border px-2 py-0.5 text-xs",
                  diarizationEnabled
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground",
                )}
              >
                {diarizationEnabled ? "On" : "Off"}
              </span>
            </button>
          )}
        </div>
      </SettingsSection>

      {meetings && (
        <SettingsSection
          title="Meeting recording"
          description={
            resolvedEngine === "native"
              ? "Your microphone and system audio are recorded as two separate tracks on this device — the other side of the call is captured without a meeting bot."
              : "This device records through the in-app pipeline. Two-track capture needs macOS 14.2 or later."
          }
        >
          <div className="space-y-2">
            <SettingToggle
              title="Two-track capture"
              hint={
                resolvedEngine === "native"
                  ? "Recommended · survives closing the window, and both sides are transcribed separately"
                  : "Unavailable on this device"
              }
              value={meetings.captureEngine !== "renderer"}
              disabled={resolvedEngine !== "native"}
              onChange={(next) =>
                void changeMeetings({ captureEngine: next ? "auto" : "renderer" })
              }
            />
            {resolvedEngine === "native" && meetings.captureEngine !== "renderer" && (
              <>
                <SettingToggle
                  title="Fast transcription"
                  hint={
                    meetings.transcriptionEngine === "parakeet"
                      ? "Parakeet on the Neural Engine — about a minute for an hour-long meeting, versus roughly seven"
                      : "Uses whisper. Switch to Parakeet for ~4x faster transcription (multilingual, one-time 600 MB download)"
                  }
                  value={meetings.transcriptionEngine === "parakeet"}
                  onChange={(next) =>
                    void changeMeetings({ transcriptionEngine: next ? "parakeet" : "whisper" })
                  }
                />
                {meetings.transcriptionEngine === "parakeet" && fastModels && !fastModels.ready && (
                  <div className="flex items-center justify-between gap-3 border border-border px-3.5 py-3">
                    <span className="flex flex-col">
                      <span className="text-sm font-medium">Transcription models</span>
                      <span className="text-xs text-muted-foreground">
                        {modelDownload === null
                          ? "About 600 MB, downloaded once. Meetings fall back to whisper until this finishes."
                          : `Downloading… ${Math.round(modelDownload * 100)}%`}
                      </span>
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={modelDownload !== null}
                      onClick={() => void downloadFastModels()}
                    >
                      {modelDownload !== null ? (
                        <Loader2 className="mr-2 size-3.5 animate-spin" />
                      ) : (
                        <Download className="mr-2 size-3.5" />
                      )}
                      Download
                    </Button>
                  </div>
                )}
                <div className="border border-border px-3.5 py-3">
                  <p className="text-sm font-medium">When a calendar meeting starts</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Only for events with a video-call link.
                  </p>
                  <div className="mt-2.5 flex flex-col gap-1.5">
                    {(
                      [
                        ["prompt", "Ask me", "A notification you can act on or ignore."],
                        [
                          "always",
                          "Start recording",
                          "Records without asking. You are still told each time it starts.",
                        ],
                        ["off", "Do nothing", "No notification, no recording."],
                      ] as const
                    ).map(([value, label, hint]) => (
                      <label key={value} className="flex cursor-pointer items-start gap-2.5">
                        <input
                          type="radio"
                          name="meeting-auto-start"
                          className="mt-1"
                          checked={(meetings.autoStart ?? "prompt") === value}
                          onChange={() => void changeMeetings({ autoStart: value })}
                        />
                        <span className="min-w-0">
                          <span className="block text-sm">{label}</span>
                          <span className="block text-xs text-muted-foreground">{hint}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
                <SettingToggle
                  title="Live transcript while recording"
                  hint="Transcribes in the background during the call so you can read along and ask questions mid-meeting. Off by default: it is a second transcription pass running on a machine already busy with the call."
                  value={meetings.liveTranscript === true}
                  onChange={(next) => void changeMeetings({ liveTranscript: next })}
                />
                <SettingToggle
                  title="Stand by before calendar meetings"
                  hint="Opens the microphone a couple of minutes early and holds the last few minutes in memory, writing nothing — so pressing record still catches what was already said. Off by default: arming a microphone should be your choice, not a side effect of your calendar."
                  value={meetings.standbyBeforeMeetings === true}
                  onChange={(next) => void changeMeetings({ standbyBeforeMeetings: next })}
                />
                <SettingToggle
                  title="Warn me before a meeting if something is wrong"
                  hint="Checks microphone and system-audio access, the input device, and disk space about two minutes before a call — and stays quiet when everything is fine"
                  value={meetings.preflightNotifications !== false}
                  onChange={(next) => void changeMeetings({ preflightNotifications: next })}
                />
                <SettingToggle
                  title="Echo cancellation"
                  hint="Turn on when the meeting plays through speakers, or their audio is transcribed twice — once as them, once as you. Leave off with headphones."
                  value={meetings.micVoiceProcessing}
                  onChange={(next) => void changeMeetings({ micVoiceProcessing: next })}
                />
                {meetings.keepAudio === "always" && (
                  <SettingToggle
                    title="Compress kept audio"
                    hint="AAC instead of raw — about an eighth the size (15 MB per hour per track rather than 115), still playable, and still re-transcribable"
                    value={meetings.compressRetainedAudio}
                    onChange={(next) => void changeMeetings({ compressRetainedAudio: next })}
                  />
                )}
                <SettingToggle
                  title="Keep audio after transcribing"
                  hint={
                    meetings.keepAudio === "always"
                      ? "Recordings stay on disk so you can re-transcribe with a better model later"
                      : "Recordings are deleted once the transcript is written · kept if transcription fails, so a retry is possible"
                  }
                  value={meetings.keepAudio === "always"}
                  onChange={(next) =>
                    void changeMeetings({ keepAudio: next ? "always" : "untilTranscribed" })
                  }
                />
              </>
            )}
          </div>
        </SettingsSection>
      )}
    </div>
  );
}

/** A labelled on/off row, matching the local-diarization toggle above. */
function SettingToggle({
  title,
  hint,
  value,
  onChange,
  disabled = false,
}: {
  title: string;
  hint: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!value)}
      aria-pressed={value}
      disabled={disabled}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-none border px-3.5 py-3 text-left transition-all",
        disabled && "cursor-not-allowed opacity-50",
        !disabled && value
          ? "border-primary bg-primary/[0.03] ring-2 ring-primary/20"
          : "border-border",
        !disabled && "hover:border-primary/40 hover:bg-muted/40",
      )}
    >
      <span className="flex flex-col">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </span>
      <span
        className={cn(
          "shrink-0 rounded-none border px-2 py-0.5 text-xs",
          value
            ? "border-primary bg-primary text-primary-foreground"
            : "bg-card text-muted-foreground",
        )}
      >
        {value ? "On" : "Off"}
      </span>
    </button>
  );
}

function ProviderOption({
  selected,
  onSelect,
  icon: Icon,
  title,
  hint,
  disabled = false,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ElementType;
  title: string;
  hint: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        "flex w-full items-center gap-3 rounded-none border px-3.5 py-3 text-left transition-all",
        // ... (ERRORS.md E61) Dim + block selection when local isn't supported.
        disabled && "cursor-not-allowed opacity-50",
        selected
          ? "border-primary bg-primary/[0.03] ring-2 ring-primary/20"
          : "border-border hover:border-primary/40 hover:bg-muted/40",
      )}
    >
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-none border",
          selected
            ? "border-primary bg-primary text-primary-foreground"
            : "bg-card text-muted-foreground",
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-foreground">{title}</span>
        <span className="block text-xs text-muted-foreground">
          {disabled ? "Not supported on this device — will use cloud" : hint}
        </span>
      </span>
      <span
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity",
          selected ? "opacity-100" : "opacity-0",
        )}
      >
        <Check className="size-3" />
      </span>
    </button>
  );
}
