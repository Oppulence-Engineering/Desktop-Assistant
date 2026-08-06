import { describe, expect, it } from "vitest";
import { departureObservation } from "./email-evidence.js";

/**
 * The departure signal only earns its place if it reaches the graph. Detecting a
 * bounce and writing it to a local profile nothing reads is the same as not
 * reading the bounce at all.
 *
 * These tests guard the two ways that goes wrong: publishing something that is
 * not a departure, and publishing the same departure on every sync.
 */

const NOW = Date.parse("2026-08-06T12:00:00Z");
const now = () => NOW;

function departure(overrides: Partial<Parameters<typeof departureObservation>[0]["departure"]> = {}) {
  return {
    email: "sarah@acme.example",
    displayName: "Sarah Chen",
    kind: "recipient_unknown" as const,
    evidence: "550 5.1.1 The email account that you tried to reach does not exist.",
    observedAt: NOW - 60_000,
    externalId: "departure:sarah@acme.example:recipient_unknown",
    ...overrides,
  };
}

describe("departureObservation", () => {
  it("publishes a bounce as a contact_departed observation", () => {
    const observation = departureObservation({
      departure: departure(),
      sourceAccountId: "me@myco.example",
      now,
    });
    expect(observation?.eventType).toBe("contact_departed");
    expect(observation?.primaryEmail).toBe("sarah@acme.example");
    expect(observation?.accountDomain).toBe("acme.example");
    expect(observation?.participants?.[0]?.email).toBe("sarah@acme.example");
    expect(observation?.normalizedFacts?.departure_kind).toBe("recipient_unknown");
  });

  it("carries the words that justify the claim", () => {
    // A departure a user cannot check is an assertion, not evidence.
    const observation = departureObservation({
      departure: departure({ kind: "left_organization", evidence: "I have left Acme as of 1 August." }),
      sourceAccountId: "me@myco.example",
      now,
    });
    expect(observation?.normalizedFacts?.departure_evidence).toMatch(/left Acme/);
  });

  it("bounds the evidence text", () => {
    // Bounce reports quote the entire original message. The sentence naming the
    // failure is the evidence; the thread it was attached to is content, and the
    // desktop has never promised to send email bodies.
    const observation = departureObservation({
      departure: departure({ evidence: "x".repeat(5_000) }),
      sourceAccountId: "me@myco.example",
      now,
    });
    expect((observation?.normalizedFacts?.departure_evidence as string).length).toBe(300);
  });

  it("never carries the subject line", () => {
    const observation = departureObservation({
      departure: departure(),
      sourceAccountId: "me@myco.example",
      now,
    });
    const serialized = JSON.stringify(observation);
    expect(serialized).not.toMatch(/subject/i);
    expect(observation?.payload).toBeUndefined();
  });

  it("drops a public mailbox", () => {
    // A gmail.com bounce says nothing about an organization, and account
    // resolution would anchor an entire relationship on a public domain.
    expect(
      departureObservation({
        departure: departure({ email: "someone@gmail.com" }),
        sourceAccountId: "me@myco.example",
        now,
      }),
    ).toBeNull();
  });

  it("drops a machine address", () => {
    // A no-reply mailbox cannot leave a company.
    expect(
      departureObservation({
        departure: departure({ email: "no-reply@acme.example" }),
        sourceAccountId: "me@myco.example",
        now,
      }),
    ).toBeNull();
  });

  it("keys on address and kind so a re-synced bounce is the same observation", () => {
    // The bounce stays in the mailbox forever and every sync re-reads it. Two
    // reads of the same report must be one observation, not two.
    const first = departureObservation({
      departure: departure(),
      sourceAccountId: "me@myco.example",
      now,
    });
    const second = departureObservation({
      departure: departure({ observedAt: NOW - 5_000 }),
      sourceAccountId: "me@myco.example",
      now,
    });
    expect(first?.externalId).toBe(second?.externalId);
  });

  it("clamps an implausible timestamp rather than trusting the header", () => {
    const observation = departureObservation({
      departure: departure({ observedAt: NOW + 90 * 24 * 60 * 60 * 1000 }),
      sourceAccountId: "me@myco.example",
      now,
    });
    expect(Date.parse(observation!.occurredAt)).toBeLessThanOrEqual(NOW);
    expect(observation?.normalizedFacts?.occurred_at_clamped).toBe(true);
  });
});
