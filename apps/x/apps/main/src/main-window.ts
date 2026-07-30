import { BrowserWindow, app } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Where the preload bundle lives. Shared rather than re-derived per window: the dev and
 * packaged layouts differ, and a second copy of this only ever breaks in the packaged
 * build, which is the one nobody runs while iterating.
 */
export const preloadPath = app.isPackaged
  ? path.join(__dirname, "../preload/dist/preload.cjs")
  : path.join(__dirname, "../../../preload/dist/preload.cjs");

/**
 * Which window is "the app".
 *
 * Until the recording indicator there was exactly one `BrowserWindow`, so five places
 * could reasonably treat `BrowserWindow.getAllWindows()` as "the app's windows" and
 * `getAllWindows()[0]` as "the main window". A second, long-lived, always-on-top window
 * breaks every one of those assumptions in a way that is invisible until it bites:
 *
 *  - `activate` (dock click) re-creates the main window only when the count is 0. With
 *    an indicator open the count is never 0, so closing the main window during a meeting
 *    would leave no way to get it back.
 *  - `window-all-closed` quits on Windows/Linux for the same reason — the app would
 *    never quit.
 *  - `focusApp()` from the tray focuses `getAllWindows()[0]`, which could be the
 *    indicator: "Open Oppulence" would focus a 260-pixel pill.
 *
 * So secondary windows register themselves here and are excluded from both questions.
 */

let mainWindow: BrowserWindow | null = null;
/** Window ids that must not count as "the app is open". */
const secondaryIds = new Set<number>();

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win;
}

/** The main window, or null when it is closed or gone. */
export function getMainWindow(): BrowserWindow | null {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  return mainWindow;
}

/** Register a window that is not the app: an overlay, an indicator, a print surface. */
export function markSecondaryWindow(win: BrowserWindow): void {
  secondaryIds.add(win.id);
  win.on("closed", () => secondaryIds.delete(win.id));
}

/** Live windows that represent the app, excluding overlays. */
export function appWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter(
    (win) => !win.isDestroyed() && !secondaryIds.has(win.id),
  );
}
