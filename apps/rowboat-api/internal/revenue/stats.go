package revenue

import (
	"context"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/actionoutcome"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueaction"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
)

// Impact is the aggregate picture of the revenue queue for one user: how many
// open loops were surfaced, how they were triaged, how many were acted on, and
// what came back. It is the ROI view's data source (RFC 030 product quality
// metrics). Everything here is scoped to the caller by the tenant interceptors.
type Impact struct {
	Surfaced  int            // total actions ever created
	Open      int            // queue_status = open
	Handled   int            // queue_status = handled
	Snoozed   int            // queue_status = snoozed
	Dismissed int            // queue_status = dismissed
	Approved  int            // approval_status = approved
	Executed  int            // execution_status = sent (draft created or email sent)
	Outcomes  map[string]int // outcome kind -> count
	Detectors []DetectorStat // per-detector surfaced/handled
}

// DetectorStat is one detector's contribution.
type DetectorStat struct {
	Detector string `json:"detector"`
	Surfaced int    `json:"surfaced"`
	Handled  int    `json:"handled"`
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
	return imp, nil
}

// OutcomeCount returns the count for one outcome kind (0 if none).
func (i *Impact) OutcomeCount(kind string) int { return i.Outcomes[kind] }
