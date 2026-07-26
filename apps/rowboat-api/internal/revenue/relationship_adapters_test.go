package revenue

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestRelationshipAdaptersNormalizeFourEvidenceSources(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 7, 26, 14, 0, 0, 0, time.UTC)
	event := AdapterEvent{
		ExternalID:   "event-1",
		AccountName:  "Acme",
		PrimaryEmail: "CHAMPION@ACME.COM",
		EventType:    "engagement_changed",
		Summary:      "Champion asked to schedule the security review.",
		OccurredAt:   now,
		Payload:      map[string]any{"provider": "fixture"},
		Participants: []RelationshipParticipantInput{{DisplayName: "Avery", Role: "champion"}},
		Assertions:   []RelationshipAssertionInput{{Dimension: "engagement", Value: "increasing"}},
		Facts:        map[string]any{"thread": "security"},
	}

	adapters := map[string]func(AdapterEvent) (RelationshipObservationInput, error){
		"gmail":    AdaptGmailEvent,
		"calendar": AdaptCalendarEvent,
		"slack":    AdaptSlackEvent,
		"hubspot":  AdaptHubSpotEvent,
	}
	for source, adapter := range adapters {
		source := source
		adapter := adapter
		t.Run(source, func(t *testing.T) {
			t.Parallel()
			observation, err := adapter(event)
			require.NoError(t, err)
			require.Equal(t, source, observation.Source)
			require.Equal(t, "champion@acme.com", observation.PrimaryEmail)
			require.Equal(t, "acme.com", observation.AccountDomain)
			require.Equal(t, source, observation.Facts["adapter"])
			require.JSONEq(t, `{"provider":"fixture"}`, string(observation.Payload))
		})
	}
}
