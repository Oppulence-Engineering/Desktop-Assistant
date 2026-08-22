import * as fs from "node:fs/promises";
import type { MeetingDoctorCheck, MeetingPreflightReport } from "@x/shared/meetings";
import { getTranscriptionConfig } from "@x/core/voice/voice";
import { recordingsRoot } from "@x/core/meetings/meetings";
import { runCaptureDoctor, osSupportsNativeCapture } from "./meeting-capture.js";
import { parakeetModelStatus } from "./meeting-engines.js";

/**
 * Is this machine ready to record the meeting that is about to start?
 *
 * The app has had a "check your setup" surface since native capture landed, but it only
 * answers when someone goes looking — which is never, because nobody audits their audio
 * stack before a call. The failure this prevents is specific and total: you record an
 * hour, and the other side is silent because screen-recording permission was revoked by
 * an OS update three weeks ago.
 *
 * So it runs on its own, shortly before a meeting, and — this is the whole design — says
 * nothing at all when everything is fine. A preflight that pings you before every meeting
 * to say "all good" is a preflight you turn off, and then it cannot warn you about the
 * one that matters.
 */

/**
 * Two tracks of 16 kHz mono 16-bit PCM is ~230 MB/hour, and a meeting can run long.
 * Below this there is a real chance of a recording that stops partway.
 */
const MIN_FREE_BYTES = 500 * 1024 * 1024;

export type MeetingPreflight = MeetingPreflightReport;

async function freeSpaceCheck(dir: string): Promise<MeetingDoctorCheck | null> {
  try {
    const stats = await fs.statfs(dir);
    const free = stats.bavail * stats.bsize;
    if (free >= MIN_FREE_BYTES) return null;
    return {
      name: "disk space",
      status: "warn",
      detail: `${Math.round(free / (1024 * 1024))} MB free where recordings are stored`,
      remediation: "a long meeting needs roughly 230 MB per hour",
    };
  } catch {
    // `statfs` is not available everywhere. An unknown answer is not a problem to
    // report — this must not manufacture warnings.
    return null;
  }
}

/**
 * Whether the fast engine can actually run. Only asked when it is the one selected:
 * an undownloaded model for an engine nobody chose is not a problem.
 */
async function transcriptionCheck(): Promise<MeetingDoctorCheck | null> {
  const config = await getTranscriptionConfig();
  if (config.meetings?.transcriptionEngine !== "parakeet") return null;
  const status = await parakeetModelStatus(config.meetings.parakeetModel ?? "v3");
  if (status.ready) return null;
  return {
    name: "transcription model",
    status: "warn",
    detail: "the fast transcription model has not been downloaded yet (~600 MB)",
    // Not a blocker, and saying so matters: the recording still happens either way,
    // and whisper transcribes it if the download has not finished.
    remediation: "it downloads on first use, or transcription falls back to whisper",
  };
}

/**
 * Run every readiness check that does not require the user's attention.
 *
 * Callers leave `probeSystemAudio` false for background checks. Probing means
 * *creating* a process tap and may raise the OS permission dialog, so only an
 * explicit capture gesture may opt in. The doctor still reports a previously
 * denied permission without a probe.
 */
export async function runMeetingPreflight(probeSystemAudio = false): Promise<MeetingPreflight> {
  if (!osSupportsNativeCapture()) return { ok: true, problems: [] };

  const config = await getTranscriptionConfig();
  const root = recordingsRoot(config.meetings?.recordingsDir);

  const [report, space, transcription] = await Promise.all([
    runCaptureDoctor(root, probeSystemAudio),
    freeSpaceCheck(root),
    transcriptionCheck(),
  ]);

  const problems = [
    ...report.checks.filter((check) => check.status !== "ok"),
    ...(space ? [space] : []),
    ...(transcription ? [transcription] : []),
  ];
  return { ok: problems.length === 0, problems };
}

/**
 * The single most important problem, phrased for a notification body.
 *
 * One line, because a notification is one line. Failures outrank warnings — "microphone
 * access is denied" and "the model has not downloaded" are not the same news — and the
 * count of anything else is appended rather than dropped, so nothing is silently hidden.
 */
export function preflightSummary(preflight: MeetingPreflight): string | null {
  if (preflight.ok || preflight.problems.length === 0) return null;
  const ranked = [...preflight.problems].sort(
    (a, b) => (a.status === "fail" ? 0 : 1) - (b.status === "fail" ? 0 : 1),
  );
  const first = ranked[0];
  const others = ranked.length - 1;
  const remediation = first.remediation ? ` — ${first.remediation}` : "";
  return `${first.name}: ${first.detail}${remediation}${others > 0 ? ` (+${others} more)` : ""}`;
}
