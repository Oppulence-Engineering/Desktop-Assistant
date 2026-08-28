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

	providerRelease := make(chan struct{})
	custodyRelease := make(chan struct{})
	providerStarted := make(chan struct{}, 2)
	var providerCalls atomic.Int64
	var completed atomic.Int64
	done := make(chan credentialCustodyResult, 2)
	providerOperation := func() {
		permit, err := s.acquireProviderOperation()
		if err != nil {
			done <- credentialCustodyResult{err: err}
			return
		}
		defer permit.release()
		providerCalls.Add(1)
		providerStarted <- struct{}{}
		<-providerRelease
		done <- permit.submit(func() credentialCustodyResult {
			_ = secret
			<-custodyRelease // PostgreSQL recovery and provider revocation are unavailable.
			completed.Add(1)
			return credentialCustodyResult{recoveryID: "00000000-0000-0000-0000-000000000001"}
		})
	}

	for i := 0; i < int(s.capacity); i++ {
		go providerOperation()
	}
	for i := 0; i < int(s.capacity); i++ {
		<-providerStarted
	}
	if got := s.pending.Load(); got != s.capacity {
		t.Fatalf("reserved operations = %d, want hard capacity %d", got, s.capacity)
	}

	const excess = 12
	for i := 0; i < excess; i++ {
		permit, err := s.acquireProviderOperation()
		if permit != nil || !errors.Is(err, errCredentialCustodySaturated) {
			t.Fatalf("excess caller %d was not denied before provider invocation: permit=%v err=%v", i, permit, err)
		}
		if got := s.pending.Load(); got > s.capacity {
			t.Fatalf("pending exceeded hard capacity: pending=%d capacity=%d", got, s.capacity)
		}
	}
	if got := providerCalls.Load(); got != s.capacity {
		t.Fatalf("provider calls = %d, want at most hard capacity %d", got, s.capacity)
	}

	deadline := time.Now().Add(time.Second)
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

	close(providerRelease)
	select {
	case <-closed:
		t.Fatal("shutdown returned while credentials lacked custody during dual outage")
	case <-time.After(30 * time.Millisecond):
	}
	close(custodyRelease)
	for i := 0; i < int(s.capacity); i++ {
		result := <-done
		if result.err != nil || result.recoveryID == "" {
			t.Fatalf("reserved custody result %d = %+v", i, result)
		}
	}
	select {
	case <-closed:
	case <-time.After(time.Second):
		t.Fatal("shutdown did not drain admitted credentials")
	}
	if completed.Load() != s.capacity {
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

func TestCredentialCustodySupervisorPreShutdownProviderOperationCanSubmitAfterDrainStarts(t *testing.T) {
	s := newCredentialCustodySupervisor(zap.NewNop(), 1, 1)
	permit, err := s.acquireProviderOperation()
	if err != nil {
		t.Fatalf("acquire provider operation: %v", err)
	}

	s.beginShutdown()
	closed := make(chan error, 1)
	go func() { closed <- s.closeContext(context.Background()) }()

	deadline := time.Now().Add(time.Second)
	for {
		s.mu.RLock()
		stopping := s.stopping
		s.mu.RUnlock()
		if stopping || time.Now().After(deadline) {
			break
		}
		time.Sleep(time.Millisecond)
	}

	// This models an HTTP handler whose provider response arrives after the
	// listener drain deadline. Because the provider call was registered before
	// shutdown, the resulting credential is still admitted and tracked.
	result := permit.submit(func() credentialCustodyResult {
		return credentialCustodyResult{recoveryID: "durable-after-late-provider-response"}
	})
	permit.release()
	if result.err != nil || result.recoveryID == "" {
		t.Fatalf("pre-shutdown provider response was dropped: %+v", result)
	}
	select {
	case err := <-closed:
		if err != nil {
			t.Fatalf("shutdown after late provider response: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("shutdown did not wait for pre-shutdown provider operation")
	}

	if _, err := s.acquireProviderOperation(); !errors.Is(err, errCredentialCustodyStopping) {
		t.Fatalf("post-drain provider operation was not rejected before exchange: %v", err)
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
