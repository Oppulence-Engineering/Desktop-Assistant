// Package communicationsync projects Gmail and Google Calendar incremental
// feeds into the communication-intelligence metadata store.
package communicationsync

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/mail"
	"net/url"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/communicationattachment"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/communicationinteraction"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/communicationparticipant"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/communicationsynccursor"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/oauthconnection"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/googleapi"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

const (
	// SourceGmail is the persisted Gmail cursor source value.
	SourceGmail = "gmail"
	// SourceCalendar is the persisted Calendar cursor source value.
	SourceCalendar = "calendar"

	defaultInterval      = 5 * time.Second
	defaultLeaseTTL      = 5 * time.Minute
	defaultBatchSize     = 50
	maxReconcilePages    = 5
	reconcileLookback    = 365 * 24 * time.Hour
	maxPersistedErrorLen = 500
	retryDelay           = time.Minute
)

// Config bounds worker concurrency and recovery scans.
type Config struct {
	Interval  time.Duration
	LeaseTTL  time.Duration
	BatchSize int
}

// Service owns durable invalidation, leasing, provider reads, and projections.
type Service struct {
	client  *ent.Client
	sealer  *crypto.Sealer
	secrets *secrets.Store
	google  *googleapi.Client
	cfg     Config
	log     *zap.Logger
	now     func() time.Time
}

// New returns a production-ready synchronization service.
func New(client *ent.Client, sealer *crypto.Sealer, secretStore *secrets.Store, google *googleapi.Client, cfg Config, log *zap.Logger) *Service {
	if cfg.Interval <= 0 {
		cfg.Interval = defaultInterval
	}
	if cfg.LeaseTTL <= 0 {
		cfg.LeaseTTL = defaultLeaseTTL
	}
	if cfg.BatchSize <= 0 {
		cfg.BatchSize = defaultBatchSize
	}
	if log == nil {
		log = zap.NewNop()
	}
	return &Service{client: client, sealer: sealer, secrets: secretStore, google: google, cfg: cfg, log: log, now: time.Now}
}

// EnqueueInvalidation is intentionally database-only so a verified webhook can
// acknowledge quickly. It runs in CloudEvent's after-create boundary: failure
// removes the event and causes Google/PubSub to retry, preventing detached work
// from being lost on process shutdown.
func (s *Service) EnqueueInvalidation(ctx context.Context, owner *ent.User, cloudSource, accountID string, providerEventAt time.Time) error {
	source, err := normalizeSource(cloudSource)
	if err != nil {
		return err
	}
	ctx = auth.WithInternal(ctx)
	accountID = strings.ToLower(strings.TrimSpace(accountID))
	workspace, err := s.workspace(ctx, owner)
	if err != nil {
		return fmt.Errorf("communication sync workspace: %w", err)
	}
	cursor, err := s.client.CommunicationSyncCursor.Query().Where(
		communicationsynccursor.SourceEQ(source),
		communicationsynccursor.SourceAccountIDEQ(accountID),
		communicationsynccursor.HasOwnerWith(user.IDEQ(owner.ID)),
		communicationsynccursor.HasWorkspaceWith(revenueworkspace.IDEQ(workspace.ID)),
	).Only(ctx)
	if ent.IsNotFound(err) {
		_, err = s.client.CommunicationSyncCursor.Create().
			SetWorkspace(workspace).
			SetOwner(owner).
			SetSource(source).
			SetSourceAccountID(accountID).
			SetStatus("queued").
			SetLastProviderEventAt(providerEventAt.UTC()).
			Save(ctx)
		if ent.IsConstraintError(err) {
			return s.EnqueueInvalidation(ctx, owner, cloudSource, accountID, providerEventAt)
		}
		return err
	}
	if err != nil {
		return err
	}
	update := cursor.Update().SetLastProviderEventAt(providerEventAt.UTC())
	if cursor.Status != "running" {
		update.SetStatus("queued")
	}
	return update.Exec(ctx)
}

func normalizeSource(source string) (string, error) {
	switch source {
	case SourceGmail:
		return SourceGmail, nil
	case "google_calendar", SourceCalendar:
		return SourceCalendar, nil
	default:
		return "", fmt.Errorf("unsupported communication source %q", source)
	}
}

// Run processes durable cursor rows until cancellation.
func (s *Service) Run(ctx context.Context) error {
	ticker := time.NewTicker(s.cfg.Interval)
	defer ticker.Stop()
	for {
		if err := s.RunOnce(ctx); err != nil && !errors.Is(err, context.Canceled) {
			s.log.Error("communication sync pass failed", zap.Error(err))
		}
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		}
	}
}

// RunOnce claims and processes a bounded batch. The CAS lease makes concurrent
// scheduler replicas safe; stale running leases are recoverable after a crash.
func (s *Service) RunOnce(ctx context.Context) error {
	ctx = auth.WithInternal(ctx)
	now := s.now().UTC()
	rows, err := s.client.CommunicationSyncCursor.Query().
		Where(communicationsynccursor.Or(
			communicationsynccursor.StatusEQ("queued"),
			communicationsynccursor.And(
				communicationsynccursor.StatusEQ("failed"),
				communicationsynccursor.UpdatedAtLT(now.Add(-retryDelay)),
			),
			communicationsynccursor.And(
				communicationsynccursor.StatusEQ("running"),
				communicationsynccursor.LeaseClaimedAtLT(now.Add(-s.cfg.LeaseTTL)),
			),
		)).
		Order(ent.Asc(communicationsynccursor.FieldUpdatedAt)).
		Limit(s.cfg.BatchSize).
		All(ctx)
	if err != nil {
		return err
	}
	for _, row := range rows {
		claimed, claimErr := s.claim(ctx, row, now)
		if claimErr != nil {
			return claimErr
		}
		if !claimed {
			continue
		}
		if processErr := s.process(ctx, row); processErr != nil {
			s.fail(ctx, row, now, processErr)
			continue
		}
		if finishErr := s.finish(ctx, row, now); finishErr != nil {
			return finishErr
		}
	}
	return nil
}

func (s *Service) claim(ctx context.Context, row *ent.CommunicationSyncCursor, now time.Time) (bool, error) {
	n, err := s.client.CommunicationSyncCursor.Update().
		Where(
			communicationsynccursor.IDEQ(row.ID),
			communicationsynccursor.Or(
				communicationsynccursor.StatusEQ("queued"),
				communicationsynccursor.And(
					communicationsynccursor.StatusEQ("failed"),
					communicationsynccursor.UpdatedAtLT(now.Add(-retryDelay)),
				),
				communicationsynccursor.And(
					communicationsynccursor.StatusEQ("running"),
					communicationsynccursor.LeaseClaimedAtLT(now.Add(-s.cfg.LeaseTTL)),
				),
			),
		).
		SetStatus("running").
		SetLeaseClaimedAt(now).
		Save(ctx)
	return n == 1, err
}

func (s *Service) process(ctx context.Context, row *ent.CommunicationSyncCursor) error {
	owner, err := row.QueryOwner().Only(ctx)
	if err != nil {
		return err
	}
	workspace, err := row.QueryWorkspace().Only(ctx)
	if err != nil {
		return err
	}
	conn, err := s.client.OAuthConnection.Query().Where(
		oauthconnection.ProviderEQ("google"),
		oauthconnection.HasUserWith(user.IDEQ(owner.ID)),
	).Only(ctx)
	if err != nil {
		return fmt.Errorf("load Google connection: %w", err)
	}
	if !strings.EqualFold(conn.ExternalAccountID, row.SourceAccountID) {
		return errors.New("google connection account no longer matches synchronization cursor")
	}
	token, err := s.google.AccessTokenForConnection(ctx, s.sealer, s.secrets, conn)
	if err != nil {
		return err
	}
	switch row.Source {
	case SourceGmail:
		return s.syncGmail(ctx, workspace, owner, row, token)
	case SourceCalendar:
		return s.syncCalendar(ctx, workspace, owner, row, token)
	default:
		return fmt.Errorf("unsupported cursor source %q", row.Source)
	}
}

func (s *Service) syncGmail(ctx context.Context, workspace *ent.RevenueWorkspace, owner *ent.User, row *ent.CommunicationSyncCursor, token string) error {
	if row.Cursor == "" {
		return s.reconcileGmail(ctx, workspace, owner, row, token)
	}
	changes, err := s.google.ListHistoryChanges(ctx, token, row.Cursor)
	if errors.Is(err, googleapi.ErrHistoryGap) {
		return s.reconcileGmail(ctx, workspace, owner, row, token)
	}
	if err != nil {
		return err
	}
	for _, id := range changes.UpdatedMessageIDs {
		message, getErr := s.google.GetMessageMetadata(ctx, token, id)
		if getErr != nil {
			if strings.Contains(getErr.Error(), "returned 404") {
				if tombstoneErr := s.tombstone(ctx, workspace, SourceGmail, row.SourceAccountID, id); tombstoneErr != nil {
					return tombstoneErr
				}
				continue
			}
			return getErr
		}
		if err := s.persistGmail(ctx, workspace, owner, row.SourceAccountID, message); err != nil {
			return err
		}
	}
	for _, id := range changes.DeletedMessageIDs {
		if err := s.tombstone(ctx, workspace, SourceGmail, row.SourceAccountID, id); err != nil {
			return err
		}
	}
	if changes.LatestHistoryID != "" {
		row.Cursor = changes.LatestHistoryID
	}
	return nil
}

func (s *Service) reconcileGmail(ctx context.Context, workspace *ent.RevenueWorkspace, owner *ent.User, row *ent.CommunicationSyncCursor, token string) error {
	pageToken := ""
	for page := 0; page < maxReconcilePages; page++ {
		ids, next, err := s.google.ListMessageIDsPage(ctx, token, "in:anywhere newer_than:365d", 500, pageToken)
		if err != nil {
			return err
		}
		for _, id := range ids {
			message, getErr := s.google.GetMessageMetadata(ctx, token, id)
			if getErr != nil {
				return getErr
			}
			if err := s.persistGmail(ctx, workspace, owner, row.SourceAccountID, message); err != nil {
				return err
			}
		}
		if next == "" {
			profile, profileErr := s.google.GetProfile(ctx, token)
			if profileErr != nil {
				return profileErr
			}
			row.Cursor = profile.HistoryID
			return nil
		}
		pageToken = next
	}
	return fmt.Errorf("gmail reconciliation exceeded %d pages", maxReconcilePages)
}

func (s *Service) syncCalendar(ctx context.Context, workspace *ent.RevenueWorkspace, owner *ent.User, row *ent.CommunicationSyncCursor, token string) error {
	syncToken := row.Cursor
	timeMin := ""
	if syncToken == "" {
		timeMin = s.now().UTC().Add(-reconcileLookback).Format(time.RFC3339)
	}
	for page := 0; page < maxReconcilePages; page++ {
		changes, err := s.google.ListCalendarChanges(ctx, token, syncToken, "", timeMin)
		if errors.Is(err, googleapi.ErrCalendarSyncTokenExpired) {
			if syncToken == "" {
				return err
			}
			row.Cursor = ""
			return s.syncCalendar(ctx, workspace, owner, row, token)
		}
		if err != nil {
			return err
		}
		for _, event := range changes.Events {
			if err := s.persistCalendar(ctx, workspace, owner, row.SourceAccountID, event); err != nil {
				return err
			}
		}
		if changes.NextPageToken == "" {
			if changes.NextSyncToken == "" {
				return errors.New("calendar incremental list returned no nextSyncToken")
			}
			row.Cursor = changes.NextSyncToken
			return nil
		}
		// Calendar requires the same syncToken on every page.
		pageToken := changes.NextPageToken
		for page++; page < maxReconcilePages; page++ {
			changes, err = s.google.ListCalendarChanges(ctx, token, syncToken, pageToken, timeMin)
			if err != nil {
				return err
			}
			for _, event := range changes.Events {
				if err := s.persistCalendar(ctx, workspace, owner, row.SourceAccountID, event); err != nil {
					return err
				}
			}
			if changes.NextPageToken == "" {
				if changes.NextSyncToken == "" {
					return errors.New("calendar incremental list returned no nextSyncToken")
				}
				row.Cursor = changes.NextSyncToken
				return nil
			}
			pageToken = changes.NextPageToken
		}
	}
	return fmt.Errorf("calendar reconciliation exceeded %d pages", maxReconcilePages)
}

func (s *Service) finish(ctx context.Context, row *ent.CommunicationSyncCursor, claimedAt time.Time) error {
	now := s.now().UTC()
	n, err := s.client.CommunicationSyncCursor.Update().
		Where(
			communicationsynccursor.IDEQ(row.ID),
			communicationsynccursor.LeaseClaimedAtEQ(claimedAt),
			communicationsynccursor.Or(
				communicationsynccursor.LastProviderEventAtIsNil(),
				communicationsynccursor.LastProviderEventAtLTE(claimedAt),
			),
		).
		SetCursor(row.Cursor).
		SetStatus("live").
		SetLastSuccessAt(now).
		SetRetryCount(0).
		ClearLastError().
		ClearLeaseClaimedAt().
		Save(ctx)
	if err != nil {
		return err
	}
	if n == 1 {
		return nil
	}
	// A webhook arrived while this lease was running. Preserve the new queued
	// invalidation while committing the provider cursor already processed.
	_, err = s.client.CommunicationSyncCursor.Update().
		Where(communicationsynccursor.IDEQ(row.ID), communicationsynccursor.LeaseClaimedAtEQ(claimedAt)).
		SetCursor(row.Cursor).
		SetStatus("queued").
		SetLastSuccessAt(now).
		SetRetryCount(0).
		ClearLastError().
		ClearLeaseClaimedAt().
		Save(ctx)
	return err
}

func (s *Service) fail(ctx context.Context, row *ent.CommunicationSyncCursor, claimedAt time.Time, processErr error) {
	message := processErr.Error()
	if len(message) > maxPersistedErrorLen {
		message = message[:maxPersistedErrorLen]
	}
	if _, err := s.client.CommunicationSyncCursor.Update().
		Where(communicationsynccursor.IDEQ(row.ID), communicationsynccursor.LeaseClaimedAtEQ(claimedAt)).
		SetStatus("failed").
		SetRetryCount(row.RetryCount + 1).
		SetLastError(message).
		ClearLeaseClaimedAt().
		Save(ctx); err != nil {
		s.log.Error("record communication sync failure", zap.Error(err))
	}
}

func (s *Service) workspace(ctx context.Context, owner *ent.User) (*ent.RevenueWorkspace, error) {
	workspace, err := s.client.RevenueWorkspace.Query().Where(revenueworkspace.HasUserWith(user.IDEQ(owner.ID))).Only(ctx)
	if err == nil {
		return workspace, nil
	}
	if !ent.IsNotFound(err) {
		return nil, err
	}
	workspace, err = s.client.RevenueWorkspace.Create().SetUser(owner).Save(ctx)
	if ent.IsConstraintError(err) {
		return s.client.RevenueWorkspace.Query().Where(revenueworkspace.HasUserWith(user.IDEQ(owner.ID))).Only(ctx)
	}
	return workspace, err
}

type participant struct {
	email string
	name  string
	role  string
}

type attachment struct {
	id       string
	filename string
	mimeType string
	size     int64
}

type projection struct {
	source, accountID, objectID, subject, direction string
	occurredAt                                      time.Time
	deleted                                         bool
	metadata                                        any
	participants                                    []participant
	attachments                                     []attachment
}

func (s *Service) persistGmail(ctx context.Context, workspace *ent.RevenueWorkspace, owner *ent.User, accountID string, message googleapi.GmailMessageContent) error {
	at, _ := time.Parse(time.RFC3339, message.ReceivedAt)
	if at.IsZero() {
		at = s.now().UTC()
	}
	metadata := map[string]any{
		"threadId": message.ThreadID, "rfc822MessageId": message.RFC822MessageID,
		"inReplyToMessageId": message.InReplyToMessageID, "labels": message.Labels,
		"snippet": message.Snippet, "sizeBytes": message.SizeBytes,
	}
	p := projection{source: SourceGmail, accountID: accountID, objectID: message.MessageID, subject: message.Subject, occurredAt: at, metadata: metadata}
	if message.Outbound {
		p.direction = "outbound"
	} else {
		p.direction = "inbound"
	}
	p.participants = append(p.participants, parseAddresses(message.From, "from")...)
	p.participants = append(p.participants, parseAddresses(message.To, "to")...)
	p.participants = append(p.participants, parseAddresses(message.Cc, "cc")...)
	p.participants = append(p.participants, parseAddresses(message.Bcc, "bcc")...)
	for _, item := range message.Attachments {
		id := item.ID
		if id == "" {
			id = item.Reference
		}
		if id == "" {
			id = item.Filename + ":" + item.MIMEType
		}
		p.attachments = append(p.attachments, attachment{id: id, filename: item.Filename, mimeType: item.MIMEType, size: int64(item.Size)})
	}
	return s.persist(ctx, workspace, owner, p)
}

func (s *Service) persistCalendar(ctx context.Context, workspace *ent.RevenueWorkspace, owner *ent.User, accountID string, event googleapi.CalendarEvent) error {
	at := parseProviderTime(event.StartsAt)
	if at.IsZero() {
		at = parseProviderTime(event.OriginalStartAt)
	}
	if at.IsZero() {
		at = parseProviderTime(event.UpdatedAt)
	}
	if at.IsZero() {
		at = s.now().UTC()
	}
	p := projection{
		source: SourceCalendar, accountID: accountID, objectID: event.ID, subject: event.Summary,
		occurredAt: at, deleted: event.Status == "cancelled", metadata: event,
	}
	if event.Organizer != "" {
		p.participants = append(p.participants, participant{email: event.Organizer, role: "organizer"})
	}
	for _, email := range event.Attendees {
		p.participants = append(p.participants, participant{email: email, role: "attendee"})
	}
	for _, item := range event.Attachments {
		p.attachments = append(p.attachments, attachment{
			id: hashString(item.FileURL), filename: item.Title, mimeType: item.MIMEType,
		})
	}
	return s.persist(ctx, workspace, owner, p)
}

func (s *Service) persist(ctx context.Context, workspace *ent.RevenueWorkspace, owner *ent.User, p projection) error {
	raw, err := json.Marshal(p.metadata)
	if err != nil {
		return err
	}
	hash := hashBytes(raw)
	tx, err := s.client.Tx(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	interaction, err := tx.CommunicationInteraction.Query().Where(
		communicationinteraction.SourceEQ(p.source),
		communicationinteraction.SourceAccountIDEQ(p.accountID),
		communicationinteraction.ProviderObjectIDEQ(p.objectID),
		communicationinteraction.SourceVersionEQ("1"),
		communicationinteraction.HasWorkspaceWith(revenueworkspace.IDEQ(workspace.ID)),
	).Only(ctx)
	if ent.IsNotFound(err) {
		create := tx.CommunicationInteraction.Create().
			SetWorkspaceID(workspace.ID).
			SetOwnerID(owner.ID).
			SetSource(p.source).
			SetSourceAccountID(p.accountID).
			SetProviderObjectID(p.objectID).
			SetSourceVersion("1").
			SetInteractionType(map[string]string{SourceGmail: "email", SourceCalendar: "meeting"}[p.source]).
			SetSubject(p.subject).
			SetOccurredAt(p.occurredAt).
			SetReceivedAt(s.now().UTC()).
			SetDeleted(p.deleted).
			SetContentHash(hash).
			SetMetadataJSON(string(raw))
		if p.direction != "" {
			create.SetDirection(p.direction)
		}
		interaction, err = create.Save(ctx)
	} else if err == nil {
		update := interaction.Update().
			SetSubject(p.subject).
			SetOccurredAt(p.occurredAt).
			SetDeleted(p.deleted).
			SetContentHash(hash).
			SetMetadataJSON(string(raw))
		if p.direction != "" {
			update.SetDirection(p.direction)
		}
		interaction, err = update.Save(ctx)
	}
	if err != nil {
		return err
	}
	if _, err = tx.CommunicationParticipant.Delete().
		Where(communicationparticipant.HasInteractionWith(communicationinteraction.IDEQ(interaction.ID))).
		Exec(ctx); err != nil {
		return err
	}
	if _, err = tx.CommunicationAttachment.Delete().
		Where(communicationattachment.HasInteractionWith(communicationinteraction.IDEQ(interaction.ID))).
		Exec(ctx); err != nil {
		return err
	}
	for _, item := range dedupeParticipants(p.participants) {
		email := strings.ToLower(strings.TrimSpace(item.email))
		if email == "" {
			continue
		}
		if _, err = tx.CommunicationParticipant.Create().
			SetWorkspaceID(workspace.ID).
			SetInteraction(interaction).
			SetEmail(email).
			SetDisplayName(item.name).
			SetRole(item.role).
			SetOwner(strings.EqualFold(email, p.accountID)).
			SetExternal(!strings.EqualFold(email, p.accountID)).
			Save(ctx); err != nil {
			return err
		}
	}
	for _, item := range p.attachments {
		if item.id == "" {
			continue
		}
		if _, err = tx.CommunicationAttachment.Create().
			SetWorkspaceID(workspace.ID).
			SetInteraction(interaction).
			SetProviderAttachmentID(item.id).
			SetFilename(item.filename).
			SetMimeType(item.mimeType).
			SetSizeBytes(item.size).
			Save(ctx); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Service) tombstone(ctx context.Context, workspace *ent.RevenueWorkspace, source, accountID, objectID string) error {
	_, err := s.client.CommunicationInteraction.Update().
		Where(
			communicationinteraction.SourceEQ(source),
			communicationinteraction.SourceAccountIDEQ(accountID),
			communicationinteraction.ProviderObjectIDEQ(objectID),
			communicationinteraction.HasWorkspaceWith(revenueworkspace.IDEQ(workspace.ID)),
		).
		SetDeleted(true).
		Save(ctx)
	return err
}

func parseAddresses(raw, role string) []participant {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	addresses, err := mail.ParseAddressList(raw)
	if err != nil {
		return []participant{{email: strings.TrimSpace(raw), role: role}}
	}
	out := make([]participant, 0, len(addresses))
	for _, address := range addresses {
		out = append(out, participant{email: address.Address, name: address.Name, role: role})
	}
	return out
}

func dedupeParticipants(items []participant) []participant {
	seen := map[string]struct{}{}
	out := make([]participant, 0, len(items))
	for _, item := range items {
		key := strings.ToLower(strings.TrimSpace(item.email)) + "\x00" + item.role
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, item)
	}
	return out
}

func parseProviderTime(raw string) time.Time {
	if parsed, err := time.Parse(time.RFC3339, raw); err == nil {
		return parsed.UTC()
	}
	if parsed, err := time.Parse(time.DateOnly, raw); err == nil {
		return parsed.UTC()
	}
	return time.Time{}
}

func hashBytes(raw []byte) string {
	sum := sha256.Sum256(raw)
	return "sha256:" + hex.EncodeToString(sum[:])
}

func hashString(raw string) string {
	if parsed, err := url.Parse(raw); err == nil {
		raw = parsed.String()
	}
	return hashBytes([]byte(raw))
}

// CursorHealth is the non-sensitive service DTO used by diagnostics. Provider
// account IDs, cursor values, and errors intentionally remain private.
type CursorHealth struct {
	Source        string     `json:"source"`
	Status        string     `json:"status"`
	LastSuccessAt *time.Time `json:"lastSuccessAt,omitempty"`
	RetryCount    int        `json:"retryCount"`
}

// Health reports synchronization freshness for one owner without exposing
// sensitive provider identifiers or watermarks.
func (s *Service) Health(ctx context.Context, ownerID uuid.UUID) ([]CursorHealth, error) {
	ctx = auth.WithInternal(ctx)
	rows, err := s.client.CommunicationSyncCursor.Query().
		Where(communicationsynccursor.HasOwnerWith(user.IDEQ(ownerID))).
		Order(ent.Asc(communicationsynccursor.FieldSource)).
		All(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]CursorHealth, 0, len(rows))
	for _, row := range rows {
		out = append(out, CursorHealth{Source: row.Source, Status: row.Status, LastSuccessAt: row.LastSuccessAt, RetryCount: row.RetryCount})
	}
	return out, nil
}
