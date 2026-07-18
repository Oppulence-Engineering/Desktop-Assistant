import { describe, expect, it } from "vitest";

import { describePlannedAction, findActionConflicts } from "./preview.js";

describe("findActionConflicts", () => {
  it("warns when a rule both archives and moves", () => {
    const conflicts = findActionConflicts([
      { id: "a1", type: "archive" },
      { id: "a2", type: "move", folderId: "f" },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].severity).toBe("warning");
    expect(conflicts[0].actionIds).toEqual(["a2"]);
  });

  it("errors on more than one reply for the same message", () => {
    const conflicts = findActionConflicts([
      { id: "a1", type: "draft_reply" },
      { id: "a2", type: "reply" },
    ]);
    expect(conflicts.some((c) => c.severity === "error")).toBe(true);
  });

  it("returns no conflicts for a clean action set", () => {
    expect(findActionConflicts([{ id: "a1", type: "label", labelId: "L" }])).toHaveLength(0);
  });
});

describe("describePlannedAction", () => {
  it("marks high-impact actions", () => {
    expect(describePlannedAction({ id: "a", type: "forward", to: ["x@y.com"] }).highImpact).toBe(
      true,
    );
    expect(describePlannedAction({ id: "a", type: "archive" }).highImpact).toBe(false);
  });

  it("describes a nested delayed action", () => {
    const planned = describePlannedAction({
      id: "a",
      type: "delay",
      delayMinutes: 60,
      action: { id: "b", type: "archive" },
    });
    expect(planned.description).toContain("After 60 min");
    expect(planned.description).toContain("Archive");
  });
});
