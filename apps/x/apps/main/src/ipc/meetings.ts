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
import { warmFastDictationEngine } from "../parakeet-dictation-runner.js";
import { getMeetingController, type MeetingControllerDeps } from "../meeting-controller.js";
import { getUiState, setUiState } from "@x/core/dist/config/ui_state.js";
import { runMeetingPreflight } from "../meeting-preflight.js";
import path from "node:path";
import { recordingsRoot } from "@x/core/dist/meetings/session.js";
import { readRelationshipCandidates } from "@x/core/dist/meetings/relationship-candidates.js";

type IPCChannels = ipc.IPCChannels;

type InvokeHandler<K extends keyof IPCChannels> = (
  event: Electron.IpcMainInvokeEvent,
  args: IPCChannels[K]["req"],
) => IPCChannels[K]["res"] | Promise<IPCChannels[K]["res"]>;

type MeetingCaptureHandlers = {
  "meeting:captureEngine": InvokeHandler<"meeting:captureEngine">;
  "meeting:startCapture": InvokeHandler<"meeting:startCapture">;
  "meeting:stopCapture": InvokeHandler<"meeting:stopCapture">;
  "meeting:publishRendererEvidence": InvokeHandler<"meeting:publishRendererEvidence">;
  "meeting:publishSessionEvidence": InvokeHandler<"meeting:publishSessionEvidence">;
  "meeting:relationshipCandidates": InvokeHandler<"meeting:relationshipCandidates">;
  "meeting:captureStatus": InvokeHandler<"meeting:captureStatus">;
  "meeting:listSessions": InvokeHandler<"meeting:listSessions">;
  "meeting:retranscribe": InvokeHandler<"meeting:retranscribe">;
  "meeting:deleteSession": InvokeHandler<"meeting:deleteSession">;
  "meeting:startStandby": InvokeHandler<"meeting:startStandby">;
  "meeting:beginRecording": InvokeHandler<"meeting:beginRecording">;
  "meeting:deleteAllSessions": InvokeHandler<"meeting:deleteAllSessions">;
  "meeting:sessionTranscript": InvokeHandler<"meeting:sessionTranscript">;
  "meeting:audioTracks": InvokeHandler<"meeting:audioTracks">;
  "meeting:commitments": InvokeHandler<"meeting:commitments">;
  "meeting:pendingCommitments": InvokeHandler<"meeting:pendingCommitments">;
  "meeting:liveTranscript": InvokeHandler<"meeting:liveTranscript">;
  "meeting:ask": InvokeHandler<"meeting:ask">;
  "meeting:dismissLiveCue": InvokeHandler<"meeting:dismissLiveCue">;
  "meeting:liveCueFeedback": InvokeHandler<"meeting:liveCueFeedback">;
  "meeting:confirmCommitment": InvokeHandler<"meeting:confirmCommitment">;
  "meeting:dismissCommitment": InvokeHandler<"meeting:dismissCommitment">;
  "meeting:ledger": InvokeHandler<"meeting:ledger">;
  "meeting:setCommitmentStatus": InvokeHandler<"meeting:setCommitmentStatus">;
  "ui:getState": InvokeHandler<"ui:getState">;
  "ui:setState": InvokeHandler<"ui:setState">;
  "meeting:storageUsage": InvokeHandler<"meeting:storageUsage">;
  "meeting:captureDoctor": InvokeHandler<"meeting:captureDoctor">;
  "meeting:preflight": InvokeHandler<"meeting:preflight">;
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
      return controller().start(parseCalendarEvent(args.calendarEventJson), {
        relationshipTarget: args.relationshipTarget,
      });
    },

    "meeting:stopCapture": async () => {
      return controller().stop();
    },
    "meeting:publishRendererEvidence": async (_event, args) => {
      return controller().publishRendererEvidence(args);
    },
    "meeting:publishSessionEvidence": async (_event, args) => {
      return controller().publishSessionEvidence(args.sessionId, args.relationshipTarget);
    },

    "meeting:relationshipCandidates": async (_event, args) => {
      const dir = path.join(recordingsRoot(), args.sessionId);
      const stored = await readRelationshipCandidates(dir);
      if (!stored) return { resolved: false, candidates: [] };
      return {
        resolved: !!stored.resolvedAt,
        // Already answered: return nothing to render, so the prompt does not
        // reappear every time the view is opened.
        candidates: stored.resolvedAt ? [] : stored.candidates,
      };
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

    "meeting:startStandby": async (_event, args) => {
      const calendarEvent = args.calendarEventJson
        ? (JSON.parse(args.calendarEventJson) as MeetingCalendarEvent)
        : undefined;
      const result = await controller().start(calendarEvent, {
        standby: true,
        relationshipTarget: args.relationshipTarget,
      });
      return {
        started: result.started,
        sessionId: result.sessionId,
        tracks: result.tracks,
        warnings: result.warnings,
        error: result.error,
      };
    },
    "meeting:beginRecording": async () => {
      return controller().beginRecording();
    },
    "meeting:liveTranscript": async () => {
      return controller().liveTranscript();
    },
    "meeting:ask": async (_event, args) => {
      return controller().ask(args.question);
    },
    "meeting:dismissLiveCue": async (_event, args) => {
      return controller().dismissLiveCue(args.cueId);
    },
    "meeting:liveCueFeedback": async (_event, args) => {
      return controller().recordLiveCueFeedback(args.cueId, args.outcome);
    },
    "meeting:pendingCommitments": async () => {
      return { sessions: await controller().pendingCommitments() };
    },
    "meeting:commitments": async (_event, args) => {
      return controller().commitments(args.sessionId);
    },
    "meeting:confirmCommitment": async (_event, args) => {
      return controller().confirmCommitment(args.sessionId, args.startMs, args.endMs);
    },
    "meeting:dismissCommitment": async (_event, args) => {
      return controller().dismissCommitment(args.sessionId, args.startMs, args.endMs);
    },
    "meeting:ledger": async () => {
      return { commitments: await controller().ledger() };
    },
    "meeting:setCommitmentStatus": async (_event, args) => {
      return { updated: await controller().setCommitmentStatus(args.id, args.status) };
    },
    "meeting:audioTracks": async (_event, args) => {
      return controller().audioTracks(args.sessionId);
    },
    "meeting:sessionTranscript": async (_event, args) => {
      return controller().sessionTranscript(args.sessionId);
    },
    "ui:getState": async () => {
      const state = await getUiState();
      return { meetingCaptureCheckDone: state.meetingCaptureCheckDone ?? false };
    },
    "ui:setState": async (_event, args) => {
      const state = await setUiState(args);
      return { meetingCaptureCheckDone: state.meetingCaptureCheckDone ?? false };
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
    "meeting:preflight": async (_event, args) => {
      return runMeetingPreflight(args.probeSystemAudio);
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
        if (status.ready) await warmFastDictationEngine({ refresh: true });
        return { ready: status.ready };
      } catch (err) {
        return { ready: false, error: (err as Error).message };
      }
    },
  };
}
