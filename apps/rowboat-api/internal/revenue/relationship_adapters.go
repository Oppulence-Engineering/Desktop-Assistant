package revenue

import (
	"encoding/json"
	"strings"
	"time"
)

// AdapterEvent is the deliberately small provider-facing seam. Gmail,
// Calendar, Slack, and CRM integrations normalize their payloads here; the
// relationship engine remains provider-neutral and append-only.
type AdapterEvent struct {
	ExternalID      string
	SourceAccountID string
	AccountName     string
	AccountDomain   string
	PrimaryEmail    string
	EventType       string
	Summary         string
	OccurredAt      time.Time
	Payload         any
	Participants    []RelationshipParticipantInput
	Assertions      []RelationshipAssertionInput
	Facts           map[string]any
}

func AdaptGmailEvent(event AdapterEvent) (RelationshipObservationInput, error) {
	return adaptRelationshipEvent("gmail", event)
}

func AdaptCalendarEvent(event AdapterEvent) (RelationshipObservationInput, error) {
	return adaptRelationshipEvent("calendar", event)
}

func AdaptSlackEvent(event AdapterEvent) (RelationshipObservationInput, error) {
	return adaptRelationshipEvent("slack", event)
}

func AdaptHubSpotEvent(event AdapterEvent) (RelationshipObservationInput, error) {
	return adaptRelationshipEvent("hubspot", event)
}

func adaptRelationshipEvent(source string, event AdapterEvent) (RelationshipObservationInput, error) {
	payload, err := json.Marshal(event.Payload)
	if err != nil {
		return RelationshipObservationInput{}, err
	}
	domain := strings.ToLower(strings.TrimSpace(event.AccountDomain))
	email := strings.ToLower(strings.TrimSpace(event.PrimaryEmail))
	if domain == "" {
		if at := strings.LastIndex(email, "@"); at >= 0 {
			domain = email[at+1:]
		}
	}
	facts := make(map[string]any, len(event.Facts)+1)
	for key, value := range event.Facts {
		facts[key] = value
	}
	facts["adapter"] = source
	return RelationshipObservationInput{
		DisplayName:     strings.TrimSpace(event.AccountName),
		PrimaryEmail:    email,
		AccountDomain:   domain,
		Source:          source,
		SourceAccountID: strings.TrimSpace(event.SourceAccountID),
		ExternalID:      strings.TrimSpace(event.ExternalID),
		SourceVersion:   "1",
		EventType:       strings.TrimSpace(event.EventType),
		OccurredAt:      event.OccurredAt,
		Summary:         strings.TrimSpace(event.Summary),
		Facts:           facts,
		Payload:         payload,
		Participants:    event.Participants,
		Assertions:      event.Assertions,
	}, nil
}
