import assert from "node:assert/strict";
import test from "node:test";

import {
  buildKnowledgeGraphIncrementally,
  clearKnowledgeGraphCache,
  invalidateKnowledgeGraphPaths,
} from "../apps/renderer/src/lib/knowledge-graph-cache.ts";

const knowledgePath = (target: string) => `knowledge/${target}.md`;

test("knowledge graph cache reads only new or invalidated notes", async () => {
  clearKnowledgeGraphCache();
  let reads = 0;
  const contents = new Map([
    ["knowledge/a.md", "Links to [[b]]"],
    ["knowledge/b.md", "No links"],
  ]);
  const build = () =>
    buildKnowledgeGraphIncrementally({
      paths: [...contents.keys()],
      readFile: async (path) => {
        reads += 1;
        return contents.get(path) ?? "";
      },
      resolveTarget: knowledgePath,
    });

  const first = await build();
  assert.equal(first.filesRead, 2);
  assert.deepEqual(first.edges, [{ source: "knowledge/a.md", target: "knowledge/b.md" }]);

  const cached = await build();
  assert.equal(cached.filesRead, 0);
  assert.equal(cached.cacheHits, 2);

  contents.set("knowledge/a.md", "Link removed");
  invalidateKnowledgeGraphPaths(["knowledge/a.md"]);
  const changed = await build();
  assert.equal(changed.filesRead, 1);
  assert.deepEqual(changed.edges, []);
  assert.equal(reads, 3);
});

test("knowledge graph cache prunes deleted notes and deduplicates reciprocal links", async () => {
  clearKnowledgeGraphCache();
  const contents = new Map([
    ["knowledge/a.md", "[[b]] [[b]]"],
    ["knowledge/b.md", "[[a]]"],
  ]);
  const build = (paths: string[]) =>
    buildKnowledgeGraphIncrementally({
      paths,
      readFile: async (path) => contents.get(path) ?? "",
      resolveTarget: knowledgePath,
    });

  const linked = await build([...contents.keys()]);
  assert.deepEqual(linked.edges, [{ source: "knowledge/a.md", target: "knowledge/b.md" }]);

  contents.delete("knowledge/b.md");
  const pruned = await build(["knowledge/a.md"]);
  assert.deepEqual(pruned.edges, []);
});
