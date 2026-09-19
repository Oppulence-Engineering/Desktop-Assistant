import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { dashboardRequest } from "@/lib/auth/dashboard-fetch";
import {
  DashboardRequestError,
  isOptionalRequestFailure,
  requestJson,
} from "@/lib/api/request-json";

vi.mock("@/lib/auth/dashboard-fetch", () => ({
  dashboardRequest: vi.fn(),
  toDashboardAPIPath: (path: string) => `/api/rowboat/v1${path}`,
  redirectBrowserIfUnauthorized: () => undefined,
  loginURL: () => "/api/auth/workos/login",
}));

const mockRequest = vi.mocked(dashboardRequest);

beforeEach(() => mockRequest.mockReset());

describe("requestJson", () => {
  it("validates a successful BFF body against the supplied contract", async () => {
    mockRequest.mockResolvedValueOnce(
      new Response(JSON.stringify({ sources: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      requestJson({
        path: "/relationship-sources/status",
        schema: z.object({ sources: z.array(z.unknown()) }),
      }),
    ).resolves.toEqual({ sources: [] });
    expect(mockRequest.mock.calls[0]?.[0]).toBe("/api/rowboat/v1/relationship-sources/status");
  });

  it("keeps Go problem-detail text on the thrown error", async () => {
    mockRequest.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "invalid relationshipId" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      requestJson({
        path: "/relationships/graph",
        schema: z.object({}),
      }),
    ).rejects.toMatchObject({
      name: "DashboardRequestError",
      message: "invalid relationshipId",
      status: 400,
    } satisfies Partial<DashboardRequestError>);
  });

  it("treats missing or degraded routes as optional failures", () => {
    expect(isOptionalRequestFailure(new DashboardRequestError("gone", 404))).toBe(true);
    expect(isOptionalRequestFailure(new DashboardRequestError("down", 503))).toBe(true);
    expect(isOptionalRequestFailure(new DashboardRequestError("bad", 400))).toBe(false);
  });

  it("extracts the public error envelope on failure", async () => {
    mockRequest.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "unauthenticated", code: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      requestJson({
        path: "/relationship-sources/status",
        schema: z.object({ sources: z.array(z.unknown()) }),
      }),
    ).rejects.toMatchObject({
      name: "DashboardRequestError",
      status: 401,
      code: "unauthorized",
    } satisfies Partial<DashboardRequestError>);
  });
});
