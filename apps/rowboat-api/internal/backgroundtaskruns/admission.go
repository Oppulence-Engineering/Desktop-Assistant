package backgroundtaskruns

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskrun"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskmetrics"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskworkflow"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/pricing"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/quota"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

const (
	defaultStartRateWindow     = time.Minute
	defaultPreflightOutputToks = 4096
	minPreflightInputToks      = 512
)

// AdmissionConfig controls run-start admission before a Temporal workflow is
// created. Zero values disable the individual guardrails, which keeps tests and
// local construction explicit.
type AdmissionConfig struct {
	Enabled bool

	MaxInflightGlobal  int
	MaxInflightPerUser int

	MaxStartsPerWindowGlobal  int
	MaxStartsPerWindowPerUser int
	StartRateWindow           time.Duration

	CreditPreflightEnabled bool
	CreditGate             *quota.Gate
	Prices                 *pricing.Table
	SpendLimits            quota.SpendLimits
	DefaultModel           string
	MaxLLMCalls            int
	MaxOutputTokens        int
}

// AdmissionFromConfig maps process config into the canonical starter policy.
func AdmissionFromConfig(cfg appconfig.Config, gate *quota.Gate, prices *pricing.Table) AdmissionConfig {
	return AdmissionConfig{
		Enabled:                   cfg.CloudRunAdmissionEnabled,
		MaxInflightGlobal:         cfg.CloudRunMaxInflightGlobal,
		MaxInflightPerUser:        cfg.CloudRunMaxInflightPerUser,
		MaxStartsPerWindowGlobal:  cfg.CloudRunRateLimitGlobalPerMin,
		MaxStartsPerWindowPerUser: cfg.CloudRunRateLimitPerUserPerMin,
		StartRateWindow:           time.Minute,
		CreditPreflightEnabled:    cfg.CloudRunCreditPreflightEnabled,
		CreditGate:                gate,
		Prices:                    prices,
		SpendLimits:               quota.SpendLimits{Daily: cfg.DailyCreditLimit, Monthly: cfg.MonthlyCreditLimit},
		DefaultModel:              cfg.CloudRuntimeModel,
		MaxLLMCalls:               cfg.CloudRuntimeMaxLLMCalls,
		MaxOutputTokens:           defaultPreflightOutputToks,
	}
}

// AdmissionRejectedError means the run was intentionally dead-lettered before
// Temporal start. Code is one of backgroundtaskworkflow's bounded error codes.
type AdmissionRejectedError struct {
	Code       string
	Message    string
	RetryAfter time.Duration
}

func (e *AdmissionRejectedError) Error() string { return e.Message }

// SetAdmission installs admission guardrails for future starts.
func (s *Starter) SetAdmission(cfg AdmissionConfig) {
	if cfg.StartRateWindow <= 0 {
		cfg.StartRateWindow = defaultStartRateWindow
	}
	if cfg.MaxLLMCalls <= 0 {
		cfg.MaxLLMCalls = 1
	}
	if cfg.MaxOutputTokens <= 0 {
		cfg.MaxOutputTokens = defaultPreflightOutputToks
	}
	s.Admission = cfg
}

func (s *Starter) checkAdmission(ctx context.Context, p Params) (*AdmissionRejectedError, error) {
	cfg := s.Admission
	if !cfg.Enabled {
		return nil, nil
	}
	internalCtx, cancel := context.WithTimeout(auth.WithInternal(context.Background()), 5*time.Second)
	defer cancel()
	if cfg.MaxInflightGlobal > 0 {
		n, err := s.countInflight(internalCtx, uuid.Nil)
		if err != nil {
			return nil, fmt.Errorf("admission count global inflight: %w", err)
		}
		if n >= cfg.MaxInflightGlobal {
			return reject(backgroundtaskworkflow.ErrCodeAdmissionBackpressure,
				"cloud run queue is at global capacity", 0), nil
		}
	}
	if cfg.MaxInflightPerUser > 0 {
		n, err := s.countInflight(internalCtx, p.User.ID)
		if err != nil {
			return nil, fmt.Errorf("admission count user inflight: %w", err)
		}
		if n >= cfg.MaxInflightPerUser {
			return reject(backgroundtaskworkflow.ErrCodeAdmissionBackpressure,
				"cloud run queue is at per-user capacity", 0), nil
		}
	}
	if cfg.MaxStartsPerWindowGlobal > 0 {
		n, err := s.countRecentStarts(internalCtx, uuid.Nil, cfg.StartRateWindow)
		if err != nil {
			return nil, fmt.Errorf("admission count global starts: %w", err)
		}
		if n >= cfg.MaxStartsPerWindowGlobal {
			return reject(backgroundtaskworkflow.ErrCodeAdmissionRateLimited,
				"cloud run start rate limit exceeded globally", cfg.StartRateWindow), nil
		}
	}
	if cfg.MaxStartsPerWindowPerUser > 0 {
		n, err := s.countRecentStarts(internalCtx, p.User.ID, cfg.StartRateWindow)
		if err != nil {
			return nil, fmt.Errorf("admission count user starts: %w", err)
		}
		if n >= cfg.MaxStartsPerWindowPerUser {
			return reject(backgroundtaskworkflow.ErrCodeAdmissionRateLimited,
				"cloud run start rate limit exceeded for this user", cfg.StartRateWindow), nil
		}
	}
	if cfg.CreditPreflightEnabled && cfg.CreditGate != nil && cfg.Prices != nil {
		estimated := cfg.estimateCredits(p)
		if err := cfg.CreditGate.Preflight(auth.WithUser(ctx, p.User), estimated, cfg.SpendLimits); err != nil {
			code, msg := quotaRejection(err)
			if code == "" {
				return nil, fmt.Errorf("admission credit preflight: %w", err)
			}
			return reject(code, msg, 0), nil
		}
	}
	return nil, nil
}

func (s *Starter) countInflight(ctx context.Context, userID uuid.UUID) (int, error) {
	q := s.Client.BackgroundTaskRun.Query().
		Where(
			backgroundtaskrun.ExecutorEQ("api"),
			backgroundtaskrun.StatusIn("queued", "running"),
		)
	if userID != uuid.Nil {
		q = q.Where(backgroundtaskrun.HasUserWith(user.IDEQ(userID)))
	}
	return q.Count(ctx)
}

func (s *Starter) countRecentStarts(ctx context.Context, userID uuid.UUID, window time.Duration) (int, error) {
	if window <= 0 {
		window = defaultStartRateWindow
	}
	q := s.Client.BackgroundTaskRun.Query().
		Where(
			backgroundtaskrun.ExecutorEQ("api"),
			backgroundtaskrun.CreatedAtGTE(time.Now().UTC().Add(-window)),
		)
	if userID != uuid.Nil {
		q = q.Where(backgroundtaskrun.HasUserWith(user.IDEQ(userID)))
	}
	return q.Count(ctx)
}

func reject(code, message string, retryAfter time.Duration) *AdmissionRejectedError {
	return &AdmissionRejectedError{Code: code, Message: message, RetryAfter: retryAfter}
}

func quotaRejection(err error) (code, message string) {
	switch {
	case errors.Is(err, quota.ErrInsufficientCredits):
		return backgroundtaskworkflow.ErrCodeInsufficientCredits, "insufficient credits for cloud run preflight"
	case errors.Is(err, quota.ErrSubscriptionNotActive):
		return backgroundtaskworkflow.ErrCodeSubscriptionNotActive, "subscription not active for cloud run preflight"
	case errors.Is(err, quota.ErrDailyLimitExceeded):
		return backgroundtaskworkflow.ErrCodeDailyCreditLimit, "daily credit limit exceeded for cloud run preflight"
	case errors.Is(err, quota.ErrMonthlyLimitExceeded):
		return backgroundtaskworkflow.ErrCodeMonthlyCreditLimit, "monthly credit limit exceeded for cloud run preflight"
	default:
		return "", ""
	}
}

func (cfg AdmissionConfig) estimateCredits(p Params) int {
	model := p.Task.Model
	if model == "" {
		model = cfg.DefaultModel
	}
	inputTokens := (len(p.Task.Name) + len(p.Task.Instructions) + len(p.RequestedContext) + len(p.Task.TriggersJSON)) / 4
	if inputTokens < minPreflightInputToks {
		inputTokens = minPreflightInputToks
	}
	maxCalls := cfg.MaxLLMCalls
	if maxCalls <= 0 {
		maxCalls = 1
	}
	maxOutput := cfg.MaxOutputTokens
	if maxOutput <= 0 {
		maxOutput = defaultPreflightOutputToks
	}
	return cfg.Prices.LLMEstimate(model, inputTokens, maxOutput) * maxCalls
}

func (s *Starter) createDeadLetterRun(ctx context.Context, p Params, runID, trigger string, rejection *AdmissionRejectedError, priorityKey int) (*ent.BackgroundTaskRun, error) {
	now := time.Now().UTC()
	run, err := s.Client.BackgroundTaskRun.Create().
		SetUser(p.User).
		SetTask(p.Task).
		SetRunID(runID).
		SetTrigger(trigger).
		SetStatus("failed").
		SetExecutor("api").
		SetTemporalStatus("DeadLettered").
		SetTemporalClosedAt(now).
		SetCompletedAt(now).
		SetError(rejection.Message).
		SetErrorCode(rejection.Code).
		SetErrorDetails(rejection.Message).
		SetProgressPercent(0).
		SetProgressMessage("Dead-lettered before Temporal start.").
		Save(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.appendDeadLetterEvent(ctx, p, run, rejection, priorityKey); err != nil {
		s.Log.Warn("append dead-letter event failed", zap.String("runId", runID), zap.Error(err))
	}
	backgroundtaskmetrics.AdmissionRejected.WithLabelValues(rejection.Code).Inc()
	backgroundtaskmetrics.Failed.WithLabelValues(rejection.Code).Inc()
	s.Log.Warn("cloud run dead-lettered before temporal start",
		append(runLogFields(ctx, p, run),
			zap.String("errorCode", rejection.Code),
			zap.Int("priorityKey", priorityKey),
		)...)
	return run, nil
}

func (s *Starter) appendDeadLetterEvent(ctx context.Context, p Params, run *ent.BackgroundTaskRun, rejection *AdmissionRejectedError, priorityKey int) error {
	event := map[string]any{
		"type":        backgroundtaskworkflow.EventDeadLettered,
		"message":     rejection.Message,
		"trigger":     run.Trigger,
		"runId":       run.RunID,
		"requestedBy": string(p.sourceOrDefault()),
		"errorCode":   rejection.Code,
		"priorityKey": priorityKey,
	}
	if rejection.RetryAfter > 0 {
		event["retryAfterSeconds"] = int(rejection.RetryAfter.Seconds())
	}
	raw, err := json.Marshal(event)
	if err != nil {
		return err
	}
	return s.Client.BackgroundTaskRunEvent.Create().
		SetUser(p.User).
		SetTask(p.Task).
		SetRun(run).
		SetSeq(0).
		SetEventType(backgroundtaskworkflow.EventDeadLettered).
		SetEventJSON(string(raw)).
		Exec(ctx)
}

// PriorityFor maps run provenance to Temporal's native task priority. Lower
// values run sooner.
func PriorityFor(trigger string, source Source) int {
	switch trigger {
	case "manual", "retry":
		return backgroundtaskworkflow.PriorityHigh
	case "event":
		return backgroundtaskworkflow.PriorityDefault
	case "cron", "window":
		return backgroundtaskworkflow.PriorityLow
	default:
		if source == SourceScheduler || source == SourceTemporalSchedule {
			return backgroundtaskworkflow.PriorityLow
		}
		return backgroundtaskworkflow.PriorityDefault
	}
}
