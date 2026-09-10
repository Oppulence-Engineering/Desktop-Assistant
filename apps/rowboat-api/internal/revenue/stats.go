package revenue

import (
	"context"
	"sort"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/actionoutcome"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/commitment"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipattentionitem"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueaction"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
)

// Impact is the aggregate picture of the revenue queue for one user: how many
// open loops were surfaced, how they were triaged, how many were acted on, and
// what came back. It is the ROI view's data source (RFC 030 product quality
// metrics). Everything here is scoped to the caller by the tenant interceptors.
type Impact struct {
	Surfaced              int            `json:"surfaced"`   // total actions ever created
	Open                  int            `json:"open"`       // queue_status = open
	Handled               int            `json:"handled"`    // queue_status = handled
	Snoozed               int            `json:"snoozed"`    // queue_status = snoozed
	Dismissed             int            `json:"dismissed"`  // queue_status = dismissed
	Approved              int            `json:"approved"`   // approval_status = approved
	Executed              int            `json:"executed"`   // execution_status = sent (draft created or email sent)
	Outcomes              map[string]int `json:"outcomes"`   // outcome kind -> count
	Detectors             []DetectorStat `json:"byDetector"` // per-detector surfaced/handled
	Relationships         int            `json:"relationships"`
	AtRiskRelationships   int            `json:"atRiskRelationships"`
	CriticalRelationships int            `json:"criticalRelationships"`
	PortfolioRiskScore    int            `json:"portfolioRiskScore"`
	OverdueCommitments    int            `json:"overdueCommitments"`
	OverdueByUs           int            `json:"overdueByUs"`
	OverdueByThem         int            `json:"overdueByThem"`
	LongestOverdueDays    int            `json:"longestOverdueDays"`
	RiskReasons           []RiskStat     `json:"riskReasons"`
}

// DetectorStat is one detector's contribution.
type DetectorStat struct {
	Detector string `json:"detector"`
	Surfaced int    `json:"surfaced"`
	Handled  int    `json:"handled"`
}

// RiskStat shows how many live account alerts share one deterministic reason.
type RiskStat struct {
	Reason        string `json:"reason"`
	Relationships int    `json:"relationships"`
}

// Impact computes the aggregate stats for the caller.
func (s *Service) Impact(ctx context.Context, u *ent.User) (*Impact, error) {
	uid := u.ID
	base := func() *ent.RevenueActionQuery {
		return s.client.RevenueAction.Query().Where(revenueaction.HasUserWith(user.IDEQ(uid)))
	}

	imp := &Impact{Outcomes: map[string]int{}}

	// Surfaced total.
	total, err := base().Count(ctx)
	if err != nil {
		return nil, err
	}
	imp.Surfaced = total

	// Queue-status breakdown in one group-by.
	var byQueue []struct {
		QueueStatus string `json:"queue_status"`
		N           int    `json:"n"`
	}
	if err := base().GroupBy(revenueaction.FieldQueueStatus).
		Aggregate(ent.As(ent.Count(), "n")).Scan(ctx, &byQueue); err != nil {
		return nil, err
	}
	for _, r := range byQueue {
		switch r.QueueStatus {
		case QueueOpen:
			imp.Open = r.N
		case QueueHandled:
			imp.Handled = r.N
		case QueueSnoozed:
			imp.Snoozed = r.N
		case QueueDismissed:
			imp.Dismissed = r.N
		}
	}

	if imp.Approved, err = base().Where(revenueaction.ApprovalStatusEQ(ApprovalApproved)).Count(ctx); err != nil {
		return nil, err
	}
	if imp.Executed, err = base().Where(revenueaction.ExecutionStatusEQ(ExecSent)).Count(ctx); err != nil {
		return nil, err
	}

	// Outcome counts by kind.
	var byKind []struct {
		Kind string `json:"kind"`
		N    int    `json:"n"`
	}
	if err := s.client.ActionOutcome.Query().
		Where(actionoutcome.HasUserWith(user.IDEQ(uid))).
		GroupBy(actionoutcome.FieldKind).
		Aggregate(ent.As(ent.Count(), "n")).Scan(ctx, &byKind); err != nil {
		return nil, err
	}
	for _, r := range byKind {
		imp.Outcomes[r.Kind] = r.N
	}

	// Per-detector surfaced + handled.
	var surfacedByDet, handledByDet []struct {
		Detector string `json:"detector"`
		N        int    `json:"n"`
	}
	if err := base().GroupBy(revenueaction.FieldDetector).
		Aggregate(ent.As(ent.Count(), "n")).Scan(ctx, &surfacedByDet); err != nil {
		return nil, err
	}
	if err := base().Where(revenueaction.QueueStatusEQ(QueueHandled)).
		GroupBy(revenueaction.FieldDetector).
		Aggregate(ent.As(ent.Count(), "n")).Scan(ctx, &handledByDet); err != nil {
		return nil, err
	}
	handled := map[string]int{}
	for _, r := range handledByDet {
		handled[r.Detector] = r.N
	}
	for _, r := range surfacedByDet {
		imp.Detectors = append(imp.Detectors, DetectorStat{
			Detector: r.Detector,
			Surfaced: r.N,
			Handled:  handled[r.Detector],
		})
	}

	if imp.Relationships, err = s.client.Relationship.Query().Where(
		relationship.HasUserWith(user.IDEQ(uid)),
		relationship.StatusNEQ("archived"),
	).Count(ctx); err != nil {
		return nil, err
	}
	items, err := s.client.RelationshipAttentionItem.Query().Where(
		relationshipattentionitem.HasUserWith(user.IDEQ(uid)),
		relationshipattentionitem.StatusEQ("open"),
	).WithRelationship().All(ctx)
	if err != nil {
		return nil, err
	}
	maxScore := map[string]int{}
	critical := map[string]struct{}{}
	byReason := map[string]map[string]struct{}{}
	for _, item := range items {
		rel := item.Edges.Relationship
		if rel == nil {
			continue
		}
		id := rel.ID.String()
		maxScore[id] = max(maxScore[id], item.RankScore)
		if item.UrgencyBand == "critical" {
			critical[id] = struct{}{}
		}
		if byReason[item.ReasonCode] == nil {
			byReason[item.ReasonCode] = map[string]struct{}{}
		}
		byReason[item.ReasonCode][id] = struct{}{}
	}
	imp.AtRiskRelationships = len(maxScore)
	imp.CriticalRelationships = len(critical)
	if imp.Relationships > 0 {
		total := 0
		for _, score := range maxScore {
			total += score
		}
		imp.PortfolioRiskScore = (total + imp.Relationships/2) / imp.Relationships
	}
	for reason, ids := range byReason {
		imp.RiskReasons = append(imp.RiskReasons, RiskStat{Reason: reason, Relationships: len(ids)})
	}
	sort.Slice(imp.RiskReasons, func(i, j int) bool {
		if imp.RiskReasons[i].Relationships != imp.RiskReasons[j].Relationships {
			return imp.RiskReasons[i].Relationships > imp.RiskReasons[j].Relationships
		}
		return imp.RiskReasons[i].Reason < imp.RiskReasons[j].Reason
	})

	now := s.now().UTC()
	overdue, err := s.client.Commitment.Query().Where(
		commitment.HasUserWith(user.IDEQ(uid)),
		commitment.StatusEQ("open"),
		commitment.DueAtNotNil(),
		commitment.DueAtLTE(now),
	).All(ctx)
	if err != nil {
		return nil, err
	}
	for _, promised := range overdue {
		if !promised.UserConfirmed && promised.Acceptance == "candidate" {
			continue
		}
		imp.OverdueCommitments++
		switch promised.Direction {
		case "promised_by_me":
			imp.OverdueByUs++
		case "promised_by_them":
			imp.OverdueByThem++
		}
		days := max(1, int(now.Sub(promised.DueAt.UTC()).Hours()/24))
		imp.LongestOverdueDays = max(imp.LongestOverdueDays, days)
	}
	return imp, nil
}

// OutcomeCount returns the count for one outcome kind (0 if none).
func (i *Impact) OutcomeCount(kind string) int { return i.Outcomes[kind] }
