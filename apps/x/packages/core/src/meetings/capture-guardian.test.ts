import { describe, expect, it } from "vitest";
import { MeetingCaptureGuardian, type CaptureGuardianInput } from "./capture-guardian.js";

const base = (nowMs: number): CaptureGuardianInput => ({
  sessionId: "session-1",
  nowMs,
  recordingStartedAtMs: 0,
  expectedTracks: ["mic", "system"],
  tracks: [
    { id: "mic", frames: nowMs, peak: 0.2, permission: "granted" },
    { id: "system", frames: nowMs, peak: 0.2, permission: "granted" },
  ],
  sidecarHeartbeatAtMs: nowMs,
  sidecarRunning: true,
  availableDiskBytes: 10 * 1024 * 1024 * 1024,
  observedBytesPerSecond: 200_000,
  projectedRemainingSeconds: 3600,
  modelReady: true,
  liveTranscriptionEnabled: false,
});

describe("meeting capture reliability guardian", () => {
  it("detects one-track stalls within the target while preserving the healthy track", () => {
    const guardian = new MeetingCaptureGuardian();
    guardian.evaluate(base(1_000));
    const first = base(16_001);
    first.tracks[1].frames = 1_000;
    const snapshot = guardian.evaluate(first);
    expect(snapshot.activeEvents).toEqual([
      expect.objectContaining({ kind: "system_track_stalled", severity: "critical" }),
    ]);
    expect(snapshot.activeEvents.some((event) => event.kind === "microphone_stalled")).toBe(false);

    const recovered = base(17_000);
    const next = guardian.evaluate(recovered);
    expect(next.status).toBe("healthy");
    expect(next.timeline.at(-1)).toMatchObject({
      kind: "system_track_stalled",
      severity: "recovered",
    });
  });

  it("distinguishes advancing silence, sidecar failure, disk pressure, and queue stalls", () => {
    const guardian = new MeetingCaptureGuardian();
    guardian.evaluate(base(1_000));
    const input = base(6 * 60_000);
    input.tracks[0].peak = 0;
    input.sidecarRunning = false;
    input.availableDiskBytes = 100;
    input.postTranscriptionStartedAtMs = 1;
    input.postTranscriptionProgressAtMs = 1;
    const snapshot = guardian.evaluate(input);
    expect(snapshot.activeEvents.map((event) => event.kind)).toEqual(
      expect.arrayContaining([
        "microphone_silent",
        "sidecar_crashed",
        "disk_pressure",
        "post_transcription_stuck",
      ]),
    );
    expect(
      snapshot.timeline.every(
        (event) =>
          !("exactQuote" in event.redactedDiagnostics) &&
          Object.values(event.redactedDiagnostics).every((value) =>
            ["string", "number", "boolean"].includes(typeof value),
          ),
      ),
    ).toBe(true);
  });

  it("does not label an ordinary pause as a silent-track failure", () => {
    const guardian = new MeetingCaptureGuardian();
    guardian.evaluate(base(1_000));
    const paused = base(30_000);
    paused.tracks[1].peak = 0;
    const snapshot = guardian.evaluate(paused);
    expect(snapshot.activeEvents.some((event) => event.kind === "system_track_silent")).toBe(
      false,
    );
  });
});
