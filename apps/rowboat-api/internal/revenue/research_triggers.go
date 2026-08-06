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
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipassertion"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipparticipant"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/parallel"
)

// Trigger-based outreach (RFC 039, surface 1).
//
// The attention queue today can say "no recorded interaction for 47 days". That
// is a reminder, not a reason — nobody replies to an email because time passed.
// They reply because something happened: the company raised, launched, was
// acquired, started hiring for the role the product serves.
//
// A trigger is stored as an `external_research` milestone assertion carrying the
// vendor's citations, and the attention detector reads it. Deliberately NOT a
// new table: milestone is an existing projected dimension, the assertion ladder
// already knows how to rank an external_research claim against a user
// correction, and the attention item inherits acknowledge/snooze/dismiss for
// free.
const (
	// triggerProcessor is `core`: this task reads several sources and has to
	// distinguish a material event from a blog post, which is exactly the depth
	// `lite` does not buy.
	triggerProcessor = parallel.ProcessorCore

	// triggerEventField and triggerDateField are the task's output fields.
	triggerEventField = "material_event"
	triggerDateField  = "event_date"

	// triggerValidity is how long a trigger stays a reason to write. A funding
	// round announced six weeks ago is no longer "why today", and an assertion
	// with no valid_to would keep the attention item alive forever. This is the
	// concrete answer to the RFC's open question on retention, for triggers
	// specifically: they expire, they are not kept until contradicted.
	triggerValidity = 30 * 24 * time.Hour

	// triggerRankScore places a cited external reason above a quiet account of
	// typical age (45-88) and below an overdue confirmed commitment (70-100).
	// It is a strong reason to act, not an obligation the user already took on.
	triggerRankScore = 86
)

// AccountTriggerOutcome is the result of one account trigger check.
type AccountTriggerOutcome struct {
	RelationshipID uuid.UUID `json:"relationshipId"`
	Found          bool      `json:"found"`
	Event          string    `json:"event,omitempty"`
	RunID          string    `json:"runId,omitempty"`
	Replayed       bool      `json:"replayed"`
	// Rejected explains a discarded answer — most often an uncited event, which
	// is the one thing a trigger may never be.
	Rejected string `json:"rejected,omitempty"`
}

// ResearchAccountTrigger asks what materially happened at one account and, if
// the answer is cited, records it as a milestone the attention queue can raise.
//
// Consent scope note: the input is the ACCOUNT — a company name and domain, both
// already public. No person's name is sent by this surface.
func (s *Service) ResearchAccountTrigger(
	ctx context.Context,
	u *ent.User,
	relationshipID uuid.UUID,
) (*AccountTriggerOutcome, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceContribute)
	if err != nil {
		return nil, err
	}
	if err := s.requireCloudResearch(ctx, ws); err != nil {
		return nil, err
	}
	if !s.ResearchAvailable() {
		return nil, ErrResearchUnavailable
	}
	rel, err := s.client.Relationship.Query().
		Where(
			relationship.IDEQ(relationshipID),
			relationship.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
		).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	domain := strings.TrimSpace(rel.AccountDomain)
	if domain == "" || isPublicMailboxDomain(domain) {
		return nil, fmt.Errorf("%w: relationship has no company domain to monitor", ErrInvalidInput)
	}

	now := s.now().UTC()
	// The idempotency window is the day: polling an account twice on the same
	// day asks the same question of the same web and must not bill twice.
	version := triggerTaskSpecVersion(now)
	cost := s.researchCost(triggerProcessor)
	charge, err := s.research.Gate.Reserve(
		ctx, "parallel_task", cost, researchRequestID(rel.ID, version), s.research.Limits,
	)
	if err != nil {
		return nil, err
	}
	if charge.Finalized() {
		return &AccountTriggerOutcome{RelationshipID: rel.ID, Replayed: true}, nil
	}
	if charge.InProgress() {
		return nil, ErrResearchInProgress
	}

	result, err := s.research.Client.RunTask(ctx, parallel.TaskRequest{
		Input: map[string]any{
			"company_name":   rel.DisplayName,
			"company_domain": domain,
			"since":          now.Add(-triggerValidity).Format("2006-01-02"),
		},
		OutputSchema: triggerSchema(),
		Processor:    triggerProcessor,
	})
	if err != nil {
		s.refundResearch(ctx, charge)
		return nil, err
	}
	defer s.settleResearch(ctx, charge, cost)

	outcome := &AccountTriggerOutcome{RelationshipID: rel.ID, RunID: result.RunID}
	event := strings.TrimSpace(stringValue(result.Content[triggerEventField]))
	if event == "" || strings.EqualFold(event, "none") {
		return outcome, nil
	}
	basis, ok := result.BasisFor(triggerEventField)
	if !ok {
		outcome.Rejected = "no basis returned for the event"
		return outcome, nil
	}
	citations := usableCitations(basis.Citations)
	if len(citations) == 0 {
		// An uncited trigger is a rumour. Telling a user to email someone
		// because of something that may not have happened is worse than the
		// silence it replaces.
		outcome.Rejected = "no citation to check"
		return outcome, nil
	}
	encoded, err := json.Marshal(citations)
	if err != nil {
		return nil, err
	}

	validTo := now.Add(triggerValidity)
	if _, err := createRelationshipAssertion(ctx, s.client, ws, u, rel, nil, RelationshipAssertionInput{
		Dimension:        "milestone",
		Value:            event,
		SourceType:       researchSourceType,
		Confidence:       researchConfidence(basis.Confidence),
		Reason:           strings.TrimSpace(basis.Reasoning),
		ValidFrom:        now,
		ValidTo:          &validTo,
		ExtractorVersion: version,
		CitationsJSON:    string(encoded),
	}); err != nil {
		return nil, err
	}
	outcome.Found = true
	outcome.Event = event
	return outcome, nil
}

func triggerSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			triggerEventField: map[string]any{
				"type": "string",
				"description": "The single most material public event at this company since the given date — " +
					"funding, launch, acquisition, leadership change, or notable hiring. One sentence, past tense. " +
					"Answer exactly \"none\" if nothing material happened. Do not report routine blog posts or marketing.",
			},
			triggerDateField: map[string]any{
				"type":        "string",
				"description": "The date the event was announced, as YYYY-MM-DD.",
			},
		},
		"required":             []string{triggerEventField},
		"additionalProperties": false,
	}
}

// triggerTaskSpecVersion changes daily, so a re-poll tomorrow is a new question
// and a re-poll today is free.
func triggerTaskSpecVersion(now time.Time) string {
	encoded, err := json.Marshal(triggerSchema())
	if err != nil {
		panic("revenue: trigger schema is not marshalable: " + err.Error())
	}
	sum := sha256.Sum256(encoded)
	return researchExtractor + "/" + triggerProcessor + "@" +
		hex.EncodeToString(sum[:])[:8] + ":" + now.Format("2006-01-02")
}

// activeAccountTriggers returns the live, cited trigger per relationship. Only
// external_research milestones count: an owned-data milestone is something the
// user already knows about, which is the opposite of what this detector is for.
func (s *Service) activeAccountTriggers(
	ctx context.Context,
	ws *ent.RevenueWorkspace,
	now time.Time,
) (map[uuid.UUID]*ent.RelationshipAssertion, error) {
	assertions, err := s.client.RelationshipAssertion.Query().
		Where(
			relationshipassertion.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
			relationshipassertion.DimensionEQ("milestone"),
			relationshipassertion.SourceTypeEQ(researchSourceType),
			relationshipassertion.StatusEQ("active"),
		).
		WithRelationship().
		Order(ent.Desc(relationshipassertion.FieldValidFrom)).
		All(ctx)
	if err != nil {
		return nil, err
	}
	latest := map[uuid.UUID]*ent.RelationshipAssertion{}
	for _, assertion := range assertions {
		if assertion.ValidFrom.After(now) {
			continue
		}
		if assertion.ValidTo != nil && !assertion.ValidTo.After(now) {
			continue
		}
		rel, err := assertion.Edges.RelationshipOrErr()
		if err != nil {
			continue
		}
		// Ordered newest-first, so the first one wins.
		if _, seen := latest[rel.ID]; !seen {
			latest[rel.ID] = assertion
		}
	}
	return latest, nil
}

// triggerExplanation is the sentence the user reads in the queue. It names the
// event and the last person they spoke to there, because "Acme raised a Series
// B" is information and "…and your last contact there was their VP Eng" is a
// next step.
func triggerExplanation(event string, contact string) string {
	event = strings.TrimSpace(event)
	if !strings.HasSuffix(event, ".") {
		event += "."
	}
	if contact = strings.TrimSpace(contact); contact != "" {
		return event + " Your last contact there was " + contact + "."
	}
	return event
}

// contactNamesForRelationships names the people the user actually knows at each
// triggered account, so the queue can say "your last contact there was their VP
// Eng" instead of leaving the user to remember.
//
// Departed contacts are excluded: pointing at someone whose mailbox bounces is
// the failure the departure signal exists to prevent, and a fresh reason to
// write makes it more tempting, not less.
func (s *Service) contactNamesForRelationships(
	ctx context.Context,
	triggers map[uuid.UUID]*ent.RelationshipAssertion,
) (map[uuid.UUID][]string, error) {
	if len(triggers) == 0 {
		return map[uuid.UUID][]string{}, nil
	}
	ids := make([]uuid.UUID, 0, len(triggers))
	for id := range triggers {
		ids = append(ids, id)
	}
	participants, err := s.client.RelationshipParticipant.Query().
		Where(relationshipparticipant.HasRelationshipWith(relationship.IDIn(ids...))).
		WithPerson().WithRelationship().All(ctx)
	if err != nil {
		return nil, err
	}
	out := map[uuid.UUID][]string{}
	for _, participant := range participants {
		if participant.Edges.Relationship == nil || participant.Edges.Person == nil {
			continue
		}
		p := participant.Edges.Person
		if p.Status != "active" || p.EmploymentStatus == "departed" {
			continue
		}
		name := strings.TrimSpace(p.DisplayName)
		if name == "" {
			continue
		}
		if p.Title != "" {
			name += " (" + p.Title + ")"
		}
		relID := participant.Edges.Relationship.ID
		if slicesContains(out[relID], name) {
			continue
		}
		out[relID] = append(out[relID], name)
	}
	for id, names := range out {
		sort.Strings(names)
		// One name is a next step; five is a directory. Keep the queue readable.
		if len(names) > 2 {
			out[id] = names[:2]
		}
	}
	return out, nil
}

// maxMonitoredAccounts is the plan limit, expressed here in the unit the user
// was sold ("up to 250 monitored accounts") rather than in credits. A cap
// stated as a balance makes the user do arithmetic to know whether a background
// job will run; a cap stated as accounts is a sentence they can check.
const maxMonitoredAccounts = 250

// SweepAccountTriggers polls the workspace's accounts for external events.
//
// Bounded twice over: to maxMonitoredAccounts per sweep, and by the per-day
// idempotency key, so a sweep that runs twice in a day costs nothing the second
// time. Accounts are polled most-recently-touched first, because an account the
// user is actually working is where a reason to write today is worth having.
func (s *Service) SweepAccountTriggers(
	ctx context.Context,
	u *ent.User,
	limit int,
) (int, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceContribute)
	if err != nil {
		return 0, err
	}
	if err := s.requireCloudResearch(ctx, ws); err != nil {
		return 0, err
	}
	if !s.ResearchAvailable() {
		return 0, ErrResearchUnavailable
	}
	if limit <= 0 || limit > maxMonitoredAccounts {
		limit = maxMonitoredAccounts
	}
	relationships, err := s.client.Relationship.Query().
		Where(
			relationship.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
			relationship.StatusEQ("active"),
			relationship.AccountDomainNEQ(""),
		).
		Order(ent.Desc(relationship.FieldLastTouchAt)).
		Limit(limit).
		All(ctx)
	if err != nil {
		return 0, err
	}
	found := 0
	for _, rel := range relationships {
		outcome, err := s.ResearchAccountTrigger(ctx, u, rel.ID)
		if err != nil {
			// A relationship that cannot be anchored is skipped; anything that
			// refuses the whole workspace — a kill switch, a lapsed plan, an
			// exhausted balance — stops the sweep instead of repeating itself
			// once per account.
			if errors.Is(err, ErrInvalidInput) || errors.Is(err, ErrResearchInProgress) {
				continue
			}
			return found, err
		}
		if outcome.Found {
			found++
		}
	}
	return found, nil
}

// ResearchTriggerRunner polls every consenting workspace's accounts once a day.
//
// This is the "monitor" of RFC 039 surface 1, implemented as a scheduled Task
// run rather than as a vendor Monitor subscription. The reason is deliberate: a
// Monitor subscription needs an inbound webhook, its signature verification, and
// a replay story, all built against a contract we cannot exercise until the
// first real key exists. A daily task asks the same question at a comparable
// price and shares the reserve/settle path everything else here already uses.
// The vendor Monitor product is the optimisation, and it is one this can move to
// without changing anything a user sees.
type ResearchTriggerRunner struct {
	svc       *Service
	interval  time.Duration
	maxUsers  int
	perTenant int
	log       *zap.Logger
}

// NewResearchTriggerRunner builds the daily trigger sweep.
func NewResearchTriggerRunner(
	svc *Service,
	interval time.Duration,
	maxUsers int,
	log *zap.Logger,
) *ResearchTriggerRunner {
	if interval <= 0 {
		interval = 24 * time.Hour
	}
	if maxUsers <= 0 || maxUsers > 1000 {
		maxUsers = 200
	}
	if log == nil {
		log = zap.NewNop()
	}
	return &ResearchTriggerRunner{
		svc: svc, interval: interval, maxUsers: maxUsers,
		perTenant: maxMonitoredAccounts, log: log,
	}
}

// Run sweeps until the context is canceled.
func (r *ResearchTriggerRunner) Run(ctx context.Context) error {
	// No sweep on boot, unlike the attention runner. Attention refresh is free;
	// this one spends money, and a deploy loop that restarts pods would turn
	// every restart into a billable workspace-wide poll. The first sweep waits
	// for the first tick.
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

func (r *ResearchTriggerRunner) sweep(ctx context.Context) {
	if !r.svc.ResearchAvailable() {
		return
	}
	internal := auth.WithInternalOnly(ctx)
	var afterID *uuid.UUID
	for {
		query := r.svc.client.RevenueWorkspace.Query().
			Where(
				revenueworkspace.StatusEQ("active"),
				// Only workspaces that have actually agreed. Filtered in the
				// query rather than by catching the refusal per workspace: the
				// cheapest way to never call a vendor about someone who did not
				// consent is to never load their workspace here.
				revenueworkspace.CloudResearchConsentEQ(true),
			).
			WithUser().
			Order(ent.Asc(revenueworkspace.FieldID)).
			Limit(r.maxUsers)
		if afterID != nil {
			query = query.Where(revenueworkspace.IDGT(*afterID))
		}
		workspaces, err := query.All(internal)
		if err != nil {
			r.log.Warn("research triggers: list workspaces", zap.Error(err))
			return
		}
		for _, workspace := range workspaces {
			if ctx.Err() != nil {
				return
			}
			owner, err := workspace.Edges.UserOrErr()
			if err != nil {
				continue
			}
			found, err := r.svc.SweepAccountTriggers(auth.WithUser(ctx, owner), owner, r.perTenant)
			if err != nil &&
				!errors.Is(err, ErrCapabilityDisabled) &&
				!errors.Is(err, ErrResearchPlanRequired) &&
				!errors.Is(err, ErrResearchConsentRequired) {
				r.log.Warn("research trigger sweep",
					zap.String("workspace", workspace.ID.String()), zap.Error(err))
			}
			if found > 0 {
				r.log.Info("research triggers found",
					zap.String("workspace", workspace.ID.String()), zap.Int("count", found))
			}
		}
		if len(workspaces) < r.maxUsers {
			return
		}
		last := workspaces[len(workspaces)-1].ID
		afterID = &last
	}
}
