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
	"sync"
	"sync/atomic"
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

var fixtureSequence atomic.Uint64

func newFixture(t *testing.T) *fixture {
	t.Helper()
	databaseURL := fmt.Sprintf("file:%s-%d?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name(), fixtureSequence.Add(1))
	d, err := db.Open(context.Background(), appconfig.Config{DatabaseURL: databaseURL, AutoMigrate: true}, zap.NewNop())
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

func scopedHandler(client *ent.Client, user *ent.User, workspace *ent.RevenueWorkspace, authorize Authorize) http.Handler {
	resolve := func(ctx context.Context) (Scope, error) {
		auth.GrantRevenueWorkspace(ctx, workspace.ID, "member")
		return Scope{Workspace: workspace, User: user}, nil
	}
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, r.WithContext(auth.WithUser(r.Context(), user)))
		})
	})
	NewHandler(New(client, resolve, authorize)).Mount(r)
	return r
}

const id1 = "01J9Z8Q5K3R7V2C4M6N8P0T1S3"
const id2 = "01J9Z8Q5K3R7V2C4M6N8P0T1S4"
const id3 = "01J9Z8Q5K3R7V2C4M6N8P0T1S5"

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
	invalidRef := `{"kind":"company","displayName":"Acme","resourceRefs":["Gmail.com:thread:1"],"identifiers":{}}`
	w = request(t, f.handler, "PUT", "/v1/entities/"+id1, invalidRef)
	if w.Code != 400 {
		t.Fatalf("invalid ref=%d %s", w.Code, w.Body.String())
	}
	invalidKey := `{"kind":"company","displayName":"Acme","resourceRefs":[],"identifiers":{"secret@example.com":["sha256:v1:54667cc7be6265f6a4cdfe25b9c89d52aea7817c4e570cb678feec57c23f4a6a"]}}`
	w = request(t, f.handler, "PUT", "/v1/entities/"+id1, invalidKey)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("invalid identifier key=%d %s", w.Code, w.Body.String())
	}
	for _, tc := range []struct {
		method string
		path   string
		body   string
	}{
		{http.MethodGet, "/v1/entities/not-a-ulid", ""},
		{http.MethodGet, "/v1/entities?ref=not-a-ref", ""},
		{http.MethodPost, "/v1/entities/merge", `{"sourceId":"bad","targetId":"also-bad","expectedSourceVersion":1,"expectedTargetVersion":1}`},
	} {
		w = request(t, f.handler, tc.method, tc.path, tc.body)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("invalid public identifier %s %s = %d %s", tc.method, tc.path, w.Code, w.Body.String())
		}
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
	// The source-only ref is moved to the canonical normalized reverse index.
	w = request(t, f.handler, "GET", "/v1/entities?ref=desktop%3Acompany%3A2", "")
	if w.Code != 200 || !bytes.Contains(w.Body.Bytes(), []byte(id1)) {
		t.Fatalf("merged reverse ref=%d %s", w.Code, w.Body.String())
	}
	if w = request(t, f.handler, "PUT", "/v1/entities/"+id3, projection("Gamma", "desktop:company:3")); w.Code != http.StatusOK {
		t.Fatalf("third entity=%d %s", w.Code, w.Body.String())
	}
	retarget := `{"sourceId":"` + id2 + `","targetId":"` + id3 + `","expectedSourceVersion":2,"expectedTargetVersion":1}`
	w = request(t, f.handler, "POST", "/v1/entities/merge", retarget)
	if w.Code != http.StatusConflict {
		t.Fatalf("merged alias retarget=%d %s", w.Code, w.Body.String())
	}
}

func TestHTTPConcurrentMergeRacesPreserveAllEvidence(t *testing.T) {
	f := newFixture(t)
	for _, tc := range []struct{ id, name, ref string }{
		{id1, "Target", "desktop:company:target"},
		{id2, "Source A", "desktop:company:source-a"},
		{id3, "Source B", "desktop:company:source-b"},
	} {
		if w := request(t, f.handler, http.MethodPut, "/v1/entities/"+tc.id, projection(tc.name, tc.ref)); w.Code != http.StatusOK {
			t.Fatalf("seed %s=%d %s", tc.id, w.Code, w.Body.String())
		}
	}

	type result struct {
		source string
		code   int
	}
	start := make(chan struct{})
	results := make(chan result, 2)
	var wg sync.WaitGroup
	for _, source := range []string{id2, id3} {
		source := source
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			body := fmt.Sprintf(`{"sourceId":%q,"targetId":%q,"expectedSourceVersion":1,"expectedTargetVersion":1}`, source, id1)
			results <- result{source: source, code: request(t, f.handler, http.MethodPost, "/v1/entities/merge", body).Code}
		}()
	}
	close(start)
	wg.Wait()
	close(results)

	var loser string
	for got := range results {
		switch got.code {
		case http.StatusOK:
		case http.StatusConflict:
			loser = got.source
		default:
			t.Fatalf("concurrent merge %s status=%d", got.source, got.code)
		}
	}
	if loser == "" {
		t.Fatal("expected one optimistic-lock conflict")
	}
	targetResponse := request(t, f.handler, http.MethodGet, "/v1/entities/"+id1, "")
	loserResponse := request(t, f.handler, http.MethodGet, "/v1/entities/"+loser, "")
	if targetResponse.Code != http.StatusOK || loserResponse.Code != http.StatusOK {
		t.Fatalf("read after race: target=%d loser=%d", targetResponse.Code, loserResponse.Code)
	}
	var target, remaining View
	if err := json.Unmarshal(targetResponse.Body.Bytes(), &target); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(loserResponse.Body.Bytes(), &remaining); err != nil {
		t.Fatal(err)
	}
	retry := fmt.Sprintf(`{"sourceId":%q,"targetId":%q,"expectedSourceVersion":%d,"expectedTargetVersion":%d}`, loser, id1, remaining.Version, target.Version)
	if w := request(t, f.handler, http.MethodPost, "/v1/entities/merge", retry); w.Code != http.StatusOK {
		t.Fatalf("retry losing merge=%d %s", w.Code, w.Body.String())
	}
	final := request(t, f.handler, http.MethodGet, "/v1/entities/"+id1, "")
	for _, ref := range []string{"desktop:company:target", "desktop:company:source-a", "desktop:company:source-b"} {
		if !bytes.Contains(final.Body.Bytes(), []byte(ref)) {
			t.Fatalf("final canonical missing %s: %s", ref, final.Body.String())
		}
	}
	if count := f.client.EntityResourceRef.Query().CountX(f.ctx); count != 3 {
		t.Fatalf("normalized ref count=%d, want 3", count)
	}

	// An upsert racing a merge either converges immediately or returns a
	// version conflict that is safely retryable. It must never drop either ref.
	f2 := newFixture(t)
	for _, tc := range []struct{ id, name, ref string }{
		{id1, "Target", "desktop:company:target"},
		{id2, "Source", "desktop:company:source"},
	} {
		if w := request(t, f2.handler, http.MethodPut, "/v1/entities/"+tc.id, projection(tc.name, tc.ref)); w.Code != http.StatusOK {
			t.Fatalf("race seed %s=%d %s", tc.id, w.Code, w.Body.String())
		}
	}
	start = make(chan struct{})
	codes := make(chan int, 2)
	wg = sync.WaitGroup{}
	wg.Add(2)
	go func() {
		defer wg.Done()
		<-start
		body := fmt.Sprintf(`{"sourceId":%q,"targetId":%q,"expectedSourceVersion":1,"expectedTargetVersion":1}`, id2, id1)
		codes <- request(t, f2.handler, http.MethodPost, "/v1/entities/merge", body).Code
	}()
	go func() {
		defer wg.Done()
		<-start
		codes <- request(t, f2.handler, http.MethodPut, "/v1/entities/"+id1, projection("Target update", "eigen:company:update")).Code
	}()
	close(start)
	wg.Wait()
	close(codes)
	for code := range codes {
		if code != http.StatusOK && code != http.StatusConflict {
			t.Fatalf("merge/upsert race status=%d", code)
		}
	}
	for _, ref := range []string{"desktop:company:target", "desktop:company:source", "eigen:company:update"} {
		resolved := request(t, f2.handler, http.MethodGet, "/v1/entities?ref="+ref, "")
		if resolved.Code != http.StatusOK {
			t.Fatalf("merge/upsert race lost %s: %d %s", ref, resolved.Code, resolved.Body.String())
		}
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
	// A stale alias can discover fresh evidence while offline. A successful
	// replay must forward it to the canonical entity before acknowledging it.
	staleWithNewEvidence := projection("Acme", "eigen:entity:3")
	w = request(t, f.handler, "PUT", "/v1/entities/"+id2, staleWithNewEvidence)
	if w.Code != 200 || !bytes.Contains(w.Body.Bytes(), []byte(`"canonicalEntityId":"`+id1+`"`)) {
		t.Fatalf("adoption replay: %d %s", w.Code, w.Body.String())
	}
	w = request(t, f.handler, "GET", "/v1/entities/"+id1, "")
	if w.Code != 200 || !bytes.Contains(w.Body.Bytes(), []byte("conduit:company:1")) || !bytes.Contains(w.Body.Bytes(), []byte("cadence:vendor:2")) || !bytes.Contains(w.Body.Bytes(), []byte("eigen:entity:3")) {
		t.Fatalf("canonical refs: %d %s", w.Code, w.Body.String())
	}
	if count := f.client.EntityResourceRef.Query().CountX(f.ctx); count != 3 {
		t.Fatalf("normalized ref count=%d, want 3", count)
	}
	if count := f.client.EntityIdentifier.Query().CountX(f.ctx); count != 1 {
		t.Fatalf("normalized identifier count=%d, want 1", count)
	}
}

func TestHTTPIdentifierAliasesCanonicalizeAcrossClients(t *testing.T) {
	f := newFixture(t)
	fingerprint := fmt.Sprintf("sha256:v1:%x", sha256.Sum256([]byte("acme.com")))
	body := func(key, name string) string {
		encoded, _ := json.Marshal(map[string]any{
			"kind": "company", "displayName": name,
			"resourceRefs": []string{}, "identifiers": map[string][]string{key: {fingerprint}},
		})
		return string(encoded)
	}
	if w := request(t, f.handler, http.MethodPut, "/v1/entities/"+id1, body("email_domain", "Acme")); w.Code != http.StatusOK {
		t.Fatalf("first alias=%d %s", w.Code, w.Body.String())
	}
	w := request(t, f.handler, http.MethodPut, "/v1/entities/"+id2, body("emailDomains", "Acme remint"))
	if w.Code != http.StatusOK || !bytes.Contains(w.Body.Bytes(), []byte(`"canonicalEntityId":"`+id1+`"`)) {
		t.Fatalf("canonical alias match=%d %s", w.Code, w.Body.String())
	}
}

func TestHTTPExistingRemintAdoptionTransfersPreviouslyKnownRefs(t *testing.T) {
	f := newFixture(t)
	if w := request(t, f.handler, "PUT", "/v1/entities/"+id1, projection("Acme", "conduit:company:1")); w.Code != http.StatusOK {
		t.Fatalf("canonical: %d %s", w.Code, w.Body.String())
	}
	if w := request(t, f.handler, "PUT", "/v1/entities/"+id2, projection("Beta", "cadence:vendor:legacy")); w.Code != http.StatusOK {
		t.Fatalf("independent remint: %d %s", w.Code, w.Body.String())
	}

	// The second device later learns Acme's deterministic identifier and ref.
	// Its previously known Cadence ref must move to the canonical reverse index.
	w := request(t, f.handler, "PUT", "/v1/entities/"+id2, projection("Acme", "conduit:company:1"))
	if w.Code != http.StatusOK || !bytes.Contains(w.Body.Bytes(), []byte(`"canonicalEntityId":"`+id1+`"`)) {
		t.Fatalf("adoption: %d %s", w.Code, w.Body.String())
	}
	w = request(t, f.handler, "GET", "/v1/entities?ref=cadence%3Avendor%3Alegacy", "")
	if w.Code != http.StatusOK || !bytes.Contains(w.Body.Bytes(), []byte(id1)) {
		t.Fatalf("transferred reverse ref: %d %s", w.Code, w.Body.String())
	}
	if count := f.client.EntityResourceRef.Query().CountX(f.ctx); count != 2 {
		t.Fatalf("normalized ref count=%d, want 2", count)
	}
}

func TestHTTPEarlierRemintBecomesCanonicalRegardlessOfArrivalOrder(t *testing.T) {
	f := newFixture(t)
	if w := request(t, f.handler, "PUT", "/v1/entities/"+id2, projection("Acme", "cadence:vendor:2")); w.Code != http.StatusOK {
		t.Fatalf("later id first: %d %s", w.Code, w.Body.String())
	}
	w := request(t, f.handler, "PUT", "/v1/entities/"+id1, projection("Acme", "conduit:company:1"))
	if w.Code != http.StatusOK || !bytes.Contains(w.Body.Bytes(), []byte(`"id":"`+id1+`"`)) || bytes.Contains(w.Body.Bytes(), []byte(`"canonicalEntityId"`)) {
		t.Fatalf("earlier canonical: %d %s", w.Code, w.Body.String())
	}
	w = request(t, f.handler, "GET", "/v1/entities/"+id2, "")
	if w.Code != http.StatusOK || !bytes.Contains(w.Body.Bytes(), []byte(`"canonicalEntityId":"`+id1+`"`)) {
		t.Fatalf("later tombstone: %d %s", w.Code, w.Body.String())
	}
	for _, ref := range []string{"cadence%3Avendor%3A2", "conduit%3Acompany%3A1"} {
		w = request(t, f.handler, "GET", "/v1/entities?ref="+ref, "")
		if w.Code != http.StatusOK || !bytes.Contains(w.Body.Bytes(), []byte(id1)) {
			t.Fatalf("canonical reverse ref %s: %d %s", ref, w.Code, w.Body.String())
		}
	}
}

func TestHTTPExistingEarlierRemintKeepsItsPriorRefsWhenItBecomesCanonical(t *testing.T) {
	f := newFixture(t)
	if w := request(t, f.handler, "PUT", "/v1/entities/"+id1, projection("Beta", "desktop:company:legacy")); w.Code != http.StatusOK {
		t.Fatalf("earlier independent id: %d %s", w.Code, w.Body.String())
	}
	if w := request(t, f.handler, "PUT", "/v1/entities/"+id2, projection("Acme", "cadence:vendor:2")); w.Code != http.StatusOK {
		t.Fatalf("later id: %d %s", w.Code, w.Body.String())
	}
	w := request(t, f.handler, "PUT", "/v1/entities/"+id1, projection("Acme", "conduit:company:1"))
	if w.Code != http.StatusOK || !bytes.Contains(w.Body.Bytes(), []byte(`"id":"`+id1+`"`)) {
		t.Fatalf("existing earlier canonical: %d %s", w.Code, w.Body.String())
	}
	for _, ref := range []string{"desktop%3Acompany%3Alegacy", "cadence%3Avendor%3A2", "conduit%3Acompany%3A1"} {
		w = request(t, f.handler, "GET", "/v1/entities?ref="+ref, "")
		if w.Code != http.StatusOK || !bytes.Contains(w.Body.Bytes(), []byte(id1)) {
			t.Fatalf("transferred reverse ref %s: %d %s", ref, w.Code, w.Body.String())
		}
	}
}

func TestHTTPConcurrentDeviceRemintsConvergeAfterReplay(t *testing.T) {
	f := newFixture(t)
	start := make(chan struct{})
	results := make(chan *httptest.ResponseRecorder, 2)
	for _, tc := range []struct {
		id  string
		ref string
	}{{id1, "conduit:company:1"}, {id2, "cadence:vendor:2"}} {
		tc := tc
		go func() {
			<-start
			results <- request(t, f.handler, "PUT", "/v1/entities/"+tc.id, projection("Acme", tc.ref))
		}()
	}
	close(start)
	for range 2 {
		w := <-results
		if w.Code != http.StatusOK {
			t.Fatalf("concurrent upsert: %d %s", w.Code, w.Body.String())
		}
	}

	// A lost-response retry from each device is enough to reconcile a race in
	// which both transactions initially observed an empty workspace.
	for _, tc := range []struct {
		id  string
		ref string
	}{{id1, "conduit:company:1"}, {id2, "cadence:vendor:2"}} {
		if w := request(t, f.handler, "PUT", "/v1/entities/"+tc.id, projection("Acme", tc.ref)); w.Code != http.StatusOK {
			t.Fatalf("replay %s: %d %s", tc.id, w.Code, w.Body.String())
		}
	}
	var earlier, later View
	for id, out := range map[string]*View{id1: &earlier, id2: &later} {
		w := request(t, f.handler, "GET", "/v1/entities/"+id, "")
		if w.Code != http.StatusOK {
			t.Fatalf("get %s: %d %s", id, w.Code, w.Body.String())
		}
		if err := json.Unmarshal(w.Body.Bytes(), out); err != nil {
			t.Fatal(err)
		}
	}
	if earlier.Status != "active" || later.Status != "merged" || later.CanonicalEntityID != id1 {
		t.Fatalf("did not deterministically converge: earlier=%+v later=%+v", earlier, later)
	}
}

func TestHTTPConcurrentSameEntityUnionsDistinctEvidence(t *testing.T) {
	f := newFixture(t)
	start := make(chan struct{})
	results := make(chan *httptest.ResponseRecorder, 2)
	for _, tc := range []struct {
		name string
		ref  string
	}{{"Acme Conduit", "conduit:company:concurrent"}, {"Acme Cadence", "cadence:vendor:concurrent"}} {
		tc := tc
		go func() {
			<-start
			results <- request(t, f.handler, http.MethodPut, "/v1/entities/"+id3, projection(tc.name, tc.ref))
		}()
	}
	close(start)
	for range 2 {
		w := <-results
		if w.Code != http.StatusOK {
			t.Fatalf("concurrent same-id upsert: %d %s", w.Code, w.Body.String())
		}
	}
	w := request(t, f.handler, http.MethodGet, "/v1/entities/"+id3, "")
	if w.Code != http.StatusOK ||
		!bytes.Contains(w.Body.Bytes(), []byte("conduit:company:concurrent")) ||
		!bytes.Contains(w.Body.Bytes(), []byte("cadence:vendor:concurrent")) {
		t.Fatalf("same-id evidence was lost: %d %s", w.Code, w.Body.String())
	}
	if count := f.client.EntityIdentifier.Query().CountX(f.ctx); count != 2 {
		t.Fatalf("normalized identifier count=%d, want 2", count)
	}
}

func TestHTTPOrgIsolationAndAuthorization(t *testing.T) {
	f := newFixture(t)
	if w := request(t, f.handler, "PUT", "/v1/entities/"+id1, projection("Acme", "conduit:company:org-one")); w.Code != http.StatusOK {
		t.Fatalf("seed entity: %d %s", w.Code, w.Body.String())
	}
	internal := auth.WithInternal(context.Background())
	workspace := f.client.RevenueWorkspace.Query().OnlyX(internal)
	sameOrg := f.client.User.Create().SetEmail("member@example.com").SetWorkosUserID("user_member").SetWorkosOrgID("org_one").SaveX(internal)
	f.client.RevenueWorkspaceMember.Create().SetWorkspace(workspace).SetUser(sameOrg).SetRole("member").SetStatus("active").SaveX(internal)
	sameOrgHandler := scopedHandler(f.client, sameOrg, workspace, func(context.Context, Scope, Operation) error { return nil })
	if w := request(t, sameOrgHandler, "GET", "/v1/entities/"+id1, ""); w.Code != http.StatusOK {
		t.Fatalf("same-org read: %d %s", w.Code, w.Body.String())
	}

	otherUser := f.client.User.Create().SetEmail("other@example.com").SetWorkosUserID("user_other").SetWorkosOrgID("org_two").SaveX(internal)
	otherWorkspace := f.client.RevenueWorkspace.Create().SetUser(otherUser).SetWorkosOrgID("org_two").SaveX(internal)
	otherHandler := scopedHandler(f.client, otherUser, otherWorkspace, func(context.Context, Scope, Operation) error { return nil })
	if w := request(t, otherHandler, "GET", "/v1/entities/"+id1, ""); w.Code != http.StatusNotFound {
		t.Fatalf("cross-org read: %d %s", w.Code, w.Body.String())
	}

	mismatchedOrgHandler := scopedHandler(f.client, sameOrg, otherWorkspace, func(context.Context, Scope, Operation) error { return nil })
	if w := request(t, mismatchedOrgHandler, "GET", "/v1/entities/"+id1, ""); w.Code != http.StatusForbidden {
		t.Fatalf("mismatched org: %d %s", w.Code, w.Body.String())
	}
	deniedHandler := scopedHandler(f.client, sameOrg, workspace, func(context.Context, Scope, Operation) error { return ErrForbidden })
	if w := request(t, deniedHandler, "GET", "/v1/entities/"+id1, ""); w.Code != http.StatusForbidden {
		t.Fatalf("capability denial: %d %s", w.Code, w.Body.String())
	}
}
