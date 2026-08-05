import { NextResponse } from "next/server";

import { publicRowboatApiBaseURL, publicRowboatApiURL } from "@/lib/rowboat-public-api";

const ROWBOAT_API_DESCRIPTION =
  "Rowboat's API brokers WorkOS sign-in, billing and credit state, OpenAI-compatible LLM calls, vendor proxies, Google OAuth handoff, connector OAuth, Composio proxying, internal webhooks, and admin GraphQL. The documented paths below are the routes mounted by cmd/server/wire.go.";

export async function GET(): Promise<NextResponse> {
  try {
    const upstream = await fetch(publicRowboatApiURL("/openapi.json"), {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });

    if (!upstream.ok) {
      return new NextResponse(upstream.body, {
        headers: {
          "Cache-Control": upstream.headers.get("Cache-Control") ?? "no-store",
          "Content-Type": upstream.headers.get("Content-Type") ?? "application/json; charset=utf-8",
        },
        status: upstream.status,
        statusText: upstream.statusText,
      });
    }

    const document = (await upstream.json()) as Record<string, unknown>;
    const apiBase = publicRowboatApiBaseURL().toString().replace(/\/$/, "");
    document.servers = [{ description: "Oppulence API", url: apiBase }];

    const info = document.info;
    document.info = {
      ...(isRecord(info) ? info : {}),
      description: ROWBOAT_API_DESCRIPTION,
      title: "Oppulence API",
    };

    return NextResponse.json(document, {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
