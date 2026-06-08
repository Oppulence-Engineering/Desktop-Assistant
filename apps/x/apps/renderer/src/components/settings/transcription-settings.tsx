import { useEffect, useState, useCallback } from "react";
import { AudioLines, Download, CircleCheck, Trash2 } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import * as analytics from "@/lib/analytics";
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
    void refreshModels();
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
  }, [dialogOpen, refreshModels]);

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
    <section className="space-y-8">
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Voice input</h3>
        <ProviderRow
          selected={voiceProvider === "whisper-local"}
          onSelect={() => changeVoiceProvider("whisper-local")}
          title="On-device (Whisper)"
          hint="private · offline · free"
        />
        <ProviderRow
          selected={voiceProvider === "deepgram"}
          onSelect={() => changeVoiceProvider("deepgram")}
          title="Cloud (Deepgram)"
          hint="most accurate · live partials"
        />
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          <AudioLines className="size-3.5" /> {accelLabel}
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Models</h3>
        <ul className="divide-y rounded-md border">
          {models.map((m) => {
            const pct = progress[m.id];
            const downloading = pct != null && !m.installed;
            return (
              <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <button
                  type="button"
                  className="flex flex-1 items-center gap-2 text-left"
                  onClick={() => m.installed && selectModel(m.id)}
                  disabled={!m.installed}
                >
                  <span className={activeModel === m.id ? "font-medium" : ""}>
                    {m.label}
                    {m.recommended ? " · recommended" : ""}
                    {activeModel === m.id ? " · active" : ""}
                  </span>
                </button>
                <span className="flex items-center gap-2 text-muted-foreground">
                  <span className="tabular-nums">{m.sizeMb} MB</span>
                  {m.installed ? (
                    <CircleCheck className="size-4 text-foreground" />
                  ) : downloading ? (
                    <span className="flex items-center gap-2">
                      <Progress value={Math.round((pct ?? 0) * 100)} className="h-1.5 w-20" />
                      <span className="tabular-nums">{Math.round((pct ?? 0) * 100)}%</span>
                    </span>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => download(m.id, m.sizeMb)}>
                      <Download className="size-4" /> Get
                    </Button>
                  )}
                  {m.installed && !m.recommended && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove ${m.label}`}
                      onClick={() => removeModel(m.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Meetings</h3>
        <ProviderRow
          selected={meetingProvider === "deepgram" || meetingProvider === "solomon"}
          onSelect={() => changeMeetingProvider("deepgram")}
          title="Cloud (Deepgram)"
          hint="speaker labels · system audio"
        />
        <ProviderRow
          selected={meetingProvider === "whisper-local"}
          onSelect={() => changeMeetingProvider("whisper-local")}
          title="On-device"
          hint="private · no speaker labels"
        />
      </div>
    </section>
  );
}

function ProviderRow({
  selected,
  onSelect,
  title,
  hint,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50 data-[selected=true]:border-foreground/40 data-[selected=true]:bg-muted/40"
      data-selected={selected}
      aria-pressed={selected}
    >
      <span
        className="flex size-4 shrink-0 items-center justify-center rounded-full border"
        aria-hidden
      >
        {selected && <span className="size-2 rounded-full bg-foreground" />}
      </span>
      <span className="flex flex-1 items-center justify-between">
        <span className="font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}
