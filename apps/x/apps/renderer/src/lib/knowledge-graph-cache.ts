export type KnowledgeGraphCacheResult = {
  edges: Array<{ source: string; target: string }>;
  filesRead: number;
  cacheHits: number;
};

type CacheEntry = {
  targets: string[];
};

const entries = new Map<string, CacheEntry>();
const dirtyPaths = new Set<string>();
const wikiLinkPattern = /\[\[([^\n]+?)\]\]/g;

/** Mark workspace paths stale without discarding the rest of the graph cache. */
export function invalidateKnowledgeGraphPaths(paths: Iterable<string>) {
  for (const path of paths) dirtyPaths.add(path);
}

export function clearKnowledgeGraphCache() {
  entries.clear();
  dirtyPaths.clear();
}

/**
 * Incrementally reads only new or invalidated notes, then rebuilds the cheap
 * edge projection from cached link targets. The cache stores links, not note
 * contents, so sensitive workspace text is not duplicated in memory.
 */
export async function buildKnowledgeGraphIncrementally(input: {
  paths: string[];
  readFile: (path: string) => Promise<string>;
  resolveTarget: (rawTarget: string) => string | null;
}): Promise<KnowledgeGraphCacheResult> {
  const currentPaths = new Set(input.paths);
  for (const cachedPath of entries.keys()) {
    if (!currentPaths.has(cachedPath)) entries.delete(cachedPath);
  }

  const pathsToRead = input.paths.filter((path) => !entries.has(path) || dirtyPaths.has(path));
  await Promise.all(
    pathsToRead.map(async (path) => {
      try {
        const contents = await input.readFile(path);
        const targets = Array.from(contents.matchAll(wikiLinkPattern), (match) =>
          input.resolveTarget(match[1]?.trim() ?? ""),
        ).filter((target): target is string => Boolean(target));
        entries.set(path, { targets: [...new Set(targets)] });
      } catch {
        // Keep a bounded empty entry so a broken note does not cause repeated
        // reads on every graph open. A workspace change invalidates it again.
        entries.set(path, { targets: [] });
      } finally {
        dirtyPaths.delete(path);
      }
    }),
  );

  const edges: Array<{ source: string; target: string }> = [];
  const edgeKeys = new Set<string>();
  for (const source of input.paths) {
    for (const target of entries.get(source)?.targets ?? []) {
      if (target === source || !currentPaths.has(target)) continue;
      const edgeKey = source < target ? `${source}|${target}` : `${target}|${source}`;
      if (edgeKeys.has(edgeKey)) continue;
      edgeKeys.add(edgeKey);
      edges.push({ source, target });
    }
  }

  return {
    edges,
    filesRead: pathsToRead.length,
    cacheHits: input.paths.length - pathsToRead.length,
  };
}
