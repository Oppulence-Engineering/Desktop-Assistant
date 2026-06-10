import { useEffect, useState, useCallback } from "react";
import { Download, CircleCheck, Trash2, Check, Laptop, Cloud, Loader2 } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import * as analytics from "@/lib/analytics";
import { SettingsSection } from "./settings-ui";
import type {
  WhisperModelSummary,
  WhisperCapability,
  TranscriptionProvider,
} from "@x/shared/dist/transcription.js";

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
  const [activeModel, setActiveModel] = useState<string>("base.en-q5_1");
  // Per-model download progress in [0, 1]; absent until a download starts.
  const [progress, setProgress] = useState<Record<string, number>>({});

  const refreshModels = useCallback(async () => {
    const result = await window.ipc.invoke("whisper:listModels", null);
    setModels(result.models);
  }, []);

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
        setActiveModel(cfg.whisper.model);
      })
      .catch(() => {});

    const off = window.ipc.on("whisper:modelProgress", (p) => {
      setProgress((prev) => ({ ...prev, [p.id]: p.totalMb ? p.receivedMb / p.totalMb : 0 }));
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

  const selectModel = useCallback(async (id: string) => {
    setActiveModel(id);
    await window.ipc.invoke("transcription:setConfig", { model: id });
  }, []);

  const download = useCallback(
    async (id: string, sizeMb: number) => {
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
        await refreshModels();
      }
    },
    [refreshModels],
  );

  const removeModel = useCallback(
    async (id: string) => {
      await window.ipc.invoke("whisper:removeModel", { id });
      await refreshModels();
    },
    [refreshModels],
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

  return (
    <div className="space-y-8">
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
      </SettingsSection>

      <SettingsSection
        title="On-device models"
        description="Whisper models for on-device transcription — download once, then used offline."
      >
        <div className="overflow-hidden rounded-none border">
          {models.map((m, i) => {
            const pct = progress[m.id];
            const downloading = pct != null && !m.installed;
            const active = activeModel === m.id;
            return (
              <div
                key={m.id}
                className={cn(
                  "flex items-center gap-3 px-3.5 py-2.5 text-sm transition-colors",
                  i > 0 && "border-t",
                  active && "bg-primary/[0.04]",
                  m.installed && !active && "hover:bg-muted/20",
                )}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left disabled:cursor-default"
                  onClick={() => m.installed && selectModel(m.id)}
                  disabled={!m.installed}
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
                    <span className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                      <CircleCheck className="size-4" />
                      Installed
                    </span>
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
