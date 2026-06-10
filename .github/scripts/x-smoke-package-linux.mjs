import { access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const appDir = path.join(repoRoot, 'apps/x/apps/main');
const requireFromApp = createRequire(path.join(appDir, 'package.json'));

const packager = requireFromApp('@electron/packager');
const forgeConfig = requireFromApp('./forge.config.cjs');

const platform = process.env.SMOKE_PACKAGE_PLATFORM ?? 'linux';
const arch = process.env.SMOKE_PACKAGE_ARCH ?? 'x64';
const packagerConfig = forgeConfig.packagerConfig ?? {};
const executableName = packagerConfig.executableName ?? 'solomon-ai';
const appName = packagerConfig.name ?? 'Solomon AI';

process.chdir(appDir);

if (forgeConfig.hooks?.generateAssets) {
  await forgeConfig.hooks.generateAssets(forgeConfig, platform, arch);
}

const outputPaths = await packager({
  dir: appDir,
  name: appName,
  platform,
  arch,
  out: path.join(appDir, 'out'),
  overwrite: true,
  executableName,
  icon: packagerConfig.icon,
  appBundleId: packagerConfig.appBundleId,
  appCategoryType: packagerConfig.appCategoryType,
  protocols: packagerConfig.protocols,
  prune: packagerConfig.prune,
  ignore: packagerConfig.ignore,
});

for (const outputPath of outputPaths) {
  console.log(`Packaged app: ${path.relative(repoRoot, outputPath)}`);
}

if (outputPaths.length === 0) {
  throw new Error('Packager did not return any output paths');
}

const binaryPath = platform === 'darwin'
  ? path.join(outputPaths[0], `${appName}.app`, 'Contents', 'MacOS', executableName)
  : path.join(outputPaths[0], platform === 'win32' ? `${executableName}.exe` : executableName);

await access(binaryPath);
console.log(`Packaged smoke binary: ${path.relative(repoRoot, binaryPath)}`);
