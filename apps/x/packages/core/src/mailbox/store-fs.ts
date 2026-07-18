/**
 * File-backed mailbox store.
 *
 * Persists the in-memory store to a single JSON snapshot under
 * `WorkDir/mailbox/`, matching the repo's filesystem-first persistence
 * convention (there is no SQL database in core). Writes are debounced and
 * atomic (temp file + rename) so a crash mid-write never corrupts state.
 */

import fs from "node:fs";
import path from "node:path";

import { WorkDir } from "../config/config.js";
import { InMemoryMailboxStore, type MailboxStoreState } from "./store.js";

const MAILBOX_DIR = path.join(WorkDir, "mailbox");
const STORE_FILE = path.join(MAILBOX_DIR, "store.json");
const SAVE_DEBOUNCE_MS = 250;

function writeFileAtomic(target: string, data: string): void {
  const dir = path.dirname(target);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, "utf-8");
  fs.renameSync(tmp, target);
}

export class PersistentMailboxStore extends InMemoryMailboxStore {
  private saveTimer: NodeJS.Timeout | null = null;
  private dirty = false;

  constructor(private readonly filePath: string = STORE_FILE) {
    super();
    this.load();
    // Register the persistence hook only after loading so importing the initial
    // snapshot does not schedule a redundant save.
    this.onChange = () => this.scheduleSave();
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = fs.readFileSync(this.filePath, "utf-8");
      const state = JSON.parse(raw) as MailboxStoreState;
      this.importState(normalizeState(state));
    } catch (error) {
      console.warn("[mailbox] failed to load store snapshot:", error);
    }
  }

  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, SAVE_DEBOUNCE_MS);
    // Do not keep the event loop alive solely for a pending mailbox save.
    this.saveTimer.unref?.();
  }

  /** Persist immediately. Safe to call from shutdown paths and tests. */
  flush(): void {
    if (!this.dirty) return;
    try {
      writeFileAtomic(this.filePath, JSON.stringify(this.exportState()));
      this.dirty = false;
    } catch (error) {
      console.warn("[mailbox] failed to persist store snapshot:", error);
    }
  }
}

/** Tolerate older/partial snapshots by filling any missing collection with []. */
function normalizeState(state: Partial<MailboxStoreState>): MailboxStoreState {
  return {
    version: state.version ?? 1,
    accounts: state.accounts ?? [],
    syncState: state.syncState ?? [],
    threadSummaries: state.threadSummaries ?? [],
    rules: state.rules ?? [],
    learnedPatterns: state.learnedPatterns ?? [],
    ruleRuns: state.ruleRuns ?? [],
    actionRuns: state.actionRuns ?? [],
    scheduledActions: state.scheduledActions ?? [],
    digestItems: state.digestItems ?? [],
    trackers: state.trackers ?? [],
    draftSuggestions: state.draftSuggestions ?? [],
    replyMemories: state.replyMemories ?? [],
    senderProfiles: state.senderProfiles ?? [],
    categories: state.categories ?? [],
    proposals: state.proposals ?? [],
  };
}
