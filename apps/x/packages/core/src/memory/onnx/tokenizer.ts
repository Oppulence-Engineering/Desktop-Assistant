// WordPiece tokenizer for the BERT-family embedding model, in plain TypeScript.
//
// Written out rather than pulled from a library on purpose. The obvious
// alternatives — @huggingface/transformers or @huggingface/tokenizers — each
// drag in another native module (and transformers.js additionally pulls `sharp`,
// a native image codec, plus a second ONNX runtime for the web). All of that to
// turn a sentence into ~30 integers. WordPiece is a small, stable, fully
// specified algorithm; this is ~80 lines and adds nothing to the packaged app.
//
// Matches HuggingFace's BertTokenizer for an uncased vocab: NFD-strip accents,
// lowercase, split punctuation, then greedy longest-match-first subwording.

const UNK = "[UNK]";
const CLS = "[CLS]";
const SEP = "[SEP]";
const PAD = "[PAD]";

export interface Encoded {
  ids: number[];
  /** 1 for real tokens, 0 for padding — the model needs this and so does mean pooling. */
  attentionMask: number[];
}

export class WordPieceTokenizer {
  private readonly vocab: Map<string, number>;
  readonly padId: number;
  private readonly unkId: number;
  private readonly clsId: number;
  private readonly sepId: number;

  /** @param vocabText Contents of vocab.txt — one token per line, index = line number. */
  constructor(vocabText: string) {
    this.vocab = new Map();
    const lines = vocabText.split("\n");
    for (let i = 0; i < lines.length; i++) {
      // Only trailing \r; a vocab token can legitimately be whitespace-ish.
      this.vocab.set(lines[i].replace(/\r$/, ""), i);
    }
    const need = (t: string): number => {
      const id = this.vocab.get(t);
      if (id === undefined) throw new Error(`vocab is missing the ${t} token`);
      return id;
    };
    this.unkId = need(UNK);
    this.clsId = need(CLS);
    this.sepId = need(SEP);
    this.padId = need(PAD);
  }

  /** Lowercase, strip accents, and split punctuation off as its own token. */
  private basicTokenize(text: string): string[] {
    return text
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Mn}/gu, "")
      .replace(/([\p{P}\p{S}])/gu, " $1 ")
      .split(/\s+/)
      .filter(Boolean);
  }

  /** Greedy longest-match-first subwording; the whole word becomes [UNK] on failure. */
  private wordpiece(word: string): string[] {
    if (this.vocab.has(word)) return [word];
    const pieces: string[] = [];
    let start = 0;
    while (start < word.length) {
      let end = word.length;
      let match: string | null = null;
      while (start < end) {
        const sub = (start === 0 ? "" : "##") + word.slice(start, end);
        if (this.vocab.has(sub)) {
          match = sub;
          break;
        }
        end--;
      }
      // Per the reference implementation: if any span fails, the *entire* word
      // is unknown — not just the offending piece.
      if (match === null) return [UNK];
      pieces.push(match);
      start = end;
    }
    return pieces;
  }

  /**
   * Encode one text to model input ids.
   *
   * @param text - Input text.
   * @param maxTokens - Hard ceiling including [CLS]/[SEP]. The model's learned
   *                    position embeddings stop at 512; going past that is not a
   *                    quality tradeoff, it is an out-of-range index.
   */
  encode(text: string, maxTokens = 256): Encoded {
    const body = this.basicTokenize(text).flatMap((w) => this.wordpiece(w));
    const ids = [
      this.clsId,
      ...body.slice(0, Math.max(0, maxTokens - 2)).map((t) => this.vocab.get(t) ?? this.unkId),
      this.sepId,
    ];
    return { ids, attentionMask: ids.map(() => 1) };
  }

  /** Encode a batch and right-pad to the longest row. */
  encodeBatch(texts: string[], maxTokens = 256): { ids: number[][]; attentionMask: number[][] } {
    const encoded = texts.map((t) => this.encode(t, maxTokens));
    const width = Math.max(1, ...encoded.map((e) => e.ids.length));
    return {
      ids: encoded.map((e) => [...e.ids, ...Array<number>(width - e.ids.length).fill(this.padId)]),
      attentionMask: encoded.map((e) => [
        ...e.attentionMask,
        ...Array<number>(width - e.ids.length).fill(0),
      ]),
    };
  }
}
