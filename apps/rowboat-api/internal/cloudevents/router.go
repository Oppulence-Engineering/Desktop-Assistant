package cloudevents

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtask"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskrun"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruns"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/llm"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/quota"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

// Prompt versions recorded in routing_json so route-quality changes are
// auditable across deployments.
const (
	pass1PromptVersion = "cloud-events-pass1-v1"
	pass2PromptVersion = "cloud-events-pass2-v1"
)

// pass1BatchSize mirrors the desktop router's BATCH_SIZE
// (apps/x/packages/core/src/events/routing.ts).
const pass1BatchSize = 20

// defaultMaxEligibleTasks hard-caps routing fan-out per event (RFC 003 cost
// controls): beyond it, only the most recently updated tasks are considered.
const defaultMaxEligibleTasks = 200

// routeMaxTokens bounds each routing call's completion.
const routeMaxTokens = 512

// ErrEventNotFound is surfaced (non-retryable) when the route workflow fires
// for an event that no longer exists.
var ErrEventNotFound = errors.New("cloudevents: route target event not found")

// Completer is the slice of *llm.Handler the router uses (interface so tests
// can fake the LLM without an HTTP upstream).
type Completer interface {
	CompleteJSON(ctx context.Context, req llm.CompleteRequest, out any) error
}

// RunStarter is the slice of *backgroundtaskruns.Starter the router uses.
type RunStarter interface {
	Start(ctx context.Context, p backgroundtaskruns.Params) (*ent.BackgroundTaskRun, error)
}

// ActionWatchResult is what an ActionWatcher reports for a product return event.
type ActionWatchResult struct {
	Matched       bool   // a proposal for the event's correlation id exists
	AlreadyClosed bool   // the loop was already closed (duplicate return event)
	OriginRunID   string // run whose objective produced the proposal (may be "")
	Kind          string
	Target        string
	ResultRef     string
}

// ActionWatcher closes the RFC 023 loop: it correlates a product Act-seam
// return CloudEvent to the executed ActionProposal that produced it and marks
// the loop resolved. The router owns the actual live-note re-trigger (it holds
// the run starter). Implemented by the actions broker via an adapter so this
// package does not depend on internal/actions.
type ActionWatcher interface {
	CorrelateReturn(ctx context.Context, owner *ent.User, ev *ent.CloudEvent) (ActionWatchResult, error)
	// IsProductSource reports whether a CloudEvent source is a product return
	// source (so ordinary inbound events skip the Watch path entirely).
	IsProductSource(source string) bool
}

// Router matches one stored CloudEvent against the owner's API-target tasks
// (two-pass LLM decision, desktop parity) and fires trigger=event runs. It is
// plain Go with no Temporal dependency: the workflow activity calls Route, and
// tests call it directly.
type Router struct {
	Client           *ent.Client
	LLM              Completer
	Starter          RunStarter
	Threshold        float64 // pass-2 confidence gate
	Model            string  // routing model
	MaxEligibleTasks int     // 0 → defaultMaxEligibleTasks
	Log              *zap.Logger

	// Watcher closes the RFC 023 loop for product Act-seam return events. Nil
	// when ACTIONS_ENABLED is off — product return events then route normally.
	Watcher ActionWatcher
}

// terminalRouteError marks failures that must not be retried (the event row
// has been moved to routing_status=failed with the cause recorded).
type terminalRouteError struct{ cause error }

func (e *terminalRouteError) Error() string { return e.cause.Error() }
func (e *terminalRouteError) Unwrap() error { return e.cause }

// IsTerminalRouteError reports whether err is a non-retryable routing failure.
func IsTerminalRouteError(err error) bool {
	var t *terminalRouteError
	return errors.As(err, &t)
}

// Route evaluates one event end to end. Idempotent: an event already in a
// terminal routing state is a no-op, so Temporal activity retries are safe.
func (r *Router) Route(ctx context.Context, eventID uuid.UUID) error {
	log := r.Log
	if log == nil {
		log = zap.NewNop()
	}
	ctx = auth.WithInternal(ctx)

	ev, err := r.Client.CloudEvent.Get(ctx, eventID)
	if err != nil {
		if ent.IsNotFound(err) {
			return &terminalRouteError{cause: ErrEventNotFound}
		}
		return err
	}
	switch ev.RoutingStatus {
	case StatusRouted, StatusSkipped:
		return nil // already terminal — retry replay
	}
	owner, err := ev.QueryUser().Only(ctx)
	if err != nil {
		return fmt.Errorf("load event owner: %w", err)
	}

	// RFC 023 Watch leg: a product Act-seam return event closes the loop on the
	// proposal that produced it and re-triggers the originating live-note,
	// instead of going through generic task matching.
	if r.Watcher != nil && r.Watcher.IsProductSource(ev.Source) {
		return r.watch(ctx, ev, owner, log)
	}

	targets, capped, err := r.eligibleTargets(ctx, owner.ID)
	if err != nil {
		return err
	}
	if capped {
		metricRouteFailures.WithLabelValues("cap").Inc()
		log.Warn("cloud event eligible-task cap applied",
			zap.String("eventId", ev.ID.String()), zap.Int("cap", r.maxEligible()))
	}

	summary := routingJSON{Threshold: r.Threshold, PromptVersion: pass1PromptVersion + "," + pass2PromptVersion}
	if len(targets) == 0 {
		return r.finish(ctx, ev, summary, nil)
	}

	// LLM calls bill the event owner (user decision): the owner's quota gate
	// sees these exactly like their other metered usage.
	llmCtx := auth.WithUser(ctx, owner)

	candidates, pass1Failed := r.pass1(llmCtx, ev, targets, log)
	if pass1Failed && len(candidates) == 0 {
		// Every batch failed — distinguish quota exhaustion (terminal) from a
		// transient LLM outage (retryable).
		return r.failOrRetry(ctx, ev, summary, errors.New("pass-1 candidacy failed for all batches"))
	}

	var fired []*ent.BackgroundTaskRun
	for _, t := range candidates {
		dec := r.pass2(llmCtx, ev, t, log)
		if dec.Error == "" {
			metricRouteMatches.WithLabelValues(matchBucket(dec, r.Threshold)).Inc()
		}
		if quotaTerminal(dec.quotaErr) {
			summary.Decisions = append(summary.Decisions, dec.routingDecision)
			return r.failTerminal(ctx, ev, summary, dec.quotaErr)
		}
		if dec.Match && dec.Confidence >= r.Threshold && dec.Error == "" {
			run, serr := r.Starter.Start(ctx, backgroundtaskruns.Params{
				User:             owner,
				Task:             t.task,
				Trigger:          "event",
				RunIDPrefix:      "event-",
				RequestedContext: eventSummary(ev),
				CloudEventID:     &ev.ID,
				QueuedMessage:    "Queued from cloud event router.",
				Source:           backgroundtaskruns.SourceEvent,
			})
			if serr != nil {
				// One task's start failure must not poison the whole event.
				metricRouteFailures.WithLabelValues("start_run").Inc()
				dec.Error = "run_start_failed: " + truncate(serr.Error(), 200)
				log.Error("cloud event run start failed",
					zap.String("eventId", ev.ID.String()), zap.String("taskSlug", t.task.Slug), zap.Error(serr))
			} else {
				dec.RunID = run.RunID
				fired = append(fired, run)
				metricTriggeredRuns.WithLabelValues(ev.Source).Inc()
			}
		}
		summary.Decisions = append(summary.Decisions, dec.routingDecision)
	}

	return r.finish(ctx, ev, summary, fired)
}

// eligibleTask pairs a task with its parsed match criteria.
type eligibleTask struct {
	task     *ent.BackgroundTask
	criteria string
}

// eligibleTargets returns the owner's active API-target tasks with a
// non-empty eventMatchCriteria, capped at MaxEligibleTasks (most recently
// updated first). Parsing happens in Go — no JSON string-contains in SQL (v1).
func (r *Router) eligibleTargets(ctx context.Context, ownerID uuid.UUID) ([]eligibleTask, bool, error) {
	tasks, err := r.Client.BackgroundTask.Query().
		Where(
			backgroundtask.ActiveEQ(true),
			backgroundtask.ExecutionTargetEQ("api"),
			backgroundtask.HasUserWith(user.IDEQ(ownerID)),
			backgroundtask.TriggersJSONNotNil(),
		).
		All(ctx)
	if err != nil {
		return nil, false, fmt.Errorf("scan eligible tasks: %w", err)
	}
	eligible := make([]eligibleTask, 0, len(tasks))
	for _, t := range tasks {
		if criteria := eventMatchCriteria(t.TriggersJSON); criteria != "" {
			eligible = append(eligible, eligibleTask{task: t, criteria: criteria})
		}
	}
	capped := false
	if limit := r.maxEligible(); len(eligible) > limit {
		sort.Slice(eligible, func(i, j int) bool {
			return eligible[i].task.UpdatedAt.After(eligible[j].task.UpdatedAt)
		})
		eligible = eligible[:limit]
		capped = true
	}
	return eligible, capped, nil
}

func (r *Router) maxEligible() int {
	if r.MaxEligibleTasks > 0 {
		return r.MaxEligibleTasks
	}
	return defaultMaxEligibleTasks
}

// pass1 runs the liberal candidacy classifier in batches of 20 (desktop
// parity). A failed batch is logged and skipped; pass1Failed reports whether
// at least one batch failed (the caller escalates only when ALL failed).
func (r *Router) pass1(ctx context.Context, ev *ent.CloudEvent, targets []eligibleTask, log *zap.Logger) ([]eligibleTask, bool) {
	matched := make(map[string]struct{})
	anyFailed := false
	for i := 0; i < len(targets); i += pass1BatchSize {
		batch := targets[i:min(i+pass1BatchSize, len(targets))]
		var out struct {
			IDs []string `json:"ids"`
		}
		err := r.LLM.CompleteJSON(ctx, llm.CompleteRequest{
			Model:      r.Model,
			System:     pass1SystemPrompt,
			Prompt:     pass1Prompt(ev, batch),
			MaxTokens:  routeMaxTokens,
			JSONObject: true,
			Op:         "event_route",
			UseCase:    "cloud_event_router",
			SubUseCase: "pass1",
			RequestID:  routeRequestID(ev.ID, fmt.Sprintf("pass1/%d", i/pass1BatchSize)),
		}, &out)
		if err != nil {
			metricRouteFailures.WithLabelValues("pass1").Inc()
			if quotaTerminal(err) {
				// Out of credits: no point attempting further batches.
				log.Warn("cloud event pass-1 stopped on quota", zap.String("eventId", ev.ID.String()), zap.Error(err))
				return nil, true
			}
			if errors.Is(err, llm.ErrAlreadyCompleted) {
				// Deterministic request-id replay after a partial prior attempt:
				// the original result is lost. Treat the batch as completed with
				// no recoverable candidates rather than returning a retryable error
				// that can never succeed with the same idempotency key.
				log.Warn("cloud event pass-1 batch replayed; skipping", zap.String("eventId", ev.ID.String()))
				continue
			}
			anyFailed = true
			log.Warn("cloud event pass-1 batch failed",
				zap.String("eventId", ev.ID.String()), zap.Int("batch", i/pass1BatchSize), zap.Error(err))
			continue
		}
		for _, id := range out.IDs {
			matched[id] = struct{}{}
		}
	}
	candidates := make([]eligibleTask, 0, len(matched))
	for _, t := range targets {
		if _, ok := matched[t.task.Slug]; ok {
			candidates = append(candidates, t)
		}
	}
	return candidates, anyFailed
}

// pass2Decision augments the recorded decision with the quota error (if any)
// so Route can decide terminal-vs-continue.
type pass2Decision struct {
	routingDecision
	quotaErr error
}

// pass2 decides one (event, task) pair.
func (r *Router) pass2(ctx context.Context, ev *ent.CloudEvent, t eligibleTask, log *zap.Logger) pass2Decision {
	dec := pass2Decision{routingDecision: routingDecision{TaskSlug: t.task.Slug}}
	var out struct {
		Match       bool    `json:"match"`
		Confidence  float64 `json:"confidence"`
		Explanation string  `json:"explanation"`
	}
	err := r.LLM.CompleteJSON(ctx, llm.CompleteRequest{
		Model:      r.Model,
		System:     pass2SystemPrompt,
		Prompt:     pass2Prompt(ev, t),
		MaxTokens:  routeMaxTokens,
		JSONObject: true,
		Op:         "event_route",
		UseCase:    "cloud_event_router",
		SubUseCase: "pass2",
		RequestID:  routeRequestID(ev.ID, "pass2/"+t.task.Slug),
	}, &out)
	if err != nil {
		metricRouteFailures.WithLabelValues("pass2").Inc()
		dec.Error = truncate(err.Error(), 200)
		dec.quotaErr = err
		if !quotaTerminal(err) {
			dec.quotaErr = nil // only quota errors escalate; others record-and-continue
			log.Warn("cloud event pass-2 failed",
				zap.String("eventId", ev.ID.String()), zap.String("taskSlug", t.task.Slug), zap.Error(err))
		}
		return dec
	}
	dec.Match = out.Match
	dec.Confidence = out.Confidence
	dec.Explanation = truncate(out.Explanation, 300)
	return dec
}

// finish marks the event routed and stores the decision summary.
// watch handles a product Act-seam return event (RFC 023 WP4): it closes the
// loop on the correlated proposal and re-triggers the originating task's run so
// the live-note updates with the result. Correlation failures leave the event
// routed (a return event that matches no live proposal is not an error).
func (r *Router) watch(ctx context.Context, ev *ent.CloudEvent, owner *ent.User, log *zap.Logger) error {
	summary := routingJSON{}
	res, err := r.Watcher.CorrelateReturn(ctx, owner, ev)
	if err != nil {
		// Transient DB error — leave pending and let the workflow retry.
		return fmt.Errorf("watch correlate return: %w", err)
	}
	if !res.Matched {
		summary.Error = "no matching proposal for correlation id"
		metricRouteMatches.WithLabelValues("watch_unmatched").Inc()
		return r.finish(ctx, ev, summary, nil)
	}
	if res.AlreadyClosed {
		// Duplicate at-least-once return event: idempotent no-op.
		metricRouteMatches.WithLabelValues("watch_duplicate").Inc()
		return r.finish(ctx, ev, summary, nil)
	}
	metricRouteMatches.WithLabelValues("watch_closed").Inc()

	var fired []*ent.BackgroundTaskRun
	if res.OriginRunID != "" {
		run, rerr := r.reTriggerOrigin(ctx, ev, owner, res, log)
		if rerr != nil {
			// The loop is already recorded closed; a re-trigger failure must not
			// undo that or fail the event. Surface it in the summary.
			summary.Error = "re-trigger failed: " + truncate(rerr.Error(), 160)
			metricRouteFailures.WithLabelValues("watch_retrigger").Inc()
			log.Error("action-return re-trigger failed",
				zap.String("eventId", ev.ID.String()), zap.String("originRunId", res.OriginRunID), zap.Error(rerr))
		} else if run != nil {
			fired = append(fired, run)
			metricTriggeredRuns.WithLabelValues(ev.Source).Inc()
		}
	}
	return r.finish(ctx, ev, summary, fired)
}

// reTriggerOrigin resolves the originating run's task and starts a new run with
// the return event as context, so the objective (live-note) advances.
func (r *Router) reTriggerOrigin(ctx context.Context, ev *ent.CloudEvent, owner *ent.User, res ActionWatchResult, _ *zap.Logger) (*ent.BackgroundTaskRun, error) {
	origin, err := r.Client.BackgroundTaskRun.Query().
		Where(
			backgroundtaskrun.RunIDEQ(res.OriginRunID),
			backgroundtaskrun.HasUserWith(user.IDEQ(owner.ID)),
		).
		WithTask().
		Only(ctx)
	if err != nil {
		return nil, fmt.Errorf("load origin run: %w", err)
	}
	task := origin.Edges.Task
	if task == nil {
		return nil, fmt.Errorf("origin run %s has no task", res.OriginRunID)
	}
	return r.Starter.Start(ctx, backgroundtaskruns.Params{
		User:             owner,
		Task:             task,
		Trigger:          "action-return",
		RunIDPrefix:      "action-return-",
		RequestedContext: actionReturnContext(res),
		CloudEventID:     &ev.ID,
		QueuedMessage:    "Queued from action return event (RFC 023 loop close).",
		Source:           backgroundtaskruns.SourceEvent,
	})
}

// actionReturnContext renders the objective context for a re-triggered run.
func actionReturnContext(res ActionWatchResult) string {
	ctx := fmt.Sprintf("The action %q on %q completed", res.Kind, res.Target)
	if res.ResultRef != "" {
		ctx += fmt.Sprintf(" (result: %s)", res.ResultRef)
	}
	return ctx + ". Review the product's return event and update the thread accordingly."
}

func (r *Router) finish(ctx context.Context, ev *ent.CloudEvent, summary routingJSON, fired []*ent.BackgroundTaskRun) error {
	raw, err := json.Marshal(summary)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	if err := ev.Update().
		SetRoutingStatus(StatusRouted).
		SetMatchedTaskCount(len(fired)).
		SetRoutingJSON(string(raw)).
		SetRoutedAt(now).
		Exec(ctx); err != nil {
		return fmt.Errorf("finish event routing: %w", err)
	}
	metricRouted.WithLabelValues(ev.Source).Inc()
	metricRouteLatency.Observe(now.Sub(ev.ReceivedAt).Seconds())
	return nil
}

// failTerminal records a non-retryable failure (quota exhaustion) on the row
// and returns a terminal error so the workflow stops retrying.
func (r *Router) failTerminal(ctx context.Context, ev *ent.CloudEvent, summary routingJSON, cause error) error {
	metricRouteFailures.WithLabelValues("quota").Inc()
	summary.Error = truncate(cause.Error(), 200)
	raw, _ := json.Marshal(summary)
	if err := ev.Update().
		SetRoutingStatus(StatusFailed).
		SetRoutingJSON(string(raw)).
		Exec(ctx); err != nil {
		return fmt.Errorf("mark event route failure: %w", err)
	}
	return &terminalRouteError{cause: cause}
}

// failOrRetry classifies an all-batches-failed pass-1: quota exhaustion is
// terminal; anything else is left pending and returned retryable so the
// workflow's retry policy re-runs Route.
func (r *Router) failOrRetry(ctx context.Context, ev *ent.CloudEvent, summary routingJSON, cause error) error {
	return r.failTerminalIfQuota(ctx, ev, summary, cause)
}

func (r *Router) failTerminalIfQuota(ctx context.Context, ev *ent.CloudEvent, summary routingJSON, cause error) error {
	if quotaTerminal(cause) {
		return r.failTerminal(ctx, ev, summary, cause)
	}
	return cause // retryable; event stays pending for the next attempt
}

// quotaTerminal reports whether err is a credit/limit exhaustion that retrying
// cannot fix.
func quotaTerminal(err error) bool {
	return err != nil && (errors.Is(err, quota.ErrInsufficientCredits) ||
		errors.Is(err, quota.ErrDailyLimitExceeded) ||
		errors.Is(err, quota.ErrMonthlyLimitExceeded))
}

func matchBucket(dec pass2Decision, threshold float64) string {
	switch {
	case dec.Match && dec.Confidence >= threshold:
		return "match"
	case dec.Match:
		return "low_conf"
	default:
		return "no_match"
	}
}

// routeRequestID derives a deterministic per-(event, step) request id so a
// Temporal activity retry replays the same quota reservation instead of
// double-billing the owner.
func routeRequestID(eventID uuid.UUID, step string) uuid.UUID {
	return uuid.NewSHA1(uuid.NameSpaceOID, []byte("cloud-event-route/"+eventID.String()+"/"+step))
}

// eventSummary builds the run's requested_context: source, type, subject, and
// gist only — never the raw payload (StartInput is intentionally small and the
// artifact embeds requested_context verbatim).
func eventSummary(ev *ent.CloudEvent) string {
	var b strings.Builder
	b.WriteString("Cloud event trigger: source=")
	b.WriteString(ev.Source)
	if ev.EventType != "" {
		b.WriteString(", type=")
		b.WriteString(ev.EventType)
	}
	if ev.OccurredAt != nil {
		b.WriteString(", occurred=")
		b.WriteString(ev.OccurredAt.UTC().Format(time.RFC3339))
	}
	b.WriteString(".")
	if ev.Subject != "" {
		b.WriteString(" Subject: ")
		b.WriteString(truncate(ev.Subject, 200))
		b.WriteString(".")
	}
	if ev.Text != "" {
		b.WriteString(" ")
		b.WriteString(truncate(ev.Text, 800))
	}
	return b.String()
}

// pass1SystemPrompt ports the desktop classifier's system prompt
// (routing.ts buildSystemPrompt) for background tasks.
const pass1SystemPrompt = `You are a routing classifier for a personal productivity workspace.

You will receive an event (something that happened — an email, meeting, message, etc.) and a list of background tasks. Each one has:
- id: an identifier you return in the output
- intent: the persistent intent of the background task (what it should keep being / containing / doing)
- matchCriteria: an explicit description of which kinds of incoming signals should wake this background task

Your job is to identify which background tasks MIGHT be relevant to this event.

Rules:
- Be LIBERAL in your selections. Include any background task that is even moderately relevant.
- Prefer false positives over false negatives — it is much better to include one that turns out to be irrelevant than to miss one that was relevant.
- Only exclude entries that are CLEARLY and OBVIOUSLY irrelevant to the event.
- Do not attempt to judge whether the event contains enough information to act on. That is handled in a later stage.
- Return an empty list only if no entries are relevant at all.
- Return each candidate's id exactly as given.
- Return JSON only: {"ids": ["..."]}`

func pass1Prompt(ev *ent.CloudEvent, batch []eligibleTask) string {
	var b strings.Builder
	b.WriteString("## Event\n\nSource: ")
	b.WriteString(ev.Source)
	b.WriteString("\nType: ")
	b.WriteString(ev.EventType)
	b.WriteString("\nSubject: ")
	b.WriteString(ev.Subject)
	b.WriteString("\n\n")
	b.WriteString(ev.Text)
	b.WriteString("\n\n## Background tasks\n\n")
	for i, t := range batch {
		fmt.Fprintf(&b, "%d. id: %s\n   intent: %s\n   matchCriteria: %s\n\n",
			i+1, t.task.Slug, truncate(t.task.Instructions, 500), truncate(t.criteria, 500))
	}
	return b.String()
}

// pass2SystemPrompt is the RFC 003 single-pair decision prompt.
const pass2SystemPrompt = `Decide whether this one event should trigger this one background task.
Return JSON only: {"match": boolean, "confidence": number, "explanation": string}.

Rules:
- Trigger only if the event is directly relevant to the criteria.
- confidence must be 0.0 to 1.0.
- explanation must be one sentence.`

func pass2Prompt(ev *ent.CloudEvent, t eligibleTask) string {
	var b strings.Builder
	b.WriteString("## Task\n\nname: ")
	b.WriteString(t.task.Name)
	b.WriteString("\ninstructions: ")
	b.WriteString(truncate(t.task.Instructions, 800))
	b.WriteString("\neventMatchCriteria: ")
	b.WriteString(truncate(t.criteria, 500))
	b.WriteString("\n\n## Event\n\nsource/type: ")
	b.WriteString(ev.Source)
	b.WriteString(" / ")
	b.WriteString(ev.EventType)
	b.WriteString("\nsubject: ")
	b.WriteString(ev.Subject)
	b.WriteString("\ntext: ")
	b.WriteString(ev.Text)
	return b.String()
}
