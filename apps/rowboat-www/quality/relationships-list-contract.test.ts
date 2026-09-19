import { describe, expect, it } from "vitest";

import { ListRelationships200Response } from "@/lib/api/generated/zod/relationship-intelligence/relationship-intelligence";

/**
 * The list handler always serializes people/thread/commitment counts. The
 * Orval schema used to omit them, so Zod strictObject failed every list
 * and the panel showed the generic "different versions" copy.
 */
const listRow = {
  categories: [],
  commitmentCount: 4,
  displayName: "Acme",
  emailThreadCount: 12,
  engagement: "steady",
  health: "healthy",
  id: "9c8dfa9b-a7b2-46ea-982c-622a914c00e5",
  kind: "company",
  lifecycle: "evaluation",
  milestones: [],
  peopleCount: 3,
  projectorVersion: 2,
  resourceRefs: [],
  risks: [],
  sentiment: "unknown",
  stateVersion: 4,
  status: "active",
} as const;

describe("GET /relationships contract", () => {
  it("accepts the counts the API list DTO always emits", () => {
    expect(ListRelationships200Response.parse({ relationships: [listRow] })).toEqual({
      relationships: [listRow],
    });
  });
});
