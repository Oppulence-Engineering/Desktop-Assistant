import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('search returns no more than the requested knowledge result limit for broad matches', async () => {
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'rowboat-search-limit-'));
  process.env.ROWBOAT_WORKDIR = workDir;

  try {
    const knowledgeDir = path.join(workDir, 'knowledge');
    await mkdir(knowledgeDir, { recursive: true });

    await Promise.all(
      Array.from({ length: 24 }, (_, index) =>
        writeFile(
          path.join(knowledgeDir, `note-${String(index).padStart(2, '0')}.md`),
          `# Note ${index}\n\nneedle appears in this note.\n`,
          'utf8',
        ),
      ),
    );

    const { search } = await import('../dist/search/search.js');
    const { results } = await search('needle', 7, ['knowledge']);

    assert.equal(results.length, 7);
    assert.ok(results.every((result) => result.type === 'knowledge'));
  } finally {
    await rm(workDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
    delete process.env.ROWBOAT_WORKDIR;
  }
});
