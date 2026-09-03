package connectors

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/connectormetrics"
	"go.uber.org/zap"
)

var errCredentialCustodySaturated = errors.New("credential custody supervisor saturated")
var errCredentialCustodyStopping = errors.New("credential custody supervisor draining")
var errCredentialCustodyUnresolved = errors.New("credential custody work has no acknowledged durable or revoked outcome")

type credentialCustodyShutdownError struct {
	pending int64
	cause   error
}

func (e *credentialCustodyShutdownError) Error() string {
	return fmt.Sprintf("credential custody shutdown deadline expired with %d admitted task(s) unresolved: %v", e.pending, e.cause)
}

func (e *credentialCustodyShutdownError) Unwrap() error { return e.cause }

type credentialCustodyResult struct {
	recoveryID string
	revoked    bool
	err        error
}

type credentialCustodyTask struct {
	run    func() credentialCustodyResult
	result chan credentialCustodyResult
}

// credentialCustodyPermit registers a provider operation before it can receive
// a live credential. A permit acquired before shutdown may hand that credential
// to the supervisor after HTTP draining times out; shutdown waits for the permit
// before closing the queue. Operations that start after admission closes are
// rejected before contacting the provider.
type credentialCustodyPermit struct {
	supervisor *credentialCustodySupervisor
	submitted  atomic.Bool
	released   atomic.Bool
}

// credentialCustodySupervisor bounds provider operations plus queued dual-outage
// recovery as one hard capacity domain. Every provider operation reserves before
// invocation, and its permit retains capacity until it confirms no credential was
// returned or the worker acknowledges durable custody/provider revocation.
type credentialCustodySupervisor struct {
	log       *zap.Logger
	queue     chan credentialCustodyTask
	permits   chan struct{}
	capacity  int64
	workers   sync.WaitGroup
	active    sync.WaitGroup
	mu        sync.RWMutex
	quiescing bool
	stopping  bool
	drainDone chan struct{}
	pending   atomic.Int64
	saturated atomic.Bool
}

func newCredentialCustodySupervisor(log *zap.Logger, workers, queueSize int) *credentialCustodySupervisor {
	if workers < 1 {
		workers = 1
	}
	if queueSize < 1 {
		queueSize = 1
	}
	capacity := workers + queueSize
	s := &credentialCustodySupervisor{
		log:      log,
		queue:    make(chan credentialCustodyTask, queueSize),
		permits:  make(chan struct{}, capacity),
		capacity: int64(capacity),
	}
	for i := 0; i < workers; i++ {
		s.workers.Add(1)
		go func() {
			defer s.workers.Done()
			for task := range s.queue {
				connectormetrics.CredentialCustodyQueueDepth.Set(float64(len(s.queue)))
				s.updateSaturation()
				result := task.run()
				task.result <- result
				close(task.result)
				s.releaseReservation()
			}
		}()
	}
	return s
}

func (s *credentialCustodySupervisor) submit(run func() credentialCustodyResult) credentialCustodyResult {
	permit, err := s.reserve(false)
	if err != nil {
		return credentialCustodyResult{err: err}
	}
	defer permit.release()
	return permit.submit(run)
}

func (s *credentialCustodySupervisor) submitReserved(run func() credentialCustodyResult, permit *credentialCustodyPermit) credentialCustodyResult {
	if run == nil || permit == nil || permit.supervisor != s {
		return credentialCustodyResult{err: errCredentialCustodyStopping}
	}
	task := credentialCustodyTask{run: run, result: make(chan credentialCustodyResult, 1)}
	// The reservation domain is workers + queue capacity, so every sender here is
	// already inside the hard bound. A scheduler-delayed send can wait only for a
	// worker to consume a bounded queue slot; excess callers were rejected before
	// their provider invocation and cannot accumulate as untracked submitters.
	s.queue <- task
	connectormetrics.CredentialCustodyQueueDepth.Set(float64(len(s.queue)))
	return <-task.result
}

// acquireProviderOperation must be called immediately before an operation that
// can return a new provider credential. It closes the gap between a timed-out
// HTTP drain and custody admission: closeContext cannot close the queue until
// every pre-shutdown permit either submits the credential or confirms that no
// credential was received.
func (s *credentialCustodySupervisor) acquireProviderOperation() (*credentialCustodyPermit, error) {
	return s.reserve(true)
}

func (s *credentialCustodySupervisor) reserve(providerOperation bool) (*credentialCustodyPermit, error) {
	s.mu.Lock()
	if s.stopping {
		s.mu.Unlock()
		outcome := "rejected_after_shutdown"
		message := "credential custody work rejected after shutdown admission closed"
		if providerOperation {
			outcome = "provider_operation_rejected_after_shutdown"
			message = "provider credential operation rejected after shutdown admission closed"
		}
		connectormetrics.CredentialCustodyOutcomes.WithLabelValues(outcome).Inc()
		if s.log != nil {
			s.log.Error(message,
				zap.String("operator_action", "retry_on_a_ready_replica; no_provider_credential_was_requested"))
		}
		return nil, errCredentialCustodyStopping
	}
	select {
	case s.permits <- struct{}{}:
	default:
		s.setSaturated(true)
		s.mu.Unlock()
		outcome := "custody_work_rejected_at_capacity"
		if providerOperation {
			outcome = "provider_operation_rejected_at_capacity"
		}
		connectormetrics.CredentialCustodyOutcomes.WithLabelValues(outcome).Inc()
		return nil, errCredentialCustodySaturated
	}
	s.active.Add(1)
	pending := s.pending.Add(1)
	connectormetrics.CredentialCustodyInFlight.Inc()
	if s.quiescing {
		connectormetrics.CredentialCustodyShutdownUnresolved.Set(float64(pending))
	}
	if pending >= s.capacity {
		s.setSaturated(true)
	}
	s.mu.Unlock()
	return &credentialCustodyPermit{supervisor: s}, nil
}

func (p *credentialCustodyPermit) submit(run func() credentialCustodyResult) credentialCustodyResult {
	if p == nil || p.supervisor == nil || run == nil || p.released.Load() || !p.submitted.CompareAndSwap(false, true) {
		return credentialCustodyResult{err: errCredentialCustodyStopping}
	}
	return p.supervisor.submitReserved(run, p)
}

func (p *credentialCustodyPermit) release() {
	if p == nil || p.supervisor == nil || !p.released.CompareAndSwap(false, true) {
		return
	}
	if !p.submitted.Load() {
		p.supervisor.releaseReservation()
	}
}

func (s *credentialCustodySupervisor) updateSaturation() {
	s.setSaturated(s.pending.Load() >= s.capacity)
}

func (s *credentialCustodySupervisor) releaseReservation() {
	select {
	case <-s.permits:
	default:
		if s.log != nil {
			s.log.Error("credential custody reservation accounting underflow")
		}
		return
	}
	pending := s.pending.Add(-1)
	connectormetrics.CredentialCustodyInFlight.Dec()
	if s.isQuiescing() {
		connectormetrics.CredentialCustodyShutdownUnresolved.Set(float64(pending))
	}
	s.active.Done()
	s.updateSaturation()
}

func (s *credentialCustodySupervisor) setSaturated(value bool) {
	previous := s.saturated.Swap(value)
	if value {
		connectormetrics.CredentialCustodySaturated.Set(1)
	} else {
		connectormetrics.CredentialCustodySaturated.Set(0)
	}
	if value && !previous && s.log != nil {
		s.log.Error("connector credential custody supervisor saturated; rejecting provider operations before invocation",
			zap.Int64("hard_capacity", s.capacity), zap.Int64("reserved", s.pending.Load()))
		connectormetrics.CredentialCustodyOutcomes.WithLabelValues("saturated").Inc()
	}
}

func (s *credentialCustodySupervisor) ready() error {
	s.mu.RLock()
	quiescing := s.quiescing
	s.mu.RUnlock()
	if quiescing {
		return errCredentialCustodyStopping
	}
	if s.saturated.Load() {
		return errCredentialCustodySaturated
	}
	if s.pending.Load() > 0 {
		return errCredentialCustodyUnresolved
	}
	return nil
}

// beginShutdown fails readiness before listener draining starts while keeping
// admission open for requests that were already accepted by the HTTP server.
// The metrics listener stays up through the bounded custody drain.
func (s *credentialCustodySupervisor) beginShutdown() {
	s.mu.Lock()
	if s.quiescing {
		s.mu.Unlock()
		return
	}
	s.quiescing = true
	pending := s.pending.Load()
	s.mu.Unlock()

	connectormetrics.CredentialCustodyShutdownUnresolved.Set(float64(pending))
	if pending > 0 && s.log != nil {
		s.log.Error("shutdown began with unresolved credential custody work",
			zap.Int64("accepted_work_unresolved", pending),
			zap.String("operator_action", "block_disruption_and_restore_postgresql_or_provider_revocation_before_termination_deadline"))
	}
}

func (s *credentialCustodySupervisor) isQuiescing() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.quiescing
}

// close stops admission and drains every task admitted before the listener
// drain completed. It is bounded by ctx. A deadline returns an explicit error
// and leaves the unresolved gauge/log state intact rather than claiming a clean
// shutdown while credentials remain only in process memory.
func (s *credentialCustodySupervisor) closeContext(ctx context.Context) error {
	s.beginShutdown()

	s.mu.Lock()
	if !s.stopping {
		s.stopping = true
		s.drainDone = make(chan struct{})
		drainDone := s.drainDone
		go func() {
			s.active.Wait()
			close(s.queue)
			s.workers.Wait()
			connectormetrics.CredentialCustodyQueueDepth.Set(0)
			connectormetrics.CredentialCustodyShutdownUnresolved.Set(0)
			close(drainDone)
		}()
	}
	drainDone := s.drainDone
	s.mu.Unlock()

	select {
	case <-drainDone:
		connectormetrics.CredentialCustodyOutcomes.WithLabelValues("shutdown_drained").Inc()
		return nil
	case <-ctx.Done():
		pending := s.pending.Load()
		connectormetrics.CredentialCustodyShutdownUnresolved.Set(float64(pending))
		connectormetrics.CredentialCustodyOutcomes.WithLabelValues("shutdown_timed_out").Inc()
		if s.log != nil {
			s.log.Error("credential custody shutdown deadline expired with unresolved accepted work",
				zap.Int64("accepted_work_unresolved", pending), zap.Error(ctx.Err()),
				zap.String("operator_action", "page_security_and_restore_postgresql_or_provider_revocation; do_not_treat_rollout_as_clean"))
		}
		return &credentialCustodyShutdownError{pending: pending, cause: ctx.Err()}
	}
}

// close preserves the simple cleanup contract used by focused tests. Runtime
// lifecycle code must use closeContext with a deadline.
func (s *credentialCustodySupervisor) close() { _ = s.closeContext(context.Background()) }

// processContext deliberately has no request or signal cancellation. Admitted
// work keeps trying for an acknowledged custody outcome while closeContext
// bounds how long server shutdown waits and reports any unresolved remainder.
func processContext() context.Context { return context.Background() }
