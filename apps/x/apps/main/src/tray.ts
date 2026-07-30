import { app, BrowserWindow, Menu, nativeImage, shell, Tray } from "electron";
import type { NativeImage } from "electron";
import { peekMeetingController, type MeetingController } from "./meeting-controller.js";

/**
 * Menu-bar presence for meeting capture.
 *
 * The point is not convenience — it is that capture no longer belongs to a window.
 * The sidecar keeps recording with every window closed, so there has to be somewhere
 * to see that it is recording and to stop it. The icon turns filled-red with a live
 * elapsed counter while a session runs, which doubles as the reassurance that
 * something is actually being captured.
 */

let tray: Tray | null = null;
let ticker: NodeJS.Timeout | null = null;

/** Template images: macOS tints them for light/dark menu bars automatically. A
 *  16×16 mic glyph drawn as an SVG keeps this out of the icon pipeline. */
function micIcon(recording: boolean): NativeImage {
  const svg = recording
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
         <rect x="5" y="1" width="6" height="9" rx="3" fill="black"/>
         <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0" stroke="black" stroke-width="1.4" fill="none" stroke-linecap="round"/>
         <path d="M8 12v2.5" stroke="black" stroke-width="1.4" stroke-linecap="round"/>
       </svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
         <rect x="5.2" y="1.2" width="5.6" height="8.6" rx="2.8" stroke="black" stroke-width="1.3" fill="none"/>
         <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0" stroke="black" stroke-width="1.3" fill="none" stroke-linecap="round"/>
         <path d="M8 12v2.5" stroke="black" stroke-width="1.3" stroke-linecap="round"/>
       </svg>`;
  const image = nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
  );
  image.setTemplateImage(true);
  return image;
}

function clock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function focusApp(): void {
  const [win] = BrowserWindow.getAllWindows();
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
  app.focus({ steal: true });
}

async function rebuild(controller: MeetingController): Promise<void> {
  if (!tray) return;
  const recording = controller.recording;
  const status = await controller.status();
  const elapsed = controller.elapsedSeconds;

  tray.setImage(micIcon(recording));
  // The title next to the icon is the only always-visible surface, so it carries the
  // elapsed time while recording and stays empty otherwise.
  tray.setTitle(recording ? ` ${clock(elapsed)}` : "");
  tray.setToolTip(recording ? `Recording — ${clock(elapsed)}` : "Oppulence");

  const transcribing = status.transcribingSessionId;
  const queueLabel = transcribing
    ? status.queueDepth > 1
      ? `Transcribing ${transcribing} · ${status.queueDepth - 1} queued`
      : `Transcribing ${transcribing}`
    : null;

  // One-sided capture is worth surfacing here too: the tray is where someone looks
  // when they are unsure the meeting is being recorded properly.
  const micOnly = recording && !status.tracks.includes("system");

  tray.setContextMenu(
    Menu.buildFromTemplate([
      recording
        ? { label: `Recording — ${clock(elapsed)}`, enabled: false }
        : { label: "Not recording", enabled: false },
      ...(micOnly ? [{ label: "Microphone only — no system audio", enabled: false } as const] : []),
      { type: "separator" as const },
      {
        label: recording ? "Stop recording" : "Start recording",
        click: () => {
          void (recording ? controller.stop() : controller.start());
        },
      },
      ...(queueLabel ? [{ label: queueLabel, enabled: false } as const] : []),
      { type: "separator" as const },
      {
        label: "Open recordings folder",
        click: () => {
          void controller.root().then((root) => shell.openPath(root));
        },
      },
      { label: "Open Oppulence", click: focusApp },
      { type: "separator" as const },
      { label: "Quit Oppulence", role: "quit" as const },
    ]),
  );
}

/**
 * Create the tray. Safe to call once at startup; the elapsed-time ticker only runs
 * while a session is live so an idle app is not waking up every second.
 */
export function initMeetingTray(controller: MeetingController): void {
  if (tray) return;
  tray = new Tray(micIcon(false));
  tray.setIgnoreDoubleClickEvents(true);

  const refresh = () => {
    void rebuild(controller);
    if (controller.recording && !ticker) {
      ticker = setInterval(() => void rebuild(controller), 1000);
    } else if (!controller.recording && ticker) {
      clearInterval(ticker);
      ticker = null;
    }
  };

  controller.setStateListener(refresh);
  refresh();
}

export function destroyMeetingTray(): void {
  if (ticker) {
    clearInterval(ticker);
    ticker = null;
  }
  tray?.destroy();
  tray = null;
}

/** Stop a live capture cleanly on quit, so the last write is not a truncated file. */
export function stopCaptureForQuit(): void {
  peekMeetingController()?.stopForQuit();
}
