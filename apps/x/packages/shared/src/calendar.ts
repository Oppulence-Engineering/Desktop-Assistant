import { z } from "zod";

/**
 * Calendar events, shared.
 *
 * `calendar_sync/` holds raw Google `Schema$Event` JSON, and until now every consumer
 * declared its own partial shape and its own filters — the notifier, the meeting
 * summarizer, the meetings view, and the home view all did it differently. Anything that
 * needs to know "is a meeting about to start" needs one answer, not four.
 *
 * `extractConferenceLink` lived in the renderer, so the main and core processes — the
 * ones that actually decide whether to start recording — could not reach it.
 */

/** The slice of a Google calendar event anything here cares about. Everything is
 *  optional because it is raw provider JSON, and absent fields are normal. */
export const CalendarEventSchema = z
  .object({
    id: z.string().optional(),
    summary: z.string().optional(),
    status: z.string().optional(),
    start: z.object({ dateTime: z.string().optional(), date: z.string().optional() }).optional(),
    end: z.object({ dateTime: z.string().optional(), date: z.string().optional() }).optional(),
    location: z.string().optional(),
    description: z.string().optional(),
    htmlLink: z.string().optional(),
    hangoutLink: z.string().optional(),
    conferenceLink: z.string().optional(),
    conferenceData: z
      .object({
        entryPoints: z
          .array(z.object({ entryPointType: z.string().optional(), uri: z.string().optional() }))
          .optional(),
      })
      .optional(),
    organizer: z
      .object({ email: z.string().optional(), displayName: z.string().optional() })
      .optional(),
    attendees: z
      .array(
        z.object({
          email: z.string().optional(),
          displayName: z.string().optional(),
          self: z.boolean().optional(),
          optional: z.boolean().optional(),
          responseStatus: z.string().optional(),
        }),
      )
      .optional(),
  })
  .passthrough();
export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

/** A normalized event with its times resolved. */
export interface ResolvedCalendarEvent {
  id: string;
  summary: string;
  start: Date;
  /** Absent when the provider gave no end; treat as `start + 30min` for "is it now". */
  end: Date | null;
  isAllDay: boolean;
  conferenceLink: string | null;
  raw: CalendarEvent;
}

/** Default span for an event with no end, matching the meetings view's assumption. */
export const DEFAULT_EVENT_MINUTES = 30;

const MEETING_URL_RE =
  /https?:\/\/(?:[a-z0-9-]+\.)*(?:zoom\.us|zoomgov\.com|teams\.microsoft\.com|teams\.live\.com|meet\.google\.com)\/[^\s"'<>)\]]+/i;

function findMeetingUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = MEETING_URL_RE.exec(value);
  // Calendar descriptions are often HTML, so decode &amp; back to & in the URL.
  return match ? match[0].replace(/&amp;/g, "&") : undefined;
}

/**
 * A video-conference join URL, if the event has one. Checks structured conference data
 * first, then falls back to scanning location and description — plenty of real invites
 * only put the link in the body.
 */
export function extractConferenceLink(raw: Record<string, unknown>): string | undefined {
  const confData = raw.conferenceData as
    | { entryPoints?: { entryPointType?: string; uri?: string }[] }
    | undefined;
  const video = confData?.entryPoints?.find((ep) => ep.entryPointType === "video");
  if (video?.uri) return video.uri;
  if (typeof raw.hangoutLink === "string") return raw.hangoutLink;
  if (typeof raw.conferenceLink === "string") return raw.conferenceLink;
  return findMeetingUrl(raw.location) ?? findMeetingUrl(raw.description);
}

/** Human label for the provider behind a join link. */
export function conferenceProviderLabel(link: string | null | undefined): string | null {
  if (!link) return null;
  if (/zoom\.us|zoomgov\.com/i.test(link)) return "Zoom";
  if (/teams\.(?:microsoft|live)\.com/i.test(link)) return "Teams";
  if (/meet\.google\.com/i.test(link)) return "Meet";
  return "Video call";
}

/** True when the local user explicitly declined. Their own decline is the one response
 *  that should stop us acting on an event. */
export function isDeclinedBySelf(event: CalendarEvent): boolean {
  return event.attendees?.some((a) => a.self && a.responseStatus === "declined") ?? false;
}

/**
 * Normalize a raw event, or null when it is not something to act on: cancelled,
 * declined, all-day, or with an unparseable start.
 *
 * All-day events are excluded deliberately — "starts now" is meaningless for them, and
 * treating one as a meeting would arm capture for a whole day.
 */
export function resolveCalendarEvent(
  raw: unknown,
  fallbackId?: string,
): ResolvedCalendarEvent | null {
  const parsed = CalendarEventSchema.safeParse(raw);
  if (!parsed.success) return null;
  const event = parsed.data;

  if (event.status === "cancelled") return null;
  if (isDeclinedBySelf(event)) return null;

  const startedAt = event.start?.dateTime;
  if (!startedAt) return null; // all-day (date only) or malformed
  const start = new Date(startedAt);
  if (Number.isNaN(start.getTime())) return null;

  const endedAt = event.end?.dateTime;
  const end = endedAt ? new Date(endedAt) : null;

  return {
    id: event.id ?? fallbackId ?? startedAt,
    summary: event.summary?.trim() || "(No title)",
    start,
    end: end && !Number.isNaN(end.getTime()) ? end : null,
    isAllDay: false,
    conferenceLink: extractConferenceLink(event as Record<string, unknown>) ?? null,
    raw: event,
  };
}

/**
 * Whether an event is happening right now.
 *
 * Typed on the time fields alone rather than {@link ResolvedCalendarEvent} so the
 * renderer's own event shape — which keeps all-day entries because it renders a calendar
 * — can use the same predicate. All-day is never "now": it would mean armed all day.
 */
export function isEventNow(
  event: { start: Date; end: Date | null; isAllDay?: boolean },
  now = Date.now(),
): boolean {
  if (event.isAllDay) return false;
  const start = event.start.getTime();
  const end = event.end ? event.end.getTime() : start + DEFAULT_EVENT_MINUTES * 60_000;
  return start <= now && now < end;
}

/**
 * Whether an event starts inside `[now + earliestMs, now + latestMs]`.
 *
 * A window rather than an instant because every caller here is driven by a periodic
 * tick: a check for "2 minutes out" fired every 30s must accept a span at least as wide
 * as the tick, or it will straddle the moment and never fire.
 */
export function startsWithin(
  event: ResolvedCalendarEvent,
  earliestMs: number,
  latestMs: number,
  now = Date.now(),
): boolean {
  const untilStart = event.start.getTime() - now;
  return untilStart >= earliestMs && untilStart <= latestMs;
}
