import { NextResponse } from "next/server";

import { readDevEnvFromProcess } from "@/lib/dev/validate-env";

/** Dev-only upstream health for the toolkit API tab. */
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const env = readDevEnvFromProcess();
  const base = env.vars.apiProxyUrl.replace(/\/+$/, "");

  let api: { ok: boolean; status?: number; latencyMs?: number; error?: string } = { ok: false };
  const started = performance.now();
  try {
    const response = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(4_000) });
    api = {
      ok: response.ok,
      status: response.status,
      latencyMs: Math.round(performance.now() - started),
    };
  } catch (error) {
    api = {
      ok: false,
      error: error instanceof Error ? error.message : "fetch failed",
      latencyMs: Math.round(performance.now() - started),
    };
  }

  return NextResponse.json({
    www: { ok: env.ok, warnings: env.warnings, errors: env.errors },
    api,
    env: {
      apiProxyUrl: env.vars.apiProxyUrl,
      publicAppUrl: env.vars.publicAppUrl,
    },
  });
}
