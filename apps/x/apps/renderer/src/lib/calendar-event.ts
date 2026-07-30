/**
 * Moved to `@x/shared/calendar` so the main and core processes can use it too — they are
 * the ones that decide whether to start recording, and they could not import from the
 * renderer. Re-exported here so existing importers are unaffected.
 */
export {
  extractConferenceLink,
  conferenceProviderLabel,
  isEventNow,
  resolveCalendarEvent,
  startsWithin,
  type CalendarEvent,
  type ResolvedCalendarEvent,
} from "@x/shared/dist/calendar.js";
