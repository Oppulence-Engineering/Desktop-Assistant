import { generateObject } from "ai";
import type { MeetingTranscriptSegment } from "@x/shared/meetings";
import {
  getDefaultModelAndProvider,
  getMeetingNotesModel,
  resolveProviderConfig,
} from "../models/defaults.js";
import { createProvider } from "../models/models.js";
import { withUseCase } from "../analytics/use_case.js";
import { captureLlmUsage } from "../analytics/usage.js";
import {
  COMMITMENT_GUARD,
  COMMITMENT_TASK,
  CommitmentExtraction,
  mightContainCommitments,
  transcriptForPrompt,
  validateCommitments,
  type ProposedCommitment,
} from "./commitments.js";

/**
 * The one place a transcript is handed to a model to find commitments.
 *
 * Split from `commitments.ts` so everything there — the schema, the pre-filter, the
 * validation — stays pure and testable without a model. This file is the part that
 * cannot be unit-tested honestly, so it is kept as thin as possible: build the guarded
 * messages, make the call, hand the result straight back to `validateCommitments`.
 */

export interface ExtractCommitmentsArgs {
  segments: MeetingTranscriptSegment[];
  /** Speaker labels, so the model reads "Dana" rather than "Other" on a named 1:1. */
  labels?: { me: string; them: string };
  /** Injected in tests. Defaults to a real structured-output call. */
  generate?: (messages: { role: "system" | "user"; content: string }[]) => Promise<unknown>;
}

export async function extractCommitments(
  args: ExtractCommitmentsArgs,
): Promise<ProposedCommitment[]> {
  // Most meetings end with nobody committing to anything. Skipping those costs nothing
  // and keeps the feature from being a per-meeting tax on the user's model budget.
  if (!mightContainCommitments(args.segments)) return [];

  const messages: { role: "system" | "user"; content: string }[] = [
    { role: "system", content: [COMMITMENT_TASK, "", COMMITMENT_GUARD].join("\n") },
    { role: "user", content: transcriptForPrompt(args.segments, args.labels) },
  ];

  const raw = args.generate ? await args.generate(messages) : await callModel(messages);
  const parsed = CommitmentExtraction.safeParse(raw);
  if (!parsed.success) return [];

  // Validated rather than trusted: a proposal whose evidence is not in the transcript,
  // or whose span points nowhere, is dropped.
  return validateCommitments(parsed.data.commitments, args.segments);
}

async function callModel(
  messages: { role: "system" | "user"; content: string }[],
): Promise<unknown> {
  const modelId = await getMeetingNotesModel();
  const { provider } = await getDefaultModelAndProvider();
  const config = await resolveProviderConfig(provider);
  const model = createProvider(config).languageModel(modelId);

  // `meeting_note` rather than a new top-level use case: the `UseCase` union feeds
  // billing and should not grow for a sub-feature of the same surface.
  const result = await withUseCase({ useCase: "meeting_note", subUseCase: "commitments" }, () =>
    generateObject({ model, schema: CommitmentExtraction, messages }),
  );

  captureLlmUsage({
    useCase: "meeting_note",
    subUseCase: "commitments",
    model: modelId,
    provider,
    usage: result.usage,
  });

  return result.object;
}
