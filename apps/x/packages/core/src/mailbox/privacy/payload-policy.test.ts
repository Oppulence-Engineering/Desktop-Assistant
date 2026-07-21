import { describe, expect, it } from "vitest";

import {
  buildExternalMailPayload,
  signWebhookPayload,
  verifyWebhookSignature,
} from "./payload-policy.js";
import { makeMessage, makeThread } from "../factories.testkit.js";

describe("buildExternalMailPayload", () => {
  const thread = makeThread();
  const message = makeMessage({ textBody: "secret contents", from: { email: "a@example.com" } });

  it("excludes body and attachments for a metadata-only policy", () => {
    const payload = buildExternalMailPayload({
      thread,
      message,
      policy: { includeBody: false, includeAttachments: false },
    });
    expect(payload.email.body).toBeUndefined();
    expect(payload.email.attachments).toBeUndefined();
    expect(payload.email.subject).toBe(message.subject);
  });

  it("includes body only when the policy opts in", () => {
    const payload = buildExternalMailPayload({
      thread,
      message,
      policy: { includeBody: true, includeAttachments: false },
    });
    expect(payload.email.body).toBe("secret contents");
  });
});

describe("webhook signing", () => {
  const payload = buildExternalMailPayload({
    thread: makeThread(),
    message: makeMessage(),
    policy: { includeBody: false, includeAttachments: false },
  });

  it("produces a verifiable signature", () => {
    const signed = signWebhookPayload({
      webhookId: "wh_1",
      secret: "s3cret",
      payload,
      timestamp: 1000,
    });
    expect(signed.headers["X-Rowboat-Webhook-Id"]).toBe("wh_1");
    expect(
      verifyWebhookSignature({
        secret: "s3cret",
        body: signed.body,
        timestamp: 1000,
        signature: signed.headers["X-Rowboat-Webhook-Signature"],
      }),
    ).toBe(true);
  });

  it("rejects a tampered body", () => {
    const signed = signWebhookPayload({
      webhookId: "wh_1",
      secret: "s3cret",
      payload,
      timestamp: 1000,
    });
    expect(
      verifyWebhookSignature({
        secret: "s3cret",
        body: signed.body + "x",
        timestamp: 1000,
        signature: signed.headers["X-Rowboat-Webhook-Signature"],
      }),
    ).toBe(false);
  });

  it("rejects the wrong secret", () => {
    const signed = signWebhookPayload({
      webhookId: "wh_1",
      secret: "s3cret",
      payload,
      timestamp: 1000,
    });
    expect(
      verifyWebhookSignature({
        secret: "other",
        body: signed.body,
        timestamp: 1000,
        signature: signed.headers["X-Rowboat-Webhook-Signature"],
      }),
    ).toBe(false);
  });
});
