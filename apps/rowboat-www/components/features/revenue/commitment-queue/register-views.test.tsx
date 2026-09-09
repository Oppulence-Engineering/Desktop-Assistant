import { describe, expect, it } from "vitest";

import { REGISTER_VIEWS, registerFilterFor } from "./commitment-queue";

// One-pager §3: the register has five views. Each must be one query against
// GET /v1/commitments, not a separate screen with its own data path. Keeping
// the labels and the filters in one module is what stops them drifting apart.
describe("the five register views", () => {
  it("names all five", () => {
    expect(REGISTER_VIEWS.map((view) => view.id)).toEqual([
      "we_owe",
      "they_owe",
      "changed",
      "by_account",
      "by_owner",
    ]);
  });

  it("asks for outbound obligations that are still live", () => {
    expect(registerFilterFor("we_owe")).toMatchObject({
      direction: "promised_by_me",
      state: ["open", "at_risk"],
    });
  });

  it("asks for inbound obligations, the view no other tool offers", () => {
    expect(registerFilterFor("they_owe")).toMatchObject({
      direction: "promised_by_them",
      state: ["open", "at_risk"],
    });
  });

  it("scopes 'what changed' to a window rather than a direction", () => {
    const filter = registerFilterFor("changed");
    expect(filter.changedSince).toBeTruthy();
    expect(filter.direction).toBeUndefined();
    expect(new Date(filter.changedSince as string).getTime()).toBeLessThan(Date.now());
  });

  it("passes through the account and the owner", () => {
    expect(registerFilterFor("by_account", { relationshipId: "rel-1" })).toMatchObject({
      relationshipId: "rel-1",
    });
    expect(registerFilterFor("by_owner", { owner: "sam@x.co" })).toMatchObject({
      owner: "sam@x.co",
    });
  });

  it("every view is bounded, so no view can fetch the whole ledger", () => {
    for (const view of REGISTER_VIEWS) {
      expect(registerFilterFor(view.id).limit).toBeGreaterThan(0);
    }
  });
});
