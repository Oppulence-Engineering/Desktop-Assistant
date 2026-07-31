package transcription

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"go.uber.org/zap"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/minutes"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
)

func TestWebSocketBearerPromotesProtocolCredential(t *testing.T) {
	var got string
	handler := WebSocketBearer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		got = r.Header.Get("Authorization")
	}))
	req := httptest.NewRequest(http.MethodGet, "/deepgram/v1/listen", nil)
	req.Header.Set("Sec-WebSocket-Protocol", "bearer, signed.jwt.value")
	handler.ServeHTTP(httptest.NewRecorder(), req)
	if got != "Bearer signed.jwt.value" {
		t.Fatalf("authorization = %q", got)
	}
}

func TestWebSocketBearerDoesNotOverrideAuthorization(t *testing.T) {
	var got string
	handler := WebSocketBearer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		got = r.Header.Get("Authorization")
	}))
	req := httptest.NewRequest(http.MethodGet, "/deepgram/v1/listen", nil)
	req.Header.Set("Authorization", "Bearer header-token")
	req.Header.Set("Sec-WebSocket-Protocol", "bearer, protocol-token")
	handler.ServeHTTP(httptest.NewRecorder(), req)
	if got != "Bearer header-token" {
		t.Fatalf("authorization = %q", got)
	}
}

func TestListenURLAllowsOnlyDeepgramParameters(t *testing.T) {
	h := &Handler{deepgramURL: "wss://api.deepgram.test/v1/listen?model=nova-3"}
	got, err := h.listenURL(url.Values{
		"model":         {"nova-2"},
		"language":      {"en-US"},
		"access_token":  {"must-not-pass"},
		"callback":      {"https://attacker.invalid"},
		"extra_headers": {"x-secret"},
	})
	if err != nil {
		t.Fatalf("listen URL: %v", err)
	}
	u, err := url.Parse(got)
	if err != nil {
		t.Fatalf("parse URL: %v", err)
	}
	if u.Query().Get("model") != "nova-2" || u.Query().Get("language") != "en-US" {
		t.Fatalf("allowed query = %q", u.RawQuery)
	}
	if u.Query().Has("access_token") || u.Query().Has("callback") || u.Query().Has("extra_headers") {
		t.Fatalf("unsafe query parameter passed through: %q", u.RawQuery)
	}
}

func TestListenRelaysAudioAndKeepsProviderKeyServerSide(t *testing.T) {
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	upstreamErr := make(chan error, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Token dg-server-key" {
			upstreamErr <- &testError{"upstream authorization = " + r.Header.Get("Authorization")}
			return
		}
		if r.URL.Query().Get("model") != "nova-3" || r.URL.Query().Has("callback") {
			upstreamErr <- &testError{"upstream query = " + r.URL.RawQuery}
			return
		}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			upstreamErr <- err
			return
		}
		defer func() { _ = conn.Close() }()
		messageType, payload, err := conn.ReadMessage()
		if err != nil {
			upstreamErr <- err
			return
		}
		if messageType != websocket.BinaryMessage || string(payload) != "pcm-audio" {
			upstreamErr <- &testError{"unexpected audio frame"}
			return
		}
		if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"Results","channel":{"alternatives":[{"transcript":"hello"}]}}`)); err != nil {
			upstreamErr <- err
			return
		}
		upstreamErr <- nil
	}))
	t.Cleanup(upstream.Close)

	database, err := db.Open(context.Background(), appconfig.Config{
		DatabaseURL: "file:" + t.Name() + "?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		AutoMigrate: true,
	}, zap.NewNop())
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	user := database.Client.User.Create().
		SetEmail("transcription@example.com").
		SetWorkosUserID("user_transcription").
		SaveX(auth.WithInternal(context.Background()))
	userCtx := auth.WithUser(context.Background(), user)
	database.Client.Subscription.Create().
		SetUser(user).
		SetPlan("free").
		SetStatus("active").
		SaveX(userCtx)
	gate := minutes.New(database.Client, zap.NewNop(), func(string) int { return 60 })
	sec := secrets.NewFromConfig(appconfig.Config{DeepgramAPIKey: "dg-server-key"})
	handler := New(gate, database.Client, appconfig.Config{}, sec, zap.NewNop())
	handler.SetDeepgramURL("ws" + strings.TrimPrefix(upstream.URL, "http"))
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handler.Listen(w, r.WithContext(auth.WithUser(r.Context(), user)))
	}))
	t.Cleanup(proxy.Close)

	dialer := websocket.Dialer{Subprotocols: []string{"bearer", "desktop-jwt"}, HandshakeTimeout: 5 * time.Second}
	conn, response, err := dialer.Dial("ws"+strings.TrimPrefix(proxy.URL, "http")+"/deepgram/v1/listen?model=nova-3&callback=https://attacker.invalid", nil)
	if err != nil {
		if response != nil && response.Body != nil {
			body, _ := io.ReadAll(response.Body)
			_ = response.Body.Close()
			t.Fatalf("dial proxy: %v: %s", err, body)
		}
		t.Fatalf("dial proxy: %v", err)
	}
	if conn.Subprotocol() != "bearer" {
		t.Fatalf("negotiated subprotocol = %q", conn.Subprotocol())
	}
	if err := conn.WriteMessage(websocket.BinaryMessage, []byte("pcm-audio")); err != nil {
		t.Fatalf("write audio: %v", err)
	}
	messageType, payload, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read result: %v", err)
	}
	if messageType != websocket.TextMessage || !strings.Contains(string(payload), `"transcript":"hello"`) {
		t.Fatalf("result frame type=%d payload=%s", messageType, payload)
	}
	if err := <-upstreamErr; err != nil {
		t.Fatal(err)
	}
	// Closing the browser WebSocket cancels the HTTP request. Settlement must
	// detach from that cancellation or the full reservation remains stranded.
	_ = conn.Close()
	deadline := time.Now().Add(2 * time.Second)
	for {
		remaining, remainingErr := gate.Remaining(userCtx, "free")
		if remainingErr != nil {
			t.Fatalf("remaining minutes: %v", remainingErr)
		}
		if remaining > 0 && remaining < 60 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("reservation did not settle after WebSocket close; remaining=%d", remaining)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

type testError struct{ message string }

func (e *testError) Error() string { return e.message }
