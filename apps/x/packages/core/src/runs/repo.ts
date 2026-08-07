import z from "zod";
import { IMonotonicallyIncreasingIdGenerator } from "../application/lib/id-gen.js";
import { WorkDir } from "../config/config.js";
import path from "path";
import fsp from "fs/promises";
import fs from "fs";
import readline from "readline";
import { Run, RunEvent, StartEvent, ListRunsOptions, ListRunsResponse, MessageEvent, UseCase } from "@x/shared/dist/runs.js";

/**
 * Reading-only schemas: extend the canonical `StartEvent` / `RunEvent` to
 * accept legacy run files written before `model`/`provider` were required.
 *
 * `RunEvent.or(LegacyStartEvent)` works because zod unions try left-to-right:
 * for any non-start event RunEvent matches first; for a strict start event
 * RunEvent still matches; only a legacy start event falls through and parses
 * as LegacyStartEvent. New event types stay maintained in one place
 * (`@x/shared/dist/runs.js`) — the lenient form just adds one fallback variant.
 */
const LegacyStartEvent = StartEvent.extend({
    model: z.string().optional(),
    provider: z.string().optional(),
    // Pre-rename run files carry `useCase: "track_block"`. Map it to its
    // canonical successor on read so the strict downstream types never see
    // the old value. Read-only — writes always use the current enum.
    useCase: z.preprocess(
        (v) => (v === 'track_block' ? 'live_note_agent' : v),
        StartEvent.shape.useCase,
    ),
});
const ReadRunEvent = RunEvent.or(LegacyStartEvent);

export type CreateRunRepoOptions = {
    agentId: string;
    model: string;
    provider: string;
    permissionMode: "manual" | "auto";
    useCase: z.infer<typeof UseCase>;
    subUseCase?: string;
};

const RUNS_DIR = path.join(WorkDir, 'runs');

/**
 * Log path for one run. All three uses — appendEvents, fetch, delete — take a
 * runId that can come straight from the renderer (`runs:createMessage`,
 * `runs:fetch`, `runs:delete`), so the check belongs here rather than at any
 * one handler.
 *
 * Same basename rule the sibling `runs:downloadLog` channel already applies;
 * that one was guarded while fetch and delete were not. Deliberately NOT an
 * IdGen-format regex: `list()` derives run ids from any `*.jsonl` basename, so
 * a stricter rule would produce runs that appear in the list and then fail to
 * open.
 */
function runLogPath(runId: string): string {
    const fileName = `${runId}.jsonl`;
    if (path.basename(fileName) !== fileName) {
        throw new Error(`Invalid run id: ${runId}`);
    }
    return path.join(RUNS_DIR, fileName);
}

export interface IRunsRepo {
    create(options: CreateRunRepoOptions): Promise<z.infer<typeof Run>>;
    fetch(id: string): Promise<z.infer<typeof Run>>;
    list(opts?: z.infer<typeof ListRunsOptions>): Promise<z.infer<typeof ListRunsResponse>>;
    appendEvents(runId: string, events: z.infer<typeof RunEvent>[]): Promise<void>;
    delete(id: string): Promise<void>;
}

/**
 * Strip attached-files XML from message content for title display (keeps @mentions)
 */
function cleanContentForTitle(content: string): string {
    // Remove the entire attached-files block
    let cleaned = content.replace(/<attached-files>\s*[\s\S]*?\s*<\/attached-files>/g, '');

    // Clean up extra whitespace
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    return cleaned;
}

export class FSRunsRepo implements IRunsRepo {
    private idGenerator: IMonotonicallyIncreasingIdGenerator;
    constructor({
        idGenerator,
    }: {
        idGenerator: IMonotonicallyIncreasingIdGenerator;
    }) {
        this.idGenerator = idGenerator;
        // ensure default runs directory exists
        fsp.mkdir(path.join(WorkDir, 'runs'), { recursive: true });
    }

    private extractTitle(events: z.infer<typeof RunEvent>[]): string | undefined {
        for (const event of events) {
            if (event.type === 'message') {
                const messageEvent = event as z.infer<typeof MessageEvent>;
                if (messageEvent.message.role === 'user') {
                    const content = messageEvent.message.content;
                    let textContent: string | undefined;
                    if (typeof content === 'string') {
                        textContent = content;
                    } else {
                        textContent = content
                            .filter(p => p.type === 'text')
                            .map(p => p.text)
                            .join('');
                    }
                    if (textContent && textContent.trim()) {
                        const cleaned = cleanContentForTitle(textContent);
                        if (!cleaned) continue;
                        return cleaned.length > 100 ? cleaned.substring(0, 100) : cleaned;
                    }
                }
            }
        }
        return undefined;
    }

    /**
     * Read file line-by-line using streams, stopping early once we have
     * the start event and title (or determine there's no title).
     *
     * Parses the start event with `LegacyStartEvent` so runs written before
     * `model`/`provider` were required still surface in the list view.
     */
    private async readRunMetadata(filePath: string): Promise<{
        start: z.infer<typeof LegacyStartEvent>;
        title: string | undefined;
    } | null> {
        return new Promise((resolve) => {
            const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
            const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

            // readline does not forward input errors when driven by events (it
            // does under `for await`, which is why the file-reading code is
            // safe and this is not). Unhandled, an ENOENT here is an uncaught
            // exception, and listing runs walks the directory first — so a run
            // deleted between readdir and open, by pruneRunLogs or by the user,
            // took the process down. A metadata read that fails is a run we
            // cannot describe, not a fatal condition.
            stream.on('error', () => {
                rl.close();
                resolve(null);
            });

            let start: z.infer<typeof LegacyStartEvent> | null = null;
            let title: string | undefined;
            let lineIndex = 0;

            rl.on('line', (line) => {
                const trimmed = line.trim();
                if (!trimmed) return;

                try {
                    if (lineIndex === 0) {
                        start = LegacyStartEvent.parse(JSON.parse(trimmed));
                    } else {
                        // Subsequent lines - look for first user message or assistant response
                        const event = ReadRunEvent.parse(JSON.parse(trimmed));
                        if (event.type === 'message') {
                            const msg = event.message;
                            if (msg.role === 'user') {
                                // Found first user message - use as title
                                const content = msg.content;
                                let textContent: string | undefined;
                                if (typeof content === 'string') {
                                    textContent = content;
                                } else {
                                    textContent = content
                                        .filter(p => p.type === 'text')
                                        .map(p => p.text)
                                        .join('');
                                }
                                if (textContent && textContent.trim()) {
                                    const cleaned = cleanContentForTitle(textContent);
                                    if (cleaned) {
                                        title = cleaned.length > 100 ? cleaned.substring(0, 100) : cleaned;
                                    }
                                }
                                // Stop reading
                                rl.close();
                                stream.destroy();
                                return;
                            } else if (msg.role === 'assistant') {
                                // Assistant responded before any user message - no title
                                rl.close();
                                stream.destroy();
                                return;
                            }
                        }
                    }
                    lineIndex++;
                } catch {
                    // Skip malformed lines
                }
            });

            rl.on('close', () => {
                if (start) {
                    resolve({ start, title });
                } else {
                    resolve(null);
                }
            });

            rl.on('error', () => {
                resolve(null);
            });

            stream.on('error', () => {
                rl.close();
                resolve(null);
            });
        });
    }

    async appendEvents(runId: string, events: z.infer<typeof RunEvent>[]): Promise<void> {
        await fsp.appendFile(
            runLogPath(runId),
            events.map(event => JSON.stringify(event)).join("\n") + "\n"
        );
    }

    async create(options: CreateRunRepoOptions): Promise<z.infer<typeof Run>> {
        const runId = await this.idGenerator.next();
        const ts = new Date().toISOString();
        const start: z.infer<typeof StartEvent> = {
            type: "start",
            runId,
            agentName: options.agentId,
            model: options.model,
            provider: options.provider,
            permissionMode: options.permissionMode,
            useCase: options.useCase,
            ...(options.subUseCase ? { subUseCase: options.subUseCase } : {}),
            subflow: [],
            ts,
        };
        await this.appendEvents(runId, [start]);
        return {
            id: runId,
            createdAt: ts,
            agentId: options.agentId,
            model: options.model,
            provider: options.provider,
            permissionMode: options.permissionMode,
            useCase: options.useCase,
            ...(options.subUseCase ? { subUseCase: options.subUseCase } : {}),
            log: [start],
        };
    }

    async fetch(id: string): Promise<z.infer<typeof Run>> {
        const contents = await fsp.readFile(runLogPath(id), 'utf8');
        // Parse with the lenient schema so legacy start events (no model/provider) load.
        //
        // Malformed lines are skipped, not fatal. A crash mid-write leaves a
        // truncated final line, and one such line used to make the run
        // permanently unopenable — including for authorizePermission, which
        // fetches the run to decide a pending tool call. A run missing one
        // event beats a run that cannot be opened at all; the sibling
        // readRunMetadata already tolerates malformed lines the same way.
        let skipped = 0;
        const rawEvents = contents.split('\n')
            .filter(line => line.trim() !== '')
            .flatMap(line => {
                try {
                    return [ReadRunEvent.parse(JSON.parse(line))];
                } catch {
                    skipped += 1;
                    return [];
                }
            });
        if (skipped > 0) {
            console.warn(`[Runs] ${id}: skipped ${skipped} malformed line${skipped === 1 ? '' : 's'}`);
        }
        if (rawEvents.length === 0 || rawEvents[0].type !== 'start') {
            throw new Error('Corrupt run data');
        }
        // Backfill model/provider on the start event from current defaults if missing,
        // then promote to the canonical strict types for callers.
        const rawStart = rawEvents[0];
        const defaults = (!rawStart.model || !rawStart.provider)
            ? await import("../models/defaults.js").then(m => m.getDefaultModelAndProvider())
            : null;
        const start: z.infer<typeof StartEvent> = {
            ...rawStart,
            model: rawStart.model ?? defaults!.model,
            provider: rawStart.provider ?? defaults!.provider,
        };
        const events: z.infer<typeof RunEvent>[] = [start, ...rawEvents.slice(1) as z.infer<typeof RunEvent>[]];
        const title = this.extractTitle(events);
        return {
            id,
            title,
            createdAt: start.ts!,
            agentId: start.agentName,
            model: start.model,
            provider: start.provider,
            permissionMode: start.permissionMode ?? "manual",
            ...(start.useCase ? { useCase: start.useCase } : {}),
            ...(start.subUseCase ? { subUseCase: start.subUseCase } : {}),
            log: events,
        };
    }

    async list(opts: z.infer<typeof ListRunsOptions> = {}): Promise<z.infer<typeof ListRunsResponse>> {
        const runsDir = path.join(WorkDir, 'runs');
        const requestedPageSize = opts.limit ?? 20;
        const pageSize = Math.max(1, Math.min(100, requestedPageSize));
        const agentIdFilter = opts.agentId?.trim() || undefined;

        let files: string[] = [];
        try {
            const entries = await fsp.readdir(runsDir, { withFileTypes: true });
            files = entries
                .filter(e => e.isFile() && e.name.endsWith('.jsonl'))
                .map(e => e.name);
        } catch (err: unknown) {
            const e = err as { code?: string };
            if (e.code === 'ENOENT') {
                return { runs: [] };
            }
            throw err;
        }

        files.sort((a, b) => b.localeCompare(a));

        const cursorFile = opts.cursor;
        let startIndex = 0;
        if (cursorFile) {
            const exact = files.indexOf(cursorFile);
            if (exact >= 0) {
                startIndex = exact + 1;
            } else {
                const firstOlder = files.findIndex(name => name.localeCompare(cursorFile) < 0);
                startIndex = firstOlder === -1 ? files.length : firstOlder;
            }
        }

        const runs: z.infer<typeof ListRunsResponse>['runs'] = [];
        let index = startIndex;
        let lastExamined: string | undefined;

        while (index < files.length && runs.length < pageSize) {
            const name = files[index]!;
            index += 1;
            lastExamined = name;
            const runId = name.slice(0, -'.jsonl'.length);
            const metadata = await this.readRunMetadata(path.join(runsDir, name));
            if (!metadata) {
                continue;
            }
            if (agentIdFilter && metadata.start.agentName !== agentIdFilter) {
                continue;
            }
            runs.push({
                id: runId,
                title: metadata.title,
                createdAt: metadata.start.ts!,
                agentId: metadata.start.agentName,
            });
        }

        const nextCursor = index < files.length && lastExamined
            ? lastExamined
            : undefined;

        return {
            runs,
            ...(nextCursor ? { nextCursor } : {}),
        };
    }

    async delete(id: string): Promise<void> {
        await fsp.unlink(runLogPath(id));
    }
}

/**
 * Runs kept regardless of age. A light user with a few hundred runs over two
 * years keeps all of them; the cap only bites on machines producing thousands.
 */
const MIN_RUNS_KEPT = 500;
const MAX_RUN_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Delete run logs older than 30 days, past the first {@link MIN_RUNS_KEPT}.
 *
 * Nothing pruned these. `delete` exists but is only reachable from the IPC a
 * person clicks, so the directory grew for the life of the install — every
 * background batch writes one, and email labeling alone writes ~90 per sweep.
 * The evidence is on disk: 22,830 files and 2.4GB in runs-archive from an
 * earlier era of the same directory.
 *
 * Age *and* a floor, deliberately. A pure count cap would delete a careful
 * user's history the moment a background backlog outnumbered it; a pure age
 * cap would wipe a machine that had been offline for a month.
 *
 * Best-effort: a run that will not delete is left for the next start.
 *
 * @returns Number of run logs removed.
 */
export async function pruneRunLogs(now: number = Date.now()): Promise<number> {
    let names: string[];
    try {
        names = (await fsp.readdir(RUNS_DIR)).filter((n) => n.endsWith(".jsonl"));
    } catch {
        return 0;
    }
    if (names.length <= MIN_RUNS_KEPT) return 0;

    const stated = await Promise.all(
        names.map(async (name) => {
            const full = path.join(RUNS_DIR, name);
            try {
                return { full, mtime: (await fsp.stat(full)).mtimeMs };
            } catch {
                return { full, mtime: now };
            }
        }),
    );
    stated.sort((a, b) => b.mtime - a.mtime);

    let removed = 0;
    for (const { full, mtime } of stated.slice(MIN_RUNS_KEPT)) {
        if (now - mtime <= MAX_RUN_AGE_MS) continue;
        try {
            await fsp.rm(full, { force: true });
            removed += 1;
        } catch {
            // Leave it; the next start tries again.
        }
    }
    return removed;
}
