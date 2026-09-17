package revenue

import (
	"context"
	"slices"
	"sort"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/googleapi"
)

type fixtureCalendarEvidenceReader struct {
	events       []googleapi.CalendarEvent
	selfEmail    string
	userID       uuid.UUID
	lookbackDays int
	maxEvents    int
}

func (r *fixtureCalendarEvidenceReader) ReadCalendarEvents(
	_ context.Context,
	userID uuid.UUID,
	lookbackDays int,
	maxEvents int,
) ([]googleapi.CalendarEvent, string, error) {
	r.userID = userID
	r.lookbackDays = lookbackDays
	r.maxEvents = maxEvents
	return r.events, r.selfEmail, nil
}

func TestGoogleBackfillKeepsOnlyExternalGmailAndCalendarEvidence(t *testing.T) {
	now := time.Date(2026, 9, 17, 12, 0, 0, 0, time.UTC)
	userID := uuid.New()
	self := "founder@oppulence.example"
	sweeper := &fakeSweeper{
		email: self,
		threads: [][]googleapi.GmailThreadMessage{
			{{
				ID: "gmail-external", ThreadID: "thread-external", From: self,
				To: "Buyer <buyer@acme.example>", Subject: "Proposal",
				Outbound: true, At: now.Add(-time.Hour),
			}},
			{{
				ID: "gmail-internal", ThreadID: "thread-internal", From: self,
				To: "teammate@oppulence.example", Subject: "Internal",
				Outbound: true, At: now.Add(-2 * time.Hour),
			}},
			{{
				ID: "gmail-automated", ThreadID: "thread-automated", From: self,
				To: "no-reply@vendor.example", Subject: "Notification",
				Outbound: true, At: now.Add(-3 * time.Hour),
			}},
		},
	}
	calendar := &fixtureCalendarEvidenceReader{
		selfEmail: self,
		events: []googleapi.CalendarEvent{
			{
				ID: "customer-meeting", StartsAt: now.Add(-30 * time.Minute).Format(time.RFC3339),
				UpdatedAt: now.Add(-20 * time.Minute).Format(time.RFC3339),
				Organizer: self,
				Attendees: []string{
					"teammate@oppulence.example",
					"buyer@acme.example",
					"advisor@gmail.com",
					"notifications@vendor.example",
				},
			},
			{
				ID: "internal-meeting", StartsAt: now.Add(-4 * time.Hour).Format(time.RFC3339),
				Organizer: self, Attendees: []string{"teammate@oppulence.example"},
			},
			{
				ID: "canceled-meeting", Status: "cancelled",
				StartsAt:  now.Add(-5 * time.Hour).Format(time.RFC3339),
				Organizer: self, Attendees: []string{"buyer@acme.example"},
			},
		},
	}
	backfiller := &googleSourceBackfiller{
		sweeper: sweeper, calendar: calendar, now: func() time.Time { return now },
	}

	var observations []RelationshipObservationInput
	var final SourceBackfillBatch
	err := backfiller.Backfill(context.Background(), &ent.User{ID: userID}, self, func(batch SourceBackfillBatch) error {
		observations = append(observations, batch.Observations...)
		final = batch
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if calendar.userID != userID || calendar.lookbackDays != 90 || calendar.maxEvents != 100 {
		t.Fatalf("calendar read escaped its actor/window bounds: %#v", calendar)
	}
	if final.Completed != 3 || final.Total != 3 ||
		final.Watermark != now.Add(-30*time.Minute).Format(time.RFC3339Nano) {
		t.Fatalf("unexpected final progress: %#v", final)
	}

	keys := observationKeys(observations)
	want := []string{
		"calendar:customer-meeting:advisor@gmail.com",
		"calendar:customer-meeting:buyer@acme.example",
		"gmail:thread-external",
	}
	if !slices.Equal(keys, want) {
		t.Fatalf("observations = %#v, want %#v", keys, want)
	}
	for _, observation := range observations {
		if observation.PrimaryEmail == "advisor@gmail.com" && observation.PreferredKind != "person" {
			t.Fatalf("personal calendar contact was not normalized as a person: %#v", observation)
		}
		if observation.PrimaryEmail == "buyer@acme.example" && observation.PreferredKind != "company" {
			t.Fatalf("company contact was not normalized as a company: %#v", observation)
		}
	}
}

func TestGoogleBackfillProviderIDsAreDeterministicAcrossReplay(t *testing.T) {
	now := time.Date(2026, 9, 17, 12, 0, 0, 0, time.UTC)
	self := "founder@oppulence.example"
	sweeper := &fakeSweeper{
		email: self,
		threads: [][]googleapi.GmailThreadMessage{{{
			ID: "message-1", ThreadID: "thread-1", From: self, To: "buyer@acme.example",
			Outbound: true, At: now.Add(-time.Hour),
		}}},
	}
	calendar := &fixtureCalendarEvidenceReader{selfEmail: self, events: []googleapi.CalendarEvent{{
		ID: "event-1", StartsAt: now.Format(time.RFC3339),
		Organizer: self, Attendees: []string{"buyer@acme.example", "advisor@gmail.com"},
	}}}
	backfiller := &googleSourceBackfiller{
		sweeper: sweeper, calendar: calendar, now: func() time.Time { return now },
	}

	run := func() []string {
		t.Helper()
		var observations []RelationshipObservationInput
		err := backfiller.Backfill(context.Background(), &ent.User{ID: uuid.New()}, self, func(batch SourceBackfillBatch) error {
			observations = append(observations, batch.Observations...)
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
		return observationKeys(observations)
	}
	first, second := run(), run()
	if !slices.Equal(first, second) {
		t.Fatalf("provider replay changed identities: first=%#v second=%#v", first, second)
	}
}

func observationKeys(observations []RelationshipObservationInput) []string {
	keys := make([]string, 0, len(observations))
	for _, observation := range observations {
		keys = append(keys, observation.Source+":"+observation.ExternalID)
	}
	sort.Strings(keys)
	return keys
}
