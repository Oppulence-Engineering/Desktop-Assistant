import { app, crashReporter } from 'electron';
import { readdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { captureNativeCrash } from '@x/core/dist/analytics/posthog.js';

/**
 * Starts Electron's built-in Crashpad/Breakpad reporter. This MUST be called
 * synchronously at process startup — before app.whenReady() — or it will miss
 * any crashes that happen during initialization.
 *
 * We set uploadToServer: false because we don't run a Crashpad collection
 * endpoint. Instead, minidumps land on local disk under app.getPath('crashDumps').
 * On the next launch, processPendingCrashDumps() picks them up and uploads them
 * to PostHog as $exception events.
 *
 * This catches the hard crash classes that PostHog's process.on('uncaughtException')
 * cannot see: native module segfaults, V8 engine crashes, GPU process crashes,
 * stack overflows below the JS frame, and renderer process OOMs.
 */
export function startCrashReporter(): void {
  try {
    crashReporter.start({
      productName: 'rowboat',
      companyName: 'Oppulence Engineering',
      submitURL: '',
      uploadToServer: false,
      compress: true,
      ignoreSystemCrashHandler: false,
      extra: {
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
      },
    });
  } catch (err) {
    console.error('[CrashReporter] Failed to start:', err);
  }
}

/**
 * Scans the crashes directory for minidumps left over from a previous crashed
 * session, uploads each as a PostHog $exception event with stage "native-crash",
 * then deletes the file so it isn't re-uploaded on the next launch.
 *
 * Safe to call multiple times — idempotent. Must be called after app.whenReady()
 * so app.getPath('crashDumps') is resolvable, and after PostHog has been
 * initialized so captureNativeCrash() has a client to send to.
 */
export async function processPendingCrashDumps(): Promise<void> {
  let crashesDir: string;
  try {
    crashesDir = app.getPath('crashDumps');
  } catch (err) {
    console.error('[CrashReporter] crashDumps path unavailable:', err);
    return;
  }

  let entries: string[];
  try {
    entries = await readdir(crashesDir);
  } catch (err) {
    // Directory doesn't exist yet (no crashes ever) — totally normal.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    console.error('[CrashReporter] Failed to read crashes directory:', err);
    return;
  }

  const dumps = entries.filter((name) => name.endsWith('.dmp'));
  if (dumps.length === 0) return;

  console.log('[CrashReporter] Found', dumps.length, 'pending crash dump(s); uploading to PostHog');

  for (const dump of dumps) {
    const fullPath = join(crashesDir, dump);
    try {
      const stat = await readFile(fullPath).then((b) => ({ size: b.byteLength }));
      captureNativeCrash({
        dumpFilename: dump,
        sizeBytes: stat.size,
        platform: process.platform,
        arch: process.arch,
        appVersion: app.getVersion(),
        // We deliberately don't upload the minidump bytes themselves — PostHog
        // isn't a symbol server. The filename + metadata is enough to know that
        // a native crash happened and pair it with timing of the previous launch.
      });
      await unlink(fullPath).catch((err) => {
        console.error('[CrashReporter] Failed to delete dump after upload:', dump, err);
      });
    } catch (err) {
      console.error('[CrashReporter] Failed to process dump:', dump, err);
    }
  }
}

/**
 * Registers listeners for renderer + child process crashes that happen while
 * the app is running. Unlike minidumps (which are read on the NEXT launch),
 * these fire synchronously and let us capture exit reason / code in real time.
 */
export function registerLiveCrashListeners(): void {
  app.on('render-process-gone', (_event, _webContents, details) => {
    console.error('[CrashReporter] render-process-gone:', details);
    try {
      captureNativeCrash({
        kind: 'render-process-gone',
        reason: details.reason,
        exitCode: details.exitCode,
        platform: process.platform,
        arch: process.arch,
        appVersion: app.getVersion(),
      });
    } catch (err) {
      console.error('[CrashReporter] captureNativeCrash threw:', err);
    }
  });

  app.on('child-process-gone', (_event, details) => {
    console.error('[CrashReporter] child-process-gone:', details);
    try {
      captureNativeCrash({
        kind: 'child-process-gone',
        childType: details.type,
        reason: details.reason,
        exitCode: details.exitCode,
        serviceName: details.serviceName,
        name: details.name,
        platform: process.platform,
        arch: process.arch,
        appVersion: app.getVersion(),
      });
    } catch (err) {
      console.error('[CrashReporter] captureNativeCrash threw:', err);
    }
  });
}
