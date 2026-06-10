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
	StartsAt  string   `json:"startsAt"`
	EndsAt    string   `json:"endsAt,omitempty"`
	Attendees []string `json:"attendees,omitempty"`
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
			ID      string `json:"id"`
			Summary string `json:"summary"`
			Start   struct {
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
		ev := CalendarEvent{ID: it.ID, Summary: it.Summary}
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

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
