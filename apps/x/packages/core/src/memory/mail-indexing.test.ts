import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Indexer } from './indexer.js';
import { MemoryIndex } from './store.js';

/**
 * Labels have to reach the vector index, or the most expensive thing the app
 * does produces nothing searchable. The labeler writes YAML frontmatter onto
 * each synced email; the chunker emits frontmatter as its own entity card, so
 * indexing the labeled file is what makes an email findable by what the model
 * decided about it rather than only by its prose.
 *
 * Vault ids must stay byte-identical while this happens: they key the manifest,
 * and changing them would invalidate every existing embedding on upgrade.
 */

let root: string;
let indexDir: string;
let knowledgeDir: string;
let mailDir: string;

function write(dir: string, name: string, body: string): void {
  const abs = path.join(dir, name);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
}

/** A deterministic embedder: dimensionality is all the index cares about here. */
async function embed(texts: string[]) {
  return { vectors: texts.map(() => [0.1, 0.2, 0.3, 0.4]), tokens: texts.length };
}

function newIndexer(withMail: boolean) {
  return new Indexer({
    dir: indexDir,
    knowledgeDir,
    ...(withMail ? { mailDir } : {}),
    model: 'test-model',
    dimsHint: 4,
    batchSize: 8,
    maxMonthlyEmbedTokens: 0,
    embed,
  });
}

function indexedFiles(): string[] {
  // A pass that indexes nothing writes no manifest at all.
  const manifest = MemoryIndex.readManifest(indexDir);
  return manifest ? Object.keys(manifest.files).sort() : [];
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-index-'));
  indexDir = path.join(root, 'index');
  knowledgeDir = path.join(root, 'knowledge');
  mailDir = path.join(root, 'gmail_sync');
  fs.mkdirSync(knowledgeDir, { recursive: true });
  fs.mkdirSync(mailDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('indexing labeled mail', () => {
  it('indexes a labeled email', async () => {
    write(knowledgeDir, 'Note.md', '# Note\n\nsome prose');
    write(mailDir, 'thread-1.md', '---\nlabel: invoice\nfrom: acme\n---\n\nPlease find attached.');

    await newIndexer(true).run(1);

    expect(indexedFiles()).toEqual(['Note.md', path.join('gmail_sync', 'thread-1.md')]);
  });

  it('skips an unlabeled email', async () => {
    write(mailDir, 'labeled.md', '---\nlabel: deal\n---\n\nbody');
    write(mailDir, 'raw.md', 'no frontmatter yet, the labeler has not run');

    await newIndexer(true).run(1);

    // Indexing it now would embed the prose alone, and the manifest keys on
    // content hash — so when labels arrived the file would look unchanged and
    // never be re-embedded. Waiting means the first embedding has the labels.
    expect(indexedFiles()).toEqual([path.join('gmail_sync', 'labeled.md')]);
  });

  it('picks the email up once it has been labeled', async () => {
    write(mailDir, 'raw.md', 'body only');
    await newIndexer(true).run(1);
    expect(indexedFiles()).toEqual([]);

    write(mailDir, 'raw.md', '---\nlabel: client\n---\n\nbody only');
    await newIndexer(true).run(2);
    expect(indexedFiles()).toEqual([path.join('gmail_sync', 'raw.md')]);
  });

  it('makes the label itself searchable, not just the prose', async () => {
    write(mailDir, 'thread-1.md', '---\nlabel: invoice\n---\n\nPlease find attached.');
    await newIndexer(true).run(1);

    const idx = MemoryIndex.open(indexDir, 'test-model', 4);
    const texts = idx.corpus().map((c) => c.text).join('\n');
    // The frontmatter entity card is the whole point: without it the email is
    // reachable only by its body text and the labeling spend buys nothing.
    expect(texts).toContain('invoice');
  });

  it('keeps vault ids unprefixed so existing embeddings survive', async () => {
    write(knowledgeDir, 'Projects/Alpha.md', '# Alpha');
    write(mailDir, 'thread-1.md', '---\nlabel: deal\n---\n\nbody');

    await newIndexer(true).run(1);

    // Not "knowledge/Projects/Alpha.md" — that rename would orphan every
    // manifest entry written by a previous version and force a full re-embed.
    expect(indexedFiles()).toContain(path.join('Projects', 'Alpha.md'));
  });

  it('indexes the vault only when no mail dir is configured', async () => {
    write(knowledgeDir, 'Note.md', '# Note');
    write(mailDir, 'thread-1.md', '---\nlabel: deal\n---\n\nbody');

    await newIndexer(false).run(1);

    expect(indexedFiles()).toEqual(['Note.md']);
  });

  it('drops an email from the index when it is deleted', async () => {
    write(mailDir, 'thread-1.md', '---\nlabel: deal\n---\n\nbody');
    await newIndexer(true).run(1);
    expect(indexedFiles()).toHaveLength(1);

    fs.rmSync(path.join(mailDir, 'thread-1.md'));
    await newIndexer(true).run(2);
    expect(indexedFiles()).toEqual([]);
  });
});

/**
 * The tests above construct an Indexer directly, so they prove the behaviour
 * but not that production actually asks for it. Removing the `mailDir` line
 * from memory/index.ts left every one of them green while shipping an index
 * that silently covered the vault only — the exact regression this feature
 * exists to prevent.
 *
 * A source-level guard is the cheap way to pin a wiring line whose absence is
 * invisible: building the real indexer needs WorkDir, a model config and an
 * embeddings provider. Same approach as the embedding-asset checksum test.
 */
describe('production wiring', () => {
  it('passes mailDir when constructing the indexer', () => {
    const src = fs.readFileSync(
      path.join(import.meta.dirname, 'index.ts'),
      'utf-8',
    );
    const construction = src.slice(src.indexOf('new Indexer({'));
    expect(construction).toContain('mailDir: mailDir()');
  });
});
