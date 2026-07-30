#!/usr/bin/env bash
# Stage the prebuilt `oppulence-audiocap` capture helper into the vendor tree so
# Forge's generateAssets hook bundles it as an extraResource.
#
# The audiocap-build workflow publishes per-arch binaries to a GitHub Release tagged
# `audiocap-bin-<VERSION>` (VERSION = `audiocapVersion` in main.swift). This script
# downloads the asset for the requested <plat> <arch> and extracts it into
# apps/x/vendor/audiocap/<plat>-<arch>/, which is otherwise git-ignored.
#
# Unlike stage-whisper-bin.sh this is a **soft** gate: a missing helper costs native
# meeting capture, and the app falls back to in-app capture — whereas a missing
# whisper-cli costs on-device transcription entirely. Pass --required to make it hard.
#
# Requires `gh` (authenticated via GH_TOKEN) and `tar`. macOS only.
#
# Usage: stage-audiocap-bin.sh <plat> <arch> [--required]
set -euo pipefail

PLAT="${1:?usage: stage-audiocap-bin.sh <plat> <arch> [--required]}"
ARCH="${2:?usage: stage-audiocap-bin.sh <plat> <arch> [--required]}"
REQUIRED="${3:-}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VENDOR="$REPO_ROOT/apps/x/vendor/audiocap"
EXE="oppulence-audiocap"
DEST="$VENDOR/$PLAT-$ARCH"

if [ "$PLAT" != "darwin" ]; then
  echo "audiocap is macOS-only — nothing to stage for $PLAT"
  exit 0
fi

# Single source of truth for the version, same as build.sh reads.
VERSION="$(sed -n 's/^let audiocapVersion = "\(.*\)"$/\1/p' "$VENDOR/Sources/audiocap/main.swift")"
TAG="audiocap-bin-$VERSION"
ASSET="audiocap-$PLAT-$ARCH.tar.gz"

fail_or_warn() {
  if [ "$REQUIRED" = "--required" ]; then
    echo "error: $1" >&2
    exit 1
  fi
  echo "warning: $1 — shipping without native meeting capture" >&2
  exit 0
}

echo "Staging $ASSET from release $TAG → $DEST"
mkdir -p "$DEST"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

if ! gh release download "$TAG" --pattern "$ASSET" --dir "$tmp"; then
  fail_or_warn "could not download $ASSET from release '$TAG' (has audiocap-build run for VERSION=$VERSION?)"
fi

# audiocap-build archives the contents of out/, so the binary lands directly in DEST.
tar -xzf "$tmp/$ASSET" -C "$DEST"

if [ ! -f "$DEST/$EXE" ]; then
  ls -la "$DEST" >&2
  fail_or_warn "$EXE missing from $DEST after extracting $ASSET"
fi

chmod 0755 "$DEST/$EXE"
echo "✅ staged $DEST/$EXE"
