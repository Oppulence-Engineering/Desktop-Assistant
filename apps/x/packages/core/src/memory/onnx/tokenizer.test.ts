import { describe, it, expect } from "vitest";
import { WordPieceTokenizer } from "./tokenizer.js";

/**
 * WordPiece is hand-written here rather than pulled from a library (see the
 * module header for why), so its contract needs pinning. A tokenizer that is
 * subtly wrong does not throw — it produces embeddings that are quietly worse,
 * which is the hardest kind of regression to notice from retrieval results.
 *
 * Vocab is synthetic so these tests never depend on a downloaded file.
 */
const VOCAB = [
  "[PAD]", // 0
  "[UNK]", // 1
  "[CLS]", // 2
  "[SEP]", // 3
  "invoice", // 4
  "over", // 5
  "##due", // 6
  ".", // 7
  "acme", // 8
  "a", // 9
  "##c", // 10
  "##m", // 11
  "##e", // 12
].join("\n");

const tok = new WordPieceTokenizer(VOCAB);
const CLS = 2;
const SEP = 3;

describe("WordPieceTokenizer", () => {
  it("wraps in [CLS]/[SEP] and resolves whole words", () => {
    expect(tok.encode("invoice").ids).toEqual([CLS, 4, SEP]);
  });

  it("splits an unknown word into greedy longest-match subwords", () => {
    expect(tok.encode("overdue").ids).toEqual([CLS, 5, 6, SEP]);
  });

  it("lowercases and strips accents", () => {
    expect(tok.encode("ÀCMÉ").ids).toEqual([CLS, 8, SEP]);
  });

  it("splits punctuation into its own token", () => {
    expect(tok.encode("invoice.").ids).toEqual([CLS, 4, 7, SEP]);
  });

  // The reference implementation marks the *whole* word unknown when any span
  // fails, rather than emitting the pieces it did manage to match. Getting this
  // wrong yields plausible-looking ids that no longer match how the model was
  // trained.
  it("marks the entire word [UNK] when any span fails, not just the bad piece", () => {
    expect(tok.encode("acmz").ids).toEqual([CLS, 1, SEP]);
  });

  it("truncates to maxTokens, leaving room for [CLS] and [SEP]", () => {
    const ids = tok.encode("invoice invoice invoice invoice", 4).ids;
    expect(ids).toHaveLength(4);
    expect(ids[0]).toBe(CLS);
    expect(ids[ids.length - 1]).toBe(SEP);
  });

  it("refuses a vocab without the special tokens", () => {
    expect(() => new WordPieceTokenizer("hello\nworld")).toThrow(/missing the/);
  });
});

describe("encodeBatch", () => {
  it("right-pads to the longest row and masks the padding", () => {
    const { ids, attentionMask } = tok.encodeBatch(["invoice", "overdue invoice"]);
    const width = ids[1].length;
    expect(ids[0]).toHaveLength(width);
    expect(ids[0].slice(-1)).toEqual([tok.padId]);
    // "overdue invoice" is 5 tokens ([CLS] over ##due invoice [SEP]), so the
    // 3-token row pads to 5. Mask is what stops that padding from being
    // averaged into the sentence vector.
    expect(attentionMask[0]).toEqual([1, 1, 1, 0, 0]);
    expect(attentionMask[1]).toEqual([1, 1, 1, 1, 1]);
  });

  it("handles an empty text without producing a zero-width batch", () => {
    const { ids } = tok.encodeBatch([""]);
    expect(ids[0]).toEqual([CLS, SEP]);
  });
});
