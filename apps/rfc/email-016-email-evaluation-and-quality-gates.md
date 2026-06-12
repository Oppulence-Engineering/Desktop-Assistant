# RFC email-016: Email Evaluation and Quality Gates

| Field      | Value                                                 |
| ---------- | ----------------------------------------------------- |
| RFC        | email-016                                             |
| Status     | Draft                                                 |
| Track      | Desktop email                                         |
| Owner      | TBD                                                   |
| Created    | 2026-06-12                                            |
| Depends on | email-003, email-004, email-005, email-011, email-012 |
| Related    | email-015, email-018, email-020                       |

## Summary

Create an evaluation harness and release gates for email AI behavior. Email automation is high-risk because bad classification can hide important messages, bad cleanup can archive wanted mail, and bad drafting can embarrass the user. Inbox Zero includes rule testing and debug surfaces; Rowboat should go further by treating email classification, rule matching, draft generation, cleanup, and assistant mutations as evaluated systems with fixtures, metrics, and rollout gates.

## Inbox Zero Implementation References

Implementation agents should first read [email-000](./email-000-inbox-zero-agent-reference.md), then inspect existing Inbox Zero tests before writing Rowboat equivalents:

- `apps/web/utils/ai/choose-rule/*.test.ts`
- `apps/web/utils/ai/reply/*.test.ts`
- `apps/web/utils/reply-tracker/*.test.ts`
- `apps/web/utils/cold-email/*.test.ts`
- `apps/web/utils/digest/*.test.ts`
- `apps/web/utils/drive/*.test.ts`
- `apps/web/utils/calendar/**/*.test.ts`
- `apps/web/utils/ai/security.test.ts`
- `apps/web/utils/braintrust.ts`

Use these for fixture design, edge-case discovery, and prompt/model regression gates. Rowboat should add synthetic fixtures and local-only user-correction fixtures before enabling autonomous actions.

## Goals

- Build repeatable eval datasets for email features.
- Track quality metrics before and after prompt/model/rule changes.
- Gate risky actions behind measured confidence and user approval.
- Capture user corrections as labeled examples.
- Support local synthetic fixtures that avoid real user data in tests.
- Make evaluation output visible to engineers and product decision-makers.

## Non-Goals

- Training a custom model in the first version.
- Collecting user email bodies into a centralized eval set by default.
- Proving perfect automation quality.

## Eval Targets

| Target                    | Metrics                                                 |
| ------------------------- | ------------------------------------------------------- |
| Important vs Other        | precision, recall, false negative rate for important    |
| Smart categories          | precision/recall per category                           |
| Cold email detection      | precision, false positive rate for known contacts       |
| Newsletter detection      | precision, unsubscribe safety                           |
| Needs Reply               | precision, recall, overdue miss rate                    |
| Awaiting Reply            | precision, false reminder rate                          |
| Rule matching             | exact match against expected rule IDs                   |
| Draft reply               | rubric score, recipient correctness, hallucination rate |
| Digest selection          | relevance, duplication, priority accuracy               |
| Meeting brief             | source coverage, hallucination rate, timing accuracy    |
| Assistant action proposal | policy compliance, target correctness                   |
| Prompt injection          | blocked unsafe instructions                             |

## Fixture Types

Synthetic fixtures:

- Newsletter.
- Receipt.
- Calendar invite.
- Cold pitch.
- Investor email.
- Customer support issue.
- Internal team FYI.
- Personal email.
- Password reset/security notice.
- Attachment-heavy vendor email.
- Malicious prompt-injection email.

Derived fixtures:

- Redacted user-approved examples.
- User correction records.
- Rule test samples.
- Draft edit diffs.

No raw user fixture should leave the local machine without explicit export.

## Eval Harness

```ts
type MailEvalCase = {
  id: string;
  target: MailEvalTarget;
  input: MailEvalInput;
  expected: MailEvalExpected;
  tags: string[];
  source: "synthetic" | "redacted_user" | "manual";
};

type MailEvalResult = {
  caseId: string;
  target: MailEvalTarget;
  passed: boolean;
  score?: number;
  actual: unknown;
  expected: unknown;
  modelProvider?: string;
  modelName?: string;
  promptVersion: string;
  createdAt: string;
};
```

## Draft Quality Rubric

Drafts should be checked for:

- Correct recipients.
- Correct thread context.
- No invented facts.
- Tone matches style guide.
- Clear ask/answer.
- No sensitive leakage.
- Calendar availability accurate.
- No hidden auto-send.
- Reasonable length.

The system can combine deterministic checks with judge-model rubrics, but judge output must not be the only gate for risky behavior.

## Rule Testing

Rules should have:

- Test sample set.
- Expected match/non-match examples.
- Planned action preview.
- Conflicting rule detection.
- Versioned test results.
- Regression warnings before enabling edited rules.

When a user corrects a rule outcome, Rowboat should offer:

- Add example to eval set.
- Update static condition.
- Update AI instruction.
- Add sender decision.
- Disable rule.

## Release Gates

Before enabling a feature by default:

| Feature             | Gate                                                                |
| ------------------- | ------------------------------------------------------------------- |
| Category classifier | No severe false negatives in core fixture suite.                    |
| Cold email monitor  | Low false positive rate for prior contacts.                         |
| Cold email archive  | Dogfood-only until monitor precision is proven.                     |
| Reply tracker       | No duplicate nudge drafts in retry tests.                           |
| Draft creation      | Recipient correctness tests pass.                                   |
| Auto-send           | Not enabled until separate explicit approval and eval suite exists. |
| Unsubscribe         | Safe-method parser tests pass.                                      |
| Meeting briefs      | Source-label and hallucination checks pass.                         |

## Metrics Storage

Store:

- Prompt version.
- Model provider/name.
- Dataset version.
- Pass/fail/score.
- Regression from prior run.
- Feature flag/build SHA.

## Detailed Code Examples

See [email-021](./email-021-implementation-blueprints-and-code-examples.md) for fixture and runner examples.

### Quality Gate

```ts
export function evaluateQualityGate(input: {
  target: MailEvalTarget;
  results: MailEvalResult[];
  gate: {
    minPrecision?: number;
    minRecall?: number;
    maxSevereFailures?: number;
  };
}): MailQualityGateResult {
  const severeFailures = input.results.filter(
    (result) => !result.passed && result.severity === "severe",
  ).length;

  const precision = computePrecision(input.results);
  const recall = computeRecall(input.results);

  const passed =
    (input.gate.minPrecision === undefined || precision >= input.gate.minPrecision) &&
    (input.gate.minRecall === undefined || recall >= input.gate.minRecall) &&
    (input.gate.maxSevereFailures === undefined || severeFailures <= input.gate.maxSevereFailures);

  return {
    target: input.target,
    passed,
    precision,
    recall,
    severeFailures,
    failedCaseIds: input.results.filter((result) => !result.passed).map((result) => result.caseId),
  };
}
```

### Correction To Fixture

```ts
export function correctionToEvalCase(input: {
  correction: MailUserCorrection;
  thread: MailboxThread;
}): MailEvalCase {
  return {
    id: `user-correction-${input.correction.id}`,
    target: input.correction.target,
    source: "redacted_user",
    input: {
      subject: redactSubject(input.thread.subject),
      from: redactEmail(input.thread.messages.at(-1)?.from.email ?? ""),
      body: redactBody(input.thread.messages.at(-1)?.textBody ?? ""),
    },
    expected: input.correction.expected,
    tags: ["user-correction", input.correction.target],
  };
}
```

## Test Plan

This RFC is itself a test plan foundation:

- Add synthetic fixture generator.
- Add local eval runner.
- Add CI subset for deterministic tests.
- Add optional slow eval suite for model-dependent cases.
- Add correction-to-fixture workflow.
- Add prompt/version registry.

## Open Questions

- Should evals live in `apps/x/packages/core` or a shared package?
- Which model-dependent evals should run in CI versus manual?
- Should user corrections become local-only eval cases automatically?
- What score is good enough for dogfood of each automation action?
