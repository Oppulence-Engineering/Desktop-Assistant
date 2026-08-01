import { BrowserWindow, app, screen } from "electron";
import { markSecondaryWindow, preloadPath } from "./main-window.js";

/**
 * The small always-on-top window that says a recording is running.
 *
 * This is not a convenience feature. Capture stopped belonging to a window when the
 * sidecar took it over — it keeps recording with every window closed, minimized, or on
 * another Space. A microphone that is live with nothing on screen to say so is the exact
 * thing this product refuses to be, whatever the tray icon says. Privacy software earns
 * trust by being conspicuous, and the person who most needs to see this is not the
 * operator: it is whoever else is in the room.
 *
 * It is deliberately dumb. It renders `meeting:captureState` and `meeting:captureLevel`,
 * which `meeting-controller.ts` already broadcasts to every window, and its one action
 * is the `meeting:stopCapture` channel that already exists. No new main-process state.
 */

const WIDTH = 264;
const HEIGHT = 48;
/** Clear of the menu bar and the notification stack that lands in the same corner. */
const MARGIN = 16;

let indicator: BrowserWindow | null = null;
/** Set while `app.quit()` is unwinding, so a teardown-triggered hide cannot recreate it. */
let quitting = false;

function indicatorUrl(): string {
  // `main.ts`'s app:// handler rewrites extension-less paths to index.html, so the
  // `.html` here is load-bearing — `app://-/indicator` would silently serve the app.
  return app.isPackaged ? "app://-/indicator.html" : "http://localhost:5173/indicator.html";
}

/** Top-right of the display holding the cursor, so it follows a multi-monitor setup. */
function position(): { x: number; y: number } {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y, width } = display.workArea;
  return { x: Math.round(x + width - WIDTH - MARGIN), y: Math.round(y + MARGIN) };
}

/**
 * Whether a window still sits wholly on a display that exists.
 *
 * The indicator is hidden between sessions rather than destroyed, so it comes back
 * wherever it last was — which is right when the user dragged it somewhere, and wrong
 * when that somewhere was a monitor since unplugged, or a spot a resolution change put
 * past the edge. An indicator nobody can see is precisely the failure this window exists
 * to prevent, so it is checked rather than assumed.
 */
function isOnScreen(win: BrowserWindow): boolean {
  const [x, y] = win.getPosition();
  return screen.getAllDisplays().some((display) => {
    const { x: dx, y: dy, width, height } = display.workArea;
    // The whole pill, not a sliver: two visible pixels on an edge is not visibility.
    return x >= dx && y >= dy && x + WIDTH <= dx + width && y + HEIGHT <= dy + height;
  });
}

export function showMeetingIndicator(): void {
  if (quitting) return;
  if (indicator && !indicator.isDestroyed()) {
    if (!isOnScreen(indicator)) {
      const { x, y } = position();
      indicator.setPosition(x, y);
    }
    indicator.showInactive();
    return;
  }

  const { x, y } = position();
  indicator = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    // Out of the dock, out of alt-tab, and off the window menu: it is a status light,
    // not a window someone should have to manage.
    skipTaskbar: true,
    // Deliberately NOT `focusable: false`. That would be the obvious way to keep it from
    // stealing focus, but on macOS a non-focusable window can swallow mouse events — and
    // the stop button is the only control here, so losing clicks would break the feature
    // outright. `showInactive()` below gets the same "never interrupts you" behaviour
    // without touching hit-testing.
    hasShadow: false,
    show: false,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: preloadPath,
      // Nothing renders while the window is off-screen or occluded otherwise, which
      // would freeze the elapsed clock the moment it is most worth trusting.
      backgroundThrottling: false,
    },
  });

  markSecondaryWindow(indicator);

  // "screen-saver" outranks fullscreen apps — which is precisely the case that matters,
  // since a fullscreen Zoom window would otherwise cover the one thing saying it is
  // being recorded.
  indicator.setAlwaysOnTop(true, "screen-saver");
  indicator.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Excluded from screen capture, so it does not appear in the recording of the meeting
  // it is reporting on — and does not end up in a shared screen.
  indicator.setContentProtection(true);

  indicator.on("closed", () => {
    indicator = null;
  });

  indicator.once("ready-to-show", () => {
    // `showInactive`, not `show`: appearing must never pull focus off the call.
    if (!quitting) indicator?.showInactive();
  });

  void indicator.loadURL(indicatorUrl());
}

export function hideMeetingIndicator(): void {
  if (indicator && !indicator.isDestroyed()) indicator.hide();
}

export function destroyMeetingIndicator(): void {
  quitting = true;
  if (indicator && !indicator.isDestroyed()) indicator.destroy();
  indicator = null;
}

/** Whether the indicator should be up for a given capture state. */
export function syncMeetingIndicator(state: string): void {
  if (state === "recording" || state === "starting" || state === "stopping") {
    showMeetingIndicator();
  } else {
    hideMeetingIndicator();
  }
}
