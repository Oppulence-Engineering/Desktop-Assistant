package revenue

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/communicationattachment"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/communicationinteraction"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/communicationprivacypolicy"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/mailbodycache"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/mailmessagemeta"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
)

const (
	maxCommunicationAttachmentBytes = 5 << 20 // 5 MiB
	defaultCommunicationRetention   = 30
)

// ErrCommunicationContentUnavailable means authorized content could not be
// produced from the provider or sealed cache.
var ErrCommunicationContentUnavailable = errors.New("revenue: communication content unavailable")

// CommunicationAttachmentFetcher reads one bounded text attachment from the
// owner's provider account after privacy authorization succeeds.
type CommunicationAttachmentFetcher interface {
	FetchTextAttachment(
		ctx context.Context,
		userID uuid.UUID,
		messageID, attachmentID, filename, mimeType string,
		size int64,
	) (string, error)
}

// CommunicationBodyResult is the authorized body payload returned to clients.
type CommunicationBodyResult struct {
	Body       string                  `json:"body"`
	Access     CommunicationAccess     `json:"access"`
	Provenance communicationProvenance `json:"provenance"`
}

// CommunicationAttachmentResult is the authorized attachment payload returned
// to clients after malware and active-content screening.
type CommunicationAttachmentResult struct {
	Filename   string                  `json:"filename"`
	MimeType   string                  `json:"mimeType"`
	Content    string                  `json:"content"`
	ScanStatus string                  `json:"scanStatus"`
	Access     CommunicationAccess     `json:"access"`
	Provenance communicationProvenance `json:"provenance"`
}

type communicationProvenance struct {
	Source               string    `json:"source"`
	SourceAccountID      string    `json:"sourceAccountId"`
	ProviderObjectID     string    `json:"providerObjectId"`
	ProviderAttachmentID string    `json:"providerAttachmentId,omitempty"`
	InteractionID        uuid.UUID `json:"interactionId"`
	OwnerID              uuid.UUID `json:"ownerId"`
	RetrievedAt          time.Time `json:"retrievedAt"`
}

// SetAttachmentFetcher wires on-demand attachment retrieval for authorized reads.
func (s *Service) SetAttachmentFetcher(f CommunicationAttachmentFetcher) {
	s.attachmentFetcher = f
}

func (s *Service) requireCommunicationIntelligence(
	ctx context.Context,
	u *ent.User,
) (*ent.RevenueWorkspace, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceView)
	if err != nil {
		return nil, err
	}
	if err := s.requireWorkspaceFeature(ctx, ws, CapabilityCommunicationIntelligence); err != nil {
		return nil, err
	}
	return ws, nil
}

// CommunicationInteractionBody returns the plain-text body for one interaction
// when the caller is authorized. Bodies are fetched on behalf of the mailbox
// owner and sealed with the deployment cache TTL.
func (s *Service) CommunicationInteractionBody(
	ctx context.Context,
	actor *ent.User,
	interactionID uuid.UUID,
) (*CommunicationBodyResult, error) {
	if _, err := s.requireCommunicationIntelligence(ctx, actor); err != nil {
		return nil, err
	}
	interaction, owner, participants, access, resource, err := s.loadCommunicationAccess(
		ctx, actor, interactionID, true, false,
	)
	if err != nil {
		return nil, err
	}
	if !access.Body {
		return nil, ErrForbidden
	}
	if interaction.Source != "gmail" {
		return nil, ErrCommunicationContentUnavailable
	}
	body, err := s.ownerMessageBody(ctx, owner, interaction.ProviderObjectID)
	if err != nil {
		return nil, err
	}
	return &CommunicationBodyResult{
		Body:   body,
		Access: access,
		Provenance: communicationProvenance{
			Source:           interaction.Source,
			SourceAccountID:  interaction.SourceAccountID,
			ProviderObjectID: interaction.ProviderObjectID,
			InteractionID:    interaction.ID,
			OwnerID:          owner.ID,
			RetrievedAt:      s.now().UTC(),
		},
	}, s.auditCommunicationRead(ctx, actor, interaction, participants, resource, "body")
}

// CommunicationAttachmentContent returns one authorized attachment after scan
// admission. Bytes are sealed at rest with the owner's retention policy.
func (s *Service) CommunicationAttachmentContent(
	ctx context.Context,
	actor *ent.User,
	attachmentID uuid.UUID,
) (*CommunicationAttachmentResult, error) {
	if _, err := s.requireCommunicationIntelligence(ctx, actor); err != nil {
		return nil, err
	}
	internal := auth.WithInternalOnly(ctx)
	row, err := s.client.CommunicationAttachment.Query().
		Where(communicationattachment.IDEQ(attachmentID)).
		WithInteraction(func(q *ent.CommunicationInteractionQuery) {
			q.WithWorkspace().WithOwner().WithRelationship().WithParticipants()
		}).
		Only(internal)
	if err != nil {
		if ent.IsNotFound(err) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	interaction, err := row.Edges.InteractionOrErr()
	if err != nil {
		return nil, err
	}
	owner, err := interaction.Edges.OwnerOrErr()
	if err != nil {
		return nil, err
	}
	participants, resource, access, err := s.communicationAccessForInteraction(ctx, actor, interaction)
	if err != nil {
		return nil, err
	}
	if !access.Attachments {
		return nil, ErrForbidden
	}
	now := s.now().UTC()
	if len(row.SealedContent) > 0 && row.ExpiresAt != nil && row.ExpiresAt.After(now) {
		content, openErr := s.openAttachmentContent(row)
		if openErr == nil {
			return &CommunicationAttachmentResult{
				Filename: row.Filename, MimeType: row.MimeType, Content: content,
				ScanStatus: row.ScanStatus, Access: access,
				Provenance: communicationProvenance{
					Source: interaction.Source, SourceAccountID: interaction.SourceAccountID,
					ProviderObjectID:     interaction.ProviderObjectID,
					ProviderAttachmentID: row.ProviderAttachmentID,
					InteractionID:        interaction.ID, OwnerID: owner.ID, RetrievedAt: now,
				},
			}, s.auditCommunicationRead(ctx, actor, interaction, participants, resource, "attachment")
		}
	}
	if s.attachmentFetcher == nil || interaction.Source != "gmail" {
		return nil, ErrCommunicationContentUnavailable
	}
	if err := validateAttachmentAdmission(row.MimeType, row.SizeBytes); err != nil {
		_, _ = row.Update().SetScanStatus("rejected").SetScannedAt(now).Save(auth.WithInternalOnly(ctx))
		return nil, ErrForbidden
	}
	content, err := s.attachmentFetcher.FetchTextAttachment(
		ctx, owner.ID, interaction.ProviderObjectID, row.ProviderAttachmentID,
		row.Filename, row.MimeType, row.SizeBytes,
	)
	if err != nil {
		_, _ = row.Update().SetScanStatus("failed").SetScannedAt(now).Save(auth.WithInternalOnly(ctx))
		return nil, fmt.Errorf("%w: %w", ErrCommunicationContentUnavailable, err)
	}
	retention := s.communicationRetentionDays(ctx, interaction)
	expires := now.Add(time.Duration(retention) * 24 * time.Hour)
	sealed, sealErr := s.sealAttachmentContent(content)
	update := row.Update().SetScanStatus("clean").SetScannedAt(now).SetExpiresAt(expires)
	if sealErr == nil {
		update = update.SetSealedContent(sealed)
	}
	if _, err := update.Save(auth.WithInternalOnly(ctx)); err != nil {
		return nil, err
	}
	return &CommunicationAttachmentResult{
		Filename: row.Filename, MimeType: row.MimeType, Content: content,
		ScanStatus: "clean", Access: access,
		Provenance: communicationProvenance{
			Source: interaction.Source, SourceAccountID: interaction.SourceAccountID,
			ProviderObjectID:     interaction.ProviderObjectID,
			ProviderAttachmentID: row.ProviderAttachmentID,
			InteractionID:        interaction.ID, OwnerID: owner.ID, RetrievedAt: now,
		},
	}, s.auditCommunicationRead(ctx, actor, interaction, participants, resource, "attachment")
}

func (s *Service) loadCommunicationAccess(
	ctx context.Context,
	actor *ent.User,
	interactionID uuid.UUID,
	wantBody, wantAttachments bool,
) (*ent.CommunicationInteraction, *ent.User, []string, CommunicationAccess, CommunicationResource, error) {
	interaction, err := s.client.CommunicationInteraction.Query().
		Where(communicationinteraction.IDEQ(interactionID)).
		WithWorkspace().
		WithOwner().
		WithRelationship().
		WithParticipants().
		Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return nil, nil, nil, CommunicationAccess{}, CommunicationResource{}, ErrNotFound
		}
		return nil, nil, nil, CommunicationAccess{}, CommunicationResource{}, err
	}
	owner, err := interaction.Edges.OwnerOrErr()
	if err != nil {
		return nil, nil, nil, CommunicationAccess{}, CommunicationResource{}, err
	}
	participants, resource, access, err := s.communicationAccessForInteraction(ctx, actor, interaction)
	if err != nil {
		return nil, nil, nil, CommunicationAccess{}, CommunicationResource{}, err
	}
	_ = wantBody
	_ = wantAttachments
	return interaction, owner, participants, access, resource, nil
}

func (s *Service) communicationAccessForInteraction(
	ctx context.Context,
	actor *ent.User,
	interaction *ent.CommunicationInteraction,
) ([]string, CommunicationResource, CommunicationAccess, error) {
	ws, err := interaction.Edges.WorkspaceOrErr()
	if err != nil {
		return nil, CommunicationResource{}, CommunicationAccess{}, err
	}
	owner, err := interaction.Edges.OwnerOrErr()
	if err != nil {
		return nil, CommunicationResource{}, CommunicationAccess{}, err
	}
	participants := participantEmails(interaction)
	resource := communicationResourceFromInteraction(interaction)
	access, err := s.communicationAuthorization().Evaluate(
		ctx, ws.ID, owner.ID, actor.ID,
		interaction.SourceAccountID, participants, resource,
	)
	return participants, resource, access, err
}

func participantEmails(interaction *ent.CommunicationInteraction) []string {
	rows, err := interaction.Edges.ParticipantsOrErr()
	if err != nil {
		return nil
	}
	out := make([]string, 0, len(rows))
	for _, row := range rows {
		out = append(out, row.Email)
	}
	return out
}

func communicationResourceFromInteraction(interaction *ent.CommunicationInteraction) CommunicationResource {
	resource := CommunicationResource{MessageID: interaction.ProviderObjectID}
	if rel, err := interaction.Edges.RelationshipOrErr(); err == nil {
		resource.RelationshipID = rel.ID.String()
	}
	var metadata map[string]any
	if err := json.Unmarshal([]byte(interaction.MetadataJSON), &metadata); err == nil {
		if threadID, ok := metadata["threadId"].(string); ok {
			resource.ThreadID = threadID
		}
	}
	return resource
}

func (s *Service) ownerMessageBody(ctx context.Context, owner *ent.User, messageID string) (string, error) {
	if s.bodyFetcher == nil {
		return "", ErrCommunicationContentUnavailable
	}
	internal := auth.WithInternalOnly(ctx)
	owns, err := s.client.MailMessageMeta.Query().
		Where(
			mailmessagemeta.HasUserWith(user.IDEQ(owner.ID)),
			mailmessagemeta.ProviderMessageIDEQ(messageID),
		).
		Exist(internal)
	if err != nil {
		return "", err
	}
	if !owns {
		return "", ErrCommunicationContentUnavailable
	}
	now := s.now()
	if s.sealer != nil {
		if row, cacheErr := s.client.MailBodyCache.Query().
			Where(
				mailbodycache.HasUserWith(user.IDEQ(owner.ID)),
				mailbodycache.ProviderMessageIDEQ(messageID),
				mailbodycache.ExpiresAtGT(now),
			).
			First(internal); cacheErr == nil {
			if body, openErr := s.sealer.OpenString(row.SealedBody); openErr == nil {
				return body, nil
			}
		}
	}
	body, err := s.bodyFetcher.FetchBody(internal, owner.ID, messageID)
	if err != nil || body == "" {
		if err != nil {
			return "", err
		}
		return "", ErrCommunicationContentUnavailable
	}
	if s.sealer != nil {
		if sealed, sealErr := s.sealer.SealString(body); sealErr == nil {
			_, _ = s.client.MailBodyCache.Delete().
				Where(
					mailbodycache.HasUserWith(user.IDEQ(owner.ID)),
					mailbodycache.ProviderMessageIDEQ(messageID),
				).Exec(internal)
			_ = s.client.MailBodyCache.Create().
				SetUser(owner).
				SetProviderMessageID(messageID).
				SetSealedBody(sealed).
				SetExpiresAt(now.Add(s.mailBodyTTL)).
				Exec(internal)
		}
	}
	return body, nil
}

func validateAttachmentAdmission(mimeType string, size int64) error {
	if size <= 0 || size > maxCommunicationAttachmentBytes {
		return fmt.Errorf("attachment size out of bounds")
	}
	mediaType, _, err := mime.ParseMediaType(strings.TrimSpace(mimeType))
	if err != nil || mediaType == "" {
		return fmt.Errorf("unsupported attachment mime type")
	}
	switch {
	case strings.HasPrefix(mediaType, "text/"):
	case mediaType == "application/json", mediaType == "application/xml", mediaType == "text/xml":
	default:
		return fmt.Errorf("attachment mime type not admitted")
	}
	for _, blocked := range []string{
		"application/javascript", "application/x-msdownload", "application/x-sh",
		"application/vnd.microsoft.portable-executable",
	} {
		if mediaType == blocked {
			return fmt.Errorf("attachment mime type blocked")
		}
	}
	return nil
}

func (s *Service) sealAttachmentContent(content string) ([]byte, error) {
	if s.sealer == nil {
		return nil, errors.New("sealer unavailable")
	}
	return s.sealer.SealString(content)
}

func (s *Service) openAttachmentContent(row *ent.CommunicationAttachment) (string, error) {
	if s.sealer == nil || len(row.SealedContent) == 0 {
		return "", errors.New("sealed attachment unavailable")
	}
	return s.sealer.OpenString(row.SealedContent)
}

func (s *Service) communicationRetentionDays(ctx context.Context, interaction *ent.CommunicationInteraction) int {
	owner, err := interaction.Edges.OwnerOrErr()
	if err != nil {
		return defaultCommunicationRetention
	}
	ws, err := interaction.Edges.WorkspaceOrErr()
	if err != nil {
		return defaultCommunicationRetention
	}
	internal := auth.WithInternalOnly(ctx)
	row, err := s.client.CommunicationPrivacyPolicy.Query().
		Where(
			communicationprivacypolicy.SourceAccountIDEQ(strings.ToLower(strings.TrimSpace(interaction.SourceAccountID))),
			communicationprivacypolicy.HasOwnerWith(user.IDEQ(owner.ID)),
			communicationprivacypolicy.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
		).
		Only(internal)
	if err == nil && row.RetentionDays > 0 {
		return row.RetentionDays
	}
	return defaultCommunicationRetention
}

func (s *Service) auditCommunicationRead(
	ctx context.Context,
	actor *ent.User,
	interaction *ent.CommunicationInteraction,
	_ []string,
	_ CommunicationResource,
	kind string,
) error {
	ws, err := interaction.Edges.WorkspaceOrErr()
	if err != nil {
		return err
	}
	owner, err := interaction.Edges.OwnerOrErr()
	if err != nil {
		return err
	}
	return appendTrustEvent(ctx, s.client, ws, actor, TrustEventInput{
		Name:          "communication_content_read",
		Outcome:       "accepted",
		CorrelationID: fmt.Sprintf("communication:%s:%s:owner:%s", kind, interaction.ID, owner.ID),
		Source:        interaction.Source,
		OccurredAt:    s.now().UTC(),
	})
}
