package revenue

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/googleapi"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
)

// gmailFixture stands up a fake Google (token + Gmail API) and a connected
// user, returning a ready GmailExecutor wired against them.
type gmailFixture struct {
	*fixture
	exec      *GmailExecutor
	gmailSrv  *httptest.Server
	sent      int
	drafted   int
	gmailCode int // response status for gmail calls; 0 = 200
}

func newGmailFixture(t *testing.T, scopes []string) *gmailFixture {
	t.Helper()
	f := newFixture(t)
	g := &gmailFixture{fixture: f}

	sealer, err := crypto.NewSealer("test-encryption-key-for-revenue")
	if err != nil {
		t.Fatalf("sealer: %v", err)
	}
	sealed, err := sealer.SealString("1//refresh")
	if err != nil {
		t.Fatalf("seal: %v", err)
	}
	f.client.OAuthConnection.Create().
		SetUser(f.user).
		SetProvider("google").
		SetRefreshTokenEncrypted(sealed).
		SetScopes(scopes).
		SetExternalAccountID("me@gmail.com").
		SaveX(auth.WithUser(context.Background(), f.user))

	mux := http.NewServeMux()
	mux.HandleFunc("/token", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{"access_token": "ya29.test"})
	})
	mux.HandleFunc("/gmail/v1/users/me/drafts", func(w http.ResponseWriter, _ *http.Request) {
		if g.gmailCode != 0 {
			w.WriteHeader(g.gmailCode)
			return
		}
		g.drafted++
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "draft_1", "message": map[string]string{"id": "msg_d1"}})
	})
	mux.HandleFunc("/gmail/v1/users/me/messages/send", func(w http.ResponseWriter, _ *http.Request) {
		if g.gmailCode != 0 {
			w.WriteHeader(g.gmailCode)
			return
		}
		g.sent++
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "msg_s1", "threadId": "thr_s1"})
	})
	g.gmailSrv = httptest.NewServer(mux)
	t.Cleanup(g.gmailSrv.Close)

	sec := secrets.NewFromConfig(appconfig.Config{GoogleOAuthClientID: "cid", GoogleOAuthClientSecret: "csec"})
	g.exec = NewGmailExecutor(f.client, sealer, sec, googleapi.New(googleapi.Config{
		TokenURL:     g.gmailSrv.URL + "/token",
		GmailBaseURL: g.gmailSrv.URL,
	}))
	return g
}

func (g *gmailFixture) execRequest(t *testing.T, mode string) ExecRequest {
	t.Helper()
	action := g.action(t, mode)
	return ExecRequest{
		Action:         action,
		UserID:         g.user.ID,
		Mode:           mode,
		IdempotencyKey: ExecutionIdempotencyKey(action.ID.String(), action.Revision),
	}
}

func TestGmailExecutorDraft(t *testing.T) {
	g := newGmailFixture(t, []string{scopeGmailCompose, scopeGmailSend})
	res, err := g.exec.Execute(g.ctx, g.execRequest(t, ExecModeDraft))
	if err != nil {
		t.Fatalf("draft: %v", err)
	}
	if res.ProviderMessageID != "draft_1" || g.drafted != 1 || g.sent != 0 {
		t.Fatalf("draft result=%+v drafted=%d sent=%d", res, g.drafted, g.sent)
	}
}

func TestGmailExecutorSend(t *testing.T) {
	g := newGmailFixture(t, []string{scopeGmailCompose, scopeGmailSend})
	res, err := g.exec.Execute(g.ctx, g.execRequest(t, ExecModeSend))
	if err != nil {
		t.Fatalf("send: %v", err)
	}
	if res.ProviderMessageID != "msg_s1" || g.sent != 1 || g.drafted != 0 {
		t.Fatalf("send result=%+v sent=%d drafted=%d", res, g.sent, g.drafted)
	}
}

func TestGmailExecutorMissingScopeIsDefiniteFailure(t *testing.T) {
	g := newGmailFixture(t, []string{scopeGmailCompose}) // no send scope
	_, err := g.exec.Execute(g.ctx, g.execRequest(t, ExecModeSend))
	if err == nil || errors.Is(err, ErrAmbiguous) {
		t.Fatalf("missing scope must be a definite failure, got %v", err)
	}
}

func TestGmailExecutorNoConnectionIsDefiniteFailure(t *testing.T) {
	g := newGmailFixture(t, []string{scopeGmailCompose})
	req := g.execRequest(t, ExecModeDraft)
	// A different (unconnected) user is assigned.
	other := newUser(t, g.client, "other@x.co", "user_other")
	req.UserID = other.ID
	_, err := g.exec.Execute(auth.WithUser(context.Background(), other), req)
	if err == nil || errors.Is(err, ErrAmbiguous) {
		t.Fatalf("missing connection must be a definite failure, got %v", err)
	}
}

func TestGmailExecutorServerErrorIsAmbiguous(t *testing.T) {
	g := newGmailFixture(t, []string{scopeGmailCompose, scopeGmailSend})
	g.gmailCode = http.StatusBadGateway
	_, err := g.exec.Execute(g.ctx, g.execRequest(t, ExecModeSend))
	if !errors.Is(err, ErrAmbiguous) {
		t.Fatalf("5xx on send must be ambiguous, got %v", err)
	}
}

func TestGmailExecutorClientErrorIsDefiniteFailure(t *testing.T) {
	g := newGmailFixture(t, []string{scopeGmailCompose, scopeGmailSend})
	g.gmailCode = http.StatusForbidden
	_, err := g.exec.Execute(g.ctx, g.execRequest(t, ExecModeSend))
	if err == nil || errors.Is(err, ErrAmbiguous) {
		t.Fatalf("4xx must be a definite failure, got %v", err)
	}
}

// End-to-end through the service: an ambiguous Gmail answer lands the action
// in ambiguous and a retry does not resend (invariant 8 with the real
// executor in the loop).
func TestServiceWithGmailExecutorAmbiguous(t *testing.T) {
	g := newGmailFixture(t, []string{scopeGmailCompose, scopeGmailSend})
	svc := NewService(g.client, g.facade, g.exec, g.svc.log)

	action := g.action(t, ExecModeDraft)
	if _, err := svc.Approve(g.ctx, g.user, action.ID, false); err != nil {
		t.Fatalf("approve: %v", err)
	}
	g.gmailCode = http.StatusServiceUnavailable
	got, err := svc.Execute(g.ctx, g.user, action.ID)
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	if got.ExecutionStatus != ExecAmbiguous {
		t.Fatalf("want ambiguous, got %s", got.ExecutionStatus)
	}
	g.gmailCode = 0
	again, err := svc.Execute(g.ctx, g.user, action.ID)
	if err != nil {
		t.Fatalf("retry: %v", err)
	}
	if again.ExecutionStatus != ExecAmbiguous || g.drafted != 0 {
		t.Fatalf("ambiguous must not auto-resend: status=%s drafted=%d", again.ExecutionStatus, g.drafted)
	}
}

var _ Executor = (*GmailExecutor)(nil)
