import "server-only";

import { getAuthRuntimeConfig } from "@/lib/auth/config";
import { isRowboatApiReady } from "@/lib/bff/readiness";
import { NextResponse } from "next/server";

function notReady() {
  return NextResponse.json(
    { status: "not_ready" },
    {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export async function GET() {
  try {
    const { apiBaseUrl } = getAuthRuntimeConfig();
    if (!(await isRowboatApiReady(apiBaseUrl))) return notReady();
  } catch {
    // Keep configuration details and upstream errors out of the public response.
    return notReady();
  }

  return NextResponse.json({ status: "ready" }, { headers: { "Cache-Control": "no-store" } });
}
