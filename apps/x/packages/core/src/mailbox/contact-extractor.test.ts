import { describe, expect, it } from "vitest";
import {
  DeterministicContactExtractor,
  HybridContactExtractor,
  MAX_MODEL_CONTACT_CONFIDENCE,
  redactContactModelInput,
  type ContactExtraction,
  type ContactExtractionRequest,
  type ContactExtractor,
} from "./contact-extractor.js";

const request: ContactExtractionRequest = {
  messages: [
    {
      from: { name: "Sarah Chen", email: "sarah@acme.com" },
      sentAt: "2026-08-04T12:00:00.000Z",
      body: ["Happy to walk through it.", "", "-- ", "Sarah Chen", "VP Engineering"].join("\n"),
    },
    {
      from: { name: "Dana Fox", email: "dana@acme.com" },
      sentAt: "2026-08-04T12:05:00.000Z",
      body: "Adding Dana who owns procurement.",
    },
  ],
  knownParticipants: [{ email: "sarah@acme.com" }, { email: "dana@acme.com" }],
  extractorVersion: "test",
};

function stubModel(contacts: ContactExtraction["contacts"]): ContactExtractor {
  return {
    version: "stub",
    async extract() {
      return {
        contacts,
        provenance: {
          extractorVersion: "stub",
          promptVersion: "stub",
          provider: "test",
          model: "test",
          routing: "remote" as const,
          startedAt: "2026-08-04T12:00:00.000Z",
          completedAt: "2026-08-04T12:00:01.000Z",
          durationMs: 1000,
        },
      };
    },
  };
}

describe("redactContactModelInput", () => {
  /**
   * The conversation redactor replaces every address. Reusing it here would strip
   * the join key and make the whole extraction inert.
   */
  it("keeps email addresses, which are the join key", () => {
    const out = redactContactModelInput("reach me at sarah@acme.com", new Map());
    expect(out).toContain("sarah@acme.com");
  });

  it("still removes credentials, card numbers and health terms", () => {
    const map = new Map<string, string>();
    const out = redactContactModelInput(
      "api_key=abc card 4111 1111 1111 1111 diagnosis of something",
      map,
    );
    expect(out).not.toContain("api_key=abc");
    expect(out).not.toContain("4111 1111 1111 1111");
    expect(out.toLowerCase()).not.toContain("diagnosis of something");
    expect(map.size).toBe(3);
  });
});

describe("DeterministicContactExtractor", () => {
  it("reads titles from signatures and nothing else", async () => {
    const result = await new DeterministicContactExtractor().extract(request);
    expect(result.provenance.routing).toBe("deterministic");
    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0]).toMatchObject({ email: "sarah@acme.com", title: "VP Engineering" });
  });
});

describe("HybridContactExtractor", () => {
  /** The safety property: a literal line under `-- ` always beats an inference. */
  it("never lets the model overwrite a parsed signature", async () => {
    const hybrid = new HybridContactExtractor(
      stubModel([{ email: "sarah@acme.com", title: "Chief Executive Officer", confidence: 0.9 }]),
    );
    const result = await hybrid.extract(request);
    const sarah = result.contacts.find((contact) => contact.email === "sarah@acme.com");
    expect(sarah?.title).toBe("VP Engineering");
  });

  it("lets the model fill a gap the parser left", async () => {
    const hybrid = new HybridContactExtractor(
      stubModel([{ email: "dana@acme.com", title: "Head of Procurement", confidence: 0.9 }]),
    );
    const result = await hybrid.extract(request);
    const dana = result.contacts.find((contact) => contact.email === "dana@acme.com");
    expect(dana?.title).toBe("Head of Procurement");
    // Capped regardless of what the model claimed.
    expect(dana?.confidence).toBe(MAX_MODEL_CONTACT_CONFIDENCE);
  });

  it("falls back to signature parsing when no model route is permitted", async () => {
    const refusing: ContactExtractor = {
      version: "refusing",
      async extract() {
        throw new Error("contact extraction has no permitted local model route");
      },
    };
    const result = await new HybridContactExtractor(refusing).extract(request);
    expect(result.provenance.routing).toBe("deterministic");
    expect(result.contacts[0].title).toBe("VP Engineering");
  });
});
