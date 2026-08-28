package oauthrs

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"
)

func TestEntitlementRequestVerifierRejectsReplayAcrossInstances(t *testing.T) {
	now := time.Date(2026, 8, 27, 22, 0, 0, 0, time.UTC)
	store, err := NewMemoryEntitlementReplayStore(32)
	if err != nil {
		t.Fatal(err)
	}
	store.now = func() time.Time { return now }
	config := EntitlementRequestVerifierConfig{
		SigningKey: []byte("0123456789abcdef0123456789abcdef"), Connector: "canvas", ReplayStore: store,
		Now: func() time.Time { return now },
	}
	first, err := NewEntitlementRequestVerifier(config)
	if err != nil {
		t.Fatal(err)
	}
	second, err := NewEntitlementRequestVerifier(config)
	if err != nil {
		t.Fatal(err)
	}
	body := []byte(`{"connector":"canvas","user_id":"user_1","scopes":["canvas:invoices.read"]}`)
	timestamp := now.Format(time.RFC3339)
	requestID := "0123456789abcdef0123456789abcdef"
	signature, err := SignEntitlementRequest(config.SigningKey, timestamp, requestID, body)
	if err != nil {
		t.Fatal(err)
	}
	header := make(http.Header)
	header.Set(EntitlementConnectorHeader, "canvas")
	header.Set(EntitlementTimestampHeader, timestamp)
	header.Set(EntitlementRequestIDHeader, requestID)
	header.Set(EntitlementSignatureHeader, signature)
	if err := first.Verify(context.Background(), header, body); err != nil {
		t.Fatalf("first verification failed: %v", err)
	}
	if err := second.Verify(context.Background(), header, body); !errors.Is(err, ErrEntitlementRequestReplay) {
		t.Fatalf("shared replay verification error = %v", err)
	}
}

func TestEntitlementSigningParityVectorAndTampering(t *testing.T) {
	key := []byte("0123456789abcdef0123456789abcdef")
	body := []byte(`{"allowed":true}`)
	const timestamp = "2026-08-27T22:00:00Z"
	const requestID = "request-0123456789abcdef"
	const expected = "sha256=84db9f0ae97e1b6d17b24c8b27b154a147e1abd7ccd55da3a86d764bc73f0f17"
	signature, err := SignEntitlementRequest(key, timestamp, requestID, body)
	if err != nil {
		t.Fatal(err)
	}
	if signature != expected {
		t.Fatalf("signature = %q, want parity vector %q", signature, expected)
	}

	store, _ := NewMemoryEntitlementReplayStore(8)
	store.now = func() time.Time { return time.Date(2026, 8, 27, 22, 0, 0, 0, time.UTC) }
	verifier, _ := NewEntitlementRequestVerifier(EntitlementRequestVerifierConfig{
		SigningKey: key, Connector: "canvas", ReplayStore: store, Now: store.now,
	})
	header := make(http.Header)
	header.Set(EntitlementConnectorHeader, "canvas")
	header.Set(EntitlementTimestampHeader, timestamp)
	header.Set(EntitlementRequestIDHeader, requestID+"x")
	header.Set(EntitlementSignatureHeader, signature)
	if err := verifier.Verify(context.Background(), header, body); !errors.Is(err, ErrEntitlementRequestInvalid) {
		t.Fatalf("request-ID tampering error = %v", err)
	}
}

func TestMemoryEntitlementReplayStoreFailsClosedWhenBounded(t *testing.T) {
	now := time.Now()
	store, _ := NewMemoryEntitlementReplayStore(1)
	store.now = func() time.Time { return now }
	if claimed, err := store.Claim(context.Background(), "first-request-id-0001", now.Add(time.Minute)); err != nil || !claimed {
		t.Fatalf("first claim = %v, %v", claimed, err)
	}
	if claimed, err := store.Claim(context.Background(), "second-request-id-002", now.Add(time.Minute)); err == nil || claimed {
		t.Fatalf("full bounded store claim = %v, %v", claimed, err)
	}
	now = now.Add(2 * time.Minute)
	if claimed, err := store.Claim(context.Background(), "second-request-id-002", now.Add(time.Minute)); err != nil || !claimed {
		t.Fatalf("claim after expiry = %v, %v", claimed, err)
	}
}
