package entities

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"go.uber.org/zap"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/go-chi/chi/v5"
)

type fixture struct {
	client  *ent.Client
	svc     *Service
	handler http.Handler
	ctx     context.Context
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	d, err := db.Open(context.Background(), appconfig.Config{DatabaseURL: "file:" + t.Name() + "?mode=memory&cache=shared&_pragma=foreign_keys(1)", AutoMigrate: true}, zap.NewNop())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	internal := auth.WithInternal(context.Background())
	u := d.Client.User.Create().SetEmail("owner@example.com").SetWorkosUserID("user_owner").SetWorkosOrgID("org_one").SaveX(internal)
	ws := d.Client.RevenueWorkspace.Create().SetUser(u).SetWorkosOrgID("org_one").SaveX(internal)
	ctx := auth.WithUser(context.Background(), u)
	resolve := func(ctx context.Context) (Scope, error) {
		auth.GrantRevenueWorkspace(ctx, ws.ID, "owner")
		return Scope{Workspace: ws, User: u}, nil
	}
	svc := New(d.Client, resolve, func(context.Context, Scope, Operation) error { return nil })
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, r.WithContext(auth.WithUser(r.Context(), u)))
		})
	})
	NewHandler(svc).Mount(r)
	return &fixture{d.Client, svc, r, ctx}
}
func request(t *testing.T, h http.Handler, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		r.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

const id1 = "01J9Z8Q5K3R7V2C4M6N8P0T1S3"
const id2 = "01J9Z8Q5K3R7V2C4M6N8P0T1S4"

func projection(name, ref string) string {
	fingerprint := fmt.Sprintf("sha256:v1:%x", sha256.Sum256([]byte(strings.ToLower(name)+".example")))
	b, _ := json.Marshal(map[string]any{"kind": "company", "displayName": name, "resourceRefs": []string{ref}, "identifiers": map[string][]string{"emailDomain": {fingerprint}}, "oneLineSummary": "summary"})
	return string(b)
}

func TestHTTPProjectionReverseResolveReplayAndVersionConflict(t *testing.T) {
	f := newFixture(t)
	w := request(t, f.handler, "PUT", "/v1/entities/"+id1, projection("Acme", "hubspot:company:123"))
	if w.Code != 200 {
		t.Fatalf("put: %d %s", w.Code, w.Body.String())
	}
	var first View
	if err := json.Unmarshal(w.Body.Bytes(), &first); err != nil {
		t.Fatal(err)
	}
	w = request(t, f.handler, "PUT", "/v1/entities/"+id1, projection("Acme", "hubspot:company:123"))
	if w.Code != 200 {
		t.Fatalf("replay: %d %s", w.Code, w.Body.String())
	}
	var replay View
	_ = json.Unmarshal(w.Body.Bytes(), &replay)
	if replay.Version != first.Version {
		t.Fatalf("replay bumped version: %d -> %d", first.Version, replay.Version)
	}
	w = request(t, f.handler, "GET", "/v1/entities?ref=hubspot%3Acompany%3A123", "")
	if w.Code != 200 || !bytes.Contains(w.Body.Bytes(), []byte(id1)) {
		t.Fatalf("resolve: %d %s", w.Code, w.Body.String())
	}
	bad := `{"kind":"company","displayName":"Changed","resourceRefs":[],"identifiers":{},"expectedVersion":99}`
	w = request(t, f.handler, "PUT", "/v1/entities/"+id1, bad)
	if w.Code != 409 {
		t.Fatalf("version conflict = %d %s", w.Code, w.Body.String())
	}
}
func TestHTTPStrictProjectionBoundary(t *testing.T) {
	f := newFixture(t)
	for name, body := range map[string]string{"unknown": `{"kind":"company","displayName":"Acme","resourceRefs":[],"identifiers":{},"body":"secret"}`, "trailing": projection("Acme", "desktop:company:1") + ` {}`} {
		t.Run(name, func(t *testing.T) {
			w := request(t, f.handler, "PUT", "/v1/entities/"+id1, body)
			if w.Code != 400 {
				t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
			}
			if ct := w.Header().Get("Content-Type"); !strings.Contains(ct, "problem+json") {
				t.Fatalf("content type=%q", ct)
			}
		})
	}
	w := request(t, f.handler, "GET", "/v1/entities?ref=a&ref=b", "")
	if w.Code != 400 {
		t.Fatalf("duplicate ref=%d", w.Code)
	}
	huge := `{"kind":"company","displayName":"` + strings.Repeat("x", 300000) + `","resourceRefs":[],"identifiers":{}}`
	w = request(t, f.handler, "PUT", "/v1/entities/"+id1, huge)
	if w.Code != 413 {
		t.Fatalf("oversize=%d %s", w.Code, w.Body.String())
	}
	raw := `{"kind":"company","displayName":"Acme","resourceRefs":[],"identifiers":{"emailDomain":["example.com"]}}`
	w = request(t, f.handler, "PUT", "/v1/entities/"+id1, raw)
	if w.Code != 400 {
		t.Fatalf("raw identifier=%d %s", w.Code, w.Body.String())
	}
}
func TestHTTPMergeIsIdempotent(t *testing.T) {
	f := newFixture(t)
	for _, tc := range []struct{ id, ref string }{{id1, "desktop:company:1"}, {id2, "desktop:company:2"}} {
		w := request(t, f.handler, "PUT", "/v1/entities/"+tc.id, projection(tc.id, tc.ref))
		if w.Code != 200 {
			t.Fatalf("put=%d %s", w.Code, w.Body.String())
		}
	}
	body := `{"sourceId":"` + id2 + `","targetId":"` + id1 + `","expectedSourceVersion":1,"expectedTargetVersion":1}`
	w := request(t, f.handler, "POST", "/v1/entities/merge", body)
	if w.Code != 200 {
		t.Fatalf("merge=%d %s", w.Code, w.Body.String())
	}
	w = request(t, f.handler, "POST", "/v1/entities/merge", body)
	if w.Code != 200 || !bytes.Contains(w.Body.Bytes(), []byte(`"idempotent":true`)) {
		t.Fatalf("replay=%d %s", w.Code, w.Body.String())
	}
}

func TestHTTPDuplicateRemintAdoptionReplayPreservesBothRefs(t *testing.T) {
	f := newFixture(t)
	first := projection("Acme", "conduit:company:1")
	second := projection("Acme", "cadence:vendor:2")
	if w := request(t, f.handler, "PUT", "/v1/entities/"+id1, first); w.Code != 200 {
		t.Fatalf("first: %d %s", w.Code, w.Body.String())
	}
	w := request(t, f.handler, "PUT", "/v1/entities/"+id2, second)
	if w.Code != 200 || !bytes.Contains(w.Body.Bytes(), []byte(`"canonicalEntityId":"`+id1+`"`)) {
		t.Fatalf("adoption: %d %s", w.Code, w.Body.String())
	}
	// Lost-response replay must return the same adoption instruction.
	w = request(t, f.handler, "PUT", "/v1/entities/"+id2, second)
	if w.Code != 200 || !bytes.Contains(w.Body.Bytes(), []byte(`"canonicalEntityId":"`+id1+`"`)) {
		t.Fatalf("adoption replay: %d %s", w.Code, w.Body.String())
	}
	w = request(t, f.handler, "GET", "/v1/entities/"+id1, "")
	if w.Code != 200 || !bytes.Contains(w.Body.Bytes(), []byte("conduit:company:1")) || !bytes.Contains(w.Body.Bytes(), []byte("cadence:vendor:2")) {
		t.Fatalf("canonical refs: %d %s", w.Code, w.Body.String())
	}
}
