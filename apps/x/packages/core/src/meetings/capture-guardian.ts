import type {
  CaptureHealthEvent,
  CaptureHealthKind,
  CaptureHealthSnapshot,
  MeetingTrackId,
} from "@x/shared/meetings";
import { createHash } from "node:crypto";

export interface CaptureGuardianTrackInput {
  id: MeetingTrackId;
  frames: number;
  peak: number;
  permission: "granted" | "denied" | "unknown";
}

export interface CaptureGuardianInput {
  sessionId: string;
  nowMs: number;
  recordingStartedAtMs: number;
  expectedTracks: MeetingTrackId[];
  tracks: CaptureGuardianTrackInput[];
  sidecarHeartbeatAtMs: number;
  sidecarRunning: boolean;
  availableDiskBytes?: number;
  observedBytesPerSecond?: number;
  projectedRemainingSeconds?: number;
  modelReady: boolean;
  liveTranscriptionEnabled: boolean;
  liveProgressAtMs?: number;
  postTranscriptionStartedAtMs?: number;
  postTranscriptionProgressAtMs?: number;
}

const DETECTION_MS = 15_000;
const SILENT_DETECTION_MS = 60_000;
const LIVE_STALE_MS = 30_000;
const POST_STUCK_MS = 5 * 60_000;
const DISK_FLOOR_BYTES = 512 * 1024 * 1024;

function eventId(sessionId: string, kind: CaptureHealthKind, severity: string): string {
  return `capture-health:${createHash("sha256")
    .update(`${sessionId}:${kind}:${severity}`)
    .digest("hex")
    .slice(0, 24)}`;
}

const COPY: Record<CaptureHealthKind, { impact: string; remediation: string }> = {
  microphone_missing: {
    impact: "Your side of the conversation is not being captured.",
    remediation: "Restore microphone permission or continue with system audio only.",
  },
  microphone_silent: {
    impact: "The microphone track is advancing but contains no audible signal.",
    remediation: "Check the selected microphone and its mute state.",
  },
  microphone_stalled: {
    impact: "The microphone track stopped advancing while capture continues.",
    remediation: "Reopen the microphone track or preserve and continue with system audio.",
  },
  system_track_missing: {
    impact: "Other participants may not be captured.",
    remediation: "Restore system-audio permission or continue with the microphone caveat.",
  },
  system_track_silent: {
    impact: "System audio is advancing but contains no audible signal.",
    remediation: "Confirm the meeting is playing through a capturable output device.",
  },
  system_track_stalled: {
    impact: "System audio stopped advancing while the microphone continues.",
    remediation: "Reopen the system track and preserve the microphone recording.",
  },
  sidecar_stalled: {
    impact: "The recorder stopped reporting progress and evidence may be incomplete.",
    remediation: "Preserve partial audio, restart the recorder, and continue the meeting.",
  },
  sidecar_crashed: {
    impact: "The recorder exited unexpectedly.",
    remediation: "Preserve partial audio and restart capture with the surviving path.",
  },
  disk_pressure: {
    impact: "Capture may stop before the meeting ends.",
    remediation: "Free space or relocate the recordings directory.",
  },
  model_unavailable: {
    impact: "On-device transcription cannot start with the selected model.",
    remediation: "Install the model or use the permitted fallback transcriber.",
  },
  live_transcription_stale: {
    impact: "Live notes are not keeping up, but the durable audio capture continues.",
    remediation: "Continue recording and use the post-meeting transcription pass.",
  },
  post_transcription_stuck: {
    impact: "The recording is safe but its transcript is not progressing.",
    remediation: "Retry the queue job or switch to the permitted fallback transcriber.",
  },
};

/** Deterministic, clock-injected guardian used by the single MeetingController. */
export class MeetingCaptureGuardian {
  private readonly timeline: CaptureHealthEvent[] = [];
  private readonly active = new Map<CaptureHealthKind, CaptureHealthEvent>();
  private previousTracks = new Map<
    MeetingTrackId,
    { frames: number; changedAtMs: number; audibleAtMs: number }
  >();

  reset(): void {
    this.timeline.length = 0;
    this.active.clear();
    this.previousTracks.clear();
  }

  evaluate(input: CaptureGuardianInput): CaptureHealthSnapshot {
    const graceElapsed = input.nowMs - input.recordingStartedAtMs >= DETECTION_MS;
    const detected = new Map<
      CaptureHealthKind,
      {
        severity: "warning" | "critical";
        trackId?: MeetingTrackId;
        diagnostics: Record<string, string | number | boolean>;
      }
    >();
    const trackById = new Map(input.tracks.map((track) => [track.id, track]));

    for (const expected of input.expectedTracks) {
      const track = trackById.get(expected);
      if (!track && graceElapsed) {
        detected.set(expected === "mic" ? "microphone_missing" : "system_track_missing", {
          severity: "critical",
          trackId: expected,
          diagnostics: { expected: true },
        });
        continue;
      }
      if (!track) continue;
      const previous = this.previousTracks.get(expected) ?? {
        frames: track.frames,
        changedAtMs: input.recordingStartedAtMs,
        audibleAtMs: input.recordingStartedAtMs,
      };
      const changedAtMs = track.frames > previous.frames ? input.nowMs : previous.changedAtMs;
      const audibleAtMs = track.peak > 0.005 ? input.nowMs : previous.audibleAtMs;
      this.previousTracks.set(expected, { frames: track.frames, changedAtMs, audibleAtMs });
      if (track.permission === "denied") {
        detected.set(expected === "mic" ? "microphone_missing" : "system_track_missing", {
          severity: "critical",
          trackId: expected,
          diagnostics: { permission: "denied" },
        });
      } else if (graceElapsed && input.nowMs - changedAtMs >= DETECTION_MS) {
        detected.set(expected === "mic" ? "microphone_stalled" : "system_track_stalled", {
          severity: "critical",
          trackId: expected,
          diagnostics: { frames: track.frames, stalledMs: input.nowMs - changedAtMs },
        });
      } else if (graceElapsed && input.nowMs - audibleAtMs >= SILENT_DETECTION_MS) {
        detected.set(expected === "mic" ? "microphone_silent" : "system_track_silent", {
          severity: "warning",
          trackId: expected,
          diagnostics: { frames: track.frames, silentMs: input.nowMs - audibleAtMs },
        });
      }
    }

    if (!input.sidecarRunning) {
      detected.set("sidecar_crashed", { severity: "critical", diagnostics: {} });
    } else if (graceElapsed && input.nowMs - input.sidecarHeartbeatAtMs >= DETECTION_MS) {
      detected.set("sidecar_stalled", {
        severity: "critical",
        diagnostics: { heartbeatAgeMs: input.nowMs - input.sidecarHeartbeatAtMs },
      });
    }
    if (input.availableDiskBytes !== undefined) {
      const projected =
        (input.observedBytesPerSecond ?? 0) * (input.projectedRemainingSeconds ?? 0);
      if (input.availableDiskBytes < Math.max(DISK_FLOOR_BYTES, projected * 1.25)) {
        detected.set("disk_pressure", {
          severity: "critical",
          diagnostics: {
            availableDiskBytes: input.availableDiskBytes,
            projectedRequiredBytes: Math.ceil(projected * 1.25),
          },
        });
      }
    }
    if (!input.modelReady) {
      detected.set("model_unavailable", { severity: "warning", diagnostics: {} });
    }
    if (
      input.liveTranscriptionEnabled &&
      input.liveProgressAtMs !== undefined &&
      input.nowMs - input.liveProgressAtMs >= LIVE_STALE_MS
    ) {
      detected.set("live_transcription_stale", {
        severity: "warning",
        diagnostics: { progressAgeMs: input.nowMs - input.liveProgressAtMs },
      });
    }
    if (
      input.postTranscriptionStartedAtMs !== undefined &&
      input.nowMs - (input.postTranscriptionProgressAtMs ?? input.postTranscriptionStartedAtMs) >=
        POST_STUCK_MS
    ) {
      detected.set("post_transcription_stuck", {
        severity: "warning",
        diagnostics: {
          progressAgeMs:
            input.nowMs -
            (input.postTranscriptionProgressAtMs ?? input.postTranscriptionStartedAtMs),
        },
      });
    }

    for (const [kind, details] of detected) {
      if (this.active.has(kind)) continue;
      const copy = COPY[kind];
      const event: CaptureHealthEvent = {
        eventId: eventId(input.sessionId, kind, details.severity),
        sessionId: input.sessionId,
        kind,
        severity: details.severity,
        detectedAt: new Date(input.nowMs).toISOString(),
        impact: copy.impact,
        remediation: copy.remediation,
        ...(details.trackId ? { trackId: details.trackId } : {}),
        redactedDiagnostics: details.diagnostics,
      };
      this.active.set(kind, event);
      this.timeline.push(event);
    }
    for (const [kind, active] of [...this.active]) {
      if (detected.has(kind)) continue;
      const recovered: CaptureHealthEvent = {
        ...active,
        eventId: eventId(input.sessionId, kind, "recovered"),
        severity: "recovered",
        detectedAt: new Date(input.nowMs).toISOString(),
        impact: `${COPY[kind].impact} Recovery was detected.`,
        redactedDiagnostics: {},
      };
      this.active.delete(kind);
      this.timeline.push(recovered);
    }
    const activeEvents = [...this.active.values()];
    return {
      guardianVersion: "capture-guardian-v1",
      status: activeEvents.some((event) => event.severity === "critical")
        ? "critical"
        : activeEvents.length > 0
          ? "warning"
          : "healthy",
      activeEvents,
      timeline: [...this.timeline],
      lastCheckedAt: new Date(input.nowMs).toISOString(),
    };
  }
}
