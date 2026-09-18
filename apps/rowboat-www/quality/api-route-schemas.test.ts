import { describe, expect, it } from "vitest";

import { ConnectorSlugSchema } from "@/lib/api/routes/schemas/common";
import {
  ConnectorOAuthCallbackQuerySchema,
  ConnectorRouteParamsSchema,
  ConnectorStartFormSchema,
} from "@/lib/api/routes/schemas/connectors";
import { DownloadQuerySchema } from "@/lib/api/routes/schemas/download";
import { OpenAPIDocumentSchema } from "@/lib/api/routes/schemas/openapi";
import { RowboatProxyPathSchema } from "@/lib/api/routes/schemas/proxy";
import { WorkOSLoginQuerySchema } from "@/lib/api/routes/schemas/auth";

describe("api route schemas", () => {
  it("accepts valid connector slugs and rejects unsafe values", () => {
    expect(ConnectorSlugSchema.safeParse("google-drive").success).toBe(true);
    expect(ConnectorSlugSchema.safeParse("Bad Slug").success).toBe(false);
    expect(ConnectorSlugSchema.safeParse("../admin").success).toBe(false);
  });

  it("deduplicates connector start scopes", () => {
    const parsed = ConnectorStartFormSchema.parse({
      requested_scope: ["read", "read", "write"],
    });
    expect(parsed.requested_scope).toEqual(["read", "write"]);
  });

  it("requires at least one requested scope for connector start", () => {
    expect(ConnectorStartFormSchema.safeParse({ requested_scope: [] }).success).toBe(false);
  });

  it("parses connector OAuth callback query params", () => {
    const parsed = ConnectorOAuthCallbackQuerySchema.parse({
      connector: "slack",
      status: "success",
      session: "state-token",
    });
    expect(parsed.connector).toBe("slack");
    expect(parsed.status).toBe("success");
  });

  it("validates connector route params", () => {
    expect(ConnectorRouteParamsSchema.safeParse({ name: "notion" }).success).toBe(true);
    expect(ConnectorRouteParamsSchema.safeParse({ name: "Notion" }).success).toBe(false);
  });

  it("accepts download query params and rejects unknown platforms", () => {
    expect(DownloadQuerySchema.parse({ app: "voice", platform: "mac-arm64" })).toEqual({
      app: "voice",
      platform: "mac-arm64",
    });
    expect(DownloadQuerySchema.safeParse({ platform: "mac" }).success).toBe(false);
    expect(DownloadQuerySchema.parse({})).toEqual({});
  });

  it("accepts minimal OpenAPI documents", () => {
    const parsed = OpenAPIDocumentSchema.parse({
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0.0" },
      paths: {},
    });
    expect(parsed.info).toEqual({ title: "Test", version: "1.0.0" });
  });

  it("rejects proxy path segments that could escape /v1", () => {
    expect(RowboatProxyPathSchema.safeParse(["v1", "me"]).success).toBe(true);
    expect(RowboatProxyPathSchema.safeParse(["v1", "..", "graphql"]).success).toBe(false);
    expect(RowboatProxyPathSchema.safeParse(["%2e%2e"]).success).toBe(false);
  });

  it("defaults login return_to when omitted", () => {
    expect(WorkOSLoginQuerySchema.parse({}).return_to).toBeUndefined();
    expect(WorkOSLoginQuerySchema.parse({ return_to: "/app" }).return_to).toBe("/app");
  });
});
