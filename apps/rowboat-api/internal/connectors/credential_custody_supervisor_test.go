package connectors

import (
	"bytes"
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
	log := zap.New(zapcore.NewCore(encoder, zapcore.AddSync(&logs), zap.DebugLevel))
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
	for s.ready() == nil && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if !errors.Is(s.ready(), errCredentialCustodySaturated) {
		t.Fatalf("expected saturation readiness failure, got %v", s.ready())
	}

	closed := make(chan struct{})
	go func() { s.close(); close(closed) }()
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
	log := zap.New(zapcore.NewCore(zapcore.NewJSONEncoder(zap.NewProductionEncoderConfig()), zapcore.AddSync(&logs), zap.DebugLevel))

	first := newCredentialCustodySupervisor(log, 1, 1)
	result := first.submit(func() credentialCustodyResult {
		_ = secret
		return credentialCustodyResult{revoked: true}
	})
	if !result.revoked {
		t.Fatal("first process did not confirm revocation")
	}
	first.close()

	// A restarted process has a fresh bounded supervisor and can resume durable
	// recovery work discovered by the cleanup worker.
	second := newCredentialCustodySupervisor(log, 1, 1)
	result = second.submit(func() credentialCustodyResult {
		_ = secret
		return credentialCustodyResult{recoveryID: "durable-recovery-row"}
	})
	second.close()
	if result.recoveryID == "" {
		t.Fatal("restart did not establish durable recovery")
	}
	if strings.Contains(logs.String(), secret) {
		t.Fatal("provider credential appeared in logs")
	}
}
