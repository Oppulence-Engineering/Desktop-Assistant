#!/usr/bin/env bash
# Build the oppulence-audiocap capture sidecar for one arch.
#
# Compiles with `swiftc` directly rather than SwiftPM. The target has no package
# dependencies, so a manifest buys nothing and costs plenty: SwiftPM's manifest
# compiler is tightly coupled to the toolchain version and fails outright on a bare
# Command Line Tools install, while `swiftc` needs only a compiler and an SDK.
#
# Usage:  ./build.sh [arm64|x86_64]     (defaults to the host arch)
# Output: out/oppulence-audiocap + out/VERSION
#
# CI (.github/workflows/audiocap-build.yml) runs this per arch; the release job
# stages the result into vendor/audiocap/<platform>-<arch>/ before packaging, where
# Forge picks it up as an extraResource and signs it with the app.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SOURCES="$HERE/Sources/audiocap"
ARCH="${1:-$(uname -m)}"
# Core Audio process taps (AudioHardwareCreateProcessTap) land in 14.2. Below that
# the host falls back to renderer capture, so there is no point building lower.
MIN_MACOS="14.2"
VERSION="$(sed -n 's/^let audiocapVersion = "\(.*\)"$/\1/p' "$SOURCES/main.swift")"

case "$ARCH" in
  arm64|x86_64) ;;
  *) echo "error: unsupported arch '$ARCH' (expected arm64 or x86_64)" >&2; exit 2 ;;
esac

if [ "$(uname -s)" != "Darwin" ]; then
  echo "error: audiocap is macOS-only (Core Audio process taps)" >&2
  exit 2
fi

SDK="${SDKROOT:-$(xcrun --show-sdk-path)}"
[ -d "$SDK" ] || { echo "error: no macOS SDK at $SDK" >&2; exit 2; }

# A stale module.modulemap alongside bridging.modulemap makes every Objective-C
# module fail to build with "redefinition of module 'SwiftBridging'". Apple renamed
# the file; older Command Line Tools installs leave the original behind. Detect it
# here, because the compiler error points at the SDK and reads like a code problem.
SWIFT_INCLUDE="$(dirname "$(xcrun --find swiftc)")/../include/swift"
if [ -f "$SWIFT_INCLUDE/module.modulemap" ] && [ -f "$SWIFT_INCLUDE/bridging.modulemap" ]; then
  cat >&2 <<EOF
error: this toolchain has two module maps defining SwiftBridging:
         $SWIFT_INCLUDE/module.modulemap   (stale)
         $SWIFT_INCLUDE/bridging.modulemap (current)
       Every Objective-C module import will fail. Remove the stale one:
         sudo rm "$SWIFT_INCLUDE/module.modulemap"
EOF
  exit 2
fi

mkdir -p "$HERE/out"
OUT="$HERE/out/oppulence-audiocap"

# -wmo so the whole target optimizes as one unit (it is small and the audio path
# benefits); -swift-version 5 because the realtime callbacks manage their own thread
# safety and Swift 6 strict isolation would force actor hops into the IO proc.
swiftc \
  -O -wmo -swift-version 5 \
  -target "${ARCH}-apple-macos${MIN_MACOS}" \
  -sdk "$SDK" \
  -framework AVFoundation -framework CoreAudio \
  -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist \
  -Xlinker "$SOURCES/Info.plist" \
  -o "$OUT" \
  "$SOURCES"/*.swift

chmod 0755 "$OUT"
echo "$VERSION" > "$HERE/out/VERSION"

# Smoke test: the binary must at least start and report its version. Skipped when
# cross-building, since the host cannot execute the result.
if [ "$ARCH" = "$(uname -m)" ]; then
  REPORTED="$("$OUT" --version)"
  [ "$REPORTED" = "$VERSION" ] || {
    echo "error: built binary reports version '$REPORTED', expected '$VERSION'" >&2
    exit 1
  }
fi

echo "built oppulence-audiocap $VERSION ($ARCH, macOS $MIN_MACOS+) → $OUT"
