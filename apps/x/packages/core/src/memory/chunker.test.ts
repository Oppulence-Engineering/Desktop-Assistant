import { describe, it, expect } from 'vitest';
import { chunkMarkdown, parseFrontmatter, headingAnchor } from './chunker.js';

describe('chunker', () => {
    it('emits a frontmatter entity card chunk', () => {
        const note = `---\nname: Acme Corp\ntype: Company\ntags: ar, overdue\n---\n\n# Overview\n\nAcme is a customer.`;
        const chunks = chunkMarkdown('People/Acme.md', note);
        const card = chunks.find((c) => c.meta.headingAnchor === 'frontmatter');
        expect(card).toBeDefined();
        expect(card!.text).toContain('name: Acme Corp');
        expect(card!.text).toContain('type: Company');
        expect(card!.meta.frontmatterId).toBe('Acme Corp');
        expect(card!.meta.path).toBe('People/Acme.md');
    });

    it('splits on heading boundaries with anchors', () => {
        const note = `# Status\n\nOpen.\n\n## Payment\n\nLate by 30 days.\n\n## Notes\n\nCall scheduled.`;
        const chunks = chunkMarkdown('Invoices/INV-1.md', note);
        const anchors = chunks.map((c) => c.meta.headingAnchor);
        expect(anchors).toContain('h1-status');
        expect(anchors).toContain('h2-payment');
        expect(anchors).toContain('h2-notes');
        const payment = chunks.find((c) => c.meta.headingAnchor === 'h2-payment')!;
        expect(payment.text).toContain('Late by 30 days');
        // Each chunk carries a content hash + line range.
        expect(payment.meta.contentHash).toMatch(/^[0-9a-f]{64}$/);
        expect(payment.meta.startLine).toBeGreaterThan(0);
    });

    it('splits an overlong section into multiple chunks (never empty)', () => {
        const long = Array.from({ length: 400 }, (_, i) => `Sentence number ${i} about overdue invoices and AR.`).join(
            ' ',
        );
        const note = `# Big\n\n${long}`;
        const chunks = chunkMarkdown('big.md', note);
        const bigChunks = chunks.filter((c) => c.meta.headingAnchor === 'h1-big');
        expect(bigChunks.length).toBeGreaterThan(1);
        for (const c of bigChunks) expect(c.text.length).toBeLessThanOrEqual(512 * 4 + 16);
    });

    it('does not split on a heading-like line inside a fenced code block', () => {
        // The "# install" and "## comment" lines live inside a ``` fence and must
        // NOT be treated as section headings (they would create bogus anchors and
        // fragment the section).
        const note = [
            '# Setup',
            '',
            'Run the script:',
            '',
            '```bash',
            '# install deps',
            'npm install',
            '## not a heading',
            '```',
            '',
            'Done.',
        ].join('\n');
        const chunks = chunkMarkdown('Setup.md', note);
        const anchors = chunks.map((c) => c.meta.headingAnchor);
        expect(anchors).toContain('h1-setup');
        expect(anchors).not.toContain('h1-install-deps');
        expect(anchors).not.toContain('h2-not-a-heading');
        const setup = chunks.find((c) => c.meta.headingAnchor === 'h1-setup')!;
        expect(setup.text).toContain('npm install'); // fenced body stayed in the section
        expect(setup.text).toContain('Done.');
    });

    it('normalizes CRLF line endings when splitting headings', () => {
        const note = '# Status\r\n\r\nOpen.\r\n\r\n## Payment\r\n\r\nLate.';
        const anchors = chunkMarkdown('crlf.md', note).map((c) => c.meta.headingAnchor);
        expect(anchors).toContain('h1-status');
        expect(anchors).toContain('h2-payment');
    });

    it('parseFrontmatter returns null without a leading fence', () => {
        expect(parseFrontmatter('# No frontmatter\n\nbody')).toBeNull();
    });

    it('headingAnchor slugifies', () => {
        expect(headingAnchor(2, 'Payment Status!')).toBe('h2-payment-status');
        expect(headingAnchor(3, '   ')).toBe('h3-section');
    });
});

describe('chunkMarkdown — edge cases', () => {
    it('returns no chunks for empty or whitespace-only content', () => {
        expect(chunkMarkdown('empty.md', '')).toEqual([]);
        expect(chunkMarkdown('blank.md', '   \n\n\t\n')).toEqual([]);
    });

    it('emits only the entity card when a note is frontmatter with no body', () => {
        const note = `---\nname: Bob\ntype: Person\n---\n`;
        const chunks = chunkMarkdown('People/Bob.md', note);
        expect(chunks).toHaveLength(1);
        expect(chunks[0].meta.headingAnchor).toBe('frontmatter');
        expect(chunks[0].text).toContain('name: Bob');
    });

    it('falls back to the raw frontmatter when no well-known keys are present', () => {
        const note = `---\nfavoriteColor: blue\nlucky: 7\n---\n\nbody text`;
        const card = chunkMarkdown('x.md', note).find((c) => c.meta.headingAnchor === 'frontmatter')!;
        expect(card.text).toContain('favoriteColor: blue');
        expect(card.text).toContain('lucky: 7');
    });

    it('keeps a heading-less body as a single "body" chunk', () => {
        const chunks = chunkMarkdown('plain.md', 'Just some prose.\n\nMore prose.');
        expect(chunks).toHaveLength(1);
        expect(chunks[0].meta.headingAnchor).toBe('body');
        expect(chunks[0].text).toContain('Just some prose.');
        expect(chunks[0].text).toContain('More prose.');
    });

    it('resolves the frontmatter id by precedence id > name > title', () => {
        const withId = chunkMarkdown('a.md', `---\nid: ID1\nname: N\ntitle: T\n---\n\nx`);
        expect(withId[0].meta.frontmatterId).toBe('ID1');
        const withName = chunkMarkdown('b.md', `---\nname: N\ntitle: T\n---\n\nx`);
        expect(withName[0].meta.frontmatterId).toBe('N');
        const withTitle = chunkMarkdown('c.md', `---\ntitle: T\n---\n\nx`);
        expect(withTitle[0].meta.frontmatterId).toBe('T');
    });

    it('treats level-4+ ("####") as body text, not a section boundary', () => {
        const note = `# Top\n\nbody\n\n#### deep\n\nmore`;
        const anchors = chunkMarkdown('d.md', note).map((c) => c.meta.headingAnchor);
        expect(anchors).toContain('h1-top');
        expect(anchors).not.toContain('h4-deep');
        const top = chunkMarkdown('d.md', note).find((c) => c.meta.headingAnchor === 'h1-top')!;
        expect(top.text).toContain('#### deep'); // stayed inside the h1 section
    });

    it('suppresses headings inside a tilde (~~~) fenced block too', () => {
        const note = ['# Doc', '', '~~~', '# fake heading', '~~~', '', 'after'].join('\n');
        const anchors = chunkMarkdown('t.md', note).map((c) => c.meta.headingAnchor);
        expect(anchors).toEqual(['h1-doc']);
    });

    it('produces a deterministic content hash that differs across distinct text', () => {
        const a1 = chunkMarkdown('h.md', '# H\n\nalpha')[0];
        const a2 = chunkMarkdown('h.md', '# H\n\nalpha')[0];
        const b = chunkMarkdown('h.md', '# H\n\nbeta')[0];
        expect(a1.meta.contentHash).toBe(a2.meta.contentHash); // deterministic
        expect(a1.meta.contentHash).not.toBe(b.meta.contentHash); // content-sensitive
        expect(a1.meta.contentHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('records 1-based line ranges that reflect frontmatter offset', () => {
        const note = `---\nname: A\n---\n\n# Section\n\ncontent`;
        const section = chunkMarkdown('r.md', note).find((c) => c.meta.headingAnchor === 'h1-section')!;
        // frontmatter occupies lines 1-3 (--- name --- ), so the heading is below it.
        expect(section.meta.startLine).toBeGreaterThanOrEqual(4);
        expect(section.meta.endLine).toBeGreaterThanOrEqual(section.meta.startLine);
    });
});

describe('parseFrontmatter', () => {
    it('parses key: value pairs and counts the block lines', () => {
        const fm = parseFrontmatter('---\nname: Acme\ntype: Company\n---\n\nbody')!;
        expect(fm).not.toBeNull();
        expect(fm.data.name).toBe('Acme');
        expect(fm.data.type).toBe('Company');
        expect(fm.lines).toBe(4); // ---, name, type, ---
    });

    it('returns null when the closing fence is missing', () => {
        expect(parseFrontmatter('---\nname: Acme\n\nbody with no close')).toBeNull();
    });
});

describe('headingAnchor', () => {
    it('uses the level as the prefix', () => {
        expect(headingAnchor(1, 'Top')).toBe('h1-top');
        expect(headingAnchor(3, 'Deep Dive')).toBe('h3-deep-dive');
    });

    it('truncates very long headings to 64 chars of slug', () => {
        const slug = headingAnchor(2, 'a'.repeat(200));
        expect(slug.startsWith('h2-')).toBe(true);
        expect(slug.slice(3).length).toBeLessThanOrEqual(64);
    });

    it('collapses runs of non-alphanumerics into single hyphens', () => {
        expect(headingAnchor(2, 'Foo --- Bar!!! Baz')).toBe('h2-foo-bar-baz');
    });
});
