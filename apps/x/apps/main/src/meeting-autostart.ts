import type { CalendarNotifyHooks } from "@x/core/dist/knowledge/notify_calendar_meetings.js";
import type { ResolvedCalendarEvent } from "@x/shared/dist/calendar.js";
import type { MeetingCalendarEvent } from "@x/shared/dist/meetings.js";
import { getTranscriptionConfig } from "@x/core/dist/voice/voice.js";
import { peekMeetingController } from "./meeting-controller.js";
import { runMeetingPreflight, preflightSummary } from "./meeting-preflight.js";
import { osSupportsNativeCapture } from "./meeting-capture.js";

/**
 * Everything the calendar tick needs from the main process.
 *
 * These live here rather than inside the notifier because they need the capture
 * sidecar, the recording controller and the meetings config, none of which core can
 * import. Keeping them behind one small interface means all three notifications stay on
 * one timer with one dedupe file, instead of three schedulers arguing about the same
 * meeting.
 */

/** The slice of a calendar event `meta.json` stores and the note renders. */
function toMeetingEvent(event: ResolvedCalendarEvent): MeetingCalendarEvent {
  return {
    summary: event.summary,
    start: { dateTime: event.start.toISOString() },
    ...(event.end ? { end: { dateTime: event.end.toISOString() } } : {}),
    ...(event.conferenceLink ? { conferenceLink: event.conferenceLink } : {}),
    source: "google",
  };
}

/** Whose meetings record without asking. Compared case-insensitively — calendar
 *  providers are not consistent about the case of an address. */
function isSilentOrganizer(organizers: string[], event: ResolvedCalendarEvent): boolean {
  const email = event.raw.organizer?.email?.toLowerCase();
  if (!email) return false;
  return organizers.some((allowed) => allowed.trim().toLowerCase() === email);
}

export function calendarNotifyHooks(): CalendarNotifyHooks {
  return {
    preflight: async () => {
      const config = await getTranscriptionConfig();
      if (config.meetings?.preflightNotifications === false) return null;
      const summary = preflightSummary(await runMeetingPreflight());
      return summary ? { summary } : null;
    },

    recordPolicy: async (event) => {
      // Nothing to offer when the machine cannot do native capture at all: the
      // in-app pipeline needs the window open, so a notification promising to start
      // one from a closed app would be a lie.
      if (!osSupportsNativeCapture()) return "off";
      const config = await getTranscriptionConfig();
      const meetings = config.meetings;
      if (!meetings || meetings.autoStart === "off") return "off";
      if (meetings.autoStart === "always") return "auto";
      return isSilentOrganizer(meetings.autoStartSilentOrganizers ?? [], event) ? "auto" : "prompt";
    },

    armStandby: async (event) => {
      if (!osSupportsNativeCapture()) return;
      const config = await getTranscriptionConfig();
      if (config.meetings?.standbyBeforeMeetings !== true) return;
      const controller = peekMeetingController();
      // Only from a standing start: a session already running — recording or standing
      // by — is not ours to disturb.
      if (!controller || controller.recording || controller.standingBy) return;
      await controller.start(toMeetingEvent(event), { standby: true });
    },

    startRecording: async (event) => {
      const controller = peekMeetingController();
      if (!controller || controller.recording) return;
      // Already standing by for this meeting: promote it, which keeps the buffered
      // minutes rather than throwing them away and starting from now.
      if (controller.standingBy) {
        const promoted = await controller.beginRecording();
        if (!promoted.started) throw new Error(promoted.error ?? "could not start recording");
        return;
      }
      const result = await controller.start(toMeetingEvent(event));
      if (!result.started) {
        throw new Error(result.error ?? "could not start recording");
      }
    },

    isRecording: () => peekMeetingController()?.recording ?? false,
  };
}
