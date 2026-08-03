package revenue

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"sort"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipattentionitem"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipidentitycandidate"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipprojectionjob"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueaction"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenuetrustevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
)

const betaDiagnosticsSchemaVersion = "tfa-support-v1"

// BetaDiagnosticFeature is a content-free capability and rollout snapshot.
type BetaDiagnosticFeature struct {
	Capability   string `json:"capability"`
	Enabled      bool   `json:"enabled"`
	RolloutStage string `json:"rolloutStage"`
	ReasonCode   string `json:"reasonCode,omitempty"`
}

// BetaDiagnosticSource is redacted connector lifecycle metadata suitable for
// support export without revealing provider account identifiers.
type BetaDiagnosticSource struct {
	ConnectionRef       string     `json:"connectionRef"`
	Source              string     `json:"source"`
	SourceAccountRef    string     `json:"sourceAccountRef"`
	Status              string     `json:"status"`
	Completeness        string     `json:"completeness"`
	BackfillPhase       string     `json:"backfillPhase"`
	BackfillCompleted   int        `json:"backfillCompleted"`
	BackfillTotal       int        `json:"backfillTotal"`
	LagSeconds          int64      `json:"lagSeconds"`
	MissingScopeCount   int        `json:"missingScopeCount"`
	ErrorCode           string     `json:"errorCode,omitempty"`
	RetryCount          int        `json:"retryCount"`
	LastSuccessAt       *time.Time `json:"lastSuccessAt,omitempty"`
	LastObservationAt   *time.Time `json:"lastObservationAt,omitempty"`
	LastFailedSyncAt    *time.Time `json:"lastFailedSyncAt,omitempty"`
	AuthorizationAt     *time.Time `json:"authorizationAt,omitempty"`
	AuthorizationStart  *time.Time `json:"authorizationStartedAt,omitempty"`
	BackfillCompletedAt *time.Time `json:"backfillCompletedAt,omitempty"`
}

// BetaDiagnosticTrustCount aggregates a bounded trust event and outcome.
type BetaDiagnosticTrustCount struct {
	EventName string `json:"eventName"`
	Outcome   string `json:"outcome"`
	Count     int    `json:"count"`
}

// BetaDiagnosticCheck is one categorical release-readiness diagnostic.
type BetaDiagnosticCheck struct {
	Code        string `json:"code"`
	Status      string `json:"status"`
	Explanation string `json:"explanation"`
	Count       int    `json:"count"`
}

// BetaDiagnostics is intentionally metadata-only. It contains no relationship
// names, emails, evidence text, action bodies, provider tokens, cursors, raw
// errors, or trust-event correlation identifiers, so support can use it without
// opening customer content or database access.
type BetaDiagnostics struct {
	SchemaVersion string                     `json:"schemaVersion"`
	GeneratedAt   time.Time                  `json:"generatedAt"`
	WorkspaceRef  string                     `json:"workspaceRef"`
	Features      []BetaDiagnosticFeature    `json:"features"`
	Sources       []BetaDiagnosticSource     `json:"sources"`
	Counts        map[string]int             `json:"counts"`
	TrustFunnel   []BetaDiagnosticTrustCount `json:"trustFunnel"`
	Checks        []BetaDiagnosticCheck      `json:"checks"`
}

func diagnosticWorkspaceRef(id string) string {
	return diagnosticRef("workspace", id)
}

func diagnosticRef(kind, id string) string {
	digest := sha256.Sum256([]byte("tfa-" + kind + ":" + id))
	return kind + ":sha256:" + hex.EncodeToString(digest[:12])
}

func diagnosticCheck(code string, count int, pass, fail string) BetaDiagnosticCheck {
	if count == 0 {
		return BetaDiagnosticCheck{Code: code, Status: "pass", Explanation: pass, Count: 0}
	}
	return BetaDiagnosticCheck{Code: code, Status: "attention", Explanation: fail, Count: count}
}

// BetaDiagnostics builds a tenant-scoped, content-free support bundle.
func (s *Service) BetaDiagnostics(ctx context.Context, u *ent.User) (*BetaDiagnostics, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceManageSources)
	if err != nil {
		return nil, err
	}
	controls, err := s.WorkspaceFeatureControls(ctx, u)
	if err != nil {
		return nil, err
	}
	statuses, err := s.RelationshipSourceStatuses(ctx, u)
	if err != nil {
		return nil, err
	}

	features := make([]BetaDiagnosticFeature, 0, len(controls))
	controlByCapability := make(map[string]*ent.WorkspaceFeatureControl, len(controls))
	for _, control := range controls {
		controlByCapability[control.Capability] = control
		features = append(features, BetaDiagnosticFeature{
			Capability: control.Capability, Enabled: control.Enabled,
			RolloutStage: control.RolloutStage, ReasonCode: control.ReasonCode,
		})
	}
	sources := make([]BetaDiagnosticSource, 0, len(statuses))
	for _, status := range statuses {
		sources = append(sources, BetaDiagnosticSource{
			ConnectionRef: diagnosticRef("connection", status.ID.String()), Source: canonicalSource(status.Source),
			SourceAccountRef: diagnosticRef("source-account", canonicalSource(status.Source)+":"+status.SourceAccountID), Status: status.Status,
			Completeness: status.Completeness, BackfillPhase: status.BackfillPhase,
			BackfillCompleted: status.BackfillCompleted, BackfillTotal: status.BackfillTotal,
			LagSeconds: status.LagSeconds, MissingScopeCount: len(status.MissingScopes),
			ErrorCode: status.ErrorCode, RetryCount: status.RetryCount,
			LastSuccessAt: status.LastSuccessAt, LastObservationAt: status.LastObservationAt,
			LastFailedSyncAt: status.LastFailedSyncAt, AuthorizationAt: status.AuthorizedAt,
			AuthorizationStart:  status.AuthorizationStartedAt,
			BackfillCompletedAt: status.BackfillCompletedAt,
		})
	}

	workspace := revenueworkspace.IDEQ(ws.ID)
	counts := map[string]int{}
	queries := []struct {
		key string
		run func() (int, error)
	}{
		{"relationships", func() (int, error) {
			return s.client.Relationship.Query().Where(relationship.HasWorkspaceWith(workspace), relationship.StatusNEQ("archived")).Count(ctx)
		}},
		{"identityReview", func() (int, error) {
			return s.client.RelationshipIdentityCandidate.Query().Where(relationshipidentitycandidate.HasWorkspaceWith(workspace), relationshipidentitycandidate.StatusIn(identityPending, identityDeferred, identityResolving)).Count(ctx)
		}},
		{"projectionPending", func() (int, error) {
			return s.client.RelationshipProjectionJob.Query().Where(relationshipprojectionjob.HasWorkspaceWith(workspace), relationshipprojectionjob.StatusIn("pending", "running", "failed")).Count(ctx)
		}},
		{"projectionDead", func() (int, error) {
			return s.client.RelationshipProjectionJob.Query().Where(relationshipprojectionjob.HasWorkspaceWith(workspace), relationshipprojectionjob.StatusEQ("dead")).Count(ctx)
		}},
		{"attentionOpen", func() (int, error) {
			return s.client.RelationshipAttentionItem.Query().Where(relationshipattentionitem.HasWorkspaceWith(workspace), relationshipattentionitem.StatusEQ("open")).Count(ctx)
		}},
		{"approvalPending", func() (int, error) {
			return s.client.RevenueAction.Query().Where(revenueaction.HasWorkspaceWith(workspace), revenueaction.ApprovalStatusEQ(ApprovalPending)).Count(ctx)
		}},
		{"executionUncertain", func() (int, error) {
			return s.client.RevenueAction.Query().Where(revenueaction.HasWorkspaceWith(workspace), revenueaction.Or(revenueaction.ExecutionStatusEQ(ExecAmbiguous), revenueaction.ReconciliationStatusEQ("manual_review"))).Count(ctx)
		}},
	}
	for _, query := range queries {
		count, queryErr := query.run()
		if queryErr != nil {
			return nil, queryErr
		}
		counts[query.key] = count
	}

	var grouped []struct {
		EventName string `json:"event_name"`
		Outcome   string `json:"outcome"`
		Count     int    `json:"count"`
	}
	if err := s.client.RevenueTrustEvent.Query().Where(
		revenuetrustevent.HasWorkspaceWith(workspace),
	).GroupBy(
		revenuetrustevent.FieldEventName, revenuetrustevent.FieldOutcome,
	).Aggregate(ent.Count()).Scan(ctx, &grouped); err != nil {
		return nil, err
	}
	trust := make([]BetaDiagnosticTrustCount, 0, len(grouped))
	for _, row := range grouped {
		trust = append(trust, BetaDiagnosticTrustCount(row))
	}
	sort.Slice(trust, func(i, j int) bool {
		if trust[i].EventName != trust[j].EventName {
			return trust[i].EventName < trust[j].EventName
		}
		return trust[i].Outcome < trust[j].Outcome
	})

	degraded := 0
	for _, source := range sources {
		if source.Status != "live" || source.Completeness != "complete" || source.MissingScopeCount > 0 {
			degraded++
		}
	}
	checks := []BetaDiagnosticCheck{
		diagnosticCheck("source_health", degraded, "All source connections are live and complete.", "One or more source connections require repair or backfill."),
		diagnosticCheck("identity_review", counts["identityReview"], "No identity ambiguity is awaiting review.", "Identity candidates are awaiting review."),
		diagnosticCheck("projection_dead_letter", counts["projectionDead"], "No relationship projection is dead-lettered.", "Relationship projections require operator repair."),
		diagnosticCheck("execution_uncertainty", counts["executionUncertain"], "No external action awaits uncertainty review.", "External actions require read-only reconciliation or manual review."),
	}
	governedActionEnabled := false
	for _, capability := range []string{CapabilityActionGmail, CapabilityActionSlack, CapabilityActionHubSpot} {
		control := controlByCapability[capability]
		if control != nil && control.Enabled && (control.RolloutStage == "design_partner_governed_action" || control.RolloutStage == "beta") {
			governedActionEnabled = true
		}
	}
	releaseApproval := controlByCapability[CapabilityReleaseApproval]
	releaseApprovalMissing := 0
	if governedActionEnabled && (releaseApproval == nil || !releaseApproval.Enabled || releaseApproval.ReasonCode != "release_owner_signoff") {
		releaseApprovalMissing = 1
	}
	checks = append(checks, diagnosticCheck(
		"release_owner_signoff", releaseApprovalMissing,
		"Governed design-partner execution is either disabled or explicitly signed off.",
		"Governed design-partner execution is configured without release-owner signoff.",
	))
	return &BetaDiagnostics{
		SchemaVersion: betaDiagnosticsSchemaVersion, GeneratedAt: s.now().UTC(),
		WorkspaceRef: diagnosticWorkspaceRef(ws.ID.String()), Features: features,
		Sources: sources, Counts: counts, TrustFunnel: trust, Checks: checks,
	}, nil
}
