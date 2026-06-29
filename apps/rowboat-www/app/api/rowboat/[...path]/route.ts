import { NextRequest } from "next/server";

import { proxyRowboatAPI } from "@/lib/auth/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

async function handle(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return proxyRowboatAPI(request, path);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
