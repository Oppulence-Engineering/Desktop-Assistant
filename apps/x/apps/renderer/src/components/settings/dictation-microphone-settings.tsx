import { useCallback, useEffect, useMemo, useState } from "react";

import { ArrowDown, ArrowUp, Mic, Plus, RefreshCw, Trash2 } from "@/lib/icons";
import { Badge } from "@oppulence/ui/components/badge";
import { Button } from "@oppulence/ui/components/button";
import type {
  DictationMicrophonePreference,
  DictationSettings,
} from "@x/shared/transcription";
import { toast } from "sonner";

interface Props {
  value: DictationSettings;
  onChange: (next: DictationSettings) => Promise<void>;
}

interface AvailableMicrophone {
  deviceId: string;
  label: string;
}

function physicalMicrophones(devices: MediaDeviceInfo[]): AvailableMicrophone[] {
  const seen = new Set<string>();
  let unnamed = 0;
  return devices.flatMap((device) => {
    if (
      device.kind !== "audioinput" ||
      !device.deviceId ||
      device.deviceId === "default" ||
      device.deviceId === "communications" ||
      seen.has(device.deviceId)
    ) {
      return [];
    }
    seen.add(device.deviceId);
    unnamed += 1;
    return [{ deviceId: device.deviceId, label: device.label.trim() || `Microphone ${unnamed}` }];
  });
}

export function DictationMicrophoneSettings({ value, onChange }: Props) {
  const [available, setAvailable] = useState<AvailableMicrophone[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (!navigator.mediaDevices?.enumerateDevices) {
        setAvailable([]);
        return;
      }
      setAvailable(physicalMicrophones(await navigator.mediaDevices.enumerateDevices()));
    } catch {
      setAvailable([]);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (!navigator.mediaDevices?.addEventListener) return;
    const handleDeviceChange = () => void refresh();
    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
  }, [refresh]);

  const availableById = useMemo(
    () => new Map(available.map((microphone) => [microphone.deviceId, microphone] as const)),
    [available],
  );
  const rankedIds = useMemo(
    () => new Set(value.microphonePriority.map((microphone) => microphone.deviceId)),
    [value.microphonePriority],
  );
  const unranked = available.filter((microphone) => !rankedIds.has(microphone.deviceId));

  const persist = async (microphonePriority: DictationMicrophonePreference[], message?: string) => {
    setSaving(true);
    try {
      await onChange({ ...value, microphonePriority });
      if (message) toast.success(message);
    } catch {
      toast.error("Could not save microphone priority");
    } finally {
      setSaving(false);
    }
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= value.microphonePriority.length) return;
    const next = [...value.microphonePriority];
    [next[index], next[target]] = [next[target], next[index]];
    void persist(next);
  };

  return (
    <div className="border border-border bg-background/60 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <Mic className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div>
            <div className="text-xs font-medium text-foreground">Automatic microphone priority</div>
            <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">
              The highest available device wins. Reconnecting a ranked mic promotes it immediately;
              disconnecting falls through without ending dictation.
            </p>
          </div>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-7 shrink-0"
          disabled={refreshing}
          onClick={() => void refresh()}
          aria-label="Refresh available microphones"
          title="Refresh available microphones"
        >
          <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {value.microphonePriority.length ? (
        <div className="mt-3 divide-y border border-border">
          {value.microphonePriority.map((microphone, index) => {
            const connected = availableById.get(microphone.deviceId);
            const label = connected?.label ?? microphone.label;
            return (
              <div key={microphone.deviceId} className="flex items-center gap-2 px-2.5 py-2">
                <span className="w-5 shrink-0 text-center text-[11px] font-medium tabular-nums text-muted-foreground">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-foreground">{label}</span>
                <Badge variant="outline" className="shrink-0 rounded-[2px] text-[9px] font-normal">
                  {connected ? "Available" : "Disconnected"}
                </Badge>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  disabled={saving || index === 0}
                  onClick={() => move(index, -1)}
                  aria-label={`Move ${label} up`}
                >
                  <ArrowUp className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  disabled={saving || index === value.microphonePriority.length - 1}
                  onClick={() => move(index, 1)}
                  aria-label={`Move ${label} down`}
                >
                  <ArrowDown className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  disabled={saving}
                  onClick={() =>
                    void persist(
                      value.microphonePriority.filter(
                        (candidate) => candidate.deviceId !== microphone.deviceId,
                      ),
                      "Microphone forgotten",
                    )
                  }
                  aria-label={`Forget ${label}`}
                  title="Forget microphone"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-3 border border-dashed border-border px-3 py-2 text-[11px] text-muted-foreground">
          No ranked microphones. Oppulence follows the macOS system default.
        </p>
      )}

      {unranked.length ? (
        <div className="mt-3">
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Available to add
          </div>
          <div className="divide-y border border-border">
            {unranked.map((microphone) => (
              <div key={microphone.deviceId} className="flex items-center gap-2 px-2.5 py-2">
                <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                  {microphone.label}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={saving || value.microphonePriority.length >= 32}
                  onClick={() =>
                    void persist(
                      [...value.microphonePriority, microphone],
                      "Microphone added to priority",
                    )
                  }
                >
                  <Plus className="mr-1 size-3.5" /> Add
                </Button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
        The macOS default remains the final fallback. Device identities and labels stay on this Mac.
      </p>
    </div>
  );
}
