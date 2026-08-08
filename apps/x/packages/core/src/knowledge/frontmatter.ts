import fs from 'fs';

/**
 * Whether a file begins with a YAML frontmatter fence.
 *
 * Reads the first three bytes rather than the file. This runs over every synced
 * email on a short poll, and reading each one in full to look at three
 * characters cost 41MB per pass on a real workspace — about 10GB an hour of
 * disk traffic to answer a question the first line already answers.
 *
 * Returns `null` when the file cannot be read, because the two callers want
 * opposite fallbacks and neither is a safe default for the other: the labeler
 * skips what it cannot read (so `null` means "already handled"), while the
 * indexer must not try to embed a file it cannot open (so `null` means "not
 * labeled"). Collapsing that into a boolean here is what makes one of them
 * wrong.
 */
export function readsAsFrontmatter(filePath: string): boolean | null {
    let fd: number | undefined;
    try {
        fd = fs.openSync(filePath, 'r');
        const buf = Buffer.alloc(3);
        const read = fs.readSync(fd, buf, 0, 3, 0);
        return read === 3 && buf.toString('utf-8') === '---';
    } catch {
        return null;
    } finally {
        if (fd !== undefined) fs.closeSync(fd);
    }
}

/**
 * Whether a file is a labeled email: it has frontmatter and is readable.
 * Unreadable counts as unlabeled, so the indexer leaves it for a later pass
 * rather than failing the run on it.
 */
export function hasFrontmatter(filePath: string): boolean {
    return readsAsFrontmatter(filePath) === true;
}
