import path from "path";
import fs from "fs";
import { homedir } from "os";
import { DEFAULT_WORKDIR_NAME, LEGACY_WORKDIR_ENV, LEGACY_WORKDIR_NAME, WORKDIR_ENV } from "@x/shared/dist/branding.js";

function resolveWorkDir(): string {
    const configured = process.env[WORKDIR_ENV] || process.env[LEGACY_WORKDIR_ENV];
    if (!configured) {
        const nextDefault = path.join(homedir(), DEFAULT_WORKDIR_NAME);
        const legacyDefault = path.join(homedir(), LEGACY_WORKDIR_NAME);
        if (!fs.existsSync(nextDefault) && fs.existsSync(legacyDefault)) {
            return legacyDefault;
        }
        return nextDefault;
    }

    const expanded = configured === "~"
        ? homedir()
        : (configured.startsWith("~/") || configured.startsWith("~\\"))
            ? path.join(homedir(), configured.slice(2))
            : configured;

    return path.resolve(expanded);
}

// Resolve app root relative to compiled file location (dist/...)
// Allow override via SOLOMON_WORKDIR env var for standalone pipeline usage.
// ROWBOAT_WORKDIR remains supported as a legacy alias.
// Normalize to an absolute path so workspace boundary checks behave consistently.
export const WorkDir = resolveWorkDir();

function ensureDirs() {
    const ensure = (p: string) => { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); };
    ensure(WorkDir);
    ensure(path.join(WorkDir, "agents"));
    ensure(path.join(WorkDir, "config"));
    ensure(path.join(WorkDir, "knowledge"));
}

function ensureDefaultConfigs() {
    // Create note_creation.json with default strictness if it doesn't exist
    const noteCreationConfig = path.join(WorkDir, "config", "note_creation.json");
    if (!fs.existsSync(noteCreationConfig)) {
        fs.writeFileSync(noteCreationConfig, JSON.stringify({
            strictness: "medium",
            configured: false
        }, null, 2));
    }
}

ensureDirs();
ensureDefaultConfigs();

// One-time deprecation for the old Today.md live dashboard. New installs no
// longer get a generated Today.md; existing files are paused in place.
import('../knowledge/deprecate_today_note.js').then(m => m.deprecateTodayNote()).catch(err => {
    console.error('[TodayNoteDeprecation] Failed to deprecate Today.md:', err);
});

// Initialize version history repo (async, fire-and-forget on startup)
import('../knowledge/version_history.js').then(m => m.initRepo()).catch(err => {
    console.error('[VersionHistory] Failed to init repo:', err);
});
