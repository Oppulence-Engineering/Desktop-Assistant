// Markdown- and frontmatter-aware chunker (RFC 021). Splits a note on heading
// boundaries (#/##/###), never mid-sentence, with a soft ~512-token cap and
// ~64-token overlap, and emits the YAML frontmatter as a separate "entity card"
// chunk so a Company/Invoice note is findable by its properties, not just prose.
import crypto from 'crypto';
import type { Chunk, ChunkMeta } from './types.js';

// Token budgets approximated at ~4 chars/token (avoids a tokenizer dependency).
const CHARS_PER_TOKEN = 4;
const MAX_CHUNK_CHARS = 512 * CHARS_PER_TOKEN; // ~512 tokens
const OVERLAP_CHARS = 64 * CHARS_PER_TOKEN; // ~64 tokens

function sha256(s: string): string {
    return crypto.createHash('sha256').update(s).digest('hex');
}

/**
 * Slugify a heading into a stable anchor like `"h2-status"`.
 *
 * @param level - Heading level (1–3), used as the `h{level}` prefix.
 * @param text - Raw heading text; non-alphanumerics collapse to `-`, capped at 64 chars.
 * @returns The anchor, e.g. `headingAnchor(2, "Payment Status!")` → `"h2-payment-status"`.
 *          An empty/blank heading yields `"h{level}-section"`.
 */
export function headingAnchor(level: number, text: string): string {
    const slug = text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64);
    return `h${level}-${slug || 'section'}`;
}

/**
 * Parsed YAML frontmatter block. Intentionally a plain interface (not a zod
 * schema): it is an in-memory parse result whose `data` is open-ended key→value,
 * never serialized, so runtime validation would add nothing.
 */
interface Frontmatter {
    /** The raw frontmatter body (between the `---` fences), newline-joined. */
    raw: string;
    /** Parsed `key: value` pairs (values kept as strings; no YAML dependency). */
    data: Record<string, unknown>;
    /** Number of lines the frontmatter block occupies (including both fences). */
    lines: number;
}

/**
 * Extract a leading `--- ... ---` YAML frontmatter block (line-aware, no YAML dep).
 *
 * @param content - The raw note text.
 * @returns The parsed frontmatter, or `null` when the note has no leading `---` fence
 *          (or the closing fence is missing).
 */
export function parseFrontmatter(content: string): Frontmatter | null {
    const lines = content.split('\n');
    if (lines[0]?.trim() !== '---') return null;
    let end = -1;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === '---') {
            end = i;
            break;
        }
    }
    if (end === -1) return null;
    const body = lines.slice(1, end);
    const data: Record<string, unknown> = {};
    for (const line of body) {
        const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
        if (m) data[m[1]] = m[2].trim();
    }
    return { raw: body.join('\n'), data, lines: end + 1 };
}

/** Build the entity-card text from selected frontmatter identifiers. */
function entityCardText(fm: Frontmatter): string {
    const keys = ['name', 'title', 'type', 'tags', 'id', 'resourceRefs', 'email', 'status', 'aliases'];
    const parts: string[] = [];
    for (const k of keys) {
        const v = fm.data[k];
        if (v !== undefined && String(v).length > 0) parts.push(`${k}: ${String(v)}`);
    }
    // Fall back to the whole frontmatter if none of the well-known keys matched.
    return parts.length > 0 ? parts.join('\n') : fm.raw;
}

/**
 * Split overlong text into chunks of at most MAX_CHUNK_CHARS, breaking on
 * paragraph then sentence boundaries (never mid-sentence unless a single
 * sentence itself exceeds the cap), with ~OVERLAP_CHARS of carryover between
 * adjacent chunks. Every returned chunk is guaranteed ≤ MAX_CHUNK_CHARS.
 */
function splitLong(text: string): string[] {
    if (text.length <= MAX_CHUNK_CHARS) return [text.trim()];

    // Atomic units: sentences (within paragraphs), each hard-capped ≤ MAX.
    const units: string[] = [];
    for (const para of text.split(/\n{2,}/)) {
        for (const sentence of splitSentences(para)) {
            let t = sentence.trim();
            while (t.length > MAX_CHUNK_CHARS) {
                units.push(t.slice(0, MAX_CHUNK_CHARS));
                t = t.slice(MAX_CHUNK_CHARS);
            }
            if (t) units.push(t);
        }
    }

    const out: string[] = [];
    let buf = '';
    for (const u of units) {
        if (buf && buf.length + 1 + u.length > MAX_CHUNK_CHARS) {
            out.push(buf);
            // Carry an overlap tail, but only if the next unit still fits under
            // the cap with it (overlap must never push a chunk over MAX).
            const tail = buf.length > OVERLAP_CHARS ? buf.slice(buf.length - OVERLAP_CHARS) : buf;
            buf = tail.length + 1 + u.length <= MAX_CHUNK_CHARS ? tail : '';
        }
        buf += (buf ? ' ' : '') + u;
    }
    if (buf.trim()) out.push(buf.trim());
    return out;
}

function splitSentences(text: string): string[] {
    return text.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) ?? [text];
}

/**
 * chunkMarkdown turns a note into indexable chunks: an optional frontmatter
 * "entity card" chunk (so a note is findable by its properties, not just prose)
 * followed by one or more body chunks split on `#`/`##`/`###` heading boundaries,
 * with a soft ~512-token cap and ~64-token overlap. Heading detection ignores
 * lines inside fenced code blocks and tolerates CRLF.
 *
 * @param path - Vault-relative path of the note, used verbatim in result backlinks.
 * @param content - The raw note text.
 * @returns The note's chunks in document order; empty when the note has no indexable text.
 */
export function chunkMarkdown(path: string, content: string): Chunk[] {
    const chunks: Chunk[] = [];
    const fm = parseFrontmatter(content);
    let bodyStartLine = 1;
    if (fm) {
        const text = entityCardText(fm);
        if (text.trim()) {
            chunks.push({
                text,
                meta: meta(path, 'frontmatter', sha256(text), 1, fm.lines, frontmatterId(fm)),
            });
        }
        bodyStartLine = fm.lines + 1;
    }

    const lines = content.split('\n');
    const body = lines.slice(bodyStartLine - 1);

    // Walk body lines, breaking sections at heading boundaries.
    interface Section {
        anchor: string;
        start: number; // 1-based line in the note
        text: string[];
    }
    let current: Section = { anchor: 'body', start: bodyStartLine, text: [] };
    const sections: Section[] = [];
    const headingRe = /^(#{1,3})\s+(.*)$/;
    const fenceRe = /^\s*(```|~~~)/;
    let inFence = false;
    for (let i = 0; i < body.length; i++) {
        const lineNo = bodyStartLine + i;
        const line = body[i].replace(/\r$/, ''); // normalize CRLF
        if (fenceRe.test(line)) inFence = !inFence;
        const m = inFence ? null : headingRe.exec(line); // never treat fenced "# x" as a heading
        if (m) {
            if (current.text.join('\n').trim()) sections.push(current);
            current = { anchor: headingAnchor(m[1].length, m[2].trim()), start: lineNo, text: [line] };
        } else {
            current.text.push(line);
        }
    }
    if (current.text.join('\n').trim()) sections.push(current);

    for (const sec of sections) {
        const secText = sec.text.join('\n').trim();
        if (!secText) continue;
        const pieces = splitLong(secText);
        const secLineCount = sec.text.length;
        for (const piece of pieces) {
            chunks.push({
                text: piece,
                meta: meta(path, sec.anchor, sha256(piece), sec.start, sec.start + secLineCount - 1),
            });
        }
    }
    return chunks;
}

function frontmatterId(fm: Frontmatter): string | undefined {
    const id = fm.data['id'] ?? fm.data['name'] ?? fm.data['title'];
    return id !== undefined ? String(id) : undefined;
}

function meta(
    path: string,
    anchor: string,
    contentHash: string,
    startLine: number,
    endLine: number,
    frontmatterId?: string,
): ChunkMeta {
    return { path, headingAnchor: anchor, contentHash, startLine, endLine, frontmatterId };
}
