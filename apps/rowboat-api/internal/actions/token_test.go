package actions

import (
	"errors"
	"strings"
	"testing"
	"time"
)

const testSecret = "test-signing-secret-that-is-32-bytes+"

func testClaims() Claims {
	return Claims{
		ProposalID: "11111111-1111-1111-1111-111111111111",
		Target:     "conduit:invoice:inv_456",
		Kind:       "conduit.dunning.advance",
		ParamsHash: "abc123",
		UserID:     "22222222-2222-2222-2222-222222222222",
		StepUp:     true,
	}
}

func TestNewSignerRejectsEmptySecret(t *testing.T) {
	if _, err := NewSigner("   "); err == nil {
		t.Fatal("expected empty secret to be rejected (fail closed)")
	}
}

func TestTokenMintVerifyRoundTrip(t *testing.T) {
	s, err := NewSigner(testSecret)
	if err != nil {
		t.Fatalf("signer: %v", err)
	}
	now := time.Unix(1_700_000_000, 0)
	claims := testClaims()
	token, exp, err := s.Mint(claims, now, 5*time.Minute)
	if err != nil {
		t.Fatalf("mint: %v", err)
	}
	if !strings.HasPrefix(token, tokenPrefix) {
		t.Fatalf("token missing prefix: %q", token)
	}
	if !exp.Equal(now.Add(5 * time.Minute)) {
		t.Fatalf("exp = %v", exp)
	}
	got, err := s.Verify(token, now.Add(time.Minute))
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if *got != claims {
		t.Fatalf("claims round-trip mismatch: %+v != %+v", *got, claims)
	}
}

func TestTokenTamperedSignatureRejected(t *testing.T) {
	s, _ := NewSigner(testSecret)
	now := time.Unix(1_700_000_000, 0)
	token, _, _ := s.Mint(testClaims(), now, time.Minute)
	// Flip the last character of the signature.
	tampered := token[:len(token)-1] + flip(token[len(token)-1])
	if _, err := s.Verify(tampered, now); !errors.Is(err, ErrTokenSignature) {
		t.Fatalf("tampered signature err = %v, want ErrTokenSignature", err)
	}
}

func TestTokenTamperedPayloadRejected(t *testing.T) {
	s, _ := NewSigner(testSecret)
	now := time.Unix(1_700_000_000, 0)
	token, _, _ := s.Mint(testClaims(), now, time.Minute)
	// Corrupt a payload byte (before the dot): signature no longer matches.
	dot := strings.Index(token, ".")
	i := dot - 2
	tampered := token[:i] + flip(token[i]) + token[i+1:]
	if _, err := s.Verify(tampered, now); err == nil {
		t.Fatal("expected tampered payload to be rejected")
	}
}

func TestTokenWrongSecretRejected(t *testing.T) {
	s, _ := NewSigner(testSecret)
	other, _ := NewSigner("a-completely-different-secret-32bytes+")
	now := time.Unix(1_700_000_000, 0)
	token, _, _ := s.Mint(testClaims(), now, time.Minute)
	if _, err := other.Verify(token, now); !errors.Is(err, ErrTokenSignature) {
		t.Fatalf("wrong-secret err = %v, want ErrTokenSignature", err)
	}
}

func TestTokenExpiry(t *testing.T) {
	s, _ := NewSigner(testSecret)
	now := time.Unix(1_700_000_000, 0)
	token, _, _ := s.Mint(testClaims(), now, time.Minute)
	if _, err := s.Verify(token, now.Add(time.Minute)); !errors.Is(err, ErrTokenExpired) {
		t.Fatalf("at-expiry err = %v, want ErrTokenExpired", err)
	}
	if _, err := s.Verify(token, now.Add(30*time.Second)); err != nil {
		t.Fatalf("before expiry should verify, got %v", err)
	}
}

func TestTokenMalformedRejected(t *testing.T) {
	s, _ := NewSigner(testSecret)
	now := time.Unix(1_700_000_000, 0)
	for _, tok := range []string{"", "not-a-token", "acta_only-no-dot", tokenPrefix + "!!!.###"} {
		if _, err := s.Verify(tok, now); err == nil {
			t.Fatalf("expected %q to be rejected", tok)
		}
	}
}

func TestParamsHashOrderIndependent(t *testing.T) {
	a, err := ParamsHash(`{"amount":100,"note":"x","tags":["a","b"]}`)
	if err != nil {
		t.Fatalf("hash a: %v", err)
	}
	// Same content, different key order.
	b, err := ParamsHash(`{"tags":["a","b"],"note":"x","amount":100}`)
	if err != nil {
		t.Fatalf("hash b: %v", err)
	}
	if a != b {
		t.Fatalf("order-independent hashes differ: %s != %s", a, b)
	}
	// A different value must hash differently.
	c, _ := ParamsHash(`{"amount":101,"note":"x","tags":["a","b"]}`)
	if a == c {
		t.Fatal("changed value produced the same hash")
	}
}

func TestParamsHashEmptyStable(t *testing.T) {
	a, err := ParamsHash("")
	if err != nil {
		t.Fatalf("empty: %v", err)
	}
	b, _ := ParamsHash("   ")
	if a != b {
		t.Fatal("empty and whitespace params should hash equally")
	}
	if _, err := ParamsHash("{not json"); err == nil {
		t.Fatal("invalid JSON should error")
	}
}

func TestHashIsNotTheToken(t *testing.T) {
	token := tokenPrefix + "payload.sig"
	h := Hash(token)
	if h == token || strings.Contains(h, "payload") {
		t.Fatal("hash must not reveal the token")
	}
	if Hash(token) != h {
		t.Fatal("hash must be deterministic")
	}
	if len(h) != 64 {
		t.Fatalf("sha256 hex length = %d, want 64", len(h))
	}
}

func flip(b byte) string {
	if b == 'A' {
		return "B"
	}
	return "A"
}
