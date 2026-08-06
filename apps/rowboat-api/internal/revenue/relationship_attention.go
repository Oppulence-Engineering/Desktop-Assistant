package revenue

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/person"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipattentionitem"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipparticipant"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipsourcestatus"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/revenuemetrics"
)

const relationshipAttentionDetectorVersion = 1

type attentionCandidate struct {
	Relationship           *ent.Relationship
	ReasonCode             string
	Explanation            string
	TriggeringObjectRef    string
	EvidenceRefs           []string
	UrgencyBand            string
	RankScore              int
	RankFactors            map[string]int
	SourceRequirements     []string
	RecommendationID       *uuid.UUID
	RecommendationRevision int
	OwnerID                *uuid.UUID
	ExpiresAt              *time.Time
}

// AttentionDecisionInput is a version-bound human acknowledgement, snooze, or
// dismissal of a durable attention item.
type AttentionDecisionInput struct {
	Decision        string
	Reason          string
	ExpectedVersion int
	SnoozedUntil    *time.Time
}

func attentionStableKey(candidate attentionCandidate) string {
	return strings.Join([]string{
		candidate.Relationship.ID.String(), candidate.ReasonCode, candidate.TriggeringObjectRef,
	}, ":")
}

func attentionMaterialHash(candidate attentionCandidate) (string, error) {
	payload := struct {
		ReasonCode             string         `json:"reasonCode"`
		Explanation            string         `json:"explanation"`
		TriggeringObjectRef    string         `json:"triggeringObjectRef"`
		EvidenceRefs           []string       `json:"evidenceRefs"`
		RankFactors            map[string]int `json:"rankFactors"`
		SourceRequirements     []string       `json:"sourceRequirements"`
		RecommendationRevision int            `json:"recommendationRevision"`
		RelationshipState      int            `json:"relationshipState"`
	}{
		ReasonCode: candidate.ReasonCode, Explanation: candidate.Explanation,
		TriggeringObjectRef:    candidate.TriggeringObjectRef,
		EvidenceRefs:           normalizeProjectionTriggerRefs(candidate.EvidenceRefs),
		RankFactors:            candidate.RankFactors,
		SourceRequirements:     normalizeProjectionTriggerRefs(candidate.SourceRequirements),
		RecommendationRevision: candidate.RecommendationRevision,
		RelationshipState:      candidate.Relationship.StateVersion,
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(raw)
	return "sha256:" + hex.EncodeToString(digest[:]), nil
}

func urgencyBand(score int) string {
	switch {
	case score >= 90:
		return "critical"
	case score >= 70:
		return "high"
	case score >= 40:
		return "normal"
	default:
		return "low"
	}
}

func lifecycleQuietCooldown(lifecycle string) time.Duration {
	switch lifecycle {
	case "contracting", "renewal":
		return 7 * 24 * time.Hour
	case "evaluation", "onboarding":
		return 14 * 24 * time.Hour
	case "active_customer":
		return 21 * 24 * time.Hour
	case "prospect":
		return 30 * 24 * time.Hour
	case "former_customer":
		return 60 * 24 * time.Hour
	default:
		return 0
	}
}

func (s *Service) attentionCapabilityEnabled(ctx context.Context, ws *ent.RevenueWorkspace, capability string) (bool, error) {
	err := s.requireWorkspaceFeature(ctx, ws, capability)
	if err == nil {
		return true, nil
	}
	if errors.Is(err, ErrCapabilityDisabled) {
		return false, nil
	}
	return false, err
}

// RefreshRelationshipAttention deterministically projects high-precision
// account conditions into durable triage items. A material input change
// reopens a dismissed or snoozed item; an identical refresh preserves the
// user's decision.
func (s *Service) RefreshRelationshipAttention(ctx context.Context, u *ent.User) error {
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceContribute)
	if err != nil {
		return err
	}
	now := s.now().UTC()
	relationships, err := s.client.Relationship.Query().
		Where(relationship.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)), relationship.StatusNEQ("archived")).
		WithObservations().
		WithCommitments(func(q *ent.CommitmentQuery) { q.WithEvidences() }).
		WithActions(func(q *ent.RevenueActionQuery) { q.WithEvidences().WithOutcomes() }).
		All(ctx)
	if err != nil {
		return err
	}
	statuses, err := s.client.RelationshipSourceStatus.Query().
		Where(relationshipsourcestatus.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID))).All(ctx)
	if err != nil {
		return err
	}
	degradedSources := make([]string, 0)
	for _, status := range statuses {
		applySourceFreshness(status, now)
		if status.Status != "live" || status.Completeness != "complete" || len(status.MissingScopes) > 0 {
			degradedSources = append(degradedSources, canonicalSource(status.Source))
		}
	}
	degradedSources = normalizeProjectionTriggerRefs(degradedSources)

	capabilities := map[string]bool{}
	for capability, reason := range map[string]string{
		CapabilityDetectorQuiet: "quiet_account", CapabilityDetectorOverdue: "overdue_commitment",
		CapabilityDetectorRisk: "unresolved_risk", CapabilityDetectorNextStep: "missing_next_step",
		CapabilityDetectorSource: "source_degradation", CapabilityDetectorOutcome: "action_outcome_review",
		// The trigger detector has no local detector capability of its own: it
		// cannot fire without cloud research, so the research kill switch is the
		// only switch it needs. One switch, not two that can disagree.
		CapabilityCloudResearch: "external_trigger",
	} {
		enabled, capabilityErr := s.attentionCapabilityEnabled(ctx, ws, capability)
		if capabilityErr != nil {
			return capabilityErr
		}
		capabilities[reason] = enabled
	}

	// Which relationships have lost their contact. One query for the workspace
	// rather than a join per relationship: departures are rare and the set is small.
	departedContacts, err := s.departedContactsByRelationship(ctx, ws)
	if err != nil {
		return err
	}

	// Cited external events, one per account. Empty for every workspace that
	// has not enabled research, which is why the detector below costs a map
	// lookup rather than a query.
	triggers := map[uuid.UUID]*ent.RelationshipAssertion{}
	triggerContacts := map[uuid.UUID][]string{}
	if capabilities["external_trigger"] {
		triggers, err = s.activeAccountTriggers(ctx, ws, now)
		if err != nil {
			return err
		}
		triggerContacts, err = s.contactNamesForRelationships(ctx, triggers)
		if err != nil {
			return err
		}
	}

	candidates := make([]attentionCandidate, 0)
	for _, rel := range relationships {
		dependencies := relationshipSourceDependencies(rel)
		degradedDependencies := intersectStrings(degradedSources, dependencies)
		if capabilities["quiet_account"] && rel.LastTouchAt != nil && len(degradedDependencies) == 0 {
			cooldown := lifecycleQuietCooldown(rel.Lifecycle)
			age := now.Sub(rel.LastTouchAt.UTC())
			if cooldown > 0 && age >= cooldown {
				days := int(age.Hours() / 24)
				score := min(88, 45+days/2)
				reasonCode := "quiet_account"
				explanation := fmt.Sprintf("No recorded interaction for %d days; the %s lifecycle cooldown is %d days.", days, strings.ReplaceAll(rel.Lifecycle, "_", " "), int(cooldown.Hours()/24))
				// A departed contact explains the silence, and changes what the
				// user should do about it. "Follow up" is the wrong instruction
				// when there is nobody left to follow up with, and repeating it
				// every cooldown is how a product teaches people to ignore it.
				if departed := departedContacts[rel.ID]; len(departed) > 0 {
					reasonCode = "contact_departed"
					explanation = fmt.Sprintf(
						"%s has left; mail to that address is no longer delivered. Quiet for %d days because there is nobody here to reply.",
						strings.Join(departed, " and "), days,
					)
					// Higher than a quiet account of the same age: an account with
					// no reachable contact is a real gap, not a nudge, and unlike
					// silence it will not resolve on its own.
					score = min(92, 70+days/4)
				}
				candidates = append(candidates, attentionCandidate{
					Relationship: rel, ReasonCode: reasonCode,
					Explanation:         explanation,
					TriggeringObjectRef: "relationship:" + rel.ID.String(), RankScore: score, UrgencyBand: urgencyBand(score),
					RankFactors:        map[string]int{"inactivity_days": min(days, 60), "lifecycle_urgency": score - min(days, 60)},
					SourceRequirements: dependencies,
				})
			}
		}
		// The queue's only forward-looking reason: something happened out there,
		// here is the evidence, and here is who you know. Everything else in this
		// loop is derived from the user's own history.
		if trigger := triggers[rel.ID]; trigger != nil {
			contacts := triggerContacts[rel.ID]
			candidates = append(candidates, attentionCandidate{
				Relationship: rel, ReasonCode: "external_trigger",
				Explanation:         triggerExplanation(trigger.Value, strings.Join(contacts, " and ")),
				TriggeringObjectRef: "relationship-assertion:" + trigger.ID.String(),
				EvidenceRefs:        []string{"relationship-assertion:" + trigger.ID.String()},
				RankScore:           triggerRankScore, UrgencyBand: urgencyBand(triggerRankScore),
				RankFactors: map[string]int{"external_event": triggerRankScore, "cited_evidence": 1},
				// The reason expires with the event: a Series B stops being a
				// reason to write today about six weeks after it was announced.
				ExpiresAt: trigger.ValidTo,
			})
		}
		if capabilities["overdue_commitment"] {
			for _, promised := range rel.Edges.Commitments {
				if promised.Status != "open" || promised.DueAt == nil || promised.DueAt.After(now) || (!promised.UserConfirmed && promised.Acceptance == "candidate") {
					continue
				}
				days := max(1, int(now.Sub(promised.DueAt.UTC()).Hours()/24))
				score := min(100, 70+days*3)
				evidenceRefs := make([]string, 0, len(promised.Edges.Evidences))
				for _, evidence := range promised.Edges.Evidences {
					evidenceRefs = append(evidenceRefs, "revenue-evidence:"+evidence.ID.String())
				}
				candidates = append(candidates, attentionCandidate{
					Relationship: rel, ReasonCode: "overdue_commitment",
					Explanation:         fmt.Sprintf("A confirmed commitment is overdue by %d day%s.", days, map[bool]string{true: "", false: "s"}[days == 1]),
					TriggeringObjectRef: "commitment:" + promised.ID.String(), EvidenceRefs: evidenceRefs,
					RankScore: score, UrgencyBand: urgencyBand(score),
					RankFactors:        map[string]int{"overdue_days": min(days*3, 30), "confirmed_commitment": 70},
					SourceRequirements: dependencies,
				})
			}
		}
		if capabilities["unresolved_risk"] && (rel.Health == "critical" || rel.Health == "needs_attention") && len(rel.Risks) > 0 {
			score := 78
			if rel.Health == "critical" {
				score = 95
			}
			candidates = append(candidates, attentionCandidate{
				Relationship: rel, ReasonCode: "unresolved_risk",
				Explanation:         fmt.Sprintf("%d unresolved risk signal%s keep this relationship at %s health.", len(rel.Risks), map[bool]string{true: "", false: "s"}[len(rel.Risks) == 1], strings.ReplaceAll(rel.Health, "_", " ")),
				TriggeringObjectRef: "relationship-state:" + rel.ID.String(), RankScore: score, UrgencyBand: urgencyBand(score),
				RankFactors: map[string]int{"health_severity": score - min(20, len(rel.Risks)*5), "risk_count": min(20, len(rel.Risks)*5)},
			})
		}
		if capabilities["missing_next_step"] && strings.TrimSpace(rel.NextAction) == "" &&
			(rel.Lifecycle == "evaluation" || rel.Lifecycle == "contracting" || rel.Lifecycle == "onboarding" || rel.Lifecycle == "renewal") && len(degradedDependencies) == 0 {
			score := 68
			if rel.Lifecycle == "contracting" || rel.Lifecycle == "renewal" {
				score = 80
			}
			candidates = append(candidates, attentionCandidate{
				Relationship: rel, ReasonCode: "missing_next_step",
				Explanation:         fmt.Sprintf("The relationship is in %s with no evidence-backed next step.", strings.ReplaceAll(rel.Lifecycle, "_", " ")),
				TriggeringObjectRef: "relationship-state:" + rel.ID.String(), RankScore: score, UrgencyBand: urgencyBand(score),
				RankFactors: map[string]int{"lifecycle_urgency": score, "source_uncertainty": 0}, SourceRequirements: dependencies,
			})
		}
		if capabilities["source_degradation"] && len(degradedDependencies) > 0 {
			affected := degradedDependencies
			score := min(82, 55+len(affected)*9)
			candidates = append(candidates, attentionCandidate{
				Relationship: rel, ReasonCode: "source_degradation",
				Explanation:         fmt.Sprintf("%s evidence is incomplete, stale, rebuilding, or missing required permission.", strings.Join(affected, ", ")),
				TriggeringObjectRef: "source-status:" + strings.Join(affected, "+"), RankScore: score, UrgencyBand: urgencyBand(score),
				RankFactors: map[string]int{"degraded_sources": len(affected) * 10, "state_uncertainty": 45}, SourceRequirements: affected,
			})
		}
		for _, action := range rel.Edges.Actions {
			evidenceRefs := make([]string, 0, len(action.Edges.Evidences))
			for _, evidence := range action.Edges.Evidences {
				evidenceRefs = append(evidenceRefs, "revenue-evidence:"+evidence.ID.String())
			}
			if capabilities["action_outcome_review"] && (action.ExecutionStatus == ExecAmbiguous || action.ExecutionStatus == ExecFailed || action.ReconciliationStatus == "manual_review") {
				score := 94
				if action.ExecutionStatus == ExecFailed {
					score = 86
				}
				candidates = append(candidates, attentionCandidate{
					Relationship: rel, ReasonCode: "action_outcome_review",
					Explanation:         fmt.Sprintf("The %s action has a %s provider result and needs review before any retry.", strings.ReplaceAll(action.Channel, "_", " "), strings.ReplaceAll(action.ExecutionStatus, "_", " ")),
					TriggeringObjectRef: "revenue-action:" + action.ID.String(), EvidenceRefs: evidenceRefs,
					RankScore: score, UrgencyBand: urgencyBand(score), RankFactors: map[string]int{"provider_uncertainty": score},
					RecommendationID: &action.ID, RecommendationRevision: action.Revision, OwnerID: action.AssignedUserID,
				})
				continue
			}
			if action.QueueStatus != QueueOpen || action.ExecutionStatus == ExecSent || action.ExecutionStatus == ExecCancelled {
				continue
			}
			factors := map[string]int{}
			_ = json.Unmarshal([]byte(action.PriorityComponentsJSON), &factors)
			candidates = append(candidates, attentionCandidate{
				Relationship: rel, ReasonCode: "recommendation", Explanation: action.Reason,
				TriggeringObjectRef: "revenue-action:" + action.ID.String(), EvidenceRefs: evidenceRefs,
				RankScore: action.PriorityScore, UrgencyBand: urgencyBand(action.PriorityScore), RankFactors: factors,
				RecommendationID: &action.ID, RecommendationRevision: action.Revision,
				OwnerID: action.AssignedUserID, ExpiresAt: action.DueAt,
			})
		}
	}
	sortAttentionCandidates(candidates)
	return s.persistAttentionCandidates(ctx, ws, u, now, candidates)
}

// departedContactsByRelationship maps each relationship to the display names of its
// participants whose mail no longer reaches them.
//
// Reads the projected `employment_status` rather than the attribute table so this
// stays one indexed query, and so a user correction that says the person is still
// there has already won on the ladder before it is seen here.
func (s *Service) departedContactsByRelationship(
	ctx context.Context,
	ws *ent.RevenueWorkspace,
) (map[uuid.UUID][]string, error) {
	people, err := s.client.Person.Query().
		Where(
			person.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
			person.EmploymentStatusEQ("departed"),
			person.StatusEQ("active"),
		).All(ctx)
	if err != nil {
		return nil, err
	}
	if len(people) == 0 {
		return map[uuid.UUID][]string{}, nil
	}
	byPerson := make(map[uuid.UUID]string, len(people))
	ids := make([]uuid.UUID, 0, len(people))
	for _, p := range people {
		byPerson[p.ID] = p.DisplayName
		ids = append(ids, p.ID)
	}
	participants, err := s.client.RelationshipParticipant.Query().
		Where(relationshipparticipant.HasPersonWith(person.IDIn(ids...))).
		WithPerson().WithRelationship().All(ctx)
	if err != nil {
		return nil, err
	}
	out := map[uuid.UUID][]string{}
	for _, participant := range participants {
		if participant.Edges.Relationship == nil || participant.Edges.Person == nil {
			continue
		}
		name := byPerson[participant.Edges.Person.ID]
		if name == "" {
			continue
		}
		relID := participant.Edges.Relationship.ID
		if slicesContains(out[relID], name) {
			continue
		}
		out[relID] = append(out[relID], name)
	}
	for _, names := range out {
		sort.Strings(names)
	}
	return out, nil
}

func relationshipSourceDependencies(rel *ent.Relationship) []string {
	out := make([]string, 0)
	for _, ref := range rel.ResourceRefs {
		lower := strings.ToLower(ref)
		for _, source := range []string{"google", "gmail", "calendar", "slack", "hubspot", "crm"} {
			if strings.HasPrefix(lower, source+":") || strings.Contains(lower, "/"+source+"/") {
				out = append(out, canonicalSource(source))
			}
		}
	}
	for _, observation := range rel.Edges.Observations {
		source := canonicalSource(observation.Source)
		if source == "google" || source == "slack" || source == "hubspot" {
			out = append(out, source)
		}
	}
	return normalizeProjectionTriggerRefs(out)
}

func intersectStrings(left, right []string) []string {
	set := make(map[string]bool, len(right))
	for _, value := range right {
		set[value] = true
	}
	out := make([]string, 0)
	for _, value := range left {
		if set[value] {
			out = append(out, value)
		}
	}
	return normalizeProjectionTriggerRefs(out)
}

func (s *Service) persistAttentionCandidates(ctx context.Context, ws *ent.RevenueWorkspace, u *ent.User, now time.Time, candidates []attentionCandidate) error {
	active := make(map[string]bool, len(candidates))
	for _, candidate := range candidates {
		stableKey := attentionStableKey(candidate)
		active[stableKey] = true
		rawFactors, err := json.Marshal(candidate.RankFactors)
		if err != nil {
			return err
		}
		materialHash, err := attentionMaterialHash(candidate)
		if err != nil {
			return err
		}
		item, err := s.client.RelationshipAttentionItem.Query().Where(
			relationshipattentionitem.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
			relationshipattentionitem.StableKeyEQ(stableKey),
		).Only(ctx)
		if ent.IsNotFound(err) {
			create := s.client.RelationshipAttentionItem.Create().SetWorkspace(ws).SetRelationship(candidate.Relationship).SetUser(u).
				SetStableKey(stableKey).SetReasonCode(candidate.ReasonCode).SetExplanation(candidate.Explanation).
				SetTriggeringObjectRef(candidate.TriggeringObjectRef).SetEvidenceRefs(normalizeProjectionTriggerRefs(candidate.EvidenceRefs)).
				SetUrgencyBand(candidate.UrgencyBand).SetRankScore(candidate.RankScore).SetRankFactorsJSON(string(rawFactors)).
				SetSourceRequirements(normalizeProjectionTriggerRefs(candidate.SourceRequirements)).
				SetDetectorVersion(relationshipAttentionDetectorVersion).SetProjectorVersion(relationshipProjectorVersion).
				SetRelationshipStateVersion(candidate.Relationship.StateVersion).SetMaterialHash(materialHash).SetLastDetectedAt(now).
				SetNillableRecommendationID(candidate.RecommendationID).SetRecommendationRevision(candidate.RecommendationRevision).
				SetNillableOwnerID(candidate.OwnerID).SetNillableExpiresAt(candidate.ExpiresAt)
			if _, err = create.Save(ctx); err != nil && !ent.IsConstraintError(err) {
				return err
			}
			continue
		}
		if err != nil {
			return err
		}
		update := item.Update().SetLastDetectedAt(now).SetExplanation(candidate.Explanation).
			SetEvidenceRefs(normalizeProjectionTriggerRefs(candidate.EvidenceRefs)).SetRankScore(candidate.RankScore).
			SetUrgencyBand(candidate.UrgencyBand).SetRankFactorsJSON(string(rawFactors)).
			SetSourceRequirements(normalizeProjectionTriggerRefs(candidate.SourceRequirements)).
			SetNillableRecommendationID(candidate.RecommendationID).SetRecommendationRevision(candidate.RecommendationRevision).
			SetNillableOwnerID(candidate.OwnerID).SetNillableExpiresAt(candidate.ExpiresAt)
		if item.MaterialHash != materialHash {
			update.SetVersion(item.Version + 1).SetMaterialHash(materialHash).
				SetRelationshipStateVersion(candidate.Relationship.StateVersion).SetStatus("open").ClearStateReason().
				ClearSnoozedUntil().ClearAcknowledgedBy().ClearAcknowledgedAt().ClearDismissedBy().ClearDismissedAt()
		} else if item.Status == "snoozed" && item.SnoozedUntil != nil && !item.SnoozedUntil.After(now) {
			update.SetStatus("open").ClearSnoozedUntil().ClearStateReason()
		}
		if _, err = update.Save(ctx); err != nil {
			return err
		}
	}
	existing, err := s.client.RelationshipAttentionItem.Query().Where(
		relationshipattentionitem.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
		relationshipattentionitem.StatusIn("open", "acknowledged", "snoozed"),
	).All(ctx)
	if err != nil {
		return err
	}
	for _, item := range existing {
		if !active[item.StableKey] {
			if _, err := item.Update().SetStatus("resolved").SetStateReason("Detector condition no longer present.").Save(ctx); err != nil {
				return err
			}
		}
	}
	return nil
}

// ListRelationshipAttention returns the current tenant-scoped portfolio queue
// in deterministic priority order.
func (s *Service) ListRelationshipAttention(ctx context.Context, u *ent.User, status string, limit int) ([]*ent.RelationshipAttentionItem, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceView)
	if err != nil {
		return nil, err
	}
	// Contributors refresh on demand in addition to event-driven refreshes;
	// viewers still receive the last durable projection.
	_ = s.RefreshRelationshipAttention(ctx, u)
	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}
	q := s.client.RelationshipAttentionItem.Query().Where(
		relationshipattentionitem.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
	).WithRelationship()
	if status == "" {
		status = "open"
	}
	if status != "all" {
		q.Where(relationshipattentionitem.StatusEQ(status))
	}
	return q.Order(ent.Desc(relationshipattentionitem.FieldRankScore), ent.Asc(relationshipattentionitem.FieldCreatedAt)).Limit(limit).All(ctx)
}

// DecideRelationshipAttention applies an optimistic, actor-attributed queue
// decision without changing any governed action state.
func (s *Service) DecideRelationshipAttention(ctx context.Context, u *ent.User, id uuid.UUID, input AttentionDecisionInput) (*ent.RelationshipAttentionItem, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceContribute)
	if err != nil {
		return nil, err
	}
	input.Decision = strings.ToLower(strings.TrimSpace(input.Decision))
	if input.ExpectedVersion <= 0 {
		return nil, fmt.Errorf("%w: expectedVersion is required", ErrInvalidInput)
	}
	now := s.now().UTC()
	update := s.client.RelationshipAttentionItem.Update().Where(
		relationshipattentionitem.IDEQ(id), relationshipattentionitem.VersionEQ(input.ExpectedVersion),
		relationshipattentionitem.StatusIn("open", "acknowledged", "snoozed"),
	).SetVersion(input.ExpectedVersion + 1).SetStateReason(strings.TrimSpace(input.Reason))
	switch input.Decision {
	case "acknowledge":
		update.SetStatus("acknowledged").SetAcknowledgedBy(u.ID).SetAcknowledgedAt(now).ClearSnoozedUntil()
	case "snooze":
		if input.SnoozedUntil == nil || !input.SnoozedUntil.After(now) || input.SnoozedUntil.After(now.Add(maxSnooze)) {
			return nil, fmt.Errorf("%w: snooze must be in the future and within %s", ErrInvalidInput, maxSnooze)
		}
		update.SetStatus("snoozed").SetSnoozedUntil(input.SnoozedUntil.UTC())
	case "dismiss":
		if strings.TrimSpace(input.Reason) == "" {
			return nil, fmt.Errorf("%w: dismissal reason is required", ErrInvalidInput)
		}
		update.SetStatus("dismissed").SetDismissedBy(u.ID).SetDismissedAt(now).ClearSnoozedUntil()
	default:
		return nil, fmt.Errorf("%w: unsupported attention decision", ErrInvalidInput)
	}
	count, err := update.Save(ctx)
	if err != nil {
		return nil, err
	}
	if count != 1 {
		return nil, ErrConflict
	}
	item, err := s.client.RelationshipAttentionItem.Query().Where(relationshipattentionitem.IDEQ(id)).WithRelationship().Only(ctx)
	if err != nil {
		return nil, err
	}
	_ = appendTrustEvent(ctx, s.client, ws, u, TrustEventInput{
		Name: "attention_item_decided", Outcome: "accepted", ReasonCode: input.Decision,
		CorrelationID: "attention:" + item.ID.String(), OccurredAt: now,
		Relationship: item.Edges.Relationship,
	})
	return item, nil
}

func sortAttentionCandidates(candidates []attentionCandidate) {
	sort.SliceStable(candidates, func(i, j int) bool {
		if candidates[i].RankScore == candidates[j].RankScore {
			return attentionStableKey(candidates[i]) < attentionStableKey(candidates[j])
		}
		return candidates[i].RankScore > candidates[j].RankScore
	})
}

// RelationshipAttentionRunner provides the time-driven half of the attention
// projection. Event-driven refreshes keep interactive changes current; this sweep
// catches quiet-account and overdue boundaries that become true without a new event.
type RelationshipAttentionRunner struct {
	svc      *Service
	interval time.Duration
	maxUsers int
	log      *zap.Logger
}

// NewRelationshipAttentionRunner constructs the bounded time-driven detector.
func NewRelationshipAttentionRunner(svc *Service, interval time.Duration, maxUsers int, log *zap.Logger) *RelationshipAttentionRunner {
	if interval <= 0 {
		interval = 24 * time.Hour
	}
	if maxUsers <= 0 || maxUsers > 1000 {
		maxUsers = 200
	}
	if log == nil {
		log = zap.NewNop()
	}
	return &RelationshipAttentionRunner{svc: svc, interval: interval, maxUsers: maxUsers, log: log}
}

// Run refreshes time-dependent attention signals until the context is canceled.
func (r *RelationshipAttentionRunner) Run(ctx context.Context) error {
	r.sweep(ctx)
	ticker := time.NewTicker(r.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			r.sweep(ctx)
		}
	}
}

func (r *RelationshipAttentionRunner) sweep(ctx context.Context) {
	startedAt := time.Now()
	result := "success"
	processed := 0
	defer func() {
		revenuemetrics.RelationshipLoopSweeps.WithLabelValues("attention", result).Inc()
		revenuemetrics.RelationshipLoopDuration.WithLabelValues("attention").Observe(time.Since(startedAt).Seconds())
		revenuemetrics.RelationshipLoopItems.WithLabelValues("attention", "workspace").Add(float64(processed))
		if result == "success" {
			revenuemetrics.RelationshipLoopLastSuccess.WithLabelValues("attention").SetToCurrentTime()
		}
	}()
	internal := auth.WithInternalOnly(ctx)
	var afterID *uuid.UUID
	for {
		query := r.svc.client.RevenueWorkspace.Query().
			Where(revenueworkspace.StatusEQ("active")).
			WithUser().
			Order(ent.Asc(revenueworkspace.FieldID)).
			Limit(r.maxUsers)
		if afterID != nil {
			query = query.Where(revenueworkspace.IDGT(*afterID))
		}
		workspaces, err := query.All(internal)
		if err != nil {
			result = "error"
			r.log.Warn("relationship attention: list workspaces", zap.Error(err))
			return
		}
		for _, workspace := range workspaces {
			if ctx.Err() != nil {
				result = "cancelled"
				return
			}
			owner, err := workspace.Edges.UserOrErr()
			if err != nil {
				result = "partial"
				continue
			}
			if err := r.svc.RefreshRelationshipAttention(auth.WithUser(ctx, owner), owner); err != nil && !errors.Is(err, ErrCapabilityDisabled) {
				result = "partial"
				r.log.Warn("relationship attention sweep", zap.String("workspace", workspace.ID.String()), zap.Error(err))
			}
			processed++
		}
		if len(workspaces) < r.maxUsers {
			openItems, err := r.svc.client.RelationshipAttentionItem.Query().
				Where(relationshipattentionitem.StatusEQ("open")).
				Count(internal)
			if err != nil {
				result = "partial"
			} else {
				revenuemetrics.RelationshipQueueDepth.WithLabelValues("attention_open").Set(float64(openItems))
			}
			return
		}
		last := workspaces[len(workspaces)-1].ID
		afterID = &last
	}
}
