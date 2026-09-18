import { NextRequest, NextResponse } from "next/server";

import { parseJsonBody } from "@/lib/api/routes/parse";
import { PlanResponseRequestSchema } from "@/lib/api/routes/schemas/plan-response";
import { streamUpstreamResponse } from "@/lib/bff/upstream-response";
import { rowboatApiURL } from "@/lib/auth/config";

const MAX_BODY_BYTES = 256 * 1024;

export async function POST(request: NextRequest) {
  const parsed = await parseJsonBody(request, PlanResponseRequestSchema, MAX_BODY_BYTES);
  if (!parsed.success) {
    return NextResponse.json({ detail: "The plan request is invalid." }, { status: 400 });
  }

  const { token, response } = parsed.data;
  const hasResponse = response != null;
  const upstream = await fetch(
    rowboatApiURL(
      hasResponse ? "/v1/public/mutual-action-plan/responses" : "/v1/public/mutual-action-plan",
    ),
    {
      method: hasResponse ? "POST" : "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Oppulence-Plan-Token": token,
      },
      body: hasResponse ? JSON.stringify(response) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    },
  );
  return streamUpstreamResponse(upstream);
}
