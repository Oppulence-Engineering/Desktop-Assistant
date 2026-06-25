package agenttoken

import (
	"testing"
	"time"
)

func TestApprovalRoundTrip(t *testing.T) {
	s, err := NewSigner("super-secret-key")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_700_000_000, 0)
	claims := ApprovalClaims{ApprovalID: "a1", UserID: "u1", SessionID: "s1", TrustTier: "money-moving", MFA: true}
	tok, err := s.MintApproval(claims, now, 10*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.VerifyApproval(tok, now.Add(time.Minute))
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if got != claims {
		t.Fatalf("claims roundtrip mismatch: %+v vs %+v", got, claims)
	}
}

func TestTamperedTokenRejected(t *testing.T) {
	s, _ := NewSigner("k")
	now := time.Unix(1_700_000_000, 0)
	tok, _ := s.MintApproval(ApprovalClaims{ApprovalID: "a1", MFA: true}, now, time.Minute)
	// Flip the last character of the signature.
	bad := tok[:len(tok)-1] + flip(tok[len(tok)-1])
	if _, err := s.VerifyApproval(bad, now); err == nil {
		t.Fatal("tampered token must fail verification")
	}
}

func TestExpiredRejected(t *testing.T) {
	s, _ := NewSigner("k")
	now := time.Unix(1_700_000_000, 0)
	tok, _ := s.MintApproval(ApprovalClaims{ApprovalID: "a1"}, now, time.Minute)
	if _, err := s.VerifyApproval(tok, now.Add(2*time.Minute)); err != ErrExpired {
		t.Fatalf("expected ErrExpired, got %v", err)
	}
}

func TestWrongSecretRejected(t *testing.T) {
	s1, _ := NewSigner("k1")
	s2, _ := NewSigner("k2")
	now := time.Unix(1_700_000_000, 0)
	tok, _ := s1.MintApproval(ApprovalClaims{ApprovalID: "a1"}, now, time.Minute)
	if _, err := s2.VerifyApproval(tok, now); err != ErrSignature {
		t.Fatalf("expected ErrSignature with a different key, got %v", err)
	}
}

func TestKindNotInterchangeable(t *testing.T) {
	s, _ := NewSigner("k")
	now := time.Unix(1_700_000_000, 0)
	cont, _ := s.MintContinuation(ContinuationClaims{WorkflowID: "wf", SessionID: "s1", UserID: "u1"}, now, time.Minute)
	// A continuation token must not verify as an approval token.
	if _, err := s.VerifyApproval(cont, now); err != ErrKind {
		t.Fatalf("expected ErrKind for cross-kind use, got %v", err)
	}
}

func TestEmptySecretRejected(t *testing.T) {
	if _, err := NewSigner("  "); err == nil {
		t.Fatal("empty secret must be rejected (fail closed)")
	}
}

func flip(b byte) string {
	if b == 'A' {
		return "B"
	}
	return "A"
}
