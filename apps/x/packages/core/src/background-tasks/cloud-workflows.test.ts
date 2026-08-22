import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stringify as stringifyYaml } from "yaml";
import type { BackgroundTask, BackgroundTaskCloudRunType } from "@x/shared/background-task";
import type { RowboatEvent } from "@x/shared/events";

let tmpDir: string;
let workDir: string;

const now = "2026-06-05T12:00:00.000Z";
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
    JSON.stringify(
      {
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
      },
      null,
      2,
    ),
    "utf8",
  );
}

async function writeTask(slug: string, task: Partial<BackgroundTask> = {}): Promise<void> {
  const dir = path.join(workDir, "bg-tasks", slug);
  await fs.mkdir(dir, { recursive: true });
  const body: BackgroundTask = {
    name: "Cloud workflow smoke",
    instructions: "Write exactly: cloud workflow completed",
    active: true,
    executionTarget: "api",
    createdAt: now,
    ...task,
  };
  await fs.writeFile(path.join(dir, "task.yaml"), stringifyYaml(body), "utf8");
  await fs.writeFile(path.join(dir, "index.md"), `# ${body.name}\n\n`, "utf8");
}

async function writeRun(runId: string): Promise<void> {
  await fs.mkdir(path.join(workDir, "runs"), { recursive: true });
  const start = {
    runId,
    type: "start",
    agentName: "background-task-agent",
    model: "openai/gpt-4.1-mini",
    provider: "openai",
    useCase: "background_task_agent",
    subUseCase: "manual",
    subflow: [],
    ts: now,
  };
  const message = {
    runId,
    type: "message",
    messageId: "message-1",
    message: {
      role: "user",
      content: "Run the desktop task.",
    },
    subflow: [],
  };
  await fs.writeFile(
    path.join(workDir, "runs", `${runId}.jsonl`),
    `${JSON.stringify(start)}\n${JSON.stringify(message)}\n`,
    "utf8",
  );
}

function cloudRun(
  slug: string,
  runId: string,
  status: BackgroundTaskCloudRunType["status"] = "queued",
): BackgroundTaskCloudRunType {
  return {
    id: runId,
    runId,
    slug,
    trigger: "manual",
    status,
    executor: "api",
    temporalWorkflowId: `background-task/test-user/${slug}/${runId}`,
    temporalRunId: `temporal-${runId}`,
    temporalStatus: status === "queued" ? "RUNNING" : "COMPLETED",
    createdAt: now,
    updatedAt: now,
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

function requestMethod(init: RequestInit | undefined): string {
  return (init?.method ?? "GET").toUpperCase();
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "solomon-cloud-workflows-test-"));
  workDir = path.join(tmpDir, "workspace");
  process.env.SOLOMON_WORKDIR = workDir;
  process.env.API_URL = "http://solomon-api.test";
  vi.resetModules();
  mockConfigSideEffects();
});

afterEach(async () => {
  delete process.env.SOLOMON_WORKDIR;
  delete process.env.API_URL;
  vi.unstubAllGlobals();
  vi.doUnmock("../knowledge/version_history.js");
  vi.doUnmock("../knowledge/deprecate_today_note.js");
  vi.resetModules();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("background task cloud workflows", () => {
  it(
    "mirrors an API-target desktop task, triggers an API worker run, and records the cloud run id locally",
    async () => {
      const slug = "cloud-workflow-smoke";
      await writeOAuthToken();
      await writeTask(slug);

      const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = requestURL(input);
        const method = requestMethod(init);
        const pathname = url.pathname;

        if (method === "GET" && pathname === `/v1/background-tasks/${slug}`) {
          return new Response("not found", { status: 404 });
        }
        if (method === "POST" && pathname === "/v1/background-tasks") {
          return response({ slug, revision: 1 });
        }
        if (method === "POST" && pathname === `/v1/background-tasks/${slug}/trigger`) {
          return response(cloudRun(slug, "cloud-run-1", "queued"));
        }
        if (method === "PATCH" && pathname === `/v1/background-tasks/${slug}`) {
          return response({ slug, revision: 2 });
        }
        throw new Error(`unexpected cloud request: ${method} ${pathname}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const { triggerCloudRun } = await import("./cloud-sync.js");
      const run = await triggerCloudRun(slug, "manual", "from desktop smoke");

      expect(run).toMatchObject({
        runId: "cloud-run-1",
        executor: "api",
        temporalWorkflowId: expect.stringContaining(slug),
      });

      const createCall = fetchMock.mock.calls.find(
        ([input, init]) =>
          requestMethod(init as RequestInit | undefined) === "POST" &&
          requestURL(input).pathname === "/v1/background-tasks",
      );
      expect(createCall).toBeTruthy();
      expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
        slug,
        name: "Cloud workflow smoke",
        instructions: "Write exactly: cloud workflow completed",
        executionTarget: "api",
        active: true,
      });

      const triggerCall = fetchMock.mock.calls.find(
        ([input, init]) =>
          requestMethod(init as RequestInit | undefined) === "POST" &&
          requestURL(input).pathname === `/v1/background-tasks/${slug}/trigger`,
      );
      expect(triggerCall).toBeTruthy();
      expect(JSON.parse(String(triggerCall?.[1]?.body))).toMatchObject({
        trigger: "manual",
        context: "from desktop smoke",
      });

      const { fetchTask } = await import("./fileops.js");
      const task = await fetchTask(slug);
      expect(task?.lastRunId).toBe("cloud-run-1");
      expect(task?.lastAttemptAt).toBeTruthy();
      expect(task?.executionTarget).toBe("api");
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it("flushes task sync before reading cloud schedule state", async () => {
    const slug = "schedule-state-sync";
    await writeOAuthToken();
    await writeTask(slug, { triggers: { cronExpr: "*/1 * * * *" } });

    const scheduleState = {
      target: "api",
      triggerSources: ["cron"],
      health: "current",
      mechanism: "temporal_schedule",
      nextDueAt: "2026-06-05T12:01:00.000Z",
      scheduleSyncState: "current",
      sources: {
        cron: {
          health: "current",
          mechanism: "temporal_schedule",
          nextDueAt: "2026-06-05T12:01:00.000Z",
        },
      },
    };
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = requestURL(input);
      const method = requestMethod(init);
      const pathname = url.pathname;

      if (method === "GET" && pathname === `/v1/background-tasks/${slug}`) {
        return new Response("not found", { status: 404 });
      }
      if (method === "POST" && pathname === "/v1/background-tasks") {
        return response({ slug, revision: 1 });
      }
      if (method === "GET" && pathname === `/v1/background-tasks/${slug}/schedule-state`) {
        return response(scheduleState);
      }
      throw new Error(`unexpected cloud request: ${method} ${pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getCloudScheduleState } = await import("./cloud-sync.js");
    await expect(getCloudScheduleState(slug)).resolves.toMatchObject({
      mechanism: "temporal_schedule",
      scheduleSyncState: "current",
    });

    const paths = fetchMock.mock.calls.map(([input]) => requestURL(input).pathname);
    expect(paths).toEqual([
      `/v1/background-tasks/${slug}`,
      "/v1/background-tasks",
      `/v1/background-tasks/${slug}/schedule-state`,
    ]);
  });

  it(
    "refetches and patches the remote task when create races another desktop sync",
    async () => {
      const slug = "cloud-create-conflict";
      await writeOAuthToken();
      await writeTask(slug);
      let getCount = 0;

      const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = requestURL(input);
        const method = requestMethod(init);
        const pathname = url.pathname;

        if (method === "GET" && pathname === `/v1/background-tasks/${slug}`) {
          getCount += 1;
          return getCount === 1
            ? new Response("not found", { status: 404 })
            : response({ slug, revision: 7 });
        }
        if (method === "POST" && pathname === "/v1/background-tasks") {
          return response({ error: "background task already exists", code: "conflict" }, 409);
        }
        if (method === "PATCH" && pathname === `/v1/background-tasks/${slug}`) {
          return response({ slug, revision: 8 });
        }
        if (method === "POST" && pathname === `/v1/background-tasks/${slug}/trigger`) {
          return response(cloudRun(slug, "cloud-run-after-conflict", "queued"));
        }
        throw new Error(`unexpected cloud request: ${method} ${pathname}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const { triggerCloudRun } = await import("./cloud-sync.js");
      const run = await triggerCloudRun(slug);

      expect(run.runId).toBe("cloud-run-after-conflict");
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            requestMethod(init as RequestInit | undefined) === "PATCH" &&
            requestURL(input).pathname === `/v1/background-tasks/${slug}`,
        ),
      ).toBe(true);
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it("syncs desktop transcript events once using known cloud event types", async () => {
    const slug = "desktop-event-sync";
    const runId = "local-run-1";
    await writeOAuthToken();
    await writeTask(slug, { executionTarget: "desktop" });
    await writeRun(runId);

    let remoteRunCreated = false;
    const storedEvents: Array<{ seq: number; type?: string; event: unknown }> = [];
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = requestURL(input);
      const method = requestMethod(init);
      const pathname = url.pathname;

      if (method === "GET" && pathname === `/v1/background-tasks/${slug}`) {
        return response({ slug, revision: 1 });
      }
      if (method === "PATCH" && pathname === `/v1/background-tasks/${slug}`) {
        return response({ slug, revision: 2 });
      }
      if (method === "GET" && pathname === `/v1/background-tasks/${slug}/artifact`) {
        return response({ slug, revision: 1, body: "" });
      }
      if (method === "PUT" && pathname === `/v1/background-tasks/${slug}/artifact`) {
        return response({ slug, revision: 2, body: "# Cloud workflow smoke\n\n" });
      }
      if (method === "GET" && pathname === `/v1/background-tasks/${slug}/runs/${runId}`) {
        if (!remoteRunCreated) return new Response("not found", { status: 404 });
        return response({
          ...cloudRun(slug, runId, "running"),
          executor: "desktop",
          localRunId: runId,
          temporalWorkflowId: undefined,
          temporalRunId: undefined,
        });
      }
      if (method === "POST" && pathname === `/v1/background-tasks/${slug}/runs`) {
        remoteRunCreated = true;
        return response({
          ...cloudRun(slug, runId, "running"),
          executor: "desktop",
          localRunId: runId,
          temporalWorkflowId: undefined,
          temporalRunId: undefined,
        });
      }
      if (method === "GET" && pathname === `/v1/background-tasks/${slug}/runs/${runId}/events`) {
        return response({
          events: storedEvents.map((event, index) => ({
            id: `event-${index}`,
            ...event,
            receivedAt: now,
          })),
        });
      }
      if (method === "POST" && pathname === `/v1/background-tasks/${slug}/runs/${runId}/events`) {
        const body = JSON.parse(String(init?.body));
        storedEvents.push(...body.events);
        return response({ stored: body.events.length, skipped: 0 });
      }
      throw new Error(`unexpected cloud request: ${method} ${pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { syncRunToCloud } = await import("./cloud-sync.js");
    await syncRunToCloud(slug, runId, "manual");
    await syncRunToCloud(slug, runId, "manual");

    const eventPosts = fetchMock.mock.calls.filter(
      ([input, init]) =>
        requestMethod(init as RequestInit | undefined) === "POST" &&
        requestURL(input).pathname === `/v1/background-tasks/${slug}/runs/${runId}/events`,
    );
    expect(eventPosts).toHaveLength(1);
    expect(JSON.parse(String(eventPosts[0]?.[1]?.body))).toMatchObject({
      events: [
        { seq: 0, type: "desktop.start", event: { type: "start" } },
        { seq: 1, type: "desktop.message", event: { type: "message" } },
      ],
    });
  });

  it("skips api-target timed triggers entirely — cloud schedulers own them (RFC 006)", async () => {
    const triggerCloudRun = vi.fn();
    const processRemoteTriggers = vi.fn(async () => undefined);
    const runBackgroundTask = vi.fn(async () => ({
      slug: "desktop-scheduled",
      runId: "local-run",
      summary: null,
    }));
    vi.doMock("./cloud-sync.js", () => ({
      triggerCloudRun,
      processRemoteTriggers,
      syncTaskToCloudBestEffort: vi.fn(),
      deleteTaskFromCloudBestEffort: vi.fn(),
    }));
    vi.doMock("./runner.js", () => ({ runBackgroundTask }));

    const { createTask } = await import("./fileops.js");
    const apiTask = await createTask({
      name: "API scheduled",
      instructions: "Run through the API worker.",
      executionTarget: "api",
      triggers: { cronExpr: "* * * * *" },
    });
    const desktopTask = await createTask({
      name: "Desktop scheduled",
      instructions: "Run locally.",
      executionTarget: "desktop",
      triggers: { cronExpr: "* * * * *" },
    });

    const { processScheduledTasks } = await import("./scheduler.js");
    await processScheduledTasks();

    // The API scheduler loop / Temporal Schedules fire api-target timed
    // triggers even while the desktop is open — firing them here too
    // double-ran every occurrence. Desktop tasks still run locally, and
    // cloud-requested desktop runs still flow via processRemoteTriggers.
    expect(triggerCloudRun).not.toHaveBeenCalled();
    expect(runBackgroundTask).toHaveBeenCalledWith(desktopTask.slug, "cron");
    expect(runBackgroundTask).not.toHaveBeenCalledWith(apiTask.slug, expect.anything());
    expect(processRemoteTriggers).toHaveBeenCalledTimes(1);
  });

  it("routes event-triggered API-target tasks to the cloud worker instead of the local runner", async () => {
    const triggerCloudRun = vi.fn(async (slug: string) =>
      cloudRun(slug, "cloud-event-run", "queued"),
    );
    const runBackgroundTask = vi.fn(async () => ({
      slug: "desktop-event",
      runId: "local-event-run",
      summary: null,
    }));
    vi.doMock("./cloud-sync.js", () => ({
      triggerCloudRun,
      syncTaskToCloudBestEffort: vi.fn(),
      deleteTaskFromCloudBestEffort: vi.fn(),
    }));
    vi.doMock("./runner.js", () => ({ runBackgroundTask }));

    const { createTask } = await import("./fileops.js");
    const { slug } = await createTask({
      name: "API event",
      instructions: "React through the API worker.",
      executionTarget: "api",
      triggers: { eventMatchCriteria: "important events" },
    });
    const event: RowboatEvent = {
      id: "event-1",
      source: "test",
      type: "cloud.workflow.requested",
      createdAt: now,
      payload: "Run this in the cloud.",
    };

    const { backgroundTaskEventConsumer } = await import("./event-consumer.js");
    const result = await backgroundTaskEventConsumer.fireCandidate(event, slug);

    expect(result).toEqual({ runId: "cloud-event-run" });
    expect(triggerCloudRun).toHaveBeenCalledWith(slug, "event", event.payload);
    expect(runBackgroundTask).not.toHaveBeenCalled();
  });
});
