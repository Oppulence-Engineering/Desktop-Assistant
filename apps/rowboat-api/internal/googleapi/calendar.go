package googleapi

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
)

// maxCalendarEvents caps one events.list call.
const maxCalendarEvents = 10

// CalendarQuery bounds an events.list call. TimeMin/TimeMax are RFC3339.
type CalendarQuery struct {
	TimeMin string
	TimeMax string
	Text    string // free-text q= filter
	Limit   int
}

// CalendarEvent is the narrow read shape the runtime's connector tool returns
// (RFC 004 contract).
type CalendarEvent struct {
	ID        string   `json:"id"`
	Summary   string   `json:"summary"`
	HTMLLink  string   `json:"htmlLink,omitempty"`
	StartsAt  string   `json:"startsAt"`
	EndsAt    string   `json:"endsAt,omitempty"`
	Attendees []string `json:"attendees,omitempty"`
}

// CalendarEventMutation is the write shape accepted by event create/update.
type CalendarEventMutation struct {
	Summary     string
	Description string
	Location    string
	Start       string
	End         string
	TimeZone    string
	Attendees   []string
}

// ListEvents lists upcoming events on the user's primary calendar.
func (c *Client) ListEvents(ctx context.Context, token string, query CalendarQuery) ([]CalendarEvent, error) {
	limit := query.Limit
	if limit <= 0 || limit > maxCalendarEvents {
		limit = maxCalendarEvents
	}
	q := url.Values{}
	q.Set("singleEvents", "true")
	q.Set("orderBy", "startTime")
	q.Set("maxResults", strconv.Itoa(limit))
	if query.TimeMin != "" {
		q.Set("timeMin", query.TimeMin)
	}
	if query.TimeMax != "" {
		q.Set("timeMax", query.TimeMax)
	}
	if query.Text != "" {
		q.Set("q", query.Text)
	}

	var list struct {
		Items []struct {
			ID       string `json:"id"`
			Summary  string `json:"summary"`
			HTMLLink string `json:"htmlLink"`
			Start    struct {
				DateTime string `json:"dateTime"`
				Date     string `json:"date"`
			} `json:"start"`
			End struct {
				DateTime string `json:"dateTime"`
				Date     string `json:"date"`
			} `json:"end"`
			Attendees []struct {
				Email string `json:"email"`
			} `json:"attendees"`
		} `json:"items"`
	}
	if err := c.GetJSON(ctx, token, c.cfg.CalendarBaseURL+"/calendars/primary/events", q, &list); err != nil {
		return nil, fmt.Errorf("calendar events.list: %w", err)
	}

	out := make([]CalendarEvent, 0, len(list.Items))
	for _, it := range list.Items {
		ev := CalendarEvent{ID: it.ID, Summary: it.Summary, HTMLLink: it.HTMLLink}
		ev.StartsAt = firstNonEmpty(it.Start.DateTime, it.Start.Date)
		ev.EndsAt = firstNonEmpty(it.End.DateTime, it.End.Date)
		for _, a := range it.Attendees {
			if a.Email != "" {
				ev.Attendees = append(ev.Attendees, a.Email)
			}
		}
		out = append(out, ev)
	}
	return out, nil
}

// CreateEvent creates an event on the user's primary calendar.
func (c *Client) CreateEvent(ctx context.Context, token string, in CalendarEventMutation) (CalendarEvent, error) {
	body, err := calendarEventBody(in, false)
	if err != nil {
		return CalendarEvent{}, err
	}
	var out calendarAPIEvent
	endpoint := c.cfg.CalendarBaseURL + "/calendars/primary/events"
	if len(in.Attendees) > 0 {
		// An approved customer-facing calendar action must actually notify its
		// attendee. Google's default can create the event without sending an
		// invitation, which would make the provider receipt look successful while
		// no external follow-up occurred.
		endpoint += "?sendUpdates=all"
	}
	if err := c.PostJSON(ctx, token, endpoint, body, &out); err != nil {
		return CalendarEvent{}, fmt.Errorf("calendar events.insert: %w", err)
	}
	return out.toCalendarEvent(), nil
}

// UpdateEvent replaces the supplied fields on an event on the user's primary
// calendar. The request body is intentionally full-event shaped because Google
// events.update replaces the resource; callers should supply the desired event
// fields, not a sparse patch.
func (c *Client) UpdateEvent(ctx context.Context, token, eventID string, in CalendarEventMutation) (CalendarEvent, error) {
	if eventID == "" {
		return CalendarEvent{}, fmt.Errorf("calendar event id is required")
	}
	body, err := calendarEventBody(in, false)
	if err != nil {
		return CalendarEvent{}, err
	}
	var out calendarAPIEvent
	if err := c.PutJSON(ctx, token, c.cfg.CalendarBaseURL+"/calendars/primary/events/"+url.PathEscape(eventID), body, &out); err != nil {
		return CalendarEvent{}, fmt.Errorf("calendar events.update: %w", err)
	}
	return out.toCalendarEvent(), nil
}

func calendarEventBody(in CalendarEventMutation, allowEmptyTime bool) (map[string]any, error) {
	if in.Summary == "" {
		return nil, fmt.Errorf("calendar summary is required")
	}
	if !allowEmptyTime && (in.Start == "" || in.End == "") {
		return nil, fmt.Errorf("calendar start and end are required")
	}
	body := map[string]any{"summary": in.Summary}
	if in.Description != "" {
		body["description"] = in.Description
	}
	if in.Location != "" {
		body["location"] = in.Location
	}
	if in.Start != "" {
		body["start"] = calendarDateTime(in.Start, in.TimeZone)
	}
	if in.End != "" {
		body["end"] = calendarDateTime(in.End, in.TimeZone)
	}
	if len(in.Attendees) > 0 {
		attendees := make([]map[string]string, 0, len(in.Attendees))
		for _, email := range in.Attendees {
			if email != "" {
				attendees = append(attendees, map[string]string{"email": email})
			}
		}
		body["attendees"] = attendees
	}
	return body, nil
}

func calendarDateTime(value, tz string) map[string]string {
	out := map[string]string{"dateTime": value}
	if tz != "" {
		out["timeZone"] = tz
	}
	return out
}

type calendarAPIEvent struct {
	ID       string `json:"id"`
	Summary  string `json:"summary"`
	HTMLLink string `json:"htmlLink"`
	Start    struct {
		DateTime string `json:"dateTime"`
		Date     string `json:"date"`
	} `json:"start"`
	End struct {
		DateTime string `json:"dateTime"`
		Date     string `json:"date"`
	} `json:"end"`
	Attendees []struct {
		Email string `json:"email"`
	} `json:"attendees"`
}

func (e calendarAPIEvent) toCalendarEvent() CalendarEvent {
	out := CalendarEvent{ID: e.ID, Summary: e.Summary, HTMLLink: e.HTMLLink}
	out.StartsAt = firstNonEmpty(e.Start.DateTime, e.Start.Date)
	out.EndsAt = firstNonEmpty(e.End.DateTime, e.End.Date)
	for _, attendee := range e.Attendees {
		if attendee.Email != "" {
			out.Attendees = append(out.Attendees, attendee.Email)
		}
	}
	return out
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
