// In-process embedding with ONNX Runtime: tokenize, run, mean-pool, normalize.
//
// No daemon, no port, no second process — which is the whole reason this exists
// alongside the Ollama backend. It is also the only local option that works the
// same on macOS, Windows and Linux: Ollama's non-darwin builds are 1.4GB
// because they carry CUDA and ROCm runners, where the ONNX runtime is ~35MB per
// architecture and packaging prunes to the target.
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { MINILM, modelDir, type EmbedModelSpec } from "./assets.js";
import { WordPieceTokenizer } from "./tokenizer.js";

/** Minimal shape of the bits of onnxruntime-node this module uses. */
interface OrtTensor {
  data: Float32Array | number[];
  dims: readonly number[];
}
interface OrtSession {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensor>>;
}

let session: OrtSession | null = null;
let tokenizer: WordPieceTokenizer | null = null;
let loadInFlight: Promise<boolean> | null = null;

/** Drops the loaded session and tokenizer. For tests and model switches. */
export function resetEmbedder(): void {
  session = null;
  tokenizer = null;
  loadInFlight = null;
}

/**
 * Load the ONNX session and tokenizer once.
 *
 * onnxruntime-node is imported lazily and by name so that merely importing this
 * module — which the memory index does on every start — never pays for loading
 * a 35MB native library on a machine that will not use it.
 *
 * @returns false when the assets or the native runtime are unavailable, which
 *          is a fallback condition rather than an error.
 */
export async function ensureEmbedder(spec: EmbedModelSpec = MINILM): Promise<boolean> {
  if (session && tokenizer) return true;
  if (loadInFlight) return loadInFlight;
  loadInFlight = (async () => {
    try {
      const dir = modelDir(spec);
      const vocab = await fs.readFile(path.join(dir, "vocab.txt"), "utf8");
      const ort = (await import("onnxruntime-node")) as unknown as {
        InferenceSession: { create(p: string): Promise<OrtSession> };
      };
      session = await ort.InferenceSession.create(path.join(dir, "model.onnx"));
      tokenizer = new WordPieceTokenizer(vocab);
      return true;
    } catch (error) {
      console.log(
        "[Memory] On-device embedder unavailable:",
        error instanceof Error ? error.message : error,
      );
      resetEmbedder();
      return false;
    }
  })().finally(() => {
    loadInFlight = null;
  });
  return loadInFlight;
}

/**
 * Embed texts locally.
 *
 * Mean-pools the token vectors under the attention mask and L2-normalizes, which
 * is how all-MiniLM-L6-v2 was trained to be used — pooling over padding, or
 * skipping the normalize, degrades cosine similarity quietly rather than
 * failing.
 *
 * @param texts - Texts to embed.
 * @returns One unit vector per input, in input order.
 * @throws If the embedder was never loaded (call {@link ensureEmbedder} first).
 */
export async function embedLocally(
  texts: string[],
  spec: EmbedModelSpec = MINILM,
): Promise<{ vectors: number[][]; tokens: number }> {
  if (texts.length === 0) return { vectors: [], tokens: 0 };
  if (!session || !tokenizer) throw new Error("on-device embedder is not loaded");

  const ort = (await import("onnxruntime-node")) as unknown as {
    Tensor: new (type: string, data: BigInt64Array, dims: number[]) => unknown;
  };

  const { ids, attentionMask } = tokenizer.encodeBatch(texts, spec.maxTokens);
  const rows = ids.length;
  const width = ids[0].length;
  const dims = [rows, width];
  const big = (m: number[][]): BigInt64Array => BigInt64Array.from(m.flat().map(BigInt));

  const feeds: Record<string, unknown> = {
    input_ids: new ort.Tensor("int64", big(ids), dims),
    attention_mask: new ort.Tensor("int64", big(attentionMask), dims),
  };
  // BERT checkpoints take segment ids; some exports drop the input entirely.
  if (session.inputNames.includes("token_type_ids")) {
    feeds.token_type_ids = new ort.Tensor("int64", big(ids.map((r) => r.map(() => 0))), dims);
  }

  const output = await session.run(feeds);
  const hidden = output[session.outputNames[0]];
  const [, seq, dim] = hidden.dims;
  const data = hidden.data;

  const vectors: number[][] = [];
  for (let row = 0; row < rows; row++) {
    const vec = new Array<number>(dim).fill(0);
    let counted = 0;
    for (let s = 0; s < seq; s++) {
      if (attentionMask[row][s] === 0) continue; // padding contributes nothing
      counted++;
      const base = (row * seq + s) * dim;
      for (let d = 0; d < dim; d++) vec[d] += Number(data[base + d]);
    }
    const denom = counted || 1;
    let sumSquares = 0;
    for (let d = 0; d < dim; d++) {
      vec[d] /= denom;
      sumSquares += vec[d] * vec[d];
    }
    const norm = Math.sqrt(sumSquares) || 1;
    for (let d = 0; d < dim; d++) vec[d] /= norm;
    vectors.push(vec);
  }

  // Real token count (padding excluded) — the index's cost guard reads this,
  // and on-device tokens are free but still worth reporting honestly.
  const tokens = attentionMask.reduce((sum, row) => sum + row.reduce((a, b) => a + b, 0), 0);
  return { vectors, tokens };
}
