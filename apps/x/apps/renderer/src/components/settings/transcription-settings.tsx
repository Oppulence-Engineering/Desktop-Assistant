import { useEffect, useRef, useState, useCallback } from "react";
import {
  AudioLines,
  Download,
  CircleCheck,
  Trash2,
  Check,
  Laptop,
  Cloud,
  Loader2,
  ShieldCheck,
  Wrench,
  Copy,
  RotateCcw,
} from "@/lib/icons";
import { toast } from "sonner";
import { Button } from "@oppulence/ui/components/button";
import { Badge } from "@oppulence/ui/components/badge";
import { Progress } from "@oppulence/ui/components/progress";
import { Switch } from "@oppulence/ui/components/switch";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@oppulence/ui/components/collapsible";
import { cn } from "@/lib/utils";
import * as analytics from "@/lib/analytics";
import { SettingsSection } from "./settings-ui";
import { LocalSpeechDogfoodPanel } from "./local-speech-dogfood-panel";
import { DictationPersonalizationSettings } from "./dictation-personalization-settings";
import { DictationMicrophoneSettings } from "./dictation-microphone-settings";
import { DictationTransformSettings } from "./dictation-transform-settings";
import { MeetingCaptureCheck } from "../meeting-capture-check";
import type {
  WhisperModelSummary,
  WhisperCapability,
  WhisperModelHealth,
  TranscriptionProvider,
  TranscriptionRouting,
  WhisperBenchmarkProfile,
  DictationSettings,
  DictationHistoryRetention,
  DictationShortcut,
  DictationFlowBarDock,
  DictationLanguage,
  RelationshipEvidenceSettings,
} from "@x/shared/dist/transcription.js";
import { DICTATION_LANGUAGE_OPTIONS } from "@x/shared/dist/transcription.js";
import type {
  MeetingDoctorReport,
  MeetingResolvedEngine,
  MeetingsSettings,
} from "@x/shared/dist/meetings.js";

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

interface DesktopDictationStatus {
  available: boolean;
  monitorReady: boolean;
  commandModeReady: boolean;
  commandModeEnabled: boolean;
  transformsEnabled: boolean;
  transformShortcutsReady: boolean;
  accessibilityTrusted: boolean;
  shortcut: string;
  commandShortcut: string;
  transformShortcutError?: string;
  error?: string;
}

interface DesktopDictationRecovery {
  available: boolean;
  preview?: string;
  createdAt?: string;
  audioAvailable: boolean;
  audioCreatedAt?: string;
  audioDurationMs?: number;
  audioErrorCode?: string;
}

const DICTATION_SHORTCUT_OPTIONS: Array<{ value: DictationShortcut; label: string }> = [
  { value: "control-option", label: "Control + Option" },
  { value: "fn", label: "Fn / Globe" },
  { value: "control-fn", label: "Control + Fn" },
];

const FLOW_BAR_DOCK_OPTIONS: Array<{ value: DictationFlowBarDock; label: string }> = [
  { value: "bottom", label: "Bottom" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
];

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
  const [routing, setRouting] = useState<TranscriptionRouting | null>(null);
  const [meetings, setMeetings] = useState<MeetingsSettings | null>(null);
  const [relationships, setRelationships] = useState<RelationshipEvidenceSettings | null>(null);
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
  const [meetingDoctor, setMeetingDoctor] = useState<MeetingDoctorReport | null>(null);
  const [meetingDoctorBusy, setMeetingDoctorBusy] = useState(false);
  const [meetingCaptureCheckOpen, setMeetingCaptureCheckOpen] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [meetingsOpen, setMeetingsOpen] = useState(false);
  const [dictationStatus, setDictationStatus] = useState<DesktopDictationStatus | null>(null);
  const [dictationSettings, setDictationSettings] = useState<DictationSettings | null>(null);
  const [dictationRecovery, setDictationRecovery] = useState<DesktopDictationRecovery | null>(null);
  const meetingDoctorRequest = useRef(0);

  const refreshRouting = useCallback(async () => {
    try {
      setRouting(await window.ipc.invoke("transcription:getRouting", null));
    } catch {
      setRouting(null);
    }
  }, []);

  const refreshDictationStatus = useCallback(async () => {
    try {
      setDictationStatus(await window.ipc.invoke("dictation:getStatus", null));
    } catch {
      setDictationStatus(null);
    }
  }, []);

  const refreshDictationRecovery = useCallback(async () => {
    try {
      setDictationRecovery(await window.ipc.invoke("dictation:getRecovery", null));
    } catch {
      setDictationRecovery(null);
    }
  }, []);

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
        setMeetings(cfg.meetings);
        setRelationships(cfg.relationships);
        setDictationSettings(cfg.dictation);
      })
      .catch(() => {});
    void refreshRouting();
    void refreshDictationStatus();
    void refreshDictationRecovery();
    void window.ipc
      .invoke("meeting:captureEngine", null)
      .then((r) => setResolvedEngine(r.engine))
      .catch(() => {});
    void window.ipc
      .invoke("meeting:transcriptionModels", null)
      .then((r) => setFastModels({ ready: r.ready, available: r.available }))
      .catch(() => {});
    // Passive checks never request system-audio permission. The explicit
    // preflight button below is the only settings action that performs the probe.
    const doctorRequest = ++meetingDoctorRequest.current;
    void window.ipc
      .invoke("meeting:captureDoctor", { probeSystemAudio: false })
      .then((report) => {
        if (meetingDoctorRequest.current === doctorRequest) {
          setMeetingDoctor(report);
          if (report.checks.some((check) => check.status === "fail")) setMeetingsOpen(true);
        }
      })
      .catch(() => {
        if (meetingDoctorRequest.current === doctorRequest) setMeetingDoctor(null);
      });

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
    const offDictationLanguage = window.ipc.on("dictation:languageChanged", ({ language }) => {
      setDictationSettings((current) => (current ? { ...current, language } : current));
    });
    const offFlowBarDock = window.ipc.on("dictation:flowBarDockChanged", ({ dock }) => {
      setDictationSettings((current) => (current ? { ...current, flowBarDock: dock } : current));
    });
    return () => {
      meetingDoctorRequest.current++;
      setMeetingDoctorBusy(false);
      off?.();
      offMeetingModels?.();
      offDictationLanguage?.();
      offFlowBarDock?.();
    };
  }, [dialogOpen, refreshDictationRecovery, refreshDictationStatus, refreshRouting]);

  const requestDictationAccessibility = useCallback(async () => {
    const result = await window.ipc.invoke("dictation:requestAccessibility", null);
    await refreshDictationStatus();
    if (!result.trusted) {
      toast.info("Approve Accessibility for Oppulence in System Settings, then return here.");
    }
  }, [refreshDictationStatus]);

  const openDictationInputMonitoring = useCallback(async () => {
    await window.ipc.invoke("dictation:openInputMonitoring", null);
  }, []);

  const runMeetingPreflight = useCallback(async () => {
    const doctorRequest = ++meetingDoctorRequest.current;
    setMeetingDoctorBusy(true);
    try {
      const report = await window.ipc.invoke("meeting:captureDoctor", { probeSystemAudio: true });
      if (meetingDoctorRequest.current === doctorRequest) setMeetingDoctor(report);
    } catch (err) {
      if (meetingDoctorRequest.current === doctorRequest) {
        toast.error("Meeting preflight failed", {
          description: err instanceof Error ? err.message : undefined,
        });
      }
    } finally {
      if (meetingDoctorRequest.current === doctorRequest) setMeetingDoctorBusy(false);
    }
  }, []);

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
      window.dispatchEvent(new CustomEvent(TRANSCRIPTION_CONFIG_CHANGED_EVENT));
      await refreshRouting();
    },
    [refreshRouting, voiceProvider],
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
      window.dispatchEvent(new CustomEvent(TRANSCRIPTION_CONFIG_CHANGED_EVENT));
      await refreshRouting();
    },
    [meetingProvider, refreshRouting],
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
        await refreshRouting();
      } catch {
        setLocalOnly(previous);
      }
    },
    [localOnly, refreshRouting],
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
        window.dispatchEvent(new CustomEvent(TRANSCRIPTION_CONFIG_CHANGED_EVENT));
        await refreshRouting();
      } catch {
        setMeetings(previous);
      }
    },
    [meetings, refreshRouting],
  );

  const changeRelationships = useCallback(
    async (patch: Partial<RelationshipEvidenceSettings>) => {
      const previous = relationships;
      setRelationships((current) => (current ? { ...current, ...patch } : current));
      try {
        const cfg = await window.ipc.invoke("transcription:setConfig", { relationships: patch });
        setRelationships(cfg.relationships);
        window.dispatchEvent(new CustomEvent(TRANSCRIPTION_CONFIG_CHANGED_EVENT));
      } catch {
        setRelationships(previous);
      }
    },
    [relationships],
  );

  const changeDictationSettings = useCallback(
    async (next: DictationSettings) => {
      const previous = dictationSettings;
      setDictationSettings(next);
      try {
        const config = await window.ipc.invoke("transcription:setConfig", { dictation: next });
        setDictationSettings(config.dictation);
        window.dispatchEvent(new CustomEvent(TRANSCRIPTION_CONFIG_CHANGED_EVENT));
        await refreshDictationStatus();
      } catch (error) {
        setDictationSettings(previous);
        throw error;
      }
    },
    [dictationSettings, refreshDictationStatus],
  );

  const copyLastDictation = useCallback(async () => {
    const result = await window.ipc.invoke("dictation:copyLast", null);
    if (result.success) toast.success("Last transcript copied");
    else toast.error(result.error ?? "No transcript is available yet");
    await refreshDictationRecovery();
  }, [refreshDictationRecovery]);

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
  const meetingIssueCount =
    meetingDoctor?.checks.filter((check) => check.status === "fail").length ?? 0;

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
        title="Desktop dictation"
        description="Speak into whichever app and text field currently has focus."
      >
        <div className="space-y-3 rounded-none border bg-muted/20 px-3.5 py-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-none border bg-card text-muted-foreground">
                <AudioLines className="size-4" />
              </span>
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-foreground">
                  {dictationStatus?.shortcut ?? "Hold Control + Option"} to dictate
                </div>
                <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                  Click a text field in any desktop app, hold the shortcut while speaking, then
                  release it to transcribe and insert the text.
                </p>
              </div>
            </div>
            <Badge variant="outline" className="shrink-0 rounded-[2px] font-normal">
              {dictationStatus?.monitorReady && dictationStatus.accessibilityTrusted
                ? "Ready"
                : "Needs setup"}
            </Badge>
          </div>

          {dictationSettings ? (
            <div className="divide-y border border-border bg-background/60">
              <label className="flex items-center justify-between gap-3 px-3 py-2.5">
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-foreground">Hold shortcut</span>
                  <span className="block text-[11px] leading-5 text-muted-foreground">
                    Fn / Globe matches Wispr’s Mac default; choose Control + Fn for the literal
                    chord.
                  </span>
                </span>
                <select
                  value={dictationSettings.shortcut}
                  onChange={(event) =>
                    void changeDictationSettings({
                      ...dictationSettings,
                      shortcut: event.target.value as DictationShortcut,
                    })
                  }
                  aria-label="Desktop dictation hold shortcut"
                  className="h-8 shrink-0 border bg-background px-2 text-xs text-foreground"
                >
                  {DICTATION_SHORTCUT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center justify-between gap-3 px-3 py-2.5">
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-foreground">
                    Dictation language
                  </span>
                  <span className="block text-[11px] leading-5 text-muted-foreground">
                    Applies to the next capture immediately. Choosing one language improves
                    accuracy.
                  </span>
                </span>
                <select
                  value={dictationSettings.language}
                  onChange={(event) =>
                    void changeDictationSettings({
                      ...dictationSettings,
                      language: event.target.value as DictationLanguage,
                    })
                  }
                  aria-label="Desktop dictation language"
                  className="h-8 max-w-40 shrink-0 border bg-background px-2 text-xs text-foreground"
                >
                  {DICTATION_LANGUAGE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center justify-between gap-3 px-3 py-2.5">
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-foreground">
                    Dictation bar position
                  </span>
                  <span className="block text-[11px] leading-5 text-muted-foreground">
                    Drag the bar while it is visible, or choose an edge here. The position is
                    remembered after restart.
                  </span>
                </span>
                <select
                  value={dictationSettings.flowBarDock}
                  onChange={(event) =>
                    void changeDictationSettings({
                      ...dictationSettings,
                      flowBarDock: event.target.value as DictationFlowBarDock,
                    })
                  }
                  aria-label="Desktop dictation bar position"
                  className="h-8 shrink-0 border bg-background px-2 text-xs text-foreground"
                >
                  {FLOW_BAR_DOCK_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center justify-between gap-3 px-3 py-2.5">
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-foreground">
                    Show dictation dock
                  </span>
                  <span className="block text-[11px] leading-5 text-muted-foreground">
                    Opt in to a compact click-to-dictate button on the selected screen edge between
                    recordings.
                  </span>
                </span>
                <Switch
                  checked={dictationSettings.showFlowBar}
                  onCheckedChange={(showFlowBar) =>
                    void changeDictationSettings({ ...dictationSettings, showFlowBar })
                  }
                  aria-label="Show desktop dictation dock"
                  className="shrink-0"
                />
              </label>
            </div>
          ) : null}

          {dictationSettings ? (
            <DictationMicrophoneSettings
              value={dictationSettings}
              onChange={changeDictationSettings}
            />
          ) : null}

          {dictationStatus?.error ? (
            <p className="border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs leading-5 text-amber-700 dark:text-amber-300">
              {dictationStatus.error}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            {!dictationStatus?.accessibilityTrusted ? (
              <Button type="button" size="sm" onClick={() => void requestDictationAccessibility()}>
                Enable text insertion
              </Button>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                <CircleCheck className="size-3.5" /> Text insertion enabled
              </span>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void openDictationInputMonitoring()}
            >
              Open Input Monitoring
            </Button>
          </div>

          <div className="border border-border bg-background/60 px-3 py-2.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                  <RotateCcw className="size-3.5" /> Last transcript recovery
                </div>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                  {dictationRecovery?.audioAvailable
                    ? `Failed audio saved locally (${Math.max(1, Math.round((dictationRecovery.audioDurationMs ?? 0) / 1_000))} sec). Focus a text field and press Control + Command + R to retry it.`
                    : dictationRecovery?.available
                      ? dictationRecovery.preview
                      : "Your next completed dictation will be kept locally as a one-item safety net."}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!dictationRecovery?.available}
                onClick={() => void copyLastDictation()}
                className="shrink-0"
              >
                <Copy className="mr-1.5 size-3.5" /> Copy last
              </Button>
            </div>
            <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">
              In any text field, press Control + Command + V to paste it again. If automatic paste
              fails, the transcript stays on your clipboard instead of being discarded.
            </p>
            {dictationSettings ? (
              <div className="mt-2 space-y-2 border-t pt-2">
                <label className="flex items-center justify-between gap-3">
                  <span>
                    <span className="block text-[11px] font-medium text-foreground">
                      Transcript history
                    </span>
                    <span className="block text-[10px] leading-4 text-muted-foreground">
                      Stored only on this Mac. Turning storage off deletes existing history.
                    </span>
                  </span>
                  <select
                    value={dictationSettings.historyRetention}
                    onChange={(event) =>
                      void changeDictationSettings({
                        ...dictationSettings,
                        historyRetention: event.target.value as DictationHistoryRetention,
                      })
                    }
                    aria-label="Desktop dictation history retention"
                    className="h-8 shrink-0 border bg-background px-2 text-xs text-foreground"
                  >
                    <option value="forever">Store locally</option>
                    <option value="24-hours">Delete after 24 hours</option>
                    <option value="never">Never store</option>
                  </select>
                </label>
                <label className="flex items-center justify-between gap-3">
                  <span>
                    <span className="block text-[11px] font-medium text-foreground">
                      Save failed audio for retry
                    </span>
                    <span className="block text-[10px] leading-4 text-muted-foreground">
                      One local recording, owner-readable, automatically removed after 14 days.
                    </span>
                  </span>
                  <Switch
                    checked={dictationSettings.retryFailedAudio}
                    onCheckedChange={(retryFailedAudio) =>
                      void changeDictationSettings({ ...dictationSettings, retryFailedAudio })
                    }
                    aria-label="Save failed dictation audio for retry"
                  />
                </label>
              </div>
            ) : null}
          </div>

          {dictationSettings ? (
            <div className="flex items-center justify-between gap-3 border border-border bg-background/60 px-3 py-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                  <Wrench className="size-3.5" /> Voice Command Mode
                  {dictationSettings.commandModeEnabled && dictationStatus?.commandModeReady ? (
                    <Badge variant="outline" className="rounded-[2px] font-normal">
                      {dictationStatus.commandShortcut}
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                  Select text, hold Command + Control + Option, say “make this concise,” “translate
                  to French,” or “turn this into bullets,” then release. Without a selection, ask a
                  question and insert the answer at the cursor.
                </p>
                <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                  Common formatting commands run instantly on-device. Open-ended rewrites use your
                  configured model; Local only blocks cloud transforms.
                </p>
              </div>
              <Switch
                checked={dictationSettings.commandModeEnabled}
                onCheckedChange={(commandModeEnabled) =>
                  void changeDictationSettings({ ...dictationSettings, commandModeEnabled })
                }
                aria-label="Enable voice Command Mode"
              />
            </div>
          ) : null}

          {dictationSettings ? (
            <DictationTransformSettings
              value={dictationSettings}
              onChange={changeDictationSettings}
              shortcutsReady={dictationStatus?.transformShortcutsReady ?? false}
              shortcutError={dictationStatus?.transformShortcutError}
            />
          ) : null}

          {fastModels?.available ? (
            <div className="flex items-center justify-between gap-3 border border-border bg-background/60 px-3 py-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                  Fast local dictation
                  {fastModels.ready ? (
                    <Badge variant="outline" className="rounded-[2px] font-normal">
                      Neural Engine ready
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">
                  {fastModels.ready
                    ? "Uses Parakeet first for lower latency and falls back to Whisper automatically."
                    : modelDownload === null
                      ? "Optional ~600 MB Core ML model. Faster dictation with automatic Whisper fallback."
                      : `Downloading the fast engine… ${Math.round(modelDownload * 100)}%`}
                </p>
              </div>
              {!fastModels.ready ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={modelDownload !== null}
                  onClick={() => void downloadFastModels()}
                  className="shrink-0"
                >
                  {modelDownload !== null ? (
                    <Loader2 className="mr-2 size-3.5 animate-spin" />
                  ) : (
                    <Download className="mr-2 size-3.5" />
                  )}
                  {fastModels.ready ? "Ready" : "Enable fast engine"}
                </Button>
              ) : null}
            </div>
          ) : null}

          <p className="text-[11px] leading-5 text-muted-foreground">
            Auto Cleanup runs locally after transcription. Choose None, Light, Medium, or High to
            control filler removal, self-corrections, spoken formatting, clarity, and brevity.
          </p>

          <p className="text-[11px] leading-5 text-muted-foreground">
            Hands-free: press the selected hold shortcut plus Space, or double-tap the hold
            shortcut. Use it again to finish and insert; Escape cancels. Sessions stop safely at 20
            minutes with a one-minute warning.
          </p>

          <p className="text-[11px] leading-5 text-muted-foreground">
            If macOS blocks the modifier-only shortcut, enable Oppulence under Privacy &amp;
            Security → Input Monitoring. Backup shortcut: press Command + Shift + Space once to
            start and once again to stop.
          </p>
        </div>
      </SettingsSection>

      {dictationSettings ? (
        <DictationPersonalizationSettings
          value={dictationSettings}
          onChange={changeDictationSettings}
        />
      ) : null}

      <SettingsSection
        title="Voice input"
        description="Speech-to-text for the mic and push-to-talk."
      >
        <div className="space-y-2">
          <ProviderOption
            icon={Laptop}
            selected={
              (routing?.voice.effectiveProvider ??
                (localOnly ? "whisper-local" : voiceProvider)) === "whisper-local"
            }
            onSelect={() => changeVoiceProvider("whisper-local")}
            title="On-device (Whisper)"
            hint={
              localOnly && voiceProvider !== "whisper-local"
                ? "Active because local-only overrides the saved cloud preference"
                : "Microphone audio stays on this device · offline · free"
            }
            disabled={capability?.supported === false}
            disabledHint={
              localOnly
                ? "Unavailable on this device while local-only is enabled"
                : "Not supported on this device · choose a cloud provider to transcribe"
            }
          />
          <ProviderOption
            icon={Cloud}
            selected={
              routing?.voice.effectiveProvider === "deepgram" ||
              routing?.voice.effectiveProvider === "solomon"
            }
            onSelect={() => changeVoiceProvider("deepgram")}
            title="Cloud (Deepgram)"
            hint="When selected, microphone audio is sent to Deepgram · live partials"
            disabled={localOnly}
            disabledHint="Unavailable while local-only transcription is enabled"
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

      <Collapsible open={modelsOpen} onOpenChange={setModelsOpen}>
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-muted/10 p-4">
          <div>
            <h3 className="text-sm font-medium text-foreground">On-device models</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {activeModel === "auto"
                ? "Automatically choosing the best installed model."
                : `${activeModel} is selected for local voice input.`}
            </p>
          </div>
          <CollapsibleTrigger asChild>
            <Button type="button" size="sm" variant="outline">
              {modelsOpen ? "Hide model controls" : "Manage models"}
            </Button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent className="mt-5">
          <SettingsSection
            title="Model downloads and performance"
            description="Download, verify, repair, or benchmark Whisper models used offline."
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
                    Benchmark: {visibleBenchmarkResult.model} ·{" "}
                    {visibleBenchmarkResult.rtf.toFixed(1)}x RTF
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
                    aria-hidden="true"
                    className={cn(
                      "flex size-3.5 shrink-0 items-center justify-center rounded-full border",
                      activeModel === "auto" ? "border-primary" : "border-muted-foreground/40",
                    )}
                  >
                    {activeModel === "auto" && (
                      <span className="size-1.5 rounded-full bg-primary" />
                    )}
                  </span>
                  <span className={cn("truncate", activeModel === "auto" && "font-medium")}>
                    Auto
                  </span>
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
                      <span className="tabular-nums text-xs text-muted-foreground">
                        {m.sizeMb} MB
                      </span>
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
                          <span className="tabular-nums text-xs">
                            {Math.round((pct ?? 0) * 100)}%
                          </span>
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
        </CollapsibleContent>
      </Collapsible>

      <Collapsible open={meetingsOpen} onOpenChange={setMeetingsOpen}>
        <div
          className={cn(
            "flex items-center justify-between gap-4 rounded-2xl border p-4",
            meetingIssueCount ? "border-amber-500/35 bg-amber-500/5" : "border-border bg-muted/10",
          )}
        >
          <div>
            <h3 className="text-sm font-medium text-foreground">Meeting capture and evidence</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {meetingIssueCount
                ? `${meetingIssueCount} capture issue${meetingIssueCount === 1 ? "" : "s"} need attention.`
                : resolvedEngine === "native"
                  ? "Two-track capture is on-device; review evidence and automation separately."
                  : "Review meeting transcription, recording, and evidence publication."}
            </p>
          </div>
          <CollapsibleTrigger asChild>
            <Button type="button" size="sm" variant={meetingIssueCount ? "default" : "outline"}>
              {meetingsOpen
                ? "Hide meeting controls"
                : meetingIssueCount
                  ? "Fix capture"
                  : "Configure meetings"}
            </Button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent className="mt-5 space-y-8">
          <SettingsSection
            title="Meetings"
            description={
              resolvedEngine === "native"
                ? "The active two-track capture route is transcribed on-device."
                : "Choose where microphone and available system audio are transcribed."
            }
          >
            {resolvedEngine === "native" ? (
              <div className="space-y-2">
                <ProviderOption
                  icon={Laptop}
                  selected
                  onSelect={() => {}}
                  title={`On-device (${meetings?.transcriptionEngine === "parakeet" ? "Parakeet" : "Whisper"})`}
                  hint="Active for native two-track capture · meeting audio does not leave this device"
                  disabled
                  disabledHint="Active for native two-track capture · meeting audio does not leave this device"
                />
                {meetingProvider === "deepgram" || meetingProvider === "solomon" ? (
                  <p className="px-1 text-xs leading-5 text-muted-foreground">
                    Your cloud preference is saved for the renderer fallback. Turn off two-track
                    capture below if you want meeting audio sent to Deepgram.
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="space-y-2">
                <ProviderOption
                  icon={Cloud}
                  selected={
                    routing?.meeting.effectiveProvider === "deepgram" ||
                    routing?.meeting.effectiveProvider === "solomon"
                  }
                  onSelect={() => changeMeetingProvider("deepgram")}
                  title="Cloud (Deepgram)"
                  hint="When selected, microphone and system audio are sent to Deepgram · cloud speaker labels"
                  disabled={localOnly}
                  disabledHint="Unavailable while local-only transcription is enabled"
                />
                <ProviderOption
                  icon={Laptop}
                  selected={routing?.meeting.effectiveProvider === "whisper-local"}
                  onSelect={() => changeMeetingProvider("whisper-local")}
                  title="On-device (Whisper)"
                  hint={
                    localOnly && meetingProvider !== "whisper-local"
                      ? "Active because local-only overrides the saved cloud preference"
                      : "Audio stays on this device · channel labels distinguish You and Other"
                  }
                  disabled={capability?.supported === false}
                  disabledHint={
                    localOnly
                      ? "Unavailable on this device while local-only is enabled"
                      : "Not supported on this device · choose cloud to transcribe meetings"
                  }
                />
              </div>
            )}
          </SettingsSection>

          {relationships && (
            <SettingsSection
              title="Relationship evidence"
              description="Each switch sends something different. Nothing here is on unless you turn it on, and turning one on never implies another."
            >
              <div className="space-y-2">
                <SettingToggle
                  title="Meeting transcripts"
                  hint={
                    relationships.meetingTranscripts
                      ? "Resolved counterparty identity, finished 1:1 transcript text, and human-confirmed commitments are sent to Oppulence relationship state. Meeting audio and local file paths are never sent."
                      : "Off · transcripts and confirmed commitments stay in your local workspace"
                  }
                  value={relationships.meetingTranscripts}
                  onChange={(next) => void changeRelationships({ meetingTranscripts: next })}
                />
                <SettingToggle
                  title="Meeting attendance"
                  hint={
                    relationships.meetingAttendance
                      ? "Names and addresses of external invitees from the calendar are sent — for group meetings as well as 1:1s, and for meetings you did not record. No transcript text. People who declined, and meetings with only colleagues, are never sent."
                      : "Off · who attended stays on this device, and group meetings publish nothing"
                  }
                  value={relationships.meetingAttendance}
                  onChange={(next) => void changeRelationships({ meetingAttendance: next })}
                />
                <SettingToggle
                  title="Email metadata"
                  hint={
                    relationships.emailMetadata
                      ? "Who was on a thread, in which direction, how many messages and when. Subjects, bodies, and attachments are never sent. Newsletters and threads you never replied to are skipped."
                      : "Off · no email information leaves this device"
                  }
                  value={relationships.emailMetadata}
                  onChange={(next) => void changeRelationships({ emailMetadata: next })}
                />
                <SettingToggle
                  title="Signature enrichment"
                  hint={
                    relationships.signatureEnrichment
                      ? "Job titles and organizations parsed from senders' own signature blocks are attached to their contact record. Phone numbers are parsed but never sent."
                      : "Off · contacts carry only the name and address you already had"
                  }
                  value={relationships.signatureEnrichment}
                  onChange={(next) => void changeRelationships({ signatureEnrichment: next })}
                />
                <SettingToggle
                  title="Model-assisted contacts"
                  hint={
                    !relationships.signatureEnrichment
                      ? "Turn on signature enrichment first · this is the fallback for when it finds nothing"
                      : relationships.modelContactExtraction
                        ? "When signature parsing finds nothing, a model reads the message to infer a title or organization. Its answer never outranks a parsed signature."
                        : "Off · only deterministic signature parsing is used"
                  }
                  value={relationships.modelContactExtraction}
                  onChange={(next) => void changeRelationships({ modelContactExtraction: next })}
                  disabled={!relationships.signatureEnrichment}
                />
              </div>
            </SettingsSection>
          )}

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
                <AudioPreflightPanel
                  report={meetingDoctor}
                  busy={meetingDoctorBusy}
                  onRun={() => void runMeetingPreflight()}
                  onTestTracks={() => setMeetingCaptureCheckOpen(true)}
                />
                <SettingToggle
                  title="Two-track capture"
                  hint={
                    resolvedEngine === "native"
                      ? "Recommended · survives closing the window, and both sides are transcribed separately"
                      : fastModels?.available
                        ? "Off · enable to use crash-resilient, on-device two-track capture"
                        : "Unavailable on this device"
                  }
                  value={meetings.captureEngine !== "renderer"}
                  disabled={fastModels?.available !== true}
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
                    {meetings.transcriptionEngine === "parakeet" &&
                      fastModels &&
                      !fastModels.ready && (
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
                      title="Suggest commitments after a meeting"
                      hint="Pulls out what people said they would do, for you to confirm or dismiss. Nothing is saved until you confirm it."
                      value={meetings.extractCommitments !== false}
                      onChange={(next) => void changeMeetings({ extractCommitments: next })}
                    />
                    <SettingToggle
                      title="Live transcript while recording"
                      hint="Transcribes in the background during the call so you can read along and ask questions mid-meeting. Off by default: it is a second transcription pass running on a machine already busy with the call."
                      value={meetings.liveTranscript === true}
                      onChange={(next) => void changeMeetings({ liveTranscript: next })}
                    />
                    <div className="border border-border px-3.5 py-3">
                      <p className="text-sm font-medium">Live coaching cues</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Quiet, source-linked question prompts detected locally from the live
                        transcript. Off by default.
                      </p>
                      <div className="mt-2.5 flex gap-4">
                        {(["off", "minimal", "standard"] as const).map((value) => (
                          <label
                            key={value}
                            className="flex cursor-pointer items-center gap-1.5 text-sm capitalize"
                          >
                            <input
                              type="radio"
                              name="meeting-live-coaching"
                              checked={(meetings.liveCoachingFrequency ?? "off") === value}
                              onChange={() => void changeMeetings({ liveCoachingFrequency: value })}
                            />
                            {value}
                          </label>
                        ))}
                      </div>
                    </div>
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
              <MeetingCaptureCheck
                open={meetingCaptureCheckOpen}
                onOpenChange={setMeetingCaptureCheckOpen}
              />
            </SettingsSection>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function AudioPreflightPanel({
  report,
  busy,
  onRun,
  onTestTracks,
}: {
  report: MeetingDoctorReport | null;
  busy: boolean;
  onRun: () => void;
  onTestTracks: () => void;
}) {
  const failures = report?.checks.filter((check) => check.status === "fail") ?? [];
  const warnings = report?.checks.filter((check) => check.status === "warn") ?? [];
  const needsAttention = report !== null && (!report.ok || failures.length > 0);
  const ready = report?.ok === true && failures.length === 0 && warnings.length === 0;
  const summary = !report
    ? "Checking microphone, capture helper, and storage…"
    : needsAttention
      ? failures.length > 0
        ? `${failures.length} issue${failures.length === 1 ? "" : "s"} need attention`
        : "Audio preflight needs attention"
      : warnings.length > 0
        ? `Ready with ${warnings.length} warning${warnings.length === 1 ? "" : "s"}`
        : "Microphone, capture helper, and storage are ready";

  return (
    <div className="border border-border bg-muted/20 px-3.5 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            className={cn(
              "mt-0.5 flex size-8 shrink-0 items-center justify-center border bg-card",
              ready && "text-emerald-600 dark:text-emerald-400",
              needsAttention && "text-destructive",
            )}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <AudioLines className="size-4" />}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">Audio preflight</p>
              {report && (
                <Badge variant={needsAttention ? "destructive" : "secondary"}>
                  {needsAttention
                    ? "Needs attention"
                    : warnings.length > 0
                      ? "Check warnings"
                      : "Ready"}
                </Badge>
              )}
            </div>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{summary}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onRun}>
            {busy ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
            Check permissions
          </Button>
          <Button type="button" size="sm" onClick={onTestTracks}>
            Test both tracks
          </Button>
        </div>
      </div>
      {report && report.checks.length > 0 && (
        <div className="mt-3 grid gap-1.5 border-t border-border/60 pt-3 sm:grid-cols-2">
          {report.checks.map((check) => (
            <div key={check.name} className="flex min-w-0 items-start gap-2 text-xs">
              <span
                aria-hidden="true"
                className={cn(
                  "mt-1 size-1.5 shrink-0 rounded-full",
                  check.status === "ok" && "bg-emerald-500",
                  check.status === "warn" && "bg-amber-500",
                  check.status === "fail" && "bg-destructive",
                )}
              />
              <span className="min-w-0">
                <span className="sr-only">{check.status}: </span>
                <span className="font-medium text-foreground">{check.name}</span>
                <span className="block text-muted-foreground">{check.detail}</span>
                {check.remediation && check.status !== "ok" && (
                  <span className="block text-muted-foreground">Fix: {check.remediation}</span>
                )}
              </span>
            </div>
          ))}
        </div>
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
  disabledHint,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ElementType;
  title: string;
  hint: string;
  disabled?: boolean;
  disabledHint?: string;
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
          {disabled ? (disabledHint ?? hint) : hint}
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
