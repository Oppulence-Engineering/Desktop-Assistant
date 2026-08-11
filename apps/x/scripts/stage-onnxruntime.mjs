// Stage onnxruntime-node next to the main-process bundle.
//
// onnxruntime-node is a native binding, so bundle.mjs marks it external and
// .package/dist/main.cjs resolves it by ordinary Node lookup at
// .package/node_modules/onnxruntime-node. Packaging stages it via
// forge.config.cjs — but `npm run dev` never runs forge, so in development the
// on-device embedder could not load at all:
//
//   [Memory] On-device embedder unavailable: Cannot find package 'onnxruntime-node'
//
// which silently pushed every embedding through the cloud proxy and made the
// on-device path impossible to dogfood. This runs from bundle.mjs so dev gets
// the same layout packaging produces.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoX = path.resolve(here, "..");

function copyDirectory(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirectory(from, to);
    // Dereference: pnpm links between store entries, and copying a symlink as a
    // symlink stages an empty directory whose target does not exist here.
    else if (entry.isSymbolicLink()) fs.copyFileSync(fs.realpathSync(from), to);
    else fs.copyFileSync(from, to);
  }
}

/** Stage for the host platform. Returns true when the runtime is available. */
export function stageOnnxRuntime(packageDir, platform = process.platform, arch = process.arch) {
  const ortLink = path.join(repoX, "packages", "core", "node_modules", "onnxruntime-node");
  if (!fs.existsSync(ortLink)) return false;
  // realpath: pnpm links the package but keeps its deps beside the real dir.
  const ortSrc = fs.realpathSync(ortLink);
  const ortCommonLink = path.join(path.dirname(ortSrc), "onnxruntime-common");
  if (!fs.existsSync(ortCommonLink)) return false;
  const ortCommonSrc = fs.realpathSync(ortCommonLink);
  const ortBinSrc = path.join(ortSrc, "bin", "napi-v6", platform, arch);
  if (!fs.existsSync(ortBinSrc)) return false;

  const modulesDest = path.join(packageDir, "node_modules");
  const ortDest = path.join(modulesDest, "onnxruntime-node");
  // Only the target arch: the published package carries every platform (~210MB)
  // and the host needs ~35MB of it.
  fs.mkdirSync(ortDest, { recursive: true });
  fs.copyFileSync(path.join(ortSrc, "package.json"), path.join(ortDest, "package.json"));
  copyDirectory(path.join(ortSrc, "dist"), path.join(ortDest, "dist"));
  copyDirectory(ortBinSrc, path.join(ortDest, "bin", "napi-v6", platform, arch));
  copyDirectory(ortCommonSrc, path.join(modulesDest, "onnxruntime-common"));
  return true;
}
