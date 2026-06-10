/**
 * Word Error Rate for the ASR eval suite (RFC 009 §27, Appendix K).
 *
 *   WER = (S + D + I) / N   — substitutions, deletions, insertions over N reference words,
 * computed as a word-level minimum edit (Levenshtein) distance after normalization.
 */

/** Normalize for fair comparison: lowercase, strip punctuation, collapse whitespace. */
export function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

export function wer(reference: string, hypothesis: string): number {
  const r = normalize(reference);
  const h = normalize(hypothesis);
  if (r.length === 0) return h.length === 0 ? 0 : 1;

  // d[i][j] = edit distance between r[0..i) and h[0..j)
  const d: number[][] = Array.from({ length: r.length + 1 }, (_, i) =>
    Array.from({ length: h.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= r.length; i++) {
    for (let j = 1; j <= h.length; j++) {
      d[i][j] =
        r[i - 1] === h[j - 1]
          ? d[i - 1][j - 1]
          : 1 + Math.min(d[i - 1][j], d[i][j - 1], d[i - 1][j - 1]);
    }
  }
  return d[r.length][h.length] / r.length;
}
