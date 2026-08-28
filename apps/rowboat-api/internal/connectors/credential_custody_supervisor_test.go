package connectors

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

func TestCredentialCustodySupervisorDualOutageSaturationAndDrain(t *testing.T) {
	const secret = "provider-refresh-token-MUST-NOT-LOG"
	var logs bytes.Buffer
	encoder := zapcore.NewJSONEncoder(zap.NewProductionEncoderConfig())
	log := zap.New(zapcore.NewCore(encoder, zapcore.Lock(zapcore.AddSync(&logs)), zap.DebugLevel))
	s := newCredentialCustodySupervisor(log, 1, 1)

	release := make(chan struct{})
	started := make(chan struct{}, 3)
	var completed atomic.Int64
	run := func() credentialCustodyResult {
		_ = secret
		started <- struct{}{}
		<-release // PostgreSQL and provider are both unavailable.
		completed.Add(1)
		return credentialCustodyResult{recoveryID: "00000000-0000-0000-0000-000000000001"}
	}

	done := make(chan struct{}, 3)
	go func() { s.submit(run); done <- struct{}{} }()
	<-started
	go func() { s.submit(run); done <- struct{}{} }()
	deadline := time.Now().Add(time.Second)
	for len(s.queue) != 1 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	go func() { s.submit(run); done <- struct{}{} }()
	deadline = time.Now().Add(time.Second)
	for s.pending.Load() != 3 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if s.pending.Load() != 3 {
		t.Fatalf("third custody task was not admitted before shutdown: pending=%d", s.pending.Load())
	}

	deadline = time.Now().Add(time.Second)
	for s.ready() == nil && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if !errors.Is(s.ready(), errCredentialCustodySaturated) {
		t.Fatalf("expected saturation readiness failure, got %v", s.ready())
	}

	closed := make(chan struct{})
	go func() {
		if err := s.closeContext(context.Background()); err != nil {
			t.Errorf("close: %v", err)
		}
		close(closed)
	}()
	select {
	case <-closed:
		t.Fatal("shutdown returned while unowned credentials were still blocked")
	case <-time.After(30 * time.Millisecond):
	}

	close(release)
	for i := 0; i < 3; i++ {
		<-done
	}
	select {
	case <-closed:
	case <-time.After(time.Second):
		t.Fatal("shutdown did not drain admitted credentials")
	}
	if completed.Load() != 3 {
		t.Fatalf("dropped credentials: completed=%d", completed.Load())
	}
	if !errors.Is(s.ready(), errCredentialCustodyStopping) {
		t.Fatalf("drained supervisor unexpectedly ready: %v", s.ready())
	}

	output := logs.String()
	if !strings.Contains(output, "credential custody supervisor saturated") {
		t.Fatalf("missing saturation alert: %s", output)
	}
	if strings.Contains(output, secret) {
		t.Fatal("provider credential appeared in saturation logs")
	}
}

func TestCredentialCustodySupervisorRestartAndNoSecretLogging(t *testing.T) {
	const secret = "provider-refresh-token-MUST-NOT-LOG"
	var logs bytes.Buffer
	log := zap.New(zapcore.NewCore(zapcore.NewJSONEncoder(zap.NewProductionEncoderConfig()), zapcore.Lock(zapcore.AddSync(&logs)), zap.DebugLevel))

	first := newCredentialCustodySupervisor(log, 1, 1)
	result := first.submit(func() credentialCustodyResult {
		_ = secret
		return credentialCustodyResult{revoked: true}
	})
	if !result.revoked {
		t.Fatal("first process did not confirm revocation")
	}
	if err := first.closeContext(context.Background()); err != nil {
		t.Fatalf("close first supervisor: %v", err)
	}

	// A restarted process has a fresh bounded supervisor and can resume durable
	// recovery work discovered by the cleanup worker.
	second := newCredentialCustodySupervisor(log, 1, 1)
	result = second.submit(func() credentialCustodyResult {
		_ = secret
		return credentialCustodyResult{recoveryID: "durable-recovery-row"}
	})
	if err := second.closeContext(context.Background()); err != nil {
		t.Fatalf("close second supervisor: %v", err)
	}
	if result.recoveryID == "" {
		t.Fatal("restart did not establish durable recovery")
	}
	if strings.Contains(logs.String(), secret) {
		t.Fatal("provider credential appeared in logs")
	}
}

func TestCredentialCustodySupervisorShutdownDualOutageIsBoundedAndExplicit(t *testing.T) {
	const secret = "provider-refresh-token-MUST-NOT-LOG"
	var logs bytes.Buffer
	log := zap.New(zapcore.NewCore(zapcore.NewJSONEncoder(zap.NewProductionEncoderConfig()), zapcore.Lock(zapcore.AddSync(&logs)), zap.DebugLevel))
	s := newCredentialCustodySupervisor(log, 1, 1)

	started := make(chan struct{})
	release := make(chan struct{})
	done := make(chan credentialCustodyResult, 1)
	go func() {
		done <- s.submit(func() credentialCustodyResult {
			_ = secret
			close(started)
			<-release // PostgreSQL custody and provider revocation are both unavailable.
			return credentialCustodyResult{recoveryID: "durable-after-outage"}
		})
	}()
	<-started

	if !errors.Is(s.ready(), errCredentialCustodyUnresolved) {
		t.Fatalf("in-flight dual-outage custody must fail readiness immediately, got %v", s.ready())
	}
	s.beginShutdown()
	if !errors.Is(s.ready(), errCredentialCustodyStopping) {
		t.Fatalf("shutdown did not fail readiness immediately: %v", s.ready())
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 25*time.Millisecond)
	startedAt := time.Now()
	err := s.closeContext(shutdownCtx)
	cancel()
	if time.Since(startedAt) > 250*time.Millisecond {
		t.Fatalf("custody shutdown exceeded its bound: %s", time.Since(startedAt))
	}
	var unresolved *credentialCustodyShutdownError
	if !errors.As(err, &unresolved) || unresolved.pending != 1 || !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected explicit one-task unresolved shutdown error, got %#v", err)
	}
	select {
	case <-done:
		t.Fatal("shutdown timeout silently released an accepted custody submission")
	default:
	}

	output := logs.String()
	for _, required := range []string{
		"shutdown began with unresolved credential custody work",
		"credential custody shutdown deadline expired with unresolved accepted work",
		`"accepted_work_unresolved":1`,
		"operator_action",
	} {
		if !strings.Contains(output, required) {
			t.Fatalf("missing operator-visible shutdown state %q: %s", required, output)
		}
	}
	if strings.Contains(output, secret) {
		t.Fatal("provider credential appeared in shutdown outage logs")
	}

	// Recovery can still finish if the dependency outage clears before the
	// orchestrator's outer termination grace expires.
	close(release)
	select {
	case result := <-done:
		if result.recoveryID == "" {
			t.Fatalf("accepted work did not retain custody after outage cleared: %+v", result)
		}
	case <-time.After(time.Second):
		t.Fatal("accepted custody work did not resume after outage cleared")
	}
	if err := s.closeContext(context.Background()); err != nil {
		t.Fatalf("final drain after outage recovery: %v", err)
	}
}

func TestCredentialCustodySupervisorQuiescePreservesAcceptedRequestAdmission(t *testing.T) {
	s := newCredentialCustodySupervisor(zap.NewNop(), 1, 1)
	s.beginShutdown()

	result := s.submit(func() credentialCustodyResult {
		return credentialCustodyResult{recoveryID: "accepted-during-http-drain"}
	})
	if result.recoveryID == "" || result.err != nil {
		t.Fatalf("quiescing dropped work from an already accepted request: %+v", result)
	}
	if err := s.closeContext(context.Background()); err != nil {
		t.Fatalf("drain accepted request work: %v", err)
	}

	var ran atomic.Bool
	result = s.submit(func() credentialCustodyResult {
		ran.Store(true)
		return credentialCustodyResult{}
	})
	if !errors.Is(result.err, errCredentialCustodyStopping) {
		t.Fatalf("post-drain submission did not return an explicit shutdown error: %+v", result)
	}
	if ran.Load() {
		t.Fatal("post-drain submission ran outside bounded custody tracking")
	}
}
