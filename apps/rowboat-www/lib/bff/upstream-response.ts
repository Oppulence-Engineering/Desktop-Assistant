import "server-only";

import { NextResponse } from "next/server";

type CacheControlPolicy = "no-store" | "upstream";

type StreamUpstreamOptions = {
  cacheControl?: CacheControlPolicy;
  defaultContentType?: string;
};

/**
 * Streams an upstream fetch body back to the browser without buffering. Keeps
 * status and selected headers aligned across public BFF routes.
 */
export function streamUpstreamResponse(
  upstream: Response,
  options: StreamUpstreamOptions = {},
): NextResponse {
  const { cacheControl = "no-store", defaultContentType = "application/json" } = options;
  const headers = new Headers();

  headers.set(
    "Content-Type",
    upstream.headers.get("content-type") ??
      upstream.headers.get("Content-Type") ??
      defaultContentType,
  );

  if (cacheControl === "upstream") {
    const upstreamCache =
      upstream.headers.get("cache-control") ?? upstream.headers.get("Cache-Control");
    headers.set("Cache-Control", upstreamCache ?? "no-store");
  } else {
    headers.set("Cache-Control", cacheControl);
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
