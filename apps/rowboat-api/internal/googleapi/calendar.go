package googleapi

import (
	"context"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"time"
)

// maxCalendarEvents caps one events.list call.
const maxCalendarEvents = 10

// maxCalendarCountPages bounds count-only scans at 25,000 event instances.
const maxCalendarCountPages = 10

// CalendarQuery bounds an events.list call. TimeMin/TimeMax are RFC3339.
type CalendarQuery struct {
	TimeMin   string
	TimeMax   string
	Text      string // free-text q= filter
	Limit     int
	PageToken string
}

// CalendarEvent is the narrow read shape the runtime's connector tool returns
// (RFC 004 contract).
type CalendarEvent struct {
	ID                   string               `json:"id"`
	ICalUID              string               `json:"iCalUID,omitempty"`
	RecurringEventID     string               `json:"recurringEventId,omitempty"`
	OriginalStartAt      string               `json:"originalStartAt,omitempty"`
	RecurrenceRules      []string             `json:"recurrenceRules,omitempty"`
	UsesDefaultReminders bool                 `json:"usesDefaultReminders"`
	ReminderOverrides    []CalendarReminder   `json:"reminderOverrides,omitempty"`
	Summary              string               `json:"summary"`
	Description          string               `json:"description,omitempty"`
	Location             string               `json:"location,omitempty"`
	Status               string               `json:"status,omitempty"`
	Transparency         string               `json:"transparency,omitempty"`
	BlocksTime           bool                 `json:"blocksTime"`
	AllDay               bool                 `json:"allDay"`
	EventType            string               `json:"eventType,omitempty"`
	Creator              string               `json:"creator,omitempty"`
	CreatedAt            string               `json:"createdAt,omitempty"`
	UpdatedAt            string               `json:"updatedAt,omitempty"`
	Organizer            string               `json:"organizer,omitempty"`
	Attachments          []CalendarAttachment `json:"attachments,omitempty"`
	ConferenceProvider   string               `json:"conferenceProvider,omitempty"`
	ConferenceLink       string               `json:"conferenceLink,omitempty"`
	HTMLLink             string               `json:"htmlLink,omitempty"`
	SelfResponseStatus   string               `json:"selfResponseStatus,omitempty"`
	StartsAt             string               `json:"startsAt"`
	EndsAt               string               `json:"endsAt,omitempty"`
	Attendees            []string             `json:"attendees,omitempty"`
	AttendeeResponses    map[string]string    `json:"attendeeResponses,omitempty"`
}

// CalendarAttachment is one file attached to a calendar event.
type CalendarAttachment struct {
	Title    string `json:"title,omitempty"`
	MIMEType string `json:"mimeType,omitempty"`
	FileURL  string `json:"fileUrl"`
}

// CalendarReminder is one reminder configured on a calendar event.
type CalendarReminder struct {
	Method  string `json:"method"`
	Minutes int    `json:"minutes"`
}

// CalendarAvailabilitySlot is one free or busy period on a calendar.
type CalendarAvailabilitySlot struct {
	Start       string   `json:"start"`
	End         string   `json:"end"`
	CalendarIDs []string `json:"calendarIds"`
}

// CalendarAvailability is the free/busy answer for one calendar over a window.
type CalendarAvailability struct {
	TimeZone         string                     `json:"timeZone"`
	BusyMinutes      float64                    `json:"busyMinutes"`
	TimedBusyMinutes float64                    `json:"timedBusyMinutes"`
	AllDayBusyEvents int                        `json:"allDayBusyEvents"`
	Slots            []CalendarAvailabilitySlot `json:"slots"`
}

// CalendarDayCount is the number of events on one day.
type CalendarDayCount struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
}

// CalendarEventCount is an event tally over a window, broken down by day.
type CalendarEventCount struct {
	MatchingEvents int                `json:"matchingEvents"`
	Complete       bool               `json:"complete"`
	TimeZone       string             `json:"timeZone,omitempty"`
	Days           []CalendarDayCount `json:"days,omitempty"`
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
	// PrivateExtendedProperties are visible only to this application and make
	// an event discoverable after an ambiguous insert response.
	PrivateExtendedProperties map[string]string
}

// ListEvents lists one page of upcoming events on the user's primary calendar.
func (c *Client) ListEvents(ctx context.Context, token string, query CalendarQuery) ([]CalendarEvent, string, error) {
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
	if query.PageToken != "" {
		q.Set("pageToken", query.PageToken)
	}

	var list struct {
		Items         []calendarAPIEvent `json:"items"`
		NextPageToken string             `json:"nextPageToken"`
	}
	if err := c.GetJSON(ctx, token, c.cfg.CalendarBaseURL+"/calendars/primary/events", q, &list); err != nil {
		return nil, "", fmt.Errorf("calendar events.list: %w", err)
	}

	out := make([]CalendarEvent, 0, len(list.Items))
	for _, it := range list.Items {
		out = append(out, it.toCalendarEvent())
	}
	return out, list.NextPageToken, nil
}

// CountEvents counts event instances in one bounded time window without
// fetching event details. When byDay is true, it groups starts in the primary
// calendar's timezone. Complete is false when the safety cap is reached.
func (c *Client) CountEvents(ctx context.Context, token, timeMin, timeMax, text string, byDay bool) (CalendarEventCount, error) {
	start, err := time.Parse(time.RFC3339, timeMin)
	if err != nil {
		return CalendarEventCount{}, fmt.Errorf("calendar count timeMin must be RFC3339: %w", err)
	}
	end, err := time.Parse(time.RFC3339, timeMax)
	if err != nil {
		return CalendarEventCount{}, fmt.Errorf("calendar count timeMax must be RFC3339: %w", err)
	}
	if !end.After(start) {
		return CalendarEventCount{}, fmt.Errorf("calendar count timeMax must be after timeMin")
	}

	q := url.Values{}
	q.Set("singleEvents", "true")
	q.Set("orderBy", "startTime")
	q.Set("maxResults", "2500")
	q.Set("timeMin", timeMin)
	q.Set("timeMax", timeMax)
	q.Set("fields", "items(id),nextPageToken")
	if byDay {
		q.Set("fields", "items(start),nextPageToken,timeZone")
	}
	if text != "" {
		q.Set("q", text)
	}
	result := CalendarEventCount{}
	location := start.Location()
	daily := map[string]int{}
	for range maxCalendarCountPages {
		var list struct {
			Items []struct {
				ID    string          `json:"id"`
				Start calendarAPITime `json:"start"`
			} `json:"items"`
			NextPageToken string `json:"nextPageToken"`
			TimeZone      string `json:"timeZone"`
		}
		if err := c.GetJSON(ctx, token, c.cfg.CalendarBaseURL+"/calendars/primary/events", q, &list); err != nil {
			return CalendarEventCount{}, fmt.Errorf("calendar events.list count: %w", err)
		}
		if byDay && list.TimeZone != "" {
			location, err = time.LoadLocation(list.TimeZone)
			if err != nil {
				return CalendarEventCount{}, fmt.Errorf("calendar count timezone %q: %w", list.TimeZone, err)
			}
		}
		result.MatchingEvents += len(list.Items)
		if byDay {
			for _, event := range list.Items {
				date := event.Start.Date
				if date == "" {
					startedAt, err := time.Parse(time.RFC3339, event.Start.DateTime)
					if err != nil {
						return CalendarEventCount{}, fmt.Errorf("calendar count event start must be RFC3339: %w", err)
					}
					date = startedAt.In(location).Format(time.DateOnly)
				}
				daily[date]++
			}
		}
		if list.NextPageToken == "" {
			result.Complete = true
			break
		}
		q.Set("pageToken", list.NextPageToken)
	}
	if byDay {
		result.TimeZone = location.String()
		dates := make([]string, 0, len(daily))
		for date := range daily {
			dates = append(dates, date)
		}
		sort.Strings(dates)
		for _, date := range dates {
			result.Days = append(result.Days, CalendarDayCount{Date: date, Count: daily[date]})
		}
	}
	return result, nil
}

// FindAvailability returns maximal free windows on the primary calendar. It
// uses events.list so the existing calendar.events.readonly grant is enough,
// and never returns event titles or other private details.
func (c *Client) FindAvailability(ctx context.Context, token, timeMin, timeMax string, durationMinutes int) (CalendarAvailability, error) {
	start, err := time.Parse(time.RFC3339, timeMin)
	if err != nil {
		return CalendarAvailability{}, fmt.Errorf("calendar availability timeMin must be RFC3339: %w", err)
	}
	end, err := time.Parse(time.RFC3339, timeMax)
	if err != nil {
		return CalendarAvailability{}, fmt.Errorf("calendar availability timeMax must be RFC3339: %w", err)
	}
	if !end.After(start) {
		return CalendarAvailability{}, fmt.Errorf("calendar availability timeMax must be after timeMin")
	}
	if durationMinutes < 1 || durationMinutes > 24*60 {
		return CalendarAvailability{}, fmt.Errorf("calendar availability durationMinutes must be between 1 and 1440")
	}

	q := url.Values{}
	q.Set("singleEvents", "true")
	q.Set("orderBy", "startTime")
	q.Set("maxResults", "2500")
	q.Set("timeMin", timeMin)
	q.Set("timeMax", timeMax)
	q.Set("fields", "items(id,start,end,status,transparency),nextPageToken,timeZone")
	var list struct {
		TimeZone      string             `json:"timeZone"`
		NextPageToken string             `json:"nextPageToken"`
		Items         []calendarAPIEvent `json:"items"`
	}
	if err := c.GetJSON(ctx, token, c.cfg.CalendarBaseURL+"/calendars/primary/events", q, &list); err != nil {
		return CalendarAvailability{}, fmt.Errorf("calendar availability events.list: %w", err)
	}
	if list.NextPageToken != "" {
		return CalendarAvailability{}, fmt.Errorf("calendar availability window has more than 2500 events; narrow the time range")
	}

	location := start.Location()
	if list.TimeZone != "" {
		location, err = time.LoadLocation(list.TimeZone)
		if err != nil {
			return CalendarAvailability{}, fmt.Errorf("calendar availability timezone %q: %w", list.TimeZone, err)
		}
	}
	type interval struct{ start, end time.Time }
	busy := make([]interval, 0, len(list.Items))
	timedBusy := make([]interval, 0, len(list.Items))
	allDayBusyEvents := 0
	for _, event := range list.Items {
		if !event.blocksTime() {
			continue
		}
		eventStart, err := parseCalendarEventTime(event.Start, location)
		if err != nil {
			return CalendarAvailability{}, fmt.Errorf("calendar availability event %s start: %w", event.ID, err)
		}
		eventEnd, err := parseCalendarEventTime(event.End, location)
		if err != nil {
			return CalendarAvailability{}, fmt.Errorf("calendar availability event %s end: %w", event.ID, err)
		}
		if !eventEnd.After(eventStart) {
			return CalendarAvailability{}, fmt.Errorf("calendar availability event %s end must be after start", event.ID)
		}
		if eventStart.Before(end) && eventEnd.After(start) {
			block := interval{start: eventStart, end: eventEnd}
			busy = append(busy, block)
			if event.Start.Date != "" || event.End.Date != "" {
				allDayBusyEvents++
			} else {
				timedBusy = append(timedBusy, block)
			}
		}
	}
	sort.Slice(busy, func(i, j int) bool { return busy[i].start.Before(busy[j].start) })

	minimum := time.Duration(durationMinutes) * time.Minute
	slots := make([]CalendarAvailabilitySlot, 0, len(busy)+1)
	appendSlot := func(slotStart, slotEnd time.Time) {
		if slotEnd.Sub(slotStart) >= minimum {
			slots = append(slots, CalendarAvailabilitySlot{
				Start: slotStart.In(location).Format(time.RFC3339), End: slotEnd.In(location).Format(time.RFC3339),
				CalendarIDs: []string{"primary"},
			})
		}
	}
	cursor := start
	busyDuration := time.Duration(0)
	for _, block := range busy {
		busyStart := cursor
		if block.start.After(cursor) {
			gapEnd := block.start
			if gapEnd.After(end) {
				gapEnd = end
			}
			appendSlot(cursor, gapEnd)
			busyStart = block.start
		}
		busyEnd := block.end
		if busyEnd.After(end) {
			busyEnd = end
		}
		if busyEnd.After(busyStart) {
			busyDuration += busyEnd.Sub(busyStart)
		}
		if block.end.After(cursor) {
			cursor = block.end
			if cursor.After(end) {
				cursor = end
			}
		}
	}
	if cursor.Before(end) {
		appendSlot(cursor, end)
	}
	sort.Slice(timedBusy, func(i, j int) bool { return timedBusy[i].start.Before(timedBusy[j].start) })
	timedCursor := start
	timedBusyDuration := time.Duration(0)
	for _, block := range timedBusy {
		blockStart := block.start
		if blockStart.Before(timedCursor) {
			blockStart = timedCursor
		}
		blockEnd := block.end
		if blockEnd.After(end) {
			blockEnd = end
		}
		if blockEnd.After(blockStart) {
			timedBusyDuration += blockEnd.Sub(blockStart)
			timedCursor = blockEnd
		}
	}
	return CalendarAvailability{
		TimeZone: location.String(), BusyMinutes: busyDuration.Minutes(), TimedBusyMinutes: timedBusyDuration.Minutes(),
		AllDayBusyEvents: allDayBusyEvents, Slots: slots,
	}, nil
}

func parseCalendarEventTime(value calendarAPITime, location *time.Location) (time.Time, error) {
	if value.DateTime != "" {
		return time.Parse(time.RFC3339, value.DateTime)
	}
	if value.Date != "" {
		return time.ParseInLocation(time.DateOnly, value.Date, location)
	}
	return time.Time{}, fmt.Errorf("missing date and dateTime")
}

// GetEvent reads one exact event from the user's primary calendar.
func (c *Client) GetEvent(ctx context.Context, token, eventID string) (CalendarEvent, error) {
	if eventID == "" {
		return CalendarEvent{}, fmt.Errorf("calendar event id is required")
	}
	var event calendarAPIEvent
	endpoint := c.cfg.CalendarBaseURL + "/calendars/primary/events/" + url.PathEscape(eventID)
	if err := c.GetJSON(ctx, token, endpoint, nil, &event); err != nil {
		return CalendarEvent{}, fmt.Errorf("calendar events.get %s: %w", eventID, err)
	}
	return event.toCalendarEvent(), nil
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
	if len(in.PrivateExtendedProperties) > 0 {
		body["extendedProperties"] = map[string]any{"private": in.PrivateExtendedProperties}
	}
	return body, nil
}

// FindEventByPrivateExtendedProperty performs the Calendar-supported exact
// privateExtendedProperty lookup used to reconcile an ambiguous insert.
func (c *Client) FindEventByPrivateExtendedProperty(ctx context.Context, token, name, value string) (*CalendarEvent, error) {
	if name == "" || value == "" {
		return nil, fmt.Errorf("calendar reconciliation property is required")
	}
	q := url.Values{}
	q.Set("privateExtendedProperty", name+"="+value)
	q.Set("maxResults", "2")
	var list struct {
		Items []calendarAPIEvent `json:"items"`
	}
	if err := c.GetJSON(ctx, token, c.cfg.CalendarBaseURL+"/calendars/primary/events", q, &list); err != nil {
		return nil, fmt.Errorf("calendar events.list reconciliation: %w", err)
	}
	if len(list.Items) == 0 {
		return nil, nil
	}
	event := list.Items[0].toCalendarEvent()
	return &event, nil
}

func calendarDateTime(value, tz string) map[string]string {
	out := map[string]string{"dateTime": value}
	if tz != "" {
		out["timeZone"] = tz
	}
	return out
}

type calendarAPIEvent struct {
	ID               string               `json:"id"`
	ICalUID          string               `json:"iCalUID"`
	RecurringEventID string               `json:"recurringEventId"`
	OriginalStart    calendarAPITime      `json:"originalStartTime"`
	Recurrence       []string             `json:"recurrence"`
	Summary          string               `json:"summary"`
	Description      string               `json:"description"`
	Location         string               `json:"location"`
	Status           string               `json:"status"`
	Transparency     string               `json:"transparency"`
	EventType        string               `json:"eventType"`
	Created          string               `json:"created"`
	Updated          string               `json:"updated"`
	HangoutLink      string               `json:"hangoutLink"`
	HTMLLink         string               `json:"htmlLink"`
	Attachments      []CalendarAttachment `json:"attachments"`
	Reminders        struct {
		UseDefault bool               `json:"useDefault"`
		Overrides  []CalendarReminder `json:"overrides"`
	} `json:"reminders"`
	ConferenceData struct {
		ConferenceSolution struct {
			Name string `json:"name"`
		} `json:"conferenceSolution"`
		EntryPoints []struct {
			Type string `json:"entryPointType"`
			URI  string `json:"uri"`
		} `json:"entryPoints"`
	} `json:"conferenceData"`
	Creator struct {
		Email string `json:"email"`
	} `json:"creator"`
	Organizer struct {
		Email string `json:"email"`
	} `json:"organizer"`
	Start     calendarAPITime `json:"start"`
	End       calendarAPITime `json:"end"`
	Attendees []struct {
		Email          string `json:"email"`
		ResponseStatus string `json:"responseStatus"`
		Self           bool   `json:"self"`
	} `json:"attendees"`
}

type calendarAPITime struct {
	DateTime string `json:"dateTime"`
	Date     string `json:"date"`
}

func (e calendarAPIEvent) toCalendarEvent() CalendarEvent {
	out := CalendarEvent{
		ID: e.ID, ICalUID: e.ICalUID, RecurringEventID: e.RecurringEventID, OriginalStartAt: firstNonEmpty(e.OriginalStart.DateTime, e.OriginalStart.Date), RecurrenceRules: e.Recurrence,
		UsesDefaultReminders: e.Reminders.UseDefault, ReminderOverrides: e.Reminders.Overrides,
		Summary: e.Summary, Description: e.Description, Location: e.Location,
		Status: e.Status, Transparency: e.Transparency, BlocksTime: e.blocksTime(), AllDay: e.Start.Date != "", EventType: e.EventType,
		Creator: e.Creator.Email, CreatedAt: e.Created, UpdatedAt: e.Updated,
		Organizer: e.Organizer.Email, Attachments: e.Attachments, ConferenceProvider: e.ConferenceData.ConferenceSolution.Name, ConferenceLink: e.conferenceLink(), HTMLLink: e.HTMLLink,
	}
	out.StartsAt = firstNonEmpty(e.Start.DateTime, e.Start.Date)
	out.EndsAt = firstNonEmpty(e.End.DateTime, e.End.Date)
	for _, attendee := range e.Attendees {
		if attendee.Email != "" {
			out.Attendees = append(out.Attendees, attendee.Email)
			if attendee.ResponseStatus != "" {
				if out.AttendeeResponses == nil {
					out.AttendeeResponses = make(map[string]string)
				}
				out.AttendeeResponses[attendee.Email] = attendee.ResponseStatus
			}
		}
		if attendee.Self {
			out.SelfResponseStatus = attendee.ResponseStatus
		}
	}
	return out
}

func (e calendarAPIEvent) blocksTime() bool {
	return e.Status != "cancelled" && e.Transparency != "transparent"
}

func (e calendarAPIEvent) conferenceLink() string {
	if e.HangoutLink != "" {
		return e.HangoutLink
	}
	for _, entry := range e.ConferenceData.EntryPoints {
		if entry.Type == "video" {
			return entry.URI
		}
	}
	return ""
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
