import { ipc } from "@x/shared";
import type { MeetingCalendarEvent } from "@x/shared/dist/meetings.js";
import { getTranscriptionConfig } from "@x/core/dist/voice/voice.js";
import { BrowserWindow } from "electron";
import {
  nativeCaptureAvailable,
  resolveCaptureEngine,
  runCaptureDoctor,
} from "../meeting-capture.js";
import {
  ensureParakeetModels,
  parakeetModelStatus,
  type ParakeetModel,
} from "../meeting-engines.js";
import { getMeetingController, type MeetingControllerDeps } from "../meeting-controller.js";

type IPCChannels = ipc.IPCChannels;

type InvokeHandler<K extends keyof IPCChannels> = (
  event: Electron.IpcMainInvokeEvent,
  args: IPCChannels[K]["req"],
) => IPCChannels[K]["res"] | Promise<IPCChannels[K]["res"]>;

type MeetingCaptureHandlers = {
  "meeting:captureEngine": InvokeHandler<"meeting:captureEngine">;
  "meeting:startCapture": InvokeHandler<"meeting:startCapture">;
  "meeting:stopCapture": InvokeHandler<"meeting:stopCapture">;
  "meeting:captureStatus": InvokeHandler<"meeting:captureStatus">;
  "meeting:listSessions": InvokeHandler<"meeting:listSessions">;
  "meeting:retranscribe": InvokeHandler<"meeting:retranscribe">;
  "meeting:deleteSession": InvokeHandler<"meeting:deleteSession">;
  "meeting:deleteAllSessions": InvokeHandler<"meeting:deleteAllSessions">;
  "meeting:storageUsage": InvokeHandler<"meeting:storageUsage">;
  "meeting:captureDoctor": InvokeHandler<"meeting:captureDoctor">;
  "meeting:transcriptionModels": InvokeHandler<"meeting:transcriptionModels">;
  "meeting:ensureTranscriptionModels": InvokeHandler<"meeting:ensureTranscriptionModels">;
};

async function parakeetModel(): Promise<ParakeetModel> {
  const config = await getTranscriptionConfig();
  return config.meetings?.parakeetModel ?? "v3";
}

function parseCalendarEvent(json?: string): MeetingCalendarEvent | undefined {
  if (!json) return undefined;
  try {
    return JSON.parse(json) as MeetingCalendarEvent;
  } catch {
    return undefined;
  }
}

async function configuredEngine(): Promise<string> {
  const config = await getTranscriptionConfig();
  return config.meetings?.captureEngine ?? "auto";
}

/**
 * Native meeting capture IPC. Thin adapters over {@link MeetingController} — the
 * session lifecycle lives there so it survives the window closing. Spread into the
 * main `registerIpcHandlers({...})` call, mirroring `mailboxIpcHandlers`.
 */
export function createMeetingIpcHandlers(deps: MeetingControllerDeps): MeetingCaptureHandlers {
  const controller = () => getMeetingController(deps);

  return {
    "meeting:captureEngine": async () => {
      return { engine: resolveCaptureEngine(await configuredEngine()) };
    },

    "meeting:startCapture": async (_event, args) => {
      // Guard here as well as in the renderer: a stale renderer that starts a native
      // session on a machine without the sidecar would otherwise hang waiting.
      if (resolveCaptureEngine(await configuredEngine()) !== "native") {
        return {
          started: false,
          tracks: [],
          warnings: [],
          error: "native capture is unavailable on this device",
        };
      }
      await controller().refreshSettings();
      return controller().start(parseCalendarEvent(args.calendarEventJson));
    },

    "meeting:stopCapture": async () => {
      return controller().stop();
    },

    "meeting:captureStatus": async () => {
      return controller().status();
    },

    "meeting:listSessions": async () => {
      return { sessions: await controller().listSessions() };
    },

    "meeting:retranscribe": async (_event, args) => {
      await controller().refreshSettings();
      return controller().retranscribe(args.sessionId);
    },

    "meeting:deleteAllSessions": async (_event, args) => {
      return controller().deleteAllSessions(args.deleteNotes);
    },
    "meeting:storageUsage": async () => {
      return controller().storageUsage();
    },
    "meeting:deleteSession": async (_event, args) => {
      return controller().deleteSession(args.sessionId, args.deleteNote);
    },

    "meeting:captureDoctor": async (_event, args) => {
      return runCaptureDoctor(await controller().root(), args.probeSystemAudio);
    },

    "meeting:transcriptionModels": async () => {
      if (!nativeCaptureAvailable()) {
        return { ready: false, model: "", cacheDir: "", available: false };
      }
      const status = await parakeetModelStatus(await parakeetModel());
      return { ...status, available: true };
    },

    "meeting:ensureTranscriptionModels": async () => {
      if (!nativeCaptureAvailable()) {
        return { ready: false, error: "the capture helper is not installed in this build" };
      }
      try {
        const status = await ensureParakeetModels(await parakeetModel(), (fraction, phase) => {
          for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed() && win.webContents) {
              win.webContents.send("meeting:modelProgress", { fraction, phase });
            }
          }
        });
        return { ready: status.ready };
      } catch (err) {
        return { ready: false, error: (err as Error).message };
      }
    },
  };
}
