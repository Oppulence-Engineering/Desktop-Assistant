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
      })
      .catch(() => {});

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
    return off;
  }, [dialogOpen]);

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
            hint="Private · no speaker labels"
          />
        </div>
      </SettingsSection>
    </div>
  );
}

function ProviderOption({
  selected,
  onSelect,
  icon: Icon,
  title,
  hint,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ElementType;
  title: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex w-full items-center gap-3 rounded-none border px-3.5 py-3 text-left transition-all",
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
        <span className="block text-xs text-muted-foreground">{hint}</span>
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
