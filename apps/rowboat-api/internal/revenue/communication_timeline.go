package revenue

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/communicationinteraction"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
)

// CommunicationTimelineItem is the server-redacted communication record shown
// in relationship timelines. Clients must treat bodyLocked as authoritative.
type CommunicationTimelineItem struct {
	ID              uuid.UUID           `json:"id"`
	Source          string              `json:"source"`
	InteractionType string              `json:"interactionType"`
	Direction       string              `json:"direction,omitempty"`
	Subject         string              `json:"subject,omitempty"`
	OccurredAt      time.Time           `json:"occurredAt"`
	Visibility      string              `json:"visibility"`
	OwnerID         uuid.UUID           `json:"ownerId"`
	BodyLocked      bool                `json:"bodyLocked"`
	AttachmentCount int                 `json:"attachmentCount"`
	Access          CommunicationAccess `json:"access"`
}

// CommunicationTimelinePage is one cursor page of relationship communications.
type CommunicationTimelinePage struct {
	Items      []CommunicationTimelineItem `json:"items"`
	HasMore    bool                        `json:"hasMore"`
	NextBefore *time.Time                  `json:"nextBefore,omitempty"`
}

// ResolveCommunicationRelationship links one synced interaction to a single
// workspace relationship when participant identity resolves unambiguously.
func ResolveCommunicationRelationship(
	ctx context.Context,
	client *ent.Client,
	workspaceID uuid.UUID,
	participantEmails []string,
	ownerAccountID string,
) (*uuid.UUID, error) {
	internal := auth.WithInternalOnly(ctx)
	ownerAccountID = strings.ToLower(strings.TrimSpace(ownerAccountID))
	matches := map[uuid.UUID]struct{}{}
	for _, raw := range participantEmails {
		email := normalizeEmail(raw)
		if email == "" || strings.EqualFold(email, ownerAccountID) {
			continue
		}
		rows, err := client.Relationship.Query().
			Where(
				relationship.HasWorkspaceWith(revenueworkspace.IDEQ(workspaceID)),
				relationship.PrimaryEmailEQ(email),
			).
			All(internal)
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			matches[row.ID] = struct{}{}
		}
		domain := accountDomain(email)
		if domain != "" {
			rows, err := client.Relationship.Query().
				Where(
					relationship.HasWorkspaceWith(revenueworkspace.IDEQ(workspaceID)),
					relationship.KindEQ("company"),
					relationship.AccountDomainEQ(domain),
				).
				All(internal)
			if err != nil {
				return nil, err
			}
			for _, row := range rows {
				matches[row.ID] = struct{}{}
			}
		}
	}
	if len(matches) != 1 {
		return nil, nil
	}
	for id := range matches {
		copyID := id
		return &copyID, nil
	}
	return nil, nil
}

// RelationshipCommunicationTimeline returns paginated, policy-redacted
// communication metadata for one relationship.
func (s *Service) RelationshipCommunicationTimeline(
	ctx context.Context,
	actor *ent.User,
	relationshipID uuid.UUID,
	before *time.Time,
	limit int,
) (*CommunicationTimelinePage, error) {
	if _, err := s.requireCommunicationIntelligence(ctx, actor); err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if _, err := s.client.Relationship.Get(ctx, relationshipID); err != nil {
		if ent.IsNotFound(err) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	q := s.client.CommunicationInteraction.Query().
		Where(
			communicationinteraction.HasRelationshipWith(relationship.IDEQ(relationshipID)),
			communicationinteraction.DeletedEQ(false),
		).
		WithWorkspace().
		WithOwner().
		WithRelationship().
		WithParticipants().
		WithAttachments().
		Order(ent.Desc(communicationinteraction.FieldOccurredAt)).
		Limit(limit + 1)
	if before != nil {
		q = q.Where(communicationinteraction.OccurredAtLT(before.UTC()))
	}
	rows, err := q.All(ctx)
	if err != nil {
		return nil, err
	}
	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}
	items := make([]CommunicationTimelineItem, 0, len(rows))
	for _, row := range rows {
		item, itemErr := s.communicationTimelineItem(ctx, actor, row)
		if itemErr != nil {
			return nil, itemErr
		}
		items = append(items, item)
	}
	page := &CommunicationTimelinePage{Items: items, HasMore: hasMore}
	if hasMore && len(items) > 0 {
		last := items[len(items)-1].OccurredAt
		page.NextBefore = &last
	}
	return page, nil
}

func (s *Service) communicationTimelineItem(
	ctx context.Context,
	actor *ent.User,
	interaction *ent.CommunicationInteraction,
) (CommunicationTimelineItem, error) {
	_, _, access, err := s.communicationAccessForInteraction(ctx, actor, interaction)
	if err != nil {
		return CommunicationTimelineItem{}, err
	}
	owner, err := interaction.Edges.OwnerOrErr()
	if err != nil {
		return CommunicationTimelineItem{}, err
	}
	subject := interaction.Subject
	if !access.Subject {
		subject = ""
	}
	attachments, _ := interaction.Edges.AttachmentsOrErr()
	return CommunicationTimelineItem{
		ID: interaction.ID, Source: interaction.Source,
		InteractionType: interaction.InteractionType, Direction: interaction.Direction,
		Subject: subject, OccurredAt: interaction.OccurredAt.UTC(),
		Visibility: interaction.Visibility, OwnerID: owner.ID,
		BodyLocked: !access.Body, AttachmentCount: len(attachments), Access: access,
	}, nil
}
