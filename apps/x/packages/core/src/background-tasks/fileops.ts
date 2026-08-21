import fs from 'fs/promises';
import path from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
    BackgroundTaskSchema,
    type BackgroundTask,
    type BackgroundTaskSummary,
} from '@x/shared/background-task';
import { WorkDir } from '../config/config.js';
import { withFileLock } from '../knowledge/file-lock.js';
import { writeJsonAtomic } from "../filesystem/atomic_write.js";

const BG_TASKS_DIR = path.join(WorkDir, 'bg-tasks');

function syncTaskBestEffort(slug: string): void {
    void import('./cloud-sync.js')
        .then(mod => mod.syncTaskToCloudBestEffort(slug))
        .catch(err => {
            console.log(`[BgTask:Cloud] ${slug} — task sync unavailable: ${err instanceof Error ? err.message : String(err)}`);
        });
}

function deleteCloudTaskBestEffort(slug: string): void {
    void import('./cloud-sync.js')
        .then(mod => mod.deleteTaskFromCloudBestEffort(slug))
        .catch(err => {
            console.log(`[BgTask:Cloud] ${slug} — delete sync unavailable: ${err instanceof Error ? err.message : String(err)}`);
        });
}

/**
 * Directory for one task. Every other bg-task path helper funnels through here,
 * so this is the single place the slug has to be trusted.
 *
 * Slugs reach these helpers from three untrusted-ish directions — the renderer
 * (`bg-task:*` IPC, typed only as `z.string()`), LLM builtin tools, and cloud
 * artifact responses — and `deleteTask` ends in
 * `fs.rm(taskDir(slug), { recursive: true, force: true })`. A slug of ".." or
 * "" therefore recursively deleted the workspace, or the whole bg-tasks root,
 * and `force: true` meant it did so silently.
 *
 * The rule is single-segment-inside-root, matching MeetingController.sessionPath
 * and the case pinned in meetings/traversal.test.ts. Deliberately NOT a
 * slugify/charset regex: `listTasks` treats any non-dot directory name as a
 * task, so a hand-created folder like "My Task" is legitimate and must keep
 * working.
 */
function taskDir(slug: string): string {
    const dir = path.join(BG_TASKS_DIR, slug);
    if (path.dirname(path.resolve(dir)) !== path.resolve(BG_TASKS_DIR)) {
        throw new Error(`Invalid task slug: ${slug}`);
    }
    return dir;
}

export function taskYamlPath(slug: string): string {
    return path.join(taskDir(slug), 'task.yaml');
}

export function taskIndexPath(slug: string): string {
    return path.join(taskDir(slug), 'index.md');
}

/**
 * Sidecar at `bg-tasks/<slug>/.artifact-sync.json` recording the remote artifact
 * revision the local index.md was last pulled from, so the UI can tell whether
 * the cloud has moved ahead (`remote newer`) or a pull failed. Hidden file → it
 * is skipped by `listTasks` (which ignores dot-entries) and never confused with
 * a task. Best-effort: a missing/corrupt sidecar simply reads as "not pulled".
 */
export function artifactSyncPath(slug: string): string {
    return path.join(taskDir(slug), '.artifact-sync.json');
}

export interface ArtifactSyncRecord {
    revision: number;
    pulledAt: string;
    lastError?: string;
}

export async function readArtifactSync(slug: string): Promise<ArtifactSyncRecord | null> {
    try {
        const raw = await fs.readFile(artifactSyncPath(slug), 'utf-8');
        const parsed = JSON.parse(raw) as Partial<ArtifactSyncRecord>;
        if (typeof parsed.revision !== 'number') return null;
        return {
            revision: parsed.revision,
            pulledAt: typeof parsed.pulledAt === 'string' ? parsed.pulledAt : '',
            ...(parsed.lastError ? { lastError: parsed.lastError } : {}),
        };
    } catch {
        return null;
    }
}

export async function writeArtifactSync(slug: string, record: ArtifactSyncRecord): Promise<void> {
    try {
        await writeJsonAtomic(artifactSyncPath(slug), record);
    } catch {
        // Sidecar is advisory; a write failure must not break the pull itself.
    }
}

export async function indexExists(slug: string): Promise<boolean> {
    try {
        await fs.access(taskIndexPath(slug));
        return true;
    } catch {
        return false;
    }
}

/**
 * Plain-text pointer file at `bg-tasks/<slug>/runs.log`. Each line is a runId
 * (the canonical id of a run whose jsonl lives at the global location
 * `$WorkDir/runs/<runId>.jsonl`). Newest first: the runner prepends on each
 * start, so reading top-down gives most-recent-first ordering without sorting.
 */
export function taskRunsLogPath(slug: string): string {
    return path.join(taskDir(slug), 'runs.log');
}

// ---------------------------------------------------------------------------
// Slug
// ---------------------------------------------------------------------------

const MAX_SLUG_LEN = 60;

export function slugify(name: string): string {
    const base = name
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/[\s_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, MAX_SLUG_LEN);
    return base || 'task';
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function fetchTask(slug: string): Promise<BackgroundTask | null> {
    let raw: string;
    try {
        raw = await fs.readFile(taskYamlPath(slug), 'utf-8');
    } catch {
        return null;
    }
    let parsed: unknown;
    try {
        parsed = parseYaml(raw);
    } catch {
        return null;
    }
    const result = BackgroundTaskSchema.safeParse(parsed);
    return result.success ? result.data : null;
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Merge a partial update into the task.yaml. Used by the renderer for
 * structural edits (active toggle, instructions, triggers, model) and by the
 * runner for the `lastRun*` runtime fields.
 */
export async function patchTask(slug: string, partial: Partial<BackgroundTask>): Promise<BackgroundTask> {
    const next = await withFileLock(taskYamlPath(slug), async () => {
        const current = await fetchTask(slug);
        if (!current) {
            throw new Error(`Task '${slug}' not found`);
        }
        const next: BackgroundTask = { ...current, ...partial };
        await fs.writeFile(taskYamlPath(slug), stringifyYaml(next), 'utf-8');
        return next;
    });
    syncTaskBestEffort(slug);
    return next;
}

export interface CreateTaskInput {
    name: string;
    instructions: string;
    triggers?: BackgroundTask['triggers'];
    model?: string;
    provider?: string;
    executionTarget?: BackgroundTask['executionTarget'];
}

/**
 * Create a new bg-task folder + task.yaml + empty index.md. Returns the slug
 * assigned (which may include `-2`, `-3`, … suffix if the natural slug
 * collides with an existing folder). Slug collisions retry up to 50 times
 * before giving up. Note: runs.log is created lazily on the first run.
 */
export async function createTask(input: CreateTaskInput): Promise<{ slug: string }> {
    await fs.mkdir(BG_TASKS_DIR, { recursive: true });

    const baseSlug = slugify(input.name);
    let slug = baseSlug;
    let attempt = 1;
    while (true) {
        try {
            await fs.mkdir(taskDir(slug), { recursive: false });
            break;
        } catch (err: unknown) {
            const e = err as { code?: string };
            if (e.code === 'EEXIST') {
                attempt += 1;
                if (attempt > 50) {
                    throw new Error(`Slug collision: could not find a free slug after ${attempt - 1} attempts`);
                }
                slug = `${baseSlug}-${attempt}`;
                continue;
            }
            throw err;
        }
    }

    const task: BackgroundTask = {
        name: input.name,
        instructions: input.instructions,
        active: true,
        ...(input.triggers ? { triggers: input.triggers } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.provider ? { provider: input.provider } : {}),
        executionTarget: input.executionTarget ?? 'desktop',
        createdAt: new Date().toISOString(),
    };

    await fs.writeFile(taskYamlPath(slug), stringifyYaml(task), 'utf-8');
    await fs.writeFile(taskIndexPath(slug), `# ${input.name}\n\n`, 'utf-8');

    syncTaskBestEffort(slug);
    return { slug };
}

/** Delete a bg-task — removes the entire folder. */
export async function deleteTask(slug: string): Promise<void> {
    await withFileLock(taskYamlPath(slug), async () => {
        await fs.rm(taskDir(slug), { recursive: true, force: true });
    });
    deleteCloudTaskBestEffort(slug);
}

// ---------------------------------------------------------------------------
// Listing tasks
// ---------------------------------------------------------------------------

export interface ListTasksOptions {
    offset?: number;
    limit?: number;
    sort?: 'createdAt:desc' | 'createdAt:asc' | 'name:asc';
}

export interface ListTasksResult {
    items: BackgroundTaskSummary[];
    total: number;
}

export async function listTasks(opts: ListTasksOptions = {}): Promise<ListTasksResult> {
    const offset = opts.offset ?? 0;
    const limit = opts.limit ?? 50;
    const sort = opts.sort ?? 'createdAt:desc';

    let entries: string[];
    try {
        entries = await fs.readdir(BG_TASKS_DIR);
    } catch (err: unknown) {
        const e = err as { code?: string };
        if (e.code === 'ENOENT') return { items: [], total: 0 };
        throw err;
    }

    const all: BackgroundTaskSummary[] = [];
    for (const slug of entries) {
        if (slug.startsWith('.')) continue;
        const task = await fetchTask(slug);
        if (!task) continue;
        all.push({
            slug,
            name: task.name,
            instructions: task.instructions,
            active: task.active,
            ...(task.triggers ? { triggers: task.triggers } : {}),
            executionTarget: task.executionTarget ?? 'desktop',
            createdAt: task.createdAt,
            ...(task.lastAttemptAt ? { lastAttemptAt: task.lastAttemptAt } : {}),
            ...(task.lastRunId ? { lastRunId: task.lastRunId } : {}),
            ...(task.lastRunAt ? { lastRunAt: task.lastRunAt } : {}),
            ...(task.lastRunSummary ? { lastRunSummary: task.lastRunSummary } : {}),
            ...(task.lastRunError ? { lastRunError: task.lastRunError } : {}),
        });
    }

    all.sort((a, b) => {
        if (sort === 'name:asc') return a.name.localeCompare(b.name);
        const aT = new Date(a.createdAt).getTime();
        const bT = new Date(b.createdAt).getTime();
        return sort === 'createdAt:asc' ? aT - bT : bT - aT;
    });

    return {
        items: all.slice(offset, offset + limit),
        total: all.length,
    };
}

// ---------------------------------------------------------------------------
// Runs pointer file (`runs.log`)
//
// One line per run, runId only. Prepended on each start so the newest is at
// the top — no sorting needed on read. The actual transcript jsonl lives in
// the global `$WorkDir/runs/<runId>.jsonl`; readers fetch via the standard
// runs:fetch IPC. Read concurrency is unconstrained; write is serialized via
// `withFileLock` on the task.yaml path (same lock as patches, so a run-start
// patch and a prepend don't race).
// ---------------------------------------------------------------------------

export async function prependRunId(slug: string, runId: string): Promise<void> {
    return withFileLock(taskYamlPath(slug), async () => {
        const filePath = taskRunsLogPath(slug);
        let existing = '';
        try {
            existing = await fs.readFile(filePath, 'utf-8');
        } catch (err: unknown) {
            const e = err as { code?: string };
            if (e.code !== 'ENOENT') throw err;
        }
        await fs.writeFile(filePath, `${runId}\n${existing}`, 'utf-8');
    });
}

export async function readRunIds(slug: string, limit?: number): Promise<string[]> {
    let content = '';
    try {
        content = await fs.readFile(taskRunsLogPath(slug), 'utf-8');
    } catch (err: unknown) {
        const e = err as { code?: string };
        if (e.code === 'ENOENT') return [];
        throw err;
    }
    const ids = content.split('\n').map(s => s.trim()).filter(Boolean);
    return limit ? ids.slice(0, limit) : ids;
}
