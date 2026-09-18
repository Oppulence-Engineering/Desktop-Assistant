package revenue

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/communicationinteraction"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
)

// CommunicationProjector projects synced communication metadata into the
// relationship observation stream.
type CommunicationProjector interface {
	ProjectCommunicationInteraction(ctx context.Context, interactionID uuid.UUID) error
}

// AdaptCommunicationInteraction converts one metadata-only interaction into a
// relationship observation input without exposing provider content.
func AdaptCommunicationInteraction(
	interaction *ent.CommunicationInteraction,
	participants []*ent.CommunicationParticipant,
) (RelationshipObservationInput, error) {
	payload, err := json.Marshal(map[string]any{
		"interactionId":   interaction.ID.String(),
		"interactionType": interaction.InteractionType,
		"direction":       interaction.Direction,
		"visibility":      interaction.Visibility,
		"metadata":        json.RawMessage(interaction.MetadataJSON),
	})
	if err != nil {
		return RelationshipObservationInput{}, err
	}
	participantInputs := make([]RelationshipParticipantInput, 0, len(participants))
	primaryEmail := ""
	for _, row := range participants {
		participantInputs = append(participantInputs, RelationshipParticipantInput{
			DisplayName: row.DisplayName,
			Email:       row.Email,
			Role:        row.Role,
		})
		if primaryEmail == "" && row.External {
			primaryEmail = normalizeEmail(row.Email)
		}
	}
	summary := strings.TrimSpace(interaction.Subject)
	if summary == "" {
		summary = fmt.Sprintf("%s %s", interaction.Source, interaction.InteractionType)
	}
	source := interaction.Source
	if source == "calendar" {
		source = "calendar"
	}
	return RelationshipObservationInput{
		RelationshipID:  relationshipIDFromInteraction(interaction),
		PrimaryEmail:    primaryEmail,
		AccountDomain:   accountDomain(primaryEmail),
		Source:          source,
		SourceAccountID: interaction.SourceAccountID,
		ExternalID:      interaction.ProviderObjectID,
		SourceVersion:   interaction.SourceVersion,
		EventType:       interaction.InteractionType,
		OccurredAt:      interaction.OccurredAt,
		Summary:         summary,
		Participants:    participantInputs,
		Payload:         payload,
		Facts: map[string]any{
			"adapter":         "communication_interaction",
			"visibility":      interaction.Visibility,
			"contentHash":     interaction.ContentHash,
			"communicationId": interaction.ID.String(),
		},
	}, nil
}

func relationshipIDFromInteraction(interaction *ent.CommunicationInteraction) uuid.UUID {
	if rel, err := interaction.Edges.RelationshipOrErr(); err == nil {
		return rel.ID
	}
	return uuid.Nil
}

// ProjectCommunicationInteraction ingests one metadata observation for a synced
// interaction when policy allows workspace projection.
func (s *Service) ProjectCommunicationInteraction(
	ctx context.Context,
	interactionID uuid.UUID,
) error {
	internal := auth.WithInternalOnly(ctx)
	interaction, err := s.client.CommunicationInteraction.Query().
		Where(communicationinteraction.IDEQ(interactionID)).
		WithWorkspace().
		WithOwner().
		WithRelationship().
		WithParticipants().
		Only(internal)
	if err != nil {
		return err
	}
	if interaction.Deleted || interaction.Visibility == "private" {
		return nil
	}
	owner, err := interaction.Edges.OwnerOrErr()
	if err != nil {
		return err
	}
	participants, err := interaction.Edges.ParticipantsOrErr()
	if err != nil {
		return err
	}
	input, err := AdaptCommunicationInteraction(interaction, participants)
	if err != nil {
		return err
	}
	if input.RelationshipID == uuid.Nil {
		return nil
	}
	if err := s.AuthorizeCommunicationObservation(internal, owner, input); err != nil {
		return err
	}
	_, err = s.ingestTrustedRelationshipObservations(internal, owner, []RelationshipObservationInput{input})
	return err
}
