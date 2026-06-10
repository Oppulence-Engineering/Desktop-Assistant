#!/usr/bin/env bash
# Build a static, signable whisper-cli from a pinned whisper.cpp tag (RFC 009
# §20, Appendix H/W.4). Invoked per-arch by the whisper-build CI matrix; the
# resulting binary is staged into vendor/whisper/<platform>-<arch>/ and shipped
# as an extraResource (Forge), then signed + notarized with the app.
#
# Usage:  ./build.sh "<cmake flags>"     e.g. "-DGGML_METAL=ON -DWHISPER_COREML=ON"
# The pinned tag is the single source of truth in ./PIN — bump it to upgrade.
set -euo pipefail

FLAGS="${1:-}"
HERE="$(cd "$(dirname "$0")" && pwd)"
TAG="$(cat "$HERE/PIN")"

SRC="$(mktemp -d)"
trap 'rm -rf "$SRC"' EXIT
git clone --branch "$TAG" --depth 1 https://github.com/ggml-org/whisper.cpp "$SRC"

# Static-link ggml/whisper into one binary to minimize Mach-O/PE files to sign
# and avoid @rpath dylib issues.
#
# FLAGS may carry a quoted multi-word value (Windows: -G "Visual Studio 17 2022").
# eval re-tokenizes it honoring those quotes; a plain unquoted $FLAGS expansion
# would word-split the generator into "-G Visual" and fail ("Could not create
# named generator Visual"). $SRC is escaped so eval expands it as one quoted arg.
eval "cmake -S \"\$SRC\" -B \"\$SRC/build\" $FLAGS -DBUILD_SHARED_LIBS=OFF -DCMAKE_BUILD_TYPE=Release"
cmake --build "$SRC/build" -j --config Release

mkdir -p "$HERE/out"
# Build output path differs between single- and multi-config generators.
if [ -f "$SRC/build/bin/whisper-cli" ]; then
  cp "$SRC/build/bin/whisper-cli" "$HERE/out/"
elif [ -f "$SRC/build/bin/Release/whisper-cli.exe" ]; then
  cp "$SRC/build/bin/Release/whisper-cli.exe" "$HERE/out/"
else
  echo "error: whisper-cli not found in build output" >&2
  exit 1
fi

# Smoke test + record the pinned tag for build provenance.
"$HERE/out/whisper-cli"* --help >/dev/null 2>&1 || true
echo "$TAG" > "$HERE/out/VERSION"
echo "built whisper-cli @ $TAG → $HERE/out/"
