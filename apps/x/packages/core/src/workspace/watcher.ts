import chokidar, { type FSWatcher } from "chokidar";
import fs from "node:fs/promises";
import path from "node:path";
import { isAtomicTempName } from "../filesystem/files.js";
import { ensureWorkspaceRoot, absToRelPosix } from "./workspace.js";
import { WorkDir } from "../config/config.js";
import { workspace } from "@x/shared";
import z from "zod";
import { Stats } from "node:fs";
import { captureEntityIdentities, entityKindForPath, stabilizeEntityNoteMutation } from "../knowledge/entity-identity.js";

export type WorkspaceChangeCallback = (
  event: z.infer<typeof workspace.WorkspaceChangeEvent>,
) => void;

/**
 * Create a workspace watcher
 * Watches the configured workspace root recursively and emits change events via callback
 *
 * Returns a watcher instance that can be closed.
 * The watcher emits events immediately without debouncing.
 * Debouncing and lifecycle management should be handled by the caller.
 */
export async function createWorkspaceWatcher(
  callback: WorkspaceChangeCallback,
): Promise<FSWatcher> {
  await ensureWorkspaceRoot();

  const watcher = chokidar.watch(WorkDir, {
    ignoreInitial: true,
    // Atomic-write temp siblings must not reach the renderer — they would
    // flash into Recents/the file tree between write and rename.
    ignored: (absPath: string) => isAtomicTempName(path.basename(absPath)),
    awaitWriteFinish: {
      stabilityThreshold: 150,
      pollInterval: 50,
    },
  });
  const identities = await captureEntityIdentities(path.join(WorkDir, "knowledge"));
  const identityRewrites = new Set<string>();
  const stabilizeExternalEntity = async (absPath: string): Promise<void> => {
    if (!entityKindForPath(absPath, path.join(WorkDir, "knowledge")) || identityRewrites.has(absPath)) return;
    identityRewrites.add(absPath);
    try {
      const identity = await stabilizeEntityNoteMutation(absPath, WorkDir, identities.get(path.resolve(absPath)));
      if (identity) identities.set(path.resolve(absPath), identity);
    } catch (error) {
      console.error("Workspace watcher could not stabilize entity identity:", error);
    } finally {
      setTimeout(() => identityRewrites.delete(absPath), 500);
    }
  };

  watcher
    .on("add", async (absPath: string) => {
      await stabilizeExternalEntity(absPath);
      const relPath = absToRelPosix(absPath);
      if (relPath) {
        fs.lstat(absPath)
          .then((stats: Stats) => {
            const kind = stats.isDirectory() ? "dir" : "file";
            callback({ type: "created", path: relPath, kind });
          })
          .catch(() => {
            // Ignore errors
          });
      }
    })
    .on("addDir", (absPath: string) => {
      const relPath = absToRelPosix(absPath);
      if (relPath) {
        callback({ type: "created", path: relPath, kind: "dir" });
      }
    })
    .on("change", async (absPath: string) => {
      await stabilizeExternalEntity(absPath);
      const relPath = absToRelPosix(absPath);
      if (relPath) {
        // Emit change event immediately - debouncing handled by caller
        callback({ type: "changed", path: relPath });
      }
    })
    .on("unlink", (absPath: string) => {
      identities.delete(path.resolve(absPath));
      const relPath = absToRelPosix(absPath);
      if (relPath) {
        callback({ type: "deleted", path: relPath, kind: "file" });
      }
    })
    .on("unlinkDir", (absPath: string) => {
      const relPath = absToRelPosix(absPath);
      if (relPath) {
        callback({ type: "deleted", path: relPath, kind: "dir" });
      }
    })
    .on("error", (error: unknown) => {
      console.error("Workspace watcher error:", error);
    });

  return watcher;
}
