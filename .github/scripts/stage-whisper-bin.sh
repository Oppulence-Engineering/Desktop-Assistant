#!/usr/bin/env bash
# Stage the prebuilt, PIN-keyed whisper-cli into the vendor tree so Forge's
# generateAssets hook bundles it as an extraResource (RFC 009 §20, WP 3.x).
#
# The whisper-build workflow publishes per-arch binaries to a GitHub Release
# tagged `whisper-bin-<PIN>` (PIN = the whisper.cpp tag in apps/x/vendor/whisper/PIN).
# This script downloads the asset for the requested <plat> <arch> and extracts it
# into apps/x/vendor/whisper/<plat>-<arch>/, which is otherwise git-ignored. It is
# reused by release.yml and x-e2e-nightly.yml so the staging logic lives in one place.
#
# Failing here is deliberate: it converts the old silent "shipping without local
# transcription" skip in generateAssets into a hard gate, so a release can never
# again ship without the engine. If it fails because the release is missing, run
# the whisper-build workflow for the current PIN first.
#
# Requires `gh` (authenticated via GH_TOKEN) and `tar`. Works on Linux, macOS, and
# Windows runners (use `shell: bash` on Windows).
#
# Usage: stage-whisper-bin.sh <plat> <arch>     e.g. stage-whisper-bin.sh darwin arm64
set -euo pipefail

PLAT="${1:?usage: stage-whisper-bin.sh <plat> <arch>}"
ARCH="${2:?usage: stage-whisper-bin.sh <plat> <arch>}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VENDOR="$REPO_ROOT/apps/x/vendor/whisper"
PIN="$(tr -d '[:space:]' < "$VENDOR/PIN")"
TAG="whisper-bin-$PIN"
ASSET="whisper-$PLAT-$ARCH.tar.gz"
DEST="$VENDOR/$PLAT-$ARCH"

EXE="whisper-cli"
[ "$PLAT" = "win32" ] && EXE="whisper-cli.exe"

echo "Staging $ASSET from release $TAG → $DEST"
mkdir -p "$DEST"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

if ! gh release download "$TAG" --pattern "$ASSET" --dir "$tmp"; then
  echo "error: could not download $ASSET from release '$TAG'." >&2
  echo "       Has the whisper-build workflow run for PIN=$PIN?" >&2
  echo "       (Actions → whisper-build → Run workflow, then retry this release.)" >&2
  exit 1
fi

# whisper-build archives the contents of out/ (`tar -C out .`), so the binary
# lands directly in DEST.
tar -xzf "$tmp/$ASSET" -C "$DEST"

if [ ! -f "$DEST/$EXE" ]; then
  echo "error: $EXE missing from $DEST after extracting $ASSET" >&2
  ls -la "$DEST" >&2
  exit 1
fi

[ "$PLAT" != "win32" ] && chmod 0755 "$DEST/$EXE"
echo "✅ staged $DEST/$EXE"
