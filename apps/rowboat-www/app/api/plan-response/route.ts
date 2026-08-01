import { NextRequest, NextResponse } from "next/server";

import { rowboatApiURL } from "@/lib/auth/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | { token?: string; response?: Record<string, unknown> }
    | null;
  const token = body?.token?.trim() ?? "";
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return NextResponse.json({ detail: "The plan link is invalid." }, { status: 400 });
  }
  const hasResponse = body?.response !== undefined;
  const upstream = await fetch(
    rowboatApiURL(
      hasResponse
        ? "/v1/public/mutual-action-plan/responses"
        : "/v1/public/mutual-action-plan",
    ),
    {
      method: hasResponse ? "POST" : "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Oppulence-Plan-Token": token,
      },
      body: hasResponse ? JSON.stringify(body?.response) : undefined,
      cache: "no-store",
    },
  );
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store" },
  });
}
