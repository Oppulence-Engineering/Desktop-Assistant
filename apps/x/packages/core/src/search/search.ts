import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import readline from 'readline';
import { spawn } from 'child_process';
import { WorkDir } from '../config/config.js';

interface SearchResult {
  type: 'knowledge' | 'chat';
  title: string;
  preview: string;
  path: string;
}

const KNOWLEDGE_DIR = path.join(WorkDir, 'knowledge');
const RUNS_DIR = path.join(WorkDir, 'runs');

type SearchType = 'knowledge' | 'chat';

/**
 * Search across knowledge files and chat history.
 * @param types - optional filter to search only specific types (default: both)
 */
export async function search(query: string, limit = 20, types?: SearchType[]): Promise<{ results: SearchResult[] }> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { results: [] };
  }

  const searchKnowledgeEnabled = !types || types.includes('knowledge');
  const searchChatsEnabled = !types || types.includes('chat');

  const [knowledgeResults, chatResults] = await Promise.all([
    searchKnowledgeEnabled ? searchKnowledgeSemantic(trimmed, limit) : Promise.resolve([]),
    searchChatsEnabled ? searchChats(trimmed, limit) : Promise.resolve([]),
  ]);

  const results = [...knowledgeResults, ...chatResults].slice(0, limit);
  return { results };
}

/**
 * Semantic knowledge search: route through the memory index (hybrid vector+lexical),
 * deduped to one result per note. `memorySearch` already lexical-falls-back when the
 * index is empty/disabled; if it still returns nothing we fall back to the grep +
 * filename search (which `memorySearch` doesn't do) so behaviour never regresses.
 */
async function searchKnowledgeSemantic(query: string, limit: number): Promise<SearchResult[]> {
  try {
    const { memorySearch } = await import('../memory/index.js');
    const res = await memorySearch(query, { k: Math.min(limit, 25) });
    const seen = new Set<string>();
    const out: SearchResult[] = [];
    for (const r of res.results) {
      if (seen.has(r.path)) continue; // one entry per note (best chunk)
      seen.add(r.path);
      out.push({
        type: 'knowledge',
        title: path.basename(r.path, '.md'),
        preview: r.snippet.replace(/\s+/g, ' ').trim().substring(0, 150),
        path: r.path,
      });
      if (out.length >= limit) break;
    }
    if (out.length > 0) return out;
  } catch {
    // memory subsystem unavailable — fall through to grep
  }
  return searchKnowledge(query, limit);
}

/**
 * Search knowledge markdown files by content and filename.
 */
async function searchKnowledge(query: string, limit: number): Promise<SearchResult[]> {
  if (!fs.existsSync(KNOWLEDGE_DIR)) {
    return [];
  }

  const results: SearchResult[] = [];
  const seenPaths = new Set<string>();
  const lowerQuery = query.toLowerCase();

  // Content search via grep
  try {
    const grepMatches = await grepFiles(query, KNOWLEDGE_DIR, '*.md', limit);
    for (const match of grepMatches) {
      if (results.length >= limit) break;
      const relPath = path.relative(WorkDir, match.file);
      if (seenPaths.has(relPath)) continue;
      seenPaths.add(relPath);

      const title = path.basename(match.file, '.md');
      results.push({
        type: 'knowledge',
        title,
        preview: match.line.trim().substring(0, 150),
        path: relPath,
      });
    }
  } catch {
    // grep failed (no matches or dir issue) — continue
  }

  // Filename search — check files whose name matches the query
  try {
    const allFiles = await listMarkdownFiles(KNOWLEDGE_DIR);
    for (const file of allFiles) {
      if (results.length >= limit) break;
      const relPath = path.relative(WorkDir, file);
      if (seenPaths.has(relPath)) continue;

      const basename = path.basename(file, '.md');
      if (basename.toLowerCase().includes(lowerQuery)) {
        seenPaths.add(relPath);
        const preview = await readFirstLines(file, 2);
        results.push({
          type: 'knowledge',
          title: basename,
          preview,
          path: relPath,
        });
      }
    }
  } catch {
    // ignore errors
  }

  return results;
}

/**
 * Search chat history by title and message content.
 */
async function searchChats(query: string, limit: number): Promise<SearchResult[]> {
  if (!fs.existsSync(RUNS_DIR)) {
    return [];
  }

  const results: SearchResult[] = [];
  const seenIds = new Set<string>();
  const lowerQuery = query.toLowerCase();

  // Content search via grep on JSONL files
  try {
    const grepMatches = await grepFiles(query, RUNS_DIR, '*.jsonl', limit);
    for (const match of grepMatches) {
      if (results.length >= limit) break;
      const runId = path.basename(match.file, '.jsonl');
      if (seenIds.has(runId)) continue;

      const meta = await readRunMetadata(match.file);
      if (meta.agentName !== 'copilot') {
        seenIds.add(runId);
        continue;
      }
      seenIds.add(runId);

      // Extract a content preview from the matching line
      let preview = '';
      try {
        const parsed = JSON.parse(match.line);
        if (parsed.message?.content && typeof parsed.message.content === 'string') {
          preview = parsed.message.content.replace(/<attached-files>[\s\S]*?<\/attached-files>/g, '').trim().substring(0, 150);
        }
      } catch {
        preview = match.line.substring(0, 150);
      }

      results.push({
        type: 'chat',
        title: meta.title || runId,
        preview,
        path: runId,
      });
    }
  } catch {
    // grep failed — continue
  }

  // Title search — scan run files for matching titles
  try {
    const entries = await fsp.readdir(RUNS_DIR, { withFileTypes: true });
    const jsonlFiles = entries
      .filter(e => e.isFile() && e.name.endsWith('.jsonl'))
      .map(e => e.name)
      .sort()
      .reverse(); // newest first

    for (const name of jsonlFiles) {
      if (results.length >= limit) break;
      const runId = path.basename(name, '.jsonl');
      if (seenIds.has(runId)) continue;

      const filePath = path.join(RUNS_DIR, name);
      const meta = await readRunMetadata(filePath);
      if (meta.agentName !== 'copilot') {
        seenIds.add(runId);
        continue;
      }
      if (meta.title && meta.title.toLowerCase().includes(lowerQuery)) {
        seenIds.add(runId);
        results.push({
          type: 'chat',
          title: meta.title,
          preview: meta.title,
          path: runId,
        });
      }
    }
  } catch {
    // ignore errors
  }

  return results;
}

/**
 * Use grep to find files matching a query.
 */
function grepFiles(query: string, dir: string, includeGlob: string, limit: number): Promise<Array<{ file: string; line: string }>> {
  return new Promise((resolve, reject) => {
    const child = spawn('grep', ['-ril', '--include=' + includeGlob, query, dir], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const files: string[] = [];
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let settled = false;
    let killedAfterLimit = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const processLine = (line: string) => {
      const file = line.trim();
      if (!file || files.length >= limit) return;
      files.push(file);
      if (files.length >= limit && !killedAfterLimit) {
        killedAfterLimit = true;
        child.kill('SIGTERM');
      }
    };

    const processStdout = (chunk: string) => {
      stdoutBuffer += chunk;
      let newlineIndex = stdoutBuffer.indexOf('\n');
      while (newlineIndex >= 0) {
        processLine(stdoutBuffer.slice(0, newlineIndex));
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        newlineIndex = stdoutBuffer.indexOf('\n');
      }
    };

    const resolveMatches = () => {
      if (stdoutBuffer) {
        processLine(stdoutBuffer);
        stdoutBuffer = '';
      }
      const selected = files.slice(0, limit);
      Promise.all(selected.map(file =>
        getFirstMatchingLine(file, query).then(line => ({ file, line }))
      ))
        .then((matches) => settle(() => resolve(matches)))
        .catch((error) => settle(() => reject(error)));
    };

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', processStdout);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderrBuffer += chunk;
    });
    child.on('error', (error) => settle(() => reject(error)));
    child.on('close', (code, signal) => {
      if (code === 0 || code === 1 || killedAfterLimit || signal === 'SIGTERM') {
        resolveMatches();
        return;
      }
      settle(() => reject(new Error(stderrBuffer.trim() || `grep exited with code ${code ?? 'unknown'}`)));
    });
  });
}

/**
 * Get the first line in a file that matches the query (case-insensitive).
 */
function getFirstMatchingLine(filePath: string, query: string): Promise<string> {
  return new Promise((resolve) => {
    let resolved = false;
    const done = (value: string) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    const lowerQuery = query.toLowerCase();
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    rl.on('line', (line) => {
      if (line.toLowerCase().includes(lowerQuery)) {
        done(line);
        rl.close();
        stream.destroy();
      }
    });

    rl.on('close', () => done(''));
    stream.on('error', () => done(''));
  });
}

interface RunMetadata {
  title: string | undefined;
  agentName: string | undefined;
}

/**
 * Read metadata from a run JSONL file (agent name from start event, title from first user message).
 */
function readRunMetadata(filePath: string): Promise<RunMetadata> {
  return new Promise((resolve) => {
    let resolved = false;
    const done = (value: RunMetadata) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let lineIndex = 0;
    let agentName: string | undefined;

    rl.on('line', (line) => {
      if (resolved) return;
      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        if (lineIndex === 0) {
          // Start event — extract agentName
          const start = JSON.parse(trimmed);
          agentName = start.agentName;
          lineIndex++;
          return;
        }

        const event = JSON.parse(trimmed);
        if (event.type === 'message') {
          const msg = event.message;
          if (msg?.role === 'user') {
            const content = msg.content;
            if (typeof content === 'string' && content.trim()) {
              let cleaned = content.replace(/<attached-files>[\s\S]*?<\/attached-files>/g, '');
              cleaned = cleaned.replace(/\s+/g, ' ').trim();
              if (cleaned) {
                done({ title: cleaned.length > 100 ? cleaned.substring(0, 100) : cleaned, agentName });
                rl.close();
                stream.destroy();
                return;
              }
            }
            done({ title: undefined, agentName });
            rl.close();
            stream.destroy();
            return;
          } else if (msg?.role === 'assistant') {
            done({ title: undefined, agentName });
            rl.close();
            stream.destroy();
            return;
          }
        }
        lineIndex++;
      } catch {
        lineIndex++;
      }
    });

    rl.on('close', () => done({ title: undefined, agentName }));
    rl.on('error', () => done({ title: undefined, agentName: undefined }));
    stream.on('error', () => {
      rl.close();
      done({ title: undefined, agentName: undefined });
    });
  });
}

/**
 * Recursively list all .md files in a directory.
 */
async function listMarkdownFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const nested = await listMarkdownFiles(fullPath);
        results.push(...nested);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(fullPath);
      }
    }
  } catch {
    // ignore
  }
  return results;
}

/**
 * Read the first N non-empty lines of a file for preview.
 */
async function readFirstLines(filePath: string, n: number): Promise<string> {
  return new Promise((resolve) => {
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    const lines: string[] = [];

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        lines.push(trimmed);
      }
      if (lines.length >= n) {
        rl.close();
        stream.destroy();
      }
    });

    rl.on('close', () => {
      resolve(lines.join(' ').substring(0, 150));
    });

    stream.on('error', () => {
      resolve('');
    });
  });
}
