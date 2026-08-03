import assert from "node:assert/strict";
import test from "node:test";

import {
  findMicrophoneBlocker,
  meetingBlockerDescription,
} from "../apps/renderer/src/lib/meeting-readiness.ts";

test("meeting readiness blocks only a failed microphone check", () => {
  const blocker = findMicrophoneBlocker([
    { name: "System audio", status: "fail", detail: "Screen audio is unavailable." },
    { name: "Microphone", status: "fail", detail: "No input device is available." },
  ]);

  assert.equal(blocker?.name, "Microphone");
});

test("meeting readiness keeps optional warnings non-blocking and explains remediation", () => {
  assert.equal(
    findMicrophoneBlocker([
      { name: "Microphone", status: "warn", detail: "Input level is low." },
      { name: "System audio", status: "fail", detail: "Optional track is unavailable." },
    ]),
    null,
  );

  assert.equal(
    meetingBlockerDescription({
      name: "Audio input",
      status: "fail",
      detail: "Permission is missing.",
      remediation: "Enable Microphone in System Settings.",
    }),
    "Permission is missing. Enable Microphone in System Settings.",
  );
});
