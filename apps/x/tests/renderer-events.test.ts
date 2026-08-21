import assert from "node:assert/strict";
import test from "node:test";

import type {
  RendererEventMap,
  RendererEventName,
} from "../apps/renderer/src/lib/renderer-events.ts";

test("renderer application event names are unique compile-time keys", () => {
  const names = [
    "calendar-block:join-meeting",
    "code-mode-config-changed",
    "code-mode-detected",
    "email-block:draft-with-assistant",
    "models-config-changed",
    "rowboat-chat-recent-work-dirs-changed",
    "rowboat:open-copilot-edit-live-note",
    "rowboat:open-copilot-prompt",
    "rowboat:open-live-note-panel",
    "rowboat:open-related-notes-panel",
    "transcription-config-changed",
  ] satisfies RendererEventName[];
  assert.equal(new Set(names).size, names.length);
  const privacy: RendererEventMap["transcription-config-changed"] = {
    privacy: { localOnly: true },
  };
  assert.equal(privacy.privacy?.localOnly, true);
});
