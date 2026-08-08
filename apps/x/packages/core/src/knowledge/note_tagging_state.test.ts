import { describe, it, expect, vi } from "vitest";

const TEST_WORKDIR = vi.hoisted(() => "/tmp/rowboat-note-tagging-state-test");
vi.mock("../config/config.js", () => ({ WorkDir: TEST_WORKDIR }));

import {
  MAX_TAG_ATTEMPTS,
  abandonedNotes,
  markAttemptFailed,
  markNoteAsTagged,
  shouldAttempt,
  type NoteTaggingState,
} from "./note_tagging_state.js";

/**
 * Same repair as labeling_state.test.ts, same reason: state recorded successes
 * only, so a note the agent could not tag was re-selected on every 15-second
 * poll, forever, at full token cost. This service tags every note folder in
 * the vault, so the eligible set is the whole knowledge base.
 */

const NOTE = "/w/knowledge/People/jane-doe.md";
const MINUTE = 60_000;

function state(): NoteTaggingState {
  return { processedFiles: {}, lastRunTime: new Date(0).toISOString() };
}

describe("shouldAttempt", () => {
  it("allows a note that has never been tried", () => {
    expect(shouldAttempt(NOTE, state())).toBe(true);
  });

  it("holds a note back immediately after a failure", () => {
    const s = state();
    const now = Date.now();
    markAttemptFailed(NOTE, s, new Date(now));
    expect(shouldAttempt(NOTE, s, now + 1_000)).toBe(false);
  });

  it("lets it through once the backoff window passes", () => {
    const s = state();
    const now = Date.now();
    markAttemptFailed(NOTE, s, new Date(now));
    expect(shouldAttempt(NOTE, s, now + 6 * MINUTE)).toBe(true);
  });

  it("stops entirely at the attempt cap", () => {
    const s = state();
    const now = Date.now();
    for (let i = 0; i < MAX_TAG_ATTEMPTS; i++) markAttemptFailed(NOTE, s, new Date(now));
    expect(shouldAttempt(NOTE, s, now + 365 * 24 * 60 * MINUTE)).toBe(false);
    expect(abandonedNotes(s)).toEqual([NOTE]);
  });
});

describe("markNoteAsTagged", () => {
  it("clears failure history so an intermittent note is not half-condemned", () => {
    const s = state();
    markAttemptFailed(NOTE, s);
    markNoteAsTagged(NOTE, s);
    expect(s.processedFiles[NOTE]).toBeTruthy();
    expect(s.failures?.[NOTE]).toBeUndefined();
  });
});

describe("backward compatibility", () => {
  it("treats a state file with no failures block as all-eligible", () => {
    const legacy = { processedFiles: {}, lastRunTime: "" } as NoteTaggingState;
    expect(shouldAttempt(NOTE, legacy)).toBe(true);
    expect(abandonedNotes(legacy)).toEqual([]);
  });
});
