# On-device embedding model

`all-MiniLM-L6-v2`, int8-quantized: 384 dimensions, ~23MB.

Shipping it with the app is what makes semantic memory work on first launch —
no download, no network, and no dependency on Hugging Face being reachable.
When this directory is empty (a plain dev checkout), the app falls back to
downloading the same files into `WorkDir/models/embeddings/` on first use, so
nothing breaks; it is just slower the first time.

Populate:

    node apps/x/scripts/embeddings-fetch.mjs

The script verifies both files against the checksums pinned in
`packages/core/src/memory/onnx/assets.ts` and refuses to write on a mismatch.

Chosen over the nominally stronger bge-small because it is symmetric: our embed
interface takes texts, not (query | document) roles, so an asymmetric model
would be fed unprefixed queries and lose most of its advantage.
