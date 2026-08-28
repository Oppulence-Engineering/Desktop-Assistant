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

// credentialCustodySupervisor bounds concurrent dual-outage recovery while
// retaining custody of every admitted credential. Admission blocks at capacity,
// workers use a process-scoped context, and close drains rather than canceling.
type credentialCustodySupervisor struct {
	log       *zap.Logger
	queue     chan credentialCustodyTask
	workers   sync.WaitGroup
	inflight  sync.WaitGroup
	producers sync.WaitGroup
	mu        sync.RWMutex
	quiescing bool
	stopping  bool
	drainDone chan struct{}
	pending   atomic.Int64
	acquiring atomic.Int64
	saturated atomic.Bool
}

func newCredentialCustodySupervisor(log *zap.Logger, workers, queueSize int) *credentialCustodySupervisor {
	if workers < 1 {
		workers = 1
	}
	if queueSize < 1 {
		queueSize = 1
	}
	s := &credentialCustodySupervisor{log: log, queue: make(chan credentialCustodyTask, queueSize)}
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
				pending := s.pending.Add(-1)
				connectormetrics.CredentialCustodyInFlight.Dec()
				if s.isQuiescing() {
					connectormetrics.CredentialCustodyShutdownUnresolved.Set(float64(pending + s.acquiring.Load()))
				}
				s.inflight.Done()
				s.updateSaturation()
			}
		}()
	}
	return s
}

func (s *credentialCustodySupervisor) submit(run func() credentialCustodyResult) credentialCustodyResult {
	return s.submitInternal(run, nil)
}

func (s *credentialCustodySupervisor) submitInternal(run func() credentialCustodyResult, permit *credentialCustodyPermit) credentialCustodyResult {
	task := credentialCustodyTask{run: run, result: make(chan credentialCustodyResult, 1)}
	s.mu.RLock()
	stopping := s.stopping
	preaccepted := permit != nil && permit.supervisor == s
	if !stopping || preaccepted {
		if preaccepted {
			s.acquiring.Add(-1)
		}
		s.inflight.Add(1)
		pending := s.pending.Add(1)
		connectormetrics.CredentialCustodyInFlight.Inc()
		if s.quiescing {
			connectormetrics.CredentialCustodyShutdownUnresolved.Set(float64(pending + s.acquiring.Load()))
		}
	}
	s.mu.RUnlock()
	if stopping && !preaccepted {
		// Admission closes only after the public listener has drained. Reaching this
		// path means a request outlived the HTTP shutdown bound. Never execute new,
		// untracked custody work after the drain snapshot.
		connectormetrics.CredentialCustodyOutcomes.WithLabelValues("rejected_after_shutdown").Inc()
		if s.log != nil {
			s.log.Error("credential custody work arrived after shutdown admission closed",
				zap.String("operator_action", "treat_process_exit_as_unresolved_credential_custody"))
		}
		return credentialCustodyResult{err: errCredentialCustodyStopping}
	}
	select {
	case s.queue <- task:
		connectormetrics.CredentialCustodyQueueDepth.Set(float64(len(s.queue)))
		s.updateSaturation()
	default:
		s.setSaturated(true)
		s.queue <- task
		connectormetrics.CredentialCustodyQueueDepth.Set(float64(len(s.queue)))
	}
	return <-task.result
}

// acquireProviderOperation must be called immediately before an operation that
// can return a new provider credential. It closes the gap between a timed-out
// HTTP drain and custody admission: closeContext cannot close the queue until
// every pre-shutdown permit either submits the credential or confirms that no
// credential was received.
func (s *credentialCustodySupervisor) acquireProviderOperation() (*credentialCustodyPermit, error) {
	s.mu.Lock()
	if s.stopping {
		s.mu.Unlock()
		connectormetrics.CredentialCustodyOutcomes.WithLabelValues("provider_operation_rejected_after_shutdown").Inc()
		if s.log != nil {
			s.log.Error("provider credential operation rejected after shutdown admission closed",
				zap.String("operator_action", "retry_on_a_ready_replica; no_provider_credential_was_requested"))
		}
		return nil, errCredentialCustodyStopping
	}
	s.producers.Add(1)
	acquiring := s.acquiring.Add(1)
	if s.quiescing {
		connectormetrics.CredentialCustodyShutdownUnresolved.Set(float64(s.pending.Load() + acquiring))
	}
	s.mu.Unlock()
	return &credentialCustodyPermit{supervisor: s}, nil
}

func (p *credentialCustodyPermit) submit(run func() credentialCustodyResult) credentialCustodyResult {
	if p == nil || p.supervisor == nil || p.released.Load() || !p.submitted.CompareAndSwap(false, true) {
		return credentialCustodyResult{err: errCredentialCustodyStopping}
	}
	return p.supervisor.submitInternal(run, p)
}

func (p *credentialCustodyPermit) release() {
	if p == nil || p.supervisor == nil || !p.released.CompareAndSwap(false, true) {
		return
	}
	if !p.submitted.Load() {
		acquiring := p.supervisor.acquiring.Add(-1)
		if p.supervisor.isQuiescing() {
			connectormetrics.CredentialCustodyShutdownUnresolved.Set(float64(p.supervisor.pending.Load() + acquiring))
		}
	}
	p.supervisor.producers.Done()
}

func (s *credentialCustodySupervisor) updateSaturation() {
	s.setSaturated(len(s.queue) == cap(s.queue))
}

func (s *credentialCustodySupervisor) setSaturated(value bool) {
	previous := s.saturated.Swap(value)
	if value {
		connectormetrics.CredentialCustodySaturated.Set(1)
	} else {
		connectormetrics.CredentialCustodySaturated.Set(0)
	}
	if value && !previous && s.log != nil {
		s.log.Error("connector credential custody supervisor saturated; applying admission backpressure",
			zap.Int("queue_capacity", cap(s.queue)), zap.Int64("in_flight", s.pending.Load()))
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
	pending := s.pending.Load() + s.acquiring.Load()
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
			s.producers.Wait()
			s.inflight.Wait()
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
		pending := s.pending.Load() + s.acquiring.Load()
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
