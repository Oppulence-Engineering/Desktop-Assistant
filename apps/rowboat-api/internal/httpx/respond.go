// Package httpx holds small HTTP response helpers shared by every handler:
// the canonical error envelope and JSON writers.
package httpx

import (
	"encoding/json"
	"net/http"
)

// ErrorBody is the canonical error envelope:
//
//	{ "error": "human_readable_message", "code": "machine_readable_slug" }
type ErrorBody struct {
	Error string `json:"error"`
	Code  string `json:"code"`
}

// WriteJSON writes v as JSON with the given status.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// Error writes the canonical error envelope.
func Error(w http.ResponseWriter, status int, msg, code string) {
	if status == http.StatusUnauthorized {
		w.Header().Set("WWW-Authenticate", "Bearer")
	}
	WriteJSON(w, status, ErrorBody{Error: msg, Code: code})
}

// ErrorWith writes the error envelope plus extra top-level fields (e.g.
// "reconnectRequired": true on the Google refresh path).
func ErrorWith(w http.ResponseWriter, status int, msg, code string, extra map[string]any) {
	body := map[string]any{"error": msg, "code": code}
	for k, v := range extra {
		body[k] = v
	}
	WriteJSON(w, status, body)
}
