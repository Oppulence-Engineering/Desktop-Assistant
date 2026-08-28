package connectors

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/connectormetrics"
	"go.uber.org/zap"
)

var errCredentialCustodySaturated = errors.New("credential custody supervisor saturated")
var errCredentialCustodyStopping = errors.New("credential custody supervisor draining")

type credentialCustodyResult struct {
	recoveryID string
	revoked    bool
	err        error
}

type credentialCustodyTask struct {
	run    func() credentialCustodyResult
	result chan credentialCustodyResult
}

// credentialCustodySupervisor bounds concurrent dual-outage recovery while
// retaining custody of every admitted credential. Admission blocks at capacity,
// workers use a process-scoped context, and close drains rather than canceling.
type credentialCustodySupervisor struct {
	log       *zap.Logger
	queue     chan credentialCustodyTask
	workers   sync.WaitGroup
	inflight  sync.WaitGroup
	mu        sync.RWMutex
	stopping  bool
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
	s := &credentialCustodySupervisor{log: log, queue: make(chan credentialCustodyTask, queueSize)}
	for i := 0; i < workers; i++ {
		s.workers.Add(1)
		go func() {
			defer s.workers.Done()
			for task := range s.queue {
				connectormetrics.CredentialCustodyQueueDepth.Set(float64(len(s.queue)))
				result := task.run()
				task.result <- result
				close(task.result)
				s.pending.Add(-1)
				connectormetrics.CredentialCustodyInFlight.Dec()
				s.inflight.Done()
				s.updateSaturation()
			}
		}()
	}
	return s
}

func (s *credentialCustodySupervisor) submit(run func() credentialCustodyResult) credentialCustodyResult {
	task := credentialCustodyTask{run: run, result: make(chan credentialCustodyResult, 1)}
	s.mu.RLock()
	stopping := s.stopping
	if !stopping {
		s.inflight.Add(1)
		s.pending.Add(1)
		connectormetrics.CredentialCustodyInFlight.Inc()
	}
	s.mu.RUnlock()
	if stopping {
		// Shutdown is registered after HTTP draining, so this is only a defensive
		// race path. Execute inline rather than abandon a live credential.
		return run()
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
	stopping := s.stopping
	s.mu.RUnlock()
	if stopping {
		return errCredentialCustodyStopping
	}
	if s.saturated.Load() {
		return errCredentialCustodySaturated
	}
	return nil
}

func (s *credentialCustodySupervisor) close() {
	s.mu.Lock()
	if s.stopping {
		s.mu.Unlock()
		s.workers.Wait()
		return
	}
	s.stopping = true
	s.mu.Unlock()
	s.setSaturated(true)
	s.inflight.Wait()
	close(s.queue)
	s.workers.Wait()
	connectormetrics.CredentialCustodyQueueDepth.Set(0)
}

// processContext deliberately has no request or signal cancellation. The
// supervisor's only shutdown operation is draining to an acknowledged custody
// outcome.
func processContext() context.Context { return context.Background() }
