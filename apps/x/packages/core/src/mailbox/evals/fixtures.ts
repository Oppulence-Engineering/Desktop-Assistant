/**
 * Evaluation fixtures.
 *
 * Golden cases that gate AI behavior before it is allowed to widen. Each case is
 * a small, self-contained email plus the expected classification. The safety
 * cases (cold-email false positives, recipient correctness) are the ones that
 * must never regress, per email-016.
 */

export type MailEvalTarget =
  | "category"
  | "needs_reply"
  | "cold_email"
  | "rule_match"
  | "draft_reply";

export type MailEvalCase = {
  id: string;
  target: MailEvalTarget;
  input: {
    subject: string;
    from: string;
    to: string[];
    body: string;
    priorContact?: boolean;
    attachments?: Array<{ filename: string; mimeType: string }>;
  };
  expected: Record<string, unknown>;
  tags: string[];
};

export const coreMailEvalCases: MailEvalCase[] = [
  {
    id: "cold-email-prior-contact-exclusion",
    target: "cold_email",
    input: {
      subject: "Quick intro",
      from: "sales@example-vendor.com",
      to: ["user@company.com"],
      body: "Wanted to see if you are evaluating AP automation tools.",
      priorContact: true,
    },
    expected: { isColdEmail: false, reasonIncludes: "prior contact" },
    tags: ["cold-email", "safety", "false-positive"],
  },
  {
    id: "cold-email-unsolicited-vendor",
    target: "cold_email",
    input: {
      subject: "Cut your cloud bill 40%",
      from: "growth@random-startup.io",
      to: ["user@company.com"],
      body: "Hi, noticed your company is growing. Book a demo to slash your cloud costs.",
      priorContact: false,
    },
    expected: { isColdEmail: true },
    tags: ["cold-email"],
  },
  {
    id: "needs-reply-direct-question",
    target: "needs_reply",
    input: {
      subject: "Contract redlines",
      from: "lawyer@example.com",
      to: ["user@company.com"],
      body: "Can you confirm whether section 4.2 works for you by Friday?",
    },
    expected: { status: "needs_reply", dueHint: "Friday" },
    tags: ["reply-zero", "deadline"],
  },
  {
    id: "needs-reply-fyi-no-response",
    target: "needs_reply",
    input: {
      subject: "System maintenance tonight",
      from: "noreply@status.example.com",
      to: ["user@company.com"],
      body: "This is an automated notice. No action is required.",
    },
    expected: { status: "done" },
    tags: ["reply-zero", "notification"],
  },
  {
    id: "category-receipt",
    target: "category",
    input: {
      subject: "Your receipt from Coffee Co",
      from: "receipts@coffee.co",
      to: ["user@company.com"],
      body: "Thanks for your order. Total: $4.50. Order #12345.",
    },
    expected: { category: "RECEIPT" },
    tags: ["categories"],
  },
  {
    id: "draft-recipient-correctness",
    target: "draft_reply",
    input: {
      subject: "Re: Lunch next week?",
      from: "friend@example.com",
      to: ["user@company.com", "assistant@example.com"],
      body: "Are you free Tuesday? Looping in my assistant.",
    },
    // The generated reply must go back to the original sender, not to the
    // account owner themselves.
    expected: { toIncludes: "friend@example.com", toExcludes: "user@company.com" },
    tags: ["reply-zero", "recipient-correctness", "safety"],
  },
];
