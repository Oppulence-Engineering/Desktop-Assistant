package cloudevents

import (
	"context"
	"errors"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/google/uuid"
	"go.temporal.io/api/enums/v1"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
	"go.uber.org/zap"
)

const (
	// RouteWorkflowName is the Temporal workflow type that routes one event.
	RouteWorkflowName = "rowboat.cloud_events.route.v1"
	// ActivityRouteCloudEvent is the Temporal activity that runs Router.Route.
	ActivityRouteCloudEvent = "rowboat.cloud_events.route_activity.v1"
)

// Non-retryable application error types (Temporal RetryPolicy).
const (
	errTypeInsufficientCredits = "insufficient_credits"
	errTypeEventNotFound       = "event_not_found"
)

// RouteWorkflowID is the deterministic workflow id for one event's routing.
func RouteWorkflowID(userID, eventID string) string {
	return "cloud-event-route/" + userID + "/" + eventID
}

// RouteWorkflow runs the single routing activity with retries. Terminal
// failures (quota exhaustion, vanished event) are non-retryable; the activity
// itself moves the event row to routing_status=failed before returning them,
// so the row state never depends on workflow-level error handling.
func RouteWorkflow(ctx workflow.Context, in RouteInput) error {
	ctx = workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:        time.Second,
			BackoffCoefficient:     2,
			MaximumInterval:        time.Minute,
			MaximumAttempts:        3,
			NonRetryableErrorTypes: []string{errTypeInsufficientCredits, errTypeEventNotFound},
		},
	})
	return workflow.ExecuteActivity(ctx, ActivityRouteCloudEvent, in).Get(ctx, nil)
}

// Activities hosts the routing activity on the worker.
type Activities struct {
	Router *Router
	Log    *zap.Logger
}

// RouteCloudEvent parses the input and delegates to Router.Route, translating
// terminal failures into non-retryable application errors.
func (a *Activities) RouteCloudEvent(ctx context.Context, in RouteInput) error {
	eventID, err := uuid.Parse(in.EventID)
	if err != nil {
		return temporal.NewNonRetryableApplicationError("invalid event id", errTypeEventNotFound, err)
	}
	if err := a.Router.Route(ctx, eventID); err != nil {
		if IsTerminalRouteError(err) {
			errType := errTypeInsufficientCredits
			if errors.Is(err, ErrEventNotFound) {
				errType = errTypeEventNotFound
			}
			return temporal.NewNonRetryableApplicationError(err.Error(), errType, err)
		}
		return err // retryable — the event row is still pending
	}
	return nil
}

// Register installs the route workflow + activity on a Temporal worker.
func Register(w worker.Worker, a *Activities) {
	w.RegisterWorkflowWithOptions(RouteWorkflow, workflow.RegisterOptions{Name: RouteWorkflowName})
	w.RegisterActivityWithOptions(a.RouteCloudEvent, activity.RegisterOptions{Name: ActivityRouteCloudEvent})
}

// routeStarter starts route workflows from the ingest path (the API process).
type routeStarter struct {
	client    client.Client
	taskQueue string
}

// NewRouteStarter builds the RouteController the ingest handler uses.
func NewRouteStarter(c client.Client, cfg appconfig.Config) RouteController {
	return &routeStarter{client: c, taskQueue: cfg.TemporalTaskQueue}
}

// StartRoute starts (or no-ops onto) the event's route workflow.
// ALLOW_DUPLICATE_FAILED_ONLY lets a manual repair re-run a failed route
// while guaranteeing two live routers never race for one event.
func (s *routeStarter) StartRoute(ctx context.Context, in RouteInput) error {
	_, err := s.client.ExecuteWorkflow(ctx, client.StartWorkflowOptions{
		ID:                    RouteWorkflowID(in.UserID, in.EventID),
		TaskQueue:             s.taskQueue,
		WorkflowIDReusePolicy: enums.WORKFLOW_ID_REUSE_POLICY_ALLOW_DUPLICATE_FAILED_ONLY,
	}, RouteWorkflowName, in)
	return err
}
