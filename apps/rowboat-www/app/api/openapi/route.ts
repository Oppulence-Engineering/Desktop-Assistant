import { NextResponse } from "next/server";

import { OpenAPIDocumentSchema } from "@/lib/api/routes/schemas/openapi";
import { isRecord, streamUpstreamResponse } from "@/lib/bff/upstream-response";
import { publicRowboatApiBaseURL, publicRowboatApiURL } from "@/lib/api/rowboat-public-api";

const ROWBOAT_API_DESCRIPTION =
  "Rowboat's API brokers WorkOS sign-in, billing and credit state, OpenAI-compatible LLM calls, vendor proxies, Google OAuth handoff, connector OAuth, Composio proxying, internal webhooks, and admin GraphQL. The documented paths below are the routes mounted by cmd/server/wire.go.";

export async function GET(): Promise<NextResponse> {
  try {
    const upstream = await fetch(publicRowboatApiURL("/openapi.json"), {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });

    if (!upstream.ok) {
      return streamUpstreamResponse(upstream, {
        cacheControl: "upstream",
        defaultContentType: "application/json; charset=utf-8",
      });
    }

    const parsedDocument = OpenAPIDocumentSchema.safeParse(await upstream.json());
    if (!parsedDocument.success) {
      return NextResponse.json(
        { code: "api_unavailable", error: "upstream OpenAPI document was invalid" },
        { status: 502 },
      );
    }

    const document = parsedDocument.data;
    const apiBase = publicRowboatApiBaseURL().toString().replace(/\/$/, "");
    document.servers = [{ description: "Oppulence API", url: apiBase }];

    const info = document.info;
    document.info = {
      ...(isRecord(info) ? info : {}),
      description: ROWBOAT_API_DESCRIPTION,
      title: "Oppulence API",
    };

    return NextResponse.json(OpenAPIDocumentSchema.parse(document), {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { code: "api_unavailable", error: "could not reach the Oppulence API OpenAPI document" },
      { status: 502 },
    );
  }
}
