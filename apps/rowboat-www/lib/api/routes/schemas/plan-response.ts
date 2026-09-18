import { z } from "zod";

import { RespondPublicMutualActionPlanBody } from "@/lib/api/generated/zod/relationship-intelligence/relationship-intelligence";

export const PlanTokenSchema = z
  .string()
  .trim()
  .regex(/^[a-f0-9]{64}$/, "The plan link is invalid.");

export const PlanResponseRequestSchema = z.object({
  token: PlanTokenSchema,
  // Clients may send `null` when they only want to fetch the plan.
  response: RespondPublicMutualActionPlanBody.nullish(),
});
