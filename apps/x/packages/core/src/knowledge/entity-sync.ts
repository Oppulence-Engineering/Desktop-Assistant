import { readEntityConfig } from "./entity-config.js";
import {
  readEntityRecords,
  reconcileEntityNote,
  type EntityResolutionResult,
  type ProductEntityRecord,
} from "./entity-resolver.js";
import { syncEntityNotes } from "./entity-spine.js";

/** Mirror-sync seam: provider packages call this after writing their local note. */
export async function reconcileMirroredEntity(
  filePath: string,
  workDir: string,
  records: ProductEntityRecord[],
  identifiers?: Record<string, string | string[]>,
): Promise<EntityResolutionResult> {
  const config = await readEntityConfig(workDir);
  const adapterRecords = config.resolveOnSync ? await readEntityRecords(identifiers ?? {}) : [];
  const result = config.resolveOnSync
    ? await reconcileEntityNote({
        filePath,
        workDir,
        records: [...records, ...adapterRecords],
        identifiers,
      })
    : await reconcileEntityNote({ filePath, workDir, records: [], identifiers });
  await syncEntityNotes([filePath], workDir);
  return result;
}
