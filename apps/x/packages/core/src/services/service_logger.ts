import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { WorkDir } from "../config/config.js";
import { IdGen } from "../application/lib/id-gen.js";
import type { ServiceEventType } from "@x/shared/dist/service-events.js";
import { serviceBus } from "./service_bus.js";

type ServiceNameType = ServiceEventType["service"];
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type ServiceEventInput = DistributiveOmit<ServiceEventType, "ts">;

const LOG_DIR = path.join(WorkDir, "logs");
const LOG_FILE = path.join(LOG_DIR, "services.jsonl");
const MAX_LOG_BYTES = 10 * 1024 * 1024;

/**
 * Rotated logs to keep, newest first. Ten of them plus the live file caps this
 * directory at ~110MB.
 *
 * Rotation existed; deletion did not. On a real install that had left 52 files
 * and 516MB behind — and during an incident, when every poll writes errors,
 * this rotates roughly every half hour, so the directory grew about half a
 * gigabyte a day for as long as the fault lasted. A log directory that grows
 * without bound is a second failure stacked on the first.
 */
const KEEP_ROTATED_LOGS = 10;
const ROTATED_PATTERN = /^services\..+\.jsonl$/;

export type ServiceRunContext = {
    runId: string;
    service: ServiceNameType;
    startedAt: number;
};

function safeTimestampForFile(ts: string): string {
    return ts.replace(/[:.]/g, "-");
}

/**
 * Delete all but the newest {@link KEEP_ROTATED_LOGS} rotated logs.
 *
 * Sorted by mtime rather than filename: the names are timestamped and do sort
 * lexically today, but that is a property of the current format, and losing
 * the wrong file here is not worth the coupling.
 *
 * Best-effort throughout — pruning must never be able to stop the app logging.
 *
 * @returns Paths that were removed.
 */
export async function pruneRotatedLogs(dir: string = LOG_DIR): Promise<string[]> {
    let entries: string[];
    try {
        entries = await fsp.readdir(dir);
    } catch {
        return [];
    }

    const rotated = entries.filter((name) => ROTATED_PATTERN.test(name) && name !== "services.jsonl");
    if (rotated.length <= KEEP_ROTATED_LOGS) return [];

    const withTime = await Promise.all(
        rotated.map(async (name) => {
            const full = path.join(dir, name);
            try {
                return { full, mtime: (await fsp.stat(full)).mtimeMs };
            } catch {
                return { full, mtime: 0 };
            }
        }),
    );
    withTime.sort((a, b) => b.mtime - a.mtime);

    const removed: string[] = [];
    for (const { full } of withTime.slice(KEEP_ROTATED_LOGS)) {
        try {
            await fsp.rm(full, { force: true });
            removed.push(full);
        } catch {
            // Leave it; the next rotation tries again.
        }
    }
    return removed;
}

export class ServiceLogger {
    private idGen = new IdGen();
    private stream: fs.WriteStream | null = null;
    private currentSize = 0;
    private initialized = false;
    private writeQueue: Promise<void> = Promise.resolve();
    /** One console line per outage, not one per dropped event. */
    private warnedWriteFailure = false;

    private async ensureReady(): Promise<void> {
        if (this.initialized) return;
        await fsp.mkdir(LOG_DIR, { recursive: true });
        try {
            const stats = await fsp.stat(LOG_FILE);
            this.currentSize = stats.size;
        } catch {
            this.currentSize = 0;
        }
        this.stream = fs.createWriteStream(LOG_FILE, { flags: "a", encoding: "utf8" });
        // A stream that dies (disk full, the file removed underneath us) stays
        // an object that accepts write() and drops it. Reopen on the next event
        // instead of silently discarding everything from here on.
        this.stream.on("error", (error) => {
            console.error("[ServiceLogger] Log stream error; reopening:", error);
            this.stream = null;
            this.initialized = false;
        });
        this.initialized = true;
    }

    private async rotateIfNeeded(nextBytes: number): Promise<void> {
        if (this.currentSize + nextBytes <= MAX_LOG_BYTES) return;
        if (this.stream) {
            const stream = this.stream;
            this.stream = null;
            await new Promise<void>((resolve) => {
                let settled = false;
                const done = () => {
                    if (settled) return;
                    settled = true;
                    resolve();
                };
                stream.once("error", done);
                stream.end(done);
            });
        }
        const ts = safeTimestampForFile(new Date().toISOString());
        const rotatedPath = path.join(LOG_DIR, `services.${ts}.jsonl`);
        try {
            await fsp.rename(LOG_FILE, rotatedPath);
        } catch {
            // Ignore if file doesn't exist or rename fails
        }
        this.currentSize = 0;
        this.stream = fs.createWriteStream(LOG_FILE, { flags: "a", encoding: "utf8" });
        // Rotation is the only moment the count changes, so it is the only
        // moment worth checking.
        await pruneRotatedLogs();
    }

    async log(event: ServiceEventInput): Promise<void> {
        const payload = {
            ...event,
            ts: new Date().toISOString(),
        } as ServiceEventType;
        const line = JSON.stringify(payload) + "\n";
        const bytes = Buffer.byteLength(line, "utf8");

        // The queue must never be left rejected.
        //
        // `writeQueue.then(fn)` on a rejected promise does not run fn — it
        // propagates the rejection — so a single failure here (a full disk, a
        // transient EMFILE opening the stream) would make every later log()
        // skip its work and reject as well. Service logging would be dead for
        // the rest of the process from one bad moment, and the Data health
        // panel would simply stop updating with nothing to say why.
        //
        // Callers do `await serviceLogger.log(...)` inside their own try/catch,
        // so a rejection here would also be reported as a failure of the work
        // being logged. Diagnostics must not become the thing that breaks the
        // job they are describing.
        this.writeQueue = this.writeQueue
            .then(async () => {
                await this.ensureReady();
                await this.rotateIfNeeded(bytes);
                this.stream?.write(line);
                this.currentSize += bytes;
                this.warnedWriteFailure = false;
                try {
                    await serviceBus.publish(payload);
                } catch {
                    // Ignore publish errors to avoid blocking log writes
                }
            })
            .catch((error) => {
                if (!this.warnedWriteFailure) {
                    this.warnedWriteFailure = true;
                    console.error("[ServiceLogger] Could not write service log:", error);
                }
            });

        return this.writeQueue;
    }

    async startRun(opts: {
        service: ServiceNameType;
        message: string;
        trigger?: "timer" | "manual" | "startup";
        config?: Record<string, unknown>;
    }): Promise<ServiceRunContext> {
        const runId = `${opts.service}_${await this.idGen.next()}`;
        const startedAt = Date.now();
        await this.log({
            type: "run_start",
            service: opts.service,
            runId,
            level: "info",
            message: opts.message,
            trigger: opts.trigger,
            config: opts.config,
        });
        return { runId, service: opts.service, startedAt };
    }
}

export const serviceLogger = new ServiceLogger();
