package backgroundtaskruntime

import "testing"

// TestRuntimeRequestIDAttemptSeeding: each activity attempt derives distinct
// request ids (fresh reservations on retry), while the same (run, attempt,
// call) triple stays deterministic (same-attempt duplicates replay).
func TestRuntimeRequestIDAttemptSeeding(t *testing.T) {
	a1c0 := runtimeRequestID("run-1", 1, 0)
	if runtimeRequestID("run-1", 1, 0) != a1c0 {
		t.Fatal("same (run, attempt, call) must be deterministic")
	}
	if runtimeRequestID("run-1", 2, 0) == a1c0 {
		t.Fatal("attempt 2 must derive a fresh id for call 0")
	}
	if runtimeRequestID("run-1", 1, 1) == a1c0 {
		t.Fatal("call 1 must differ from call 0")
	}
	if runtimeRequestID("run-2", 1, 0) == a1c0 {
		t.Fatal("different runs must not collide")
	}
}

// TestNewGatewayLLMClampsAttempt: attempt < 1 (no activity env) maps to 1.
func TestNewGatewayLLMClampsAttempt(t *testing.T) {
	g := NewGatewayLLM(nil, nil, "m", "slug", "run", 0)
	if g.attempt != 1 {
		t.Fatalf("attempt = %d, want clamp to 1", g.attempt)
	}
}
