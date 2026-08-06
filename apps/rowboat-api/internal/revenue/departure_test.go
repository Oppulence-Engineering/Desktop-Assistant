package revenue

import (
	"strings"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/person"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/personattribute"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
)

// A departure only matters if it changes what the user is told.
//
// The `quiet_account` detector fires whenever an account goes silent, and a
// departed contact makes an account go silent forever — so without this the
// product asks the user to follow up with someone whose mailbox rejects mail,
// once per cooldown, indefinitely. That is the specific harm these cover.

func departureObservationInput(
	externalID, domain, name, email, kind string, now time.Time,
) RelationshipObservationInput {
	return RelationshipObservationInput{
		DisplayName:   domain,
		AccountDomain: domain,
		PrimaryEmail:  email,
		Source:        "gmail",
		ExternalID:    externalID,
		EventType:     "contact_departed",
		OccurredAt:    now,
		ReceivedAt:    now,
		Channel:       "email",
		Direction:     "inbound",
		Participants: []RelationshipParticipantInput{
			{DisplayName: name, Email: email, Role: "contact"},
		},
		Facts: map[string]any{"departure_kind": kind},
	}
}

// An ordinary exchange with the same contact, so the relationship these tests
// act on is the one a real mailbox would have produced.
func threadObservationInput(externalID, domain, name, email string, now time.Time) RelationshipObservationInput {
	in := departureObservationInput(externalID, domain, name, email, "", now)
	in.EventType = "email_exchanged"
	in.Facts = map[string]any{}
	return in
}

func departedPeople(t *testing.T, f *fixture) []*ent.Person {
	t.Helper()
	rows, err := f.client.Person.Query().
		Where(person.EmploymentStatusEQ("departed")).All(f.ctx)
	if err != nil {
		t.Fatalf("query departed: %v", err)
	}
	return rows
}

func TestDepartureObservationProjectsEmploymentStatus(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 8, 6, 12, 0, 0, 0, time.UTC)

	if _, err := f.svc.IngestRelationshipObservations(f.ctx, f.user,
		[]RelationshipObservationInput{
			departureObservationInput("bounce_1", "acme.example", "Sarah Chen", "sarah@acme.example", "recipient_unknown", now),
		},
	); err != nil {
		t.Fatalf("ingest: %v", err)
	}

	departed := departedPeople(t, f)
	if len(departed) != 1 {
		t.Fatalf("expected the bounced contact to be marked departed, got %d", len(departed))
	}

	// The claim must be auditable: a user seeing "left the company" has to be able
	// to see what said so.
	attributes, err := f.client.PersonAttribute.Query().
		Where(
			personattribute.HasPersonWith(person.IDEQ(departed[0].ID)),
			personattribute.DimensionEQ("employment_status"),
		).All(f.ctx)
	if err != nil {
		t.Fatalf("attributes: %v", err)
	}
	if len(attributes) != 1 {
		t.Fatalf("expected one employment_status assertion, got %d", len(attributes))
	}
	if attributes[0].SourceType != "source_fact" {
		t.Errorf("source_type = %q; a mail server's rejection is a fact, not an inference", attributes[0].SourceType)
	}
	if attributes[0].Extractor != "mail_delivery_report" {
		t.Errorf("extractor = %q, want mail_delivery_report so the UI can attribute it to the mail system", attributes[0].Extractor)
	}
	if attributes[0].Reason == "" {
		t.Error("no reason recorded; a departure the user cannot check is an assertion")
	}
}

func TestDepartureConfidenceReflectsWhichEvidenceWeHave(t *testing.T) {
	// Words that name a departure are stronger than an address that stopped
	// accepting mail: a mistyped address bounces identically to a departed one.
	f := newFixture(t)
	now := time.Date(2026, 8, 6, 12, 0, 0, 0, time.UTC)

	if _, err := f.svc.IngestRelationshipObservations(f.ctx, f.user,
		[]RelationshipObservationInput{
			departureObservationInput("bounce_1", "acme.example", "Sarah Chen", "sarah@acme.example", "recipient_unknown", now),
			departureObservationInput("reply_1", "globex.example", "Tom Reed", "tom@globex.example", "left_organization", now),
		},
	); err != nil {
		t.Fatalf("ingest: %v", err)
	}

	byEmail := map[string]float64{}
	rows, err := f.client.PersonAttribute.Query().
		Where(personattribute.DimensionEQ("employment_status")).WithPerson().All(f.ctx)
	if err != nil {
		t.Fatalf("attributes: %v", err)
	}
	for _, row := range rows {
		if row.Edges.Person != nil {
			byEmail[row.Edges.Person.DisplayName] = row.Confidence
		}
	}
	if byEmail["Sarah Chen"] >= byEmail["Tom Reed"] {
		t.Errorf("a bounce (%v) should not be as strong as a reply saying so (%v)",
			byEmail["Sarah Chen"], byEmail["Tom Reed"])
	}
}

func TestDepartureIsNotAcceptedFromAnInference(t *testing.T) {
	// The failure mode that would be worse than reading no bounces at all: a model
	// deciding from the tone of a thread that someone has left, and the product
	// retiring a live contact on it.
	f := newFixture(t)
	now := time.Date(2026, 8, 6, 12, 0, 0, 0, time.UTC)
	ws, err := f.svc.CurrentWorkspace(f.ctx, f.user)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := f.svc.IngestRelationshipObservations(f.ctx, f.user,
		[]RelationshipObservationInput{
			personObservation("obs_1", "Acme", "acme.example", now,
				RelationshipParticipantInput{DisplayName: "Sarah Chen", Email: "sarah@acme.example", Role: "champion"}),
		},
	); err != nil {
		t.Fatalf("ingest: %v", err)
	}
	people := personsIn(t, f)
	if len(people) != 1 {
		t.Fatalf("setup: %d people", len(people))
	}

	if err := upsertPersonAttributes(f.ctx, f.client, ws, f.user, people[0], nil,
		[]PersonAttributeInput{{
			Dimension: "employment_status", Value: "departed",
			SourceType: "ai_inference", Source: "gmail",
			Extractor: "email_header", Confidence: 0.9,
			Reason: "The thread reads like a handover.", ObservedAt: now,
		}}); err != nil {
		t.Fatalf("upsert: %v", err)
	}
	if _, err := projectPersonAttributes(f.ctx, f.client, people[0], now); err != nil {
		t.Fatalf("project: %v", err)
	}

	if got := len(departedPeople(t, f)); got != 0 {
		t.Fatalf("an inferred departure retired a live contact (%d marked departed)", got)
	}
}

func TestQuietAccountBecomesContactDepartedWhenTheContactHasLeft(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 8, 6, 12, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }

	// Built through ingest rather than the fixture so the account is the same one
	// the departure resolves to — exactly as an ordinary email thread and its
	// later bounce both anchor on the sender's domain in production.
	if _, err := f.svc.IngestRelationshipObservations(f.ctx, f.user,
		[]RelationshipObservationInput{
			threadObservationInput("thread_1", "acme.example", "Sarah Chen", "sarah@acme.example", now.Add(-91*24*time.Hour)),
			departureObservationInput("bounce_1", "acme.example", "Sarah Chen", "sarah@acme.example", "recipient_unknown", now),
		},
	); err != nil {
		t.Fatalf("ingest: %v", err)
	}
	markSourcesHealthy(t, f, now)
	// Set the silence after ingest: ingest itself is a touch.
	relationshipsWithDomain(t, f, "acme.example").Update().
		SetLifecycle("renewal").
		SetLastTouchAt(now.Add(-90 * 24 * time.Hour)).
		SetStateVersion(2).
		SaveX(f.ctx)

	if err := f.svc.RefreshRelationshipAttention(f.ctx, f.user); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	items, err := f.svc.ListRelationshipAttention(f.ctx, f.user, "all", 100)
	if err != nil {
		t.Fatalf("list: %v", err)
	}

	var departedItem *ent.RelationshipAttentionItem
	for _, item := range items {
		if item.ReasonCode == "quiet_account" {
			t.Errorf("still telling the user to follow up with someone who has left: %q", item.Explanation)
		}
		if item.ReasonCode == "contact_departed" {
			departedItem = item
		}
	}
	if departedItem == nil {
		t.Fatalf("no contact_departed item raised; reason codes were %v", reasonCodesOf(items))
	}
	// The explanation has to name who, or it is no more useful than the silence
	// it replaces.
	if !strings.Contains(departedItem.Explanation, "Sarah Chen") {
		t.Errorf("explanation does not say who left: %q", departedItem.Explanation)
	}
}

func TestQuietAccountSurvivesWhenNobodyHasDeparted(t *testing.T) {
	// The guard on the change above: an ordinary quiet account must still be raised.
	f := newFixture(t)
	now := time.Date(2026, 8, 6, 12, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }

	if _, err := f.svc.IngestRelationshipObservations(f.ctx, f.user,
		[]RelationshipObservationInput{
			threadObservationInput("thread_1", "acme.example", "Sarah Chen", "sarah@acme.example", now.Add(-91*24*time.Hour)),
		},
	); err != nil {
		t.Fatalf("ingest: %v", err)
	}
	markSourcesHealthy(t, f, now)
	relationshipsWithDomain(t, f, "acme.example").Update().
		SetLifecycle("renewal").
		SetLastTouchAt(now.Add(-90 * 24 * time.Hour)).
		SetStateVersion(2).
		SaveX(f.ctx)

	if err := f.svc.RefreshRelationshipAttention(f.ctx, f.user); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	items, err := f.svc.ListRelationshipAttention(f.ctx, f.user, "all", 100)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	found := false
	for _, item := range items {
		if item.ReasonCode == "quiet_account" {
			found = true
		}
	}
	if !found {
		t.Fatalf("quiet_account no longer fires at all; reason codes were %v", reasonCodesOf(items))
	}
}

func reasonCodesOf(items []*ent.RelationshipAttentionItem) []string {
	out := make([]string, 0, len(items))
	for _, item := range items {
		out = append(out, item.ReasonCode)
	}
	return out
}

// markSourcesHealthy brings every source status to live and complete.
//
// Called after ingest, not before: ingest itself opens a status row per source
// account and leaves it partial. While any dependency is degraded the quiet
// detector is suppressed by design — correctly, since silence from a half-synced
// mailbox means nothing — so without this these tests would assert on a detector
// that never runs.
func markSourcesHealthy(t *testing.T, f *fixture, now time.Time) {
	t.Helper()
	rows, err := f.client.RelationshipSourceStatus.Query().All(f.ctx)
	if err != nil {
		t.Fatalf("source statuses: %v", err)
	}
	for _, row := range rows {
		// LastSuccessAt too: RefreshRelationshipAttention re-derives staleness from
		// it on every pass, so a row that merely says "live" goes stale again the
		// moment the detector looks at it.
		row.Update().
			SetStatus("live").
			SetCompleteness("complete").
			SetMissingScopes([]string{}).
			SetLastSuccessAt(now).
			SaveX(f.ctx)
	}
}

func relationshipsWithDomain(t *testing.T, f *fixture, domain string) *ent.Relationship {
	t.Helper()
	rel, err := f.client.Relationship.Query().
		Where(relationship.AccountDomainEQ(domain)).Only(f.ctx)
	if err != nil {
		t.Fatalf("relationship for %s: %v", domain, err)
	}
	return rel
}
