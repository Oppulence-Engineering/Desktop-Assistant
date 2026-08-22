import type { MeetingDoctorCheck } from "@x/shared/meetings";

const MICROPHONE_CHECK = /microphone|input device|audio input/i;

export function findMicrophoneBlocker(
  checks: readonly MeetingDoctorCheck[],
): MeetingDoctorCheck | null {
  return (
    checks.find(
      (check) =>
        check.status === "fail" && MICROPHONE_CHECK.test(`${check.name} ${check.detail}`),
    ) ?? null
  );
}

export function meetingBlockerDescription(blocker: MeetingDoctorCheck): string {
  return `${blocker.detail}${blocker.remediation ? ` ${blocker.remediation}` : ""}`;
}
