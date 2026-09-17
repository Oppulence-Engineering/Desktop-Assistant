"use client";

import "client-only";

import { z } from "zod";

import { dashboardFetch, toDashboardAPIPath } from "@/lib/auth/client";

const ErrorResponseSchema = z.union([
  z.string(),
  z
    .object({
      message: z.string().optional(),
      error: z.string().optional(),
    })
    .passthrough(),
]);

type DashboardJsonOptions = RequestInit & {
  allow404?: boolean;
};

export async function requestDashboardJson<T>(
  url: string,
  schema: z.ZodType<T>,
  options: DashboardJsonOptions & { allow404: true },
): Promise<T | null>;
export async function requestDashboardJson<T>(
  url: string,
  schema: z.ZodType<T>,
  options?: DashboardJsonOptions,
): Promise<T>;
/**
 * Performs an authenticated dashboard request and validates the response
 * before it reaches feature state. Callers supply the endpoint-specific schema
 * so this transport cannot silently turn untrusted JSON into `any`.
 */
export async function requestDashboardJson<T>(
  url: string,
  schema: z.ZodType<T>,
  options: DashboardJsonOptions = {},
): Promise<T | null> {
  const { allow404, ...requestInit } = options;
  const response = await dashboardFetch(toDashboardAPIPath(url), {
    ...requestInit,
    headers: {
      "Content-Type": "application/json",
      ...(requestInit.headers ?? {}),
    },
  });
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const text = await response.text();

  if (!response.ok) {
    if (response.status === 404 && allow404) return null;
    if (contentType.includes("application/json") && text) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
      const errorBody = ErrorResponseSchema.safeParse(parsed);
      if (errorBody.success) {
        const detail =
          typeof errorBody.data === "string"
            ? errorBody.data
            : (errorBody.data.message ?? errorBody.data.error);
        if (detail) throw new Error(detail);
      }
    }
    if (response.status === 404) {
      throw new Error("Resource not found on the CLI backend (404)");
    }
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }

  let body: unknown = null;
  if (text && contentType.includes("application/json")) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error("Dashboard API returned malformed JSON");
    }
  }
  return schema.parse(body);
}
