package revenue

import (
	"context"
	"math"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/actionoutcome"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueaction"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
	"github.com/google/uuid"
)

const outcomeLearningVersion = "outcome-learning-v2"

// OutcomeLearningResult is the explainable ranking adjustment. It contains no
// authority signal: policy and approval gates never read it.
type OutcomeLearningResult struct {
	Version         string `json:"version"`
	Lift            int    `json:"lift"`
	Samples         int    `json:"samples"`
	ExactSamples    int    `json:"exactSamples"`
	PositiveSamples int    `json:"positiveSamples"`
	NegativeSamples int    `json:"negativeSamples"`
}

type outcomeLearningExample struct {
	actionType string
	channel    string
	utility    float64
	at         time.Time
}

type outcomeLearningProfile struct {
	now      time.Time
	examples []outcomeLearningExample
}

var outcomeUtility = map[string]float64{
	"sent": 0.05, "delivered": 0.15, "replied": 0.5, "meeting_booked": 0.8,
	"deal_advanced": 0.75, "onboarding_progressed": 0.7, "won": 1, "renewed": 0.95,
	"bounced": -0.6, "lost": -0.9, "dismissed": -0.65, "bad_recommendation": -0.85,
	"escalated": -0.75, "churned": -1, "corrected": -0.7,
}

func loadOutcomeLearningProfile(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	now time.Time,
) (outcomeLearningProfile, error) {
	// Outcomes are ordered by their own event time, not action.updated_at. A
	// renewal observed today must remain learnable even when its original action
	// was created a year ago.
	outcomes, err := client.ActionOutcome.Query().
		Where(actionoutcome.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID))).
		WithAction().
		Order(ent.Desc(actionoutcome.FieldOccurredAt)).
		Limit(1000).
		All(ctx)
	if err != nil {
		return outcomeLearningProfile{}, err
	}
	feedbackActions, err := client.RevenueAction.Query().
		Where(revenueaction.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID))).
		Where(revenueaction.Or(
			revenueaction.ApprovalStatusEQ(ApprovalRejected),
			revenueaction.QueueStatusEQ(QueueDismissed),
		)).
		Order(ent.Desc(revenueaction.FieldUpdatedAt)).
		Limit(500).
		All(ctx)
	if err != nil {
		return outcomeLearningProfile{}, err
	}
	type sample struct {
		action  *ent.RevenueAction
		utility float64
		at      time.Time
	}
	samples := make(map[uuid.UUID]sample, len(outcomes)+len(feedbackActions))
	consider := func(action *ent.RevenueAction, utility float64, at time.Time) {
		current, found := samples[action.ID]
		// On equal magnitude, negative feedback wins: a correction or dismissal
		// is more informative than a delivery receipt on the same action.
		if !found || math.Abs(utility) > math.Abs(current.utility) ||
			(math.Abs(utility) == math.Abs(current.utility) && utility < current.utility) {
			samples[action.ID] = sample{action: action, utility: utility, at: at}
		}
	}
	for _, outcome := range outcomes {
		utility, ok := outcomeUtility[outcome.Kind]
		if !ok {
			continue
		}
		action, edgeErr := outcome.Edges.ActionOrErr()
		if edgeErr != nil {
			return outcomeLearningProfile{}, edgeErr
		}
		consider(action, utility, outcome.OccurredAt)
	}
	for _, action := range feedbackActions {
		if action.ApprovalStatus == ApprovalRejected {
			consider(action, -0.55, action.UpdatedAt)
		}
		if action.QueueStatus == QueueDismissed {
			consider(action, -0.65, action.UpdatedAt)
		}
	}
	profile := outcomeLearningProfile{now: now.UTC(), examples: make([]outcomeLearningExample, 0, len(samples))}
	for _, sample := range samples {
		profile.examples = append(profile.examples, outcomeLearningExample{
			actionType: sample.action.ActionType, channel: sample.action.Channel,
			utility: sample.utility, at: sample.at,
		})
	}
	return profile, nil
}

func (p outcomeLearningProfile) result(actionType, channel string) OutcomeLearningResult {
	result := OutcomeLearningResult{Version: outcomeLearningVersion}
	weightedUtility, effectiveSamples := 0.0, 0.0
	for _, example := range p.examples {
		scope := learningScopeWeight(example, actionType, channel)
		if scope == 0 {
			continue
		}
		age := p.now.Sub(example.at)
		if age < 0 {
			age = 0
		}
		// Six-month half-ish life with a floor so old, high-value outcomes still
		// contribute a little instead of vanishing abruptly.
		recency := math.Max(0.2, math.Exp(-age.Hours()/(24*180)))
		weight := scope * recency
		weightedUtility += example.utility * weight
		effectiveSamples += weight
		result.Samples++
		if scope == 1 {
			result.ExactSamples++
		}
		if example.utility > 0 {
			result.PositiveSamples++
		} else {
			result.NegativeSamples++
		}
	}
	// Three neutral pseudo-samples prevent one lucky reply from dramatically
	// reordering the queue. With evidence, the lift asymptotically approaches
	// ±15 and can never exceed it.
	const neutralPrior = 3.0
	result.Lift = int(math.Round(15 * weightedUtility / (neutralPrior + effectiveSamples)))
	if result.Lift > 15 {
		result.Lift = 15
	}
	if result.Lift < -15 {
		result.Lift = -15
	}
	return result
}

func learningScopeWeight(example outcomeLearningExample, actionType, channel string) float64 {
	sameAction := example.actionType == actionType
	sameChannel := example.channel == channel
	switch {
	case sameAction && sameChannel:
		return 1
	case sameAction:
		return 0.35
	case sameChannel:
		return 0.2
	default:
		return 0.05
	}
}

func (s *Service) outcomeLearningDetails(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	actionType, channel string,
) (OutcomeLearningResult, error) {
	profile, err := loadOutcomeLearningProfile(ctx, client, ws, s.now())
	if err != nil {
		return OutcomeLearningResult{}, err
	}
	return profile.result(actionType, channel), nil
}

func (s *Service) outcomeLearningLift(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	actionType, channel string,
) (int, error) {
	result, err := s.outcomeLearningDetails(ctx, client, ws, actionType, channel)
	return result.Lift, err
}
