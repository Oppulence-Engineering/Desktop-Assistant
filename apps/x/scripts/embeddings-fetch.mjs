#!/usr/bin/env node
// Fetch the on-device embedding model into vendor/embeddings/ so it ships with
// the app instead of being downloaded on first use.
//
// Same convention as vendor/whisper and vendor/audiocap: the artifacts are not
// committed, a build step puts them here, and forge stages them into the app's
// Resources. Unlike those two the model is architecture-independent, so there
// is one directory rather than one per platform-arch.
//
// Run before packaging (the release job does this), or locally to test the
// bundled path:
//
//   node apps/x/scripts/embeddings-fetch.mjs
//
// Checksums are pinned in packages/core/src/memory/onnx/assets.ts and are the
// authority here — this script refuses to write a file whose bytes do not match,
// so a compromised mirror cannot slip a model into the build.
import { createHash } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const VENDOR_DIR = join(HERE, "..", "vendor", "embeddings");

// Mirrors MINILM in packages/core/src/memory/onnx/assets.ts. Kept in sync by
// the test in that module, which fails if the two lists drift.
const HF = "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main";
const FILES = [
  {
    name: "model.onnx",
    url: `${HF}/onnx/model_quantized.onnx`,
    sha256: "afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1",
  },
  {
    name: "vocab.txt",
    url: `${HF}/vocab.txt`,
    sha256: "07eced375cec144d27c900241f3e339478dec958f92fddbc551f295c992038a3",
  },
];

async function fetchVerified(file) {
  process.stdout.write(`  ${file.name} … `);
  const res = await fetch(file.url);
  if (!res.ok) throw new Error(`${file.name}: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());

  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== file.sha256) {
    throw new Error(`${file.name}: checksum mismatch\n  got  ${actual}\n  want ${file.sha256}`);
  }

  // Write to a sibling then rename, so an interrupted run cannot leave a
  // truncated model that later looks installed.
  const dest = join(VENDOR_DIR, file.name);
  const tmp = `${dest}.tmp`;
  await writeFile(tmp, bytes);
  await rename(tmp, dest);
  process.stdout.write(`${(bytes.length / 1e6).toFixed(1)}MB ok\n`);
}

async function main() {
  await mkdir(VENDOR_DIR, { recursive: true });
  console.log(`Fetching on-device embedding model into ${VENDOR_DIR}`);
  for (const file of FILES) {
    try {
      await fetchVerified(file);
    } catch (err) {
      await rm(join(VENDOR_DIR, `${file.name}.tmp`), { force: true });
      console.error(`\n${err.message}`);
      process.exit(1);
    }
  }
  console.log("Done. Package with `npm run package` to bundle it.");
}

await main();
