import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ProposedCommitment } from "./commitments.js";

const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "commit-race-"));
vi.mock("../config/config.js", () => ({ WorkDir: workDir }));

const { confirmCommitment, readLedger, setCommitmentStatus } =
  await import("./commitment-ledger.js");
const { writeCommitmentProposals, readCommitmentProposals, removeCommitmentProposal } =
  await import("./commitment-store.js");

/**
 * Every mutation in both stores is a read-modify-write over a whole JSON file. Two of
 * those interleaving loses one edit outright — and they interleave in the most ordinary
 * way imaginable, because confirming commitments is what a user does by clicking three
 * buttons in a row while the UI only disables the one it is working on.
 *
 * These are the tests for that. They fail loudly against an unserialized implementation.
 */

function proposal(over: Partial<ProposedCommitment> = {}): ProposedCommitment {
  return {
    owner: "them",
    text: "Send the pricing.",
    confidence: 0.9,
    evidence: "I'll send the revised pricing by Friday",
    start_ms: 0,
    end_ms: 1000,
    ...over,
  };
}

describe("concurrent ledger writes", () => {
  beforeEach(async () => {
    await fs.rm(path.join(workDir, "commitments.json"), { force: true });
  });
  afterEach(async () => {
    await fs.rm(path.join(workDir, "commitments.json"), { force: true });
  });

  it("keeps every commitment confirmed at once", async () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      proposal({ start_ms: i * 1000, end_ms: i * 1000 + 500, text: `Task ${i}.` }),
    );
    await Promise.all(many.map((p) => confirmCommitment({ proposal: p, sessionId: "s1" })));

    const ledger = await readLedger();
    expect(ledger).toHaveLength(25);
    expect(new Set(ledger.map((row) => row.id)).size).toBe(25);
  });

  it("keeps every status change applied at once", async () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      proposal({ start_ms: i * 1000, end_ms: i * 1000 + 500 }),
    );
    const entries = [];
    for (const p of many) entries.push(await confirmCommitment({ proposal: p, sessionId: "s1" }));

    await Promise.all(entries.map((entry) => setCommitmentStatus(entry.id, "done")));
    expect((await readLedger()).every((row) => row.status === "done")).toBe(true);
  });

  it("stays consistent when confirms and status changes interleave", async () => {
    const first = await confirmCommitment({ proposal: proposal(), sessionId: "s1" });
    await Promise.all([
      confirmCommitment({ proposal: proposal({ start_ms: 5000, end_ms: 6000 }), sessionId: "s1" }),
      setCommitmentStatus(first.id, "done"),
      confirmCommitment({ proposal: proposal({ start_ms: 7000, end_ms: 8000 }), sessionId: "s1" }),
    ]);

    const ledger = await readLedger();
    expect(ledger).toHaveLength(3);
    expect(ledger.find((row) => row.id === first.id)?.status).toBe("done");
  });

  it("one failing write does not wedge every write after it", async () => {
    // The queue is kept alive across a rejection on purpose; a chain that stops on the
    // first error would silently swallow every later confirmation.
    await expect(setCommitmentStatus("does-not-exist", "done")).resolves.toBe(false);
    await confirmCommitment({ proposal: proposal(), sessionId: "s1" });
    expect(await readLedger()).toHaveLength(1);
  });
});

describe("concurrent proposal dismissals", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "props-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("dismissing several at once removes exactly those", async () => {
    const proposals = Array.from({ length: 12 }, (_, i) =>
      proposal({ start_ms: i * 1000, end_ms: i * 1000 + 500 }),
    );
    await writeCommitmentProposals(dir, { proposals });

    // Dismiss the even ones simultaneously. An unserialized rewrite would resurrect
    // whichever ones lost the race.
    await Promise.all(
      proposals
        .filter((_, i) => i % 2 === 0)
        .map((p) => removeCommitmentProposal(dir, p.start_ms, p.end_ms)),
    );

    const left = (await readCommitmentProposals(dir))!.proposals;
    expect(left).toHaveLength(6);
    expect(left.every((p) => p.start_ms % 2000 === 1000)).toBe(true);
  });

  it("dismissing the same one twice reports the second as a no-op", async () => {
    await writeCommitmentProposals(dir, { proposals: [proposal()] });
    const [a, b] = await Promise.all([
      removeCommitmentProposal(dir, 0, 1000),
      removeCommitmentProposal(dir, 0, 1000),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });
});
