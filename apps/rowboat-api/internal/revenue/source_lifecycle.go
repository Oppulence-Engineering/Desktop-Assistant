package revenue

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipsourcestatus"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
)

// SourceDescriptor is the user-visible evidence, action, scope, and repair
// contract for one beta connector.
type SourceDescriptor struct {
	Source             string   `json:"source"`
	DisplayName        string   `json:"displayName"`
	Evidence           []string `json:"evidence"`
	Actions            []string `json:"actions"`
	ReadScopes         []string `json:"readScopes"`
	WriteScopes        []string `json:"writeScopes"`
	ScopeExplanation   string   `json:"scopeExplanation"`
	ConnectPath        string   `json:"connectPath"`
	DisconnectPath     string   `json:"disconnectPath"`
	SupportsReconnect  bool     `json:"supportsReconnect"`
	SupportsResync     bool     `json:"supportsResync"`
	ExpectedCadenceSec int64    `json:"expectedCadenceSeconds"`
}

var betaSourceDescriptors = []SourceDescriptor{
	{
		Source: "google", DisplayName: "Google Gmail & Calendar",
		Evidence: []string{"email_threads", "replies", "meetings", "participants", "commitments"},
		Actions:  []string{"gmail_draft", "gmail_send", "calendar_event"},
		ReadScopes: []string{
			"https://www.googleapis.com/auth/gmail.readonly",
			"https://www.googleapis.com/auth/calendar.events.readonly",
		},
		WriteScopes: []string{
			"https://www.googleapis.com/auth/gmail.compose",
			"https://www.googleapis.com/auth/gmail.send",
			"https://www.googleapis.com/auth/calendar.events",
		},
		ScopeExplanation: "Read scopes build relationship history. Write scopes are requested progressively only when you enable an approval-gated action.",
		ConnectPath:      "/v1/google-oauth/start", DisconnectPath: "/v1/google-oauth",
		SupportsReconnect: true, SupportsResync: true, ExpectedCadenceSec: 900,
	},
	{
		Source: "slack", DisplayName: "Slack",
		Evidence:         []string{"messages", "threads", "participants", "decisions", "commitments"},
		Actions:          []string{"slack_message"},
		ReadScopes:       []string{"channels:history", "channels:read", "users:read"},
		WriteScopes:      []string{"chat:write"},
		ScopeExplanation: "Channel and user reads assemble shared account context. chat:write is used only after approval of an exact destination and message revision.",
		ConnectPath:      "/v1/slack-oauth/start", DisconnectPath: "/v1/slack-oauth/workspaces/{sourceAccountId}",
		SupportsReconnect: true, SupportsResync: true, ExpectedCadenceSec: 900,
	},
	{
		Source: "hubspot", DisplayName: "HubSpot",
		Evidence:         []string{"companies", "contacts", "deals", "activities", "pipeline_changes"},
		Actions:          []string{"crm_note", "crm_task"},
		ReadScopes:       []string{"crm.objects.companies.read", "crm.objects.contacts.read", "crm.objects.deals.read"},
		WriteScopes:      []string{"crm.objects.notes.write", "crm.objects.tasks.write"},
		ScopeExplanation: "CRM reads preserve HubSpot-owned lifecycle evidence. Progressive note/task scopes create only the exact revision-bound engagement a user approves; beta does not silently mutate CRM-owned fields.",
		ConnectPath:      "/v1/connections/hubspot/api-key", DisconnectPath: "/v1/connections/hubspot",
		SupportsReconnect: true, SupportsResync: true, ExpectedCadenceSec: 1800,
	},
}

// SourceInventoryItem combines a connector contract with its workspace-bound
// provider accounts and their current lifecycle states.
type SourceInventoryItem struct {
	SourceDescriptor
	Accounts []*ent.RelationshipSourceStatus `json:"accounts"`
}

// RelationshipSourceInventory returns the guided connector inventory without
// exposing tokens, provider cursors, or raw connector errors.
func (s *Service) RelationshipSourceInventory(
	ctx context.Context,
	u *ent.User,
) ([]SourceInventoryItem, error) {
	statuses, err := s.RelationshipSourceStatuses(ctx, u)
	if err != nil {
		return nil, err
	}
	bySource := make(map[string][]*ent.RelationshipSourceStatus)
	for _, status := range statuses {
		source := canonicalSource(status.Source)
		bySource[source] = append(bySource[source], status)
	}
	out := make([]SourceInventoryItem, 0, len(betaSourceDescriptors))
	for _, descriptor := range betaSourceDescriptors {
		out = append(out, SourceInventoryItem{
			SourceDescriptor: descriptor,
			Accounts:         bySource[descriptor.Source],
		})
	}
	return out, nil
}

// SourceSyncProgressInput reports progress only after the corresponding
// evidence batch has been durably accepted.
type SourceSyncProgressInput struct {
	Source          string
	SourceAccountID string
	Completed       int
	Total           int
	Watermark       string
	Done            bool
	OccurredAt      time.Time
}

// SourceAuthorizationInput records the bounded outcome of provider consent;
// the connector broker remains the sole owner of credentials.
type SourceAuthorizationInput struct {
	SourceAccountID string
	State           string
	GrantedScopes   []string
	ErrorCode       string
}

// ReportSourceAuthorization is the relationship-facing side of connector
// consent. The connector broker continues to own tokens; this records only the
// bounded lifecycle, scopes, actor, and timestamps clients need to judge trust.
func (s *Service) ReportSourceAuthorization(ctx context.Context, u *ent.User, source string, in SourceAuthorizationInput) (*ent.RelationshipSourceStatus, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceManageSources)
	if err != nil {
		return nil, err
	}
	source = canonicalSource(source)
	if err := validateBetaSource(source); err != nil {
		return nil, err
	}
	if err := s.requireWorkspaceFeature(ctx, ws, sourceCapability(source)); err != nil {
		return nil, err
	}
	status, err := s.ensureSourceStatus(ctx, s.client, ws, u, source, in.SourceAccountID)
	if err != nil {
		return nil, err
	}
	now := s.now().UTC()
	state := strings.ToLower(strings.TrimSpace(in.State))
	update := status.Update().SetConsentingActorID(u.ID)
	event := TrustEventInput{
		Name: "source_authorization_started", Outcome: "started", ReasonCode: "user_requested",
		CorrelationID: "source:" + source + ":" + normalizedSourceAccountID(in.SourceAccountID),
		Source:        source, OccurredAt: now,
	}
	switch state {
	case "started":
		update.SetStatus("authorizing").SetAuthorizationStartedAt(now).
			ClearDisconnectedAt().ClearRevokedAt().ClearLastError().ClearErrorCode()
	case "completed":
		granted := sortedUniqueStrings(in.GrantedScopes)
		missing := differenceStrings(status.RequiredScopes, granted)
		update.SetStatus("connected").SetAuthorizedAt(now).SetGrantedScopes(granted).
			SetMissingScopes(missing).SetCompleteness("partial").ClearLastError().ClearErrorCode().
			ClearDisconnectedAt().ClearRevokedAt()
		event.Name, event.Outcome, event.ReasonCode = "source_authorization_succeeded", "succeeded", "provider_consent"
	case "canceled":
		update.SetStatus("not_connected").SetCompleteness("partial").SetErrorCode("authorization_canceled").
			SetLastError("Provider authorization was canceled.")
		event.Name, event.Outcome, event.ReasonCode = "source_authorization_canceled", "rejected", "user_canceled"
	case "failed":
		code := strings.ToLower(strings.TrimSpace(in.ErrorCode))
		if !featureReasonPattern.MatchString(code) {
			code = "authorization_failed"
		}
		update.SetStatus("reconnect_required").SetCompleteness("stale").SetErrorCode(code).
			SetLastError("Provider authorization failed; reconnect is required.").SetLastFailedSyncAt(now)
		event.Name, event.Outcome, event.ReasonCode = "source_authorization_failed", "failed", code
	default:
		return nil, fmt.Errorf("%w: authorization state must be started, completed, canceled, or failed", ErrInvalidInput)
	}
	updated, err := update.Save(ctx)
	if err != nil {
		return nil, err
	}
	_ = appendTrustEvent(ctx, s.client, ws, u, event)
	_ = s.RefreshRelationshipAttention(ctx, u)
	return updated, nil
}

// BeginSourceBackfill queues bounded provider work for a fully authorized
// source, while refusing states that require consent or reconnect.
func (s *Service) BeginSourceBackfill(
	ctx context.Context,
	u *ent.User,
	source string,
	sourceAccountID string,
) (*ent.RelationshipSourceStatus, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceManageSources)
	if err != nil {
		return nil, err
	}
	source = canonicalSource(source)
	if err := validateBetaSource(source); err != nil {
		return nil, err
	}
	if err := s.requireWorkspaceFeature(ctx, ws, sourceCapability(source)); err != nil {
		return nil, err
	}
	status, err := s.ensureSourceStatus(ctx, s.client, ws, u, source, sourceAccountID)
	if err != nil {
		return nil, err
	}
	// A resync is meaningful only for an authorized evidence stream. In
	// particular, do not let the backfill endpoint clear a disconnect,
	// revocation, failed consent, or missing-scope state: those require a fresh
	// provider authorization event first. Otherwise the lifecycle card could
	// look healthy while the worker has no valid authority to read evidence.
	if status.DisconnectedAt != nil || status.RevokedAt != nil || len(status.MissingScopes) > 0 {
		return nil, fmt.Errorf("%w: reconnect with all required read scopes before backfill", ErrSourceIncomplete)
	}
	switch status.Status {
	case "connected", "live", "degraded", "stale", "rebuilding":
		// Authorized states may start or restart bounded provider work.
	case "backfilling":
		return nil, fmt.Errorf("%w: source backfill is already queued or running", ErrConflict)
	default:
		return nil, fmt.Errorf("%w: authorize the source before backfill", ErrSourceIncomplete)
	}
	now := s.now().UTC()
	updated, err := status.Update().
		SetStatus("backfilling").SetBackfillPhase("queued").SetCompleteness("rebuilding").
		SetBackfillCompleted(0).SetBackfillTotal(0).SetSyncStartedAt(now).
		SetRetryCount(0).ClearNextRetryAt().ClearLastError().ClearErrorCode().
		Save(ctx)
	if err == nil {
		_ = s.RefreshRelationshipAttention(ctx, u)
	}
	return updated, err
}

// ReportSourceSyncProgress advances a source lifecycle after a committed
// evidence batch and makes a completed source eligible for trusted reads.
func (s *Service) ReportSourceSyncProgress(
	ctx context.Context,
	u *ent.User,
	in SourceSyncProgressInput,
) (*ent.RelationshipSourceStatus, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceManageSources)
	if err != nil {
		return nil, err
	}
	in.Source = canonicalSource(in.Source)
	if err := validateBetaSource(in.Source); err != nil {
		return nil, err
	}
	if in.Completed < 0 || in.Total < 0 || (in.Total > 0 && in.Completed > in.Total) {
		return nil, fmt.Errorf("%w: invalid backfill progress", ErrInvalidInput)
	}
	status, err := s.ensureSourceStatus(ctx, s.client, ws, u, in.Source, in.SourceAccountID)
	if err != nil {
		return nil, err
	}
	// Disconnect is an operator decision, not a transient worker state. A provider
	// response already in flight may still be retained as evidence, but stale progress
	// must never turn that connection live again.
	if status.Status == "disconnected" || status.Status == "reconnect_required" ||
		status.DisconnectedAt != nil || status.RevokedAt != nil || len(status.MissingScopes) > 0 {
		return nil, fmt.Errorf("%w: source is no longer eligible for synchronization", ErrConflict)
	}
	switch status.Status {
	case "connected", "backfilling", "live", "degraded", "stale", "rebuilding":
		// These states all represent a previously authorized evidence stream.
	default:
		return nil, fmt.Errorf("%w: authorize the source before reporting synchronization", ErrSourceIncomplete)
	}
	if in.OccurredAt.IsZero() {
		in.OccurredAt = s.now().UTC()
	}
	update := status.Update().
		SetBackfillCompleted(in.Completed).SetBackfillTotal(in.Total).
		SetLastSyncAt(in.OccurredAt.UTC()).SetLastSuccessAt(in.OccurredAt.UTC()).
		SetLagSeconds(0).ClearLastError().ClearErrorCode().ClearNextRetryAt()
	if strings.TrimSpace(in.Watermark) != "" {
		update.SetWatermark(strings.TrimSpace(in.Watermark)).SetCursor(strings.TrimSpace(in.Watermark))
	}
	if in.Done {
		update.SetStatus("live").SetBackfillPhase("live").SetCompleteness("complete").
			SetBackfillCompletedAt(in.OccurredAt.UTC()).SetAuthorizedAt(in.OccurredAt.UTC())
	} else {
		update.SetStatus("backfilling").SetBackfillPhase("running").SetCompleteness("partial")
	}
	updated, err := update.Save(ctx)
	if err == nil {
		_ = s.RefreshRelationshipAttention(ctx, u)
	}
	return updated, err
}

// MarkSourceSyncFailure records a categorical, repairable provider failure
// without persisting raw provider responses.
func (s *Service) MarkSourceSyncFailure(
	ctx context.Context,
	u *ent.User,
	source string,
	sourceAccountID string,
	errorCode string,
) (*ent.RelationshipSourceStatus, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceManageSources)
	if err != nil {
		return nil, err
	}
	source = canonicalSource(source)
	if err := validateBetaSource(source); err != nil {
		return nil, err
	}
	errorCode = strings.ToLower(strings.TrimSpace(errorCode))
	if !featureReasonPattern.MatchString(errorCode) {
		return nil, fmt.Errorf("%w: errorCode must be categorical", ErrInvalidInput)
	}
	status, err := s.ensureSourceStatus(ctx, s.client, ws, u, source, sourceAccountID)
	if err != nil {
		return nil, err
	}
	if status.Status == "disconnected" || status.Status == "reconnect_required" ||
		status.DisconnectedAt != nil || status.RevokedAt != nil {
		return status, nil
	}
	retryCount := status.RetryCount + 1
	backoff := time.Duration(1<<min(retryCount, 8)) * time.Minute
	state := "degraded"
	switch errorCode {
	case "missing_scope", "invalid_grant", "revoked_credential":
		state = "reconnect_required"
	case "cursor_lost":
		state = "rebuilding"
	}
	update := status.Update().SetStatus(state).SetBackfillPhase("failed").SetCompleteness("stale").
		SetErrorCode(errorCode).SetLastError(safeSourceError(errorCode)).
		SetRetryCount(retryCount).
		SetLastFailedSyncAt(s.now().UTC())
	if state == "reconnect_required" {
		update.ClearNextRetryAt()
	} else {
		update.SetNextRetryAt(s.now().UTC().Add(backoff))
	}
	if errorCode == "revoked_credential" {
		update.SetRevokedAt(s.now().UTC())
	}
	updated, err := update.Save(ctx)
	if err == nil {
		_ = s.RefreshRelationshipAttention(ctx, u)
	}
	return updated, err
}

// MarkSourceDisconnected makes an operator disconnect sticky and clears all
// resumable provider cursors.
func (s *Service) MarkSourceDisconnected(
	ctx context.Context,
	u *ent.User,
	source string,
	sourceAccountID string,
) (*ent.RelationshipSourceStatus, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceManageSources)
	if err != nil {
		return nil, err
	}
	source = canonicalSource(source)
	if err := validateBetaSource(source); err != nil {
		return nil, err
	}
	status, err := s.ensureSourceStatus(ctx, s.client, ws, u, source, sourceAccountID)
	if err != nil {
		return nil, err
	}
	now := s.now().UTC()
	updated, err := status.Update().SetStatus("disconnected").SetBackfillPhase("idle").
		SetCompleteness("disconnected").SetLagSeconds(0).
		SetDisconnectedAt(now).ClearCursor().ClearWatermark().ClearNextRetryAt().Save(ctx)
	if err != nil {
		return nil, err
	}
	_ = appendTrustEvent(ctx, s.client, ws, u, TrustEventInput{
		Name: "source_disconnected", Outcome: "succeeded", ReasonCode: "user_requested",
		CorrelationID: "source:" + source + ":" + normalizedSourceAccountID(sourceAccountID),
		Source:        source, OccurredAt: now,
	})
	_ = s.RefreshRelationshipAttention(ctx, u)
	return updated, nil
}

func (s *Service) ensureSourceStatus(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	u *ent.User,
	source string,
	sourceAccountID string,
) (*ent.RelationshipSourceStatus, error) {
	accountID := normalizedSourceAccountID(sourceAccountID)
	status, err := client.RelationshipSourceStatus.Query().Where(
		relationshipsourcestatus.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
		relationshipsourcestatus.SourceEQ(source),
		relationshipsourcestatus.SourceAccountIDEQ(accountID),
	).Only(ctx)
	if err == nil {
		return status, nil
	}
	if !ent.IsNotFound(err) {
		return nil, err
	}
	if accountID != "default" {
		pending, pendingErr := client.RelationshipSourceStatus.Query().Where(
			relationshipsourcestatus.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
			relationshipsourcestatus.SourceEQ(source),
			relationshipsourcestatus.SourceAccountIDEQ("default"),
			relationshipsourcestatus.StatusEQ("authorizing"),
		).Only(ctx)
		if pendingErr == nil {
			renamed, renameErr := pending.Update().SetSourceAccountID(accountID).Save(ctx)
			if renameErr == nil {
				return renamed, nil
			}
			// A racing completion may have already created the exact connection.
			// This service call is not inside a failed transaction, so reading the
			// winner is safe after a uniqueness conflict.
			if ent.IsConstraintError(renameErr) {
				winner, winnerErr := client.RelationshipSourceStatus.Query().Where(
					relationshipsourcestatus.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
					relationshipsourcestatus.SourceEQ(source),
					relationshipsourcestatus.SourceAccountIDEQ(accountID),
				).Only(ctx)
				if winnerErr == nil {
					return winner, nil
				}
			}
			return nil, renameErr
		}
		if !ent.IsNotFound(pendingErr) {
			return nil, pendingErr
		}
	}
	descriptor := sourceDescriptor(source)
	return client.RelationshipSourceStatus.Create().SetWorkspace(ws).SetUser(u).
		SetSource(source).SetSourceAccountID(accountID).SetStatus("not_connected").
		SetConsentingActorID(u.ID).
		SetBackfillPhase("idle").SetCompleteness("partial").
		SetExpectedCadenceSeconds(descriptor.ExpectedCadenceSec).
		// Only read scopes are required to establish the evidence stream. Action
		// scopes are requested progressively and evaluated for the exact action;
		// treating them as connection requirements would make least-privilege
		// consent look broken before the user enables any write capability.
		SetRequiredScopes(append([]string{}, descriptor.ReadScopes...)).
		Save(ctx)
}

func applySourceFreshness(status *ent.RelationshipSourceStatus, now time.Time) {
	if status.Status == "disconnected" || status.Status == "not_connected" || status.Status == "authorizing" || status.LastSuccessAt == nil {
		return
	}
	lag := now.Sub(status.LastSuccessAt.UTC())
	if lag < 0 {
		lag = 0
	}
	status.LagSeconds = int64(lag.Seconds())
	boundary := time.Duration(status.ExpectedCadenceSeconds*2) * time.Second
	if lag > boundary {
		status.Status = "stale"
		status.Completeness = "stale"
	}
}

func canonicalSource(source string) string {
	switch strings.ToLower(strings.TrimSpace(source)) {
	case "gmail", "calendar", "google":
		return "google"
	case "crm", "hubspot":
		return "hubspot"
	default:
		return strings.ToLower(strings.TrimSpace(source))
	}
}

func validateBetaSource(source string) error {
	if source != "google" && source != "slack" && source != "hubspot" {
		return fmt.Errorf("%w: unsupported beta source", ErrInvalidInput)
	}
	return nil
}

func normalizedSourceAccountID(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "default"
	}
	return value
}

func sourceDescriptor(source string) SourceDescriptor {
	for _, descriptor := range betaSourceDescriptors {
		if descriptor.Source == source {
			return descriptor
		}
	}
	return SourceDescriptor{Source: source, DisplayName: source, ExpectedCadenceSec: 900}
}

func safeSourceError(code string) string {
	return map[string]string{
		"missing_scope":        "Required provider permission is missing.",
		"invalid_grant":        "Provider authorization expired; reconnect is required.",
		"revoked_credential":   "Provider access was revoked; reconnect is required.",
		"rate_limited":         "Provider rate limit delayed synchronization.",
		"provider_outage":      "Provider is temporarily unavailable.",
		"provider_unavailable": "This provider is not configured on the synchronization worker.",
		"cursor_lost":          "The provider cursor was lost; a rebuild is required.",
	}[code]
}

func sortedUniqueStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}

func differenceStrings(required, granted []string) []string {
	set := make(map[string]bool, len(granted))
	for _, value := range granted {
		set[strings.TrimSpace(value)] = true
	}
	missing := make([]string, 0)
	for _, value := range required {
		if value = strings.TrimSpace(value); value != "" && !set[value] {
			missing = append(missing, value)
		}
	}
	return sortedUniqueStrings(missing)
}
