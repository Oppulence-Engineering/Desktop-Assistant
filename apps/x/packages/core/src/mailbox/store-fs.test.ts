import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { PersistentMailboxStore } from "./store-fs.js";
import { makeAccount } from "./factories.testkit.js";

const tmpFiles: string[] = [];

function tmpPath(): string {
  const p = path.join(os.tmpdir(), `mailbox-store-${process.pid}-${tmpFiles.length}.json`);
  tmpFiles.push(p);
  return p;
}

afterEach(() => {
  for (const p of tmpFiles) {
    try {
      fs.rmSync(p, { force: true });
    } catch {
      /* ignore */
    }
  }
  tmpFiles.length = 0;
});

describe("PersistentMailboxStore", () => {
  it("persists state and reloads it from disk", async () => {
    const file = tmpPath();
    const store = new PersistentMailboxStore(file);
    await store.upsertAccount(makeAccount());
    await store.createRule({
      id: "rule_1",
      accountId: makeAccount().id,
      name: "R",
      enabled: true,
      version: 1,
      runOnThreads: true,
      conditionalOperator: "AND",
      conditions: [],
      learnedPatternIds: [],
      actions: [],
      createdAt: 0,
      updatedAt: 0,
    });
    store.flush();

    const reopened = new PersistentMailboxStore(file);
    expect((await reopened.getAccount(makeAccount().id))?.email).toBe(makeAccount().email);
    expect(await reopened.listRules(makeAccount().id)).toHaveLength(1);
  });

  it("starts empty when no snapshot exists", async () => {
    const store = new PersistentMailboxStore(tmpPath());
    expect(await store.listAccounts()).toHaveLength(0);
  });
});
