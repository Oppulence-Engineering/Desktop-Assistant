package httpx

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// retryable is set by server policy on every error (RFC 010): transient/upstream
// classes are retryable; client and quota errors are not.
func TestErrorRetryablePolicy(t *testing.T) {
	cases := map[int]bool{
		http.StatusPaymentRequired:     false, // insufficient_credits
		http.StatusUnauthorized:        false,
		http.StatusBadRequest:          false,
		http.StatusTooManyRequests:     true,
		http.StatusServiceUnavailable:  true,
		http.StatusBadGateway:          true,
		http.StatusGatewayTimeout:      true,
		http.StatusInternalServerError: false,
	}
	for status, want := range cases {
		rec := httptest.NewRecorder()
		Error(rec, status, "msg", "some_code")

		var body struct {
			Retryable *bool `json:"retryable"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("status %d: decode: %v", status, err)
		}
		if body.Retryable == nil {
			t.Fatalf("status %d: retryable absent (must always be present)", status)
		}
		if *body.Retryable != want {
			t.Errorf("status %d: retryable=%v want %v", status, *body.Retryable, want)
		}
	}
}

// The extension-field path (ErrorWith) must carry both retryable and the extras.
func TestErrorWithIncludesRetryableAndExtras(t *testing.T) {
	rec := httptest.NewRecorder()
	ErrorWith(rec, http.StatusServiceUnavailable, "down", "upstream_unavailable", map[string]any{"reconnectRequired": true})

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["retryable"] != true {
		t.Errorf("retryable = %v, want true", body["retryable"])
	}
	if body["reconnectRequired"] != true {
		t.Errorf("extra field missing: %v", body["reconnectRequired"])
	}
	if body["code"] != "upstream_unavailable" {
		t.Errorf("code = %v, want upstream_unavailable", body["code"])
	}
}
