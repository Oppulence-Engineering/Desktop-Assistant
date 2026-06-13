import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpDir: string;
let workDir: string;

const now = "2026-06-11T12:00:00.000Z";
const INTEGRATION_TIMEOUT_MS = 15_000;

function mockConfigSideEffects(): void {
  vi.doMock("../knowledge/version_history.js", () => ({
    commitAll: vi.fn(async () => undefined),
    initRepo: vi.fn(async () => undefined),
  }));
  vi.doMock("../knowledge/deprecate_today_note.js", () => ({
    deprecateTodayNote: vi.fn(async () => undefined),
  }));
}

async function writeOAuthToken(): Promise<void> {
  await fs.mkdir(path.join(workDir, "config"), { recursive: true });
  await fs.writeFile(
    path.join(workDir, "config", "oauth.json"),
    JSON.stringify({
      version: 2,
      providers: {
        solomon: {
          mode: "solomon",
          tokens: {
            access_token: "test-solomon-token",
            refresh_token: null,
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            token_type: "Bearer",
          },
        },
      },
    }),
    "utf8",
  );
}

async function seedLocalTask(slug: string): Promise<void> {
  const dir = path.join(workDir, "bg-tasks", slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "task.yaml"),
    [
      `name: ${slug}`,
      "instructions: keep current",
      "active: true",
      "executionTarget: api",
      `createdAt: "${now}"`,
    ].join("\n"),
    "utf8",
  );
}

function remoteRun(slug: string, runId: string, status: string, completedAt: string) {
  return {
    id: runId,
    runId,
    slug,
    trigger: "cron",
    status,
    executor: "api",
    summary: status === "succeeded" ? "Done." : undefined,
    completedAt,
    createdAt: now,
    updatedAt: completedAt,
    revision: 1,
  };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requestURL(input: unknown): URL {
  if (typeof input === "string") return new URL(input);
  if (input instanceof URL) return input;
  return new URL((input as { url: string }).url);
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "solomon-offline-return-test-"));
  workDir = path.join(tmpDir, "workspace");
  process.env.SOLOMON_WORKDIR = workDir;
  process.env.API_URL = "http://solomon-api.test";
  vi.resetModules();
  mockConfigSideEffects();
  await writeOAuthToken();
});

afterEach(async () => {
  delete process.env.SOLOMON_WORKDIR;
  delete process.env.API_URL;
  vi.unstubAllGlobals();
  vi.resetModules();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("offline-return (RFC 006)", () => {
  it("first run initializes the marker without notifying or fetching history", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("no network calls expected on first run");
    });
    vi.stubGlobal("fetch", fetchMock);

    const { checkOfflineReturn, readCloudRunsSeenState } = await import("./cloud-runs-state.js");
    const payload = await checkOfflineReturn();

    expect(payload).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    const state = await readCloudRunsSeenState();
    expect(state?.lastSeenCloudRunAt).toBeTruthy();
  });

  it(
    "notifies terminal runs since the marker once, advances it, and auto-pulls the newest success",
    async () => {
      const completedAt = "2026-06-11T13:00:00.000Z";
      const fetchMock = vi.fn(async (input: unknown) => {
        const url = requestURL(input);
        if (url.pathname === "/v1/background-task-runs") {
          expect(url.searchParams.get("since")).toBe("2026-06-11T11:00:00.000Z");
          return response({
            runs: [
              remoteRun("digest", "sched-temporal-1", "succeeded", completedAt),
              remoteRun("digest", "sched-temporal-0", "failed", "2026-06-11T12:30:00.000Z"),
              remoteRun("watch", "sched-temporal-2", "running", completedAt),
            ],
          });
        }
        if (url.pathname === "/v1/background-tasks/digest/artifact") {
          return response({ slug: "digest", body: "# Digest\n\nfresh", revision: 3 });
        }
        throw new Error(`unexpected: ${url.pathname}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      await seedLocalTask("digest");
      const { checkOfflineReturn, writeCloudRunsSeenState, readCloudRunsSeenState } =
        await import("./cloud-runs-state.js");
      await writeCloudRunsSeenState({
        version: 1,
        lastSeenCloudRunAt: "2026-06-11T11:00:00.000Z",
        lastNotifiedRunIds: [],
      });

      const payload = await checkOfflineReturn();
      expect(payload).not.toBeNull();
      expect(payload?.count).toBe(2); // running run is not notified
      expect(payload?.runs.map((r) => r.runId).sort()).toEqual([
        "sched-temporal-0",
        "sched-temporal-1",
      ]);

      // The newest successful run's artifact was pulled (not_pulled → pull).
      const pulled = await fs.readFile(
        path.join(workDir, "bg-tasks", "digest", "index.md"),
        "utf8",
      );
      expect(pulled).toContain("fresh");

      // Marker advanced past everything seen; a second sweep is quiet.
      const state = await readCloudRunsSeenState();
      expect(state?.lastSeenCloudRunAt).toBe(completedAt);
      expect(state?.lastNotifiedRunIds).toContain("sched-temporal-1");

      fetchMock.mockImplementation(async (input: unknown) => {
        const url = requestURL(input);
        if (url.pathname === "/v1/background-task-runs") {
          return response({ runs: [] });
        }
        throw new Error(`unexpected: ${url.pathname}`);
      });
      const second = await checkOfflineReturn();
      expect(second).toBeNull();
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "does not repeat-notify runs already shown even if they reappear in the window",
    async () => {
      const fetchMock = vi.fn(async (input: unknown) => {
        const url = requestURL(input);
        if (url.pathname === "/v1/background-task-runs") {
          return response({
            runs: [remoteRun("digest", "already-seen", "failed", "2026-06-11T12:30:00.000Z")],
          });
        }
        throw new Error(`unexpected: ${url.pathname}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const { checkOfflineReturn, writeCloudRunsSeenState } = await import("./cloud-runs-state.js");
      await writeCloudRunsSeenState({
        version: 1,
        lastSeenCloudRunAt: "2026-06-11T11:00:00.000Z",
        lastNotifiedRunIds: ["already-seen"],
      });

      expect(await checkOfflineReturn()).toBeNull();
    },
    INTEGRATION_TIMEOUT_MS,
  );
});
