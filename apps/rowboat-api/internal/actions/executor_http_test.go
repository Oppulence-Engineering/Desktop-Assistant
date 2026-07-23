package actions

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestHTTPActSeamDisabledWithoutBaseURL(t *testing.T) {
	if e := NewHTTPActSeam(HTTPActSeamConfig{BaseURL: "   "}); e != nil {
		t.Fatal("blank base URL must yield a nil executor (fail closed)")
	}
}

func TestHTTPActSeamExecuteSuccess(t *testing.T) {
	var gotBody actRequest
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/act" || r.Method != http.MethodPost {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		gotAuth = r.Header.Get("Authorization")
		body, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(body, &gotBody)
		_ = json.NewEncoder(w).Encode(actResponse{ResultRef: "conduit:step:step_9"})
	}))
	defer srv.Close()

	e := NewHTTPActSeam(HTTPActSeamConfig{BaseURL: srv.URL, ServiceToken: "svc-tok", Timeout: 5 * time.Second})
	uid := uuid.New()
	res, err := e.Execute(context.Background(), ExecRequest{
		UserID:        uid,
		Kind:          "conduit.dunning.advance",
		Target:        "conduit:invoice:inv_1",
		ParamsJSON:    `{"step":2}`,
		CorrelationID: "corr-1",
	})
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	if res.ResultRef != "conduit:step:step_9" {
		t.Fatalf("result ref = %q", res.ResultRef)
	}
	if gotAuth != "Bearer svc-tok" {
		t.Fatalf("authorization = %q", gotAuth)
	}
	if gotBody.Kind != "conduit.dunning.advance" || gotBody.Target != "conduit:invoice:inv_1" ||
		gotBody.CorrelationID != "corr-1" || gotBody.Operator != uid.String() {
		t.Fatalf("request body mismatch: %+v", gotBody)
	}
	if string(gotBody.Params) != `{"step":2}` {
		t.Fatalf("params = %s", gotBody.Params)
	}
}

func TestHTTPActSeam5xxIsAmbiguous(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte("upstream down"))
	}))
	defer srv.Close()
	e := NewHTTPActSeam(HTTPActSeamConfig{BaseURL: srv.URL})
	_, err := e.Execute(context.Background(), ExecRequest{Kind: "k", Target: "t"})
	if !errors.Is(err, ErrAmbiguous) {
		t.Fatalf("5xx err = %v, want ErrAmbiguous", err)
	}
}

func TestHTTPActSeam4xxIsDefinite(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte("bad params"))
	}))
	defer srv.Close()
	e := NewHTTPActSeam(HTTPActSeamConfig{BaseURL: srv.URL})
	_, err := e.Execute(context.Background(), ExecRequest{Kind: "k", Target: "t"})
	if err == nil || errors.Is(err, ErrAmbiguous) {
		t.Fatalf("4xx err = %v, want a definite (non-ambiguous) error", err)
	}
}

func TestHTTPActSeamTimeoutIsAmbiguous(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(60 * time.Millisecond)
		_ = json.NewEncoder(w).Encode(actResponse{ResultRef: "late"})
	}))
	defer srv.Close()
	e := NewHTTPActSeam(HTTPActSeamConfig{BaseURL: srv.URL, Timeout: 15 * time.Millisecond})
	_, err := e.Execute(context.Background(), ExecRequest{Kind: "k", Target: "t"})
	if !errors.Is(err, ErrAmbiguous) {
		t.Fatalf("timeout err = %v, want ErrAmbiguous", err)
	}
}
