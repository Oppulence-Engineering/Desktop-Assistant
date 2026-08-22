package voicecloud

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

func setupVoiceCloud(t *testing.T) (*ent.Client, *ent.User, *ent.User, http.Handler) {
	t.Helper()
	database, err := db.Open(context.Background(), appconfig.Config{
		DatabaseURL: "file:" + t.Name() + "?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		AutoMigrate: true,
	}, zap.NewNop())
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	internal := auth.WithInternal(context.Background())
	first := database.Client.User.Create().SetEmail("first@example.com").SetWorkosUserID("voice_first").SaveX(internal)
	second := database.Client.User.Create().SetEmail("second@example.com").SetWorkosUserID("voice_second").SaveX(internal)
	handler := New(database.Client, zap.NewNop())
	handler.now = func() time.Time { return time.Date(2026, 8, 21, 23, 0, 0, 0, time.UTC) }
	router := chi.NewRouter()
	router.Get("/api/auth/get-session", handler.Session)
	router.Post("/api/v1/keys/create", handler.CreateKey)
	router.Get("/api/v1/keys/list", handler.ListKeys)
	router.Post("/api/v1/keys/{id}/revoke", handler.RevokeKey)
	router.Get("/v1/voice/api-key-verifiers", handler.KeyVerifiers)
	router.Post("/v1/voice-sync/items", handler.PutSyncItem)
	router.Get("/v1/voice-sync/items", handler.ListSyncItems)
	router.Post("/v1/capture-artifacts", handler.IngestCapture)
	router.Get("/v1/capture-artifacts/{eventId}", handler.GetCapture)
	return database.Client, first, second, router
}

type sessionResponse struct {
	Session struct {
		UserID string `json:"userId"`
	} `json:"session"`
	User struct {
		ID            string `json:"id"`
		Email         string `json:"email"`
		EmailVerified bool   `json:"emailVerified"`
	} `json:"user"`
}

func TestSessionAdaptsWorkOSUserWithoutMintingCredentials(t *testing.T) {
	_, first, _, router := setupVoiceCloud(t)
	recorder := requestAs(t, router, first, http.MethodGet, "/api/auth/get-session", nil, nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("session status = %d: %s", recorder.Code, recorder.Body.String())
	}
	response := decode[sessionResponse](t, recorder)
	if response.Session.UserID != first.ID.String() || response.User.ID != first.ID.String() || response.User.Email != first.Email || !response.User.EmailVerified {
		t.Fatalf("unexpected adapted session: %+v", response)
	}
}

func requestAs(t *testing.T, handler http.Handler, user *ent.User, method, path string, body any, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	var raw []byte
	var err error
	if body != nil {
		raw, err = json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal request: %v", err)
		}
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(raw)).WithContext(auth.WithUser(context.Background(), user))
	req.Header.Set("Content-Type", "application/json")
	for name, value := range headers {
		req.Header.Set(name, value)
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)
	return recorder
}

func decode[T any](t *testing.T, recorder *httptest.ResponseRecorder) T {
	t.Helper()
	var value T
	if err := json.Unmarshal(recorder.Body.Bytes(), &value); err != nil {
		t.Fatalf("decode response %d: %v (%s)", recorder.Code, err, recorder.Body.String())
	}
	return value
}

func TestAPIKeyLifecyclePersistsOnlyDigestAndIsTenantScoped(t *testing.T) {
	client, first, second, router := setupVoiceCloud(t)
	recorder := requestAs(t, router, first, http.MethodPost, "/api/v1/keys/create", map[string]any{
		"name": "Local automation", "scopes": []string{"notes:write", "notes:read"},
	}, nil)
	if recorder.Code != http.StatusCreated {
		t.Fatalf("create status = %d: %s", recorder.Code, recorder.Body.String())
	}
	created := decode[struct {
		Data keyView `json:"data"`
	}](t, recorder).Data
	if !strings.HasPrefix(created.Key, "opv_live_") {
		t.Fatalf("key = %q, want opv_live_ prefix", created.Key)
	}
	row := client.VoiceAPIKey.Query().OnlyX(auth.WithUser(context.Background(), first))
	if strings.Contains(row.KeyDigest, created.Key) || row.KeyDigest == created.Key {
		t.Fatal("persisted key material contains the bearer secret")
	}
	if got := client.VoiceAPIKey.Query().CountX(auth.WithUser(context.Background(), second)); got != 0 {
		t.Fatalf("second tenant sees %d keys, want 0", got)
	}

	verifiers := requestAs(t, router, first, http.MethodGet, "/v1/voice/api-key-verifiers", nil, nil)
	if verifiers.Code != http.StatusOK || strings.Contains(verifiers.Body.String(), created.Key) {
		t.Fatalf("verifier response leaked secret or failed: %d %s", verifiers.Code, verifiers.Body.String())
	}

	revoked := requestAs(t, router, first, http.MethodPost, "/api/v1/keys/"+created.ID+"/revoke", nil, nil)
	if revoked.Code != http.StatusOK {
		t.Fatalf("revoke status = %d: %s", revoked.Code, revoked.Body.String())
	}
	after := requestAs(t, router, first, http.MethodGet, "/v1/voice/api-key-verifiers", nil, nil)
	if strings.Contains(after.Body.String(), row.KeyDigest) {
		t.Fatal("revoked key remained in verifier snapshot")
	}
}

func TestEncryptedSyncConflictAndTenantIsolation(t *testing.T) {
	client, first, second, router := setupVoiceCloud(t)
	request := map[string]any{
		"schema_version": "1.0", "collection": "note", "item_id": "note-a", "operation": "upsert",
		"key_id": "personal-v1", "nonce": "bm9uY2U", "ciphertext": "Y2lwaGVydGV4dA",
		"content_hash": strings.Repeat("a", 64), "occurred_at": "2026-08-21T22:00:00Z",
	}
	createdRecorder := requestAs(t, router, first, http.MethodPost, "/v1/voice-sync/items", request, nil)
	if createdRecorder.Code != http.StatusCreated {
		t.Fatalf("create sync item = %d: %s", createdRecorder.Code, createdRecorder.Body.String())
	}
	created := decode[struct {
		Data syncView `json:"data"`
	}](t, createdRecorder).Data
	if created.Revision != 1 || created.Ciphertext != "Y2lwaGVydGV4dA" {
		t.Fatalf("unexpected sync item: %+v", created)
	}
	request["base_revision"] = 0
	conflict := requestAs(t, router, first, http.MethodPost, "/v1/voice-sync/items", request, nil)
	if conflict.Code != http.StatusConflict {
		t.Fatalf("stale update status = %d, want 409: %s", conflict.Code, conflict.Body.String())
	}
	if got := client.VoiceSyncItem.Query().CountX(auth.WithUser(context.Background(), second)); got != 0 {
		t.Fatalf("second tenant sees %d sync items, want 0", got)
	}
	listed := requestAs(t, router, second, http.MethodGet, "/v1/voice-sync/items", nil, nil)
	if strings.Contains(listed.Body.String(), "Y2lwaGVydGV4dA") {
		t.Fatal("cross-tenant sync response leaked ciphertext")
	}
}

func TestEncryptedSyncCursorIncludesLaterUpdates(t *testing.T) {
	_, first, _, router := setupVoiceCloud(t)
	mutation := map[string]any{
		"schema_version": "1.0", "collection": "note", "item_id": "note-cursor", "operation": "upsert",
		"key_id": "personal-v1", "nonce": "bm9uY2U", "ciphertext": "djE",
		"content_hash": strings.Repeat("a", 64), "occurred_at": "2026-08-21T22:00:00Z",
	}
	created := requestAs(t, router, first, http.MethodPost, "/v1/voice-sync/items", mutation, nil)
	if created.Code != http.StatusCreated {
		t.Fatalf("create sync item = %d: %s", created.Code, created.Body.String())
	}
	firstPage := requestAs(t, router, first, http.MethodGet, "/v1/voice-sync/items", nil, nil)
	page := decode[struct {
		NextCursor *string `json:"next_cursor"`
	}](t, firstPage)
	if page.NextCursor == nil {
		t.Fatal("first page omitted its incremental cursor")
	}

	mutation["base_revision"] = 1
	mutation["ciphertext"] = "djI"
	mutation["content_hash"] = strings.Repeat("b", 64)
	updated := requestAs(t, router, first, http.MethodPost, "/v1/voice-sync/items", mutation, nil)
	if updated.Code != http.StatusOK {
		t.Fatalf("update sync item = %d: %s", updated.Code, updated.Body.String())
	}

	nextPage := requestAs(t, router, first, http.MethodGet, "/v1/voice-sync/items?cursor="+*page.NextCursor, nil, nil)
	if nextPage.Code != http.StatusOK || !strings.Contains(nextPage.Body.String(), `"revision":2`) || !strings.Contains(nextPage.Body.String(), `"ciphertext":"djI"`) {
		t.Fatalf("updated item missing after cursor: %d %s", nextPage.Code, nextPage.Body.String())
	}
}

func TestCaptureArtifactHashIdempotencyAndTombstone(t *testing.T) {
	client, first, second, router := setupVoiceCloud(t)
	content := json.RawMessage(`{"title":"Quarterly review","content":"Customer committed to renew"}`)
	sum := sha256.Sum256(content)
	eventID := strings.Repeat("b", 64)
	body := map[string]any{
		"schemaVersion": "1.0", "eventId": eventID, "artifactId": "oppulence-voice:note:42",
		"kind": "note", "operation": "upsert", "occurredAt": "2026-08-21T22:00:00Z",
		"source":      map[string]any{"application": "Oppulence Voice", "distributionId": "oppulence-voice", "localId": "42", "event": "note-added"},
		"consent":     map[string]any{"basis": "user_opt_in", "destination": "rowboat"},
		"provenance":  map[string]any{"capturedLocally": true, "exportedBy": "rowboat-export"},
		"contentHash": hex.EncodeToString(sum[:]), "content": content,
	}
	headers := map[string]string{"Idempotency-Key": eventID}
	firstPost := requestAs(t, router, first, http.MethodPost, "/v1/capture-artifacts", body, headers)
	if firstPost.Code != http.StatusAccepted {
		t.Fatalf("first capture = %d: %s", firstPost.Code, firstPost.Body.String())
	}
	replay := requestAs(t, router, first, http.MethodPost, "/v1/capture-artifacts", body, headers)
	if replay.Code != http.StatusOK || !strings.Contains(replay.Body.String(), `"duplicate":true`) {
		t.Fatalf("capture replay = %d: %s", replay.Code, replay.Body.String())
	}
	body["artifactId"] = "oppulence-voice:note:different"
	metadataConflict := requestAs(t, router, first, http.MethodPost, "/v1/capture-artifacts", body, headers)
	if metadataConflict.Code != http.StatusConflict {
		t.Fatalf("metadata conflict = %d, want 409: %s", metadataConflict.Code, metadataConflict.Body.String())
	}
	body["artifactId"] = "oppulence-voice:note:42"
	if got := client.CaptureArtifact.Query().CountX(auth.WithUser(context.Background(), first)); got != 1 {
		t.Fatalf("artifact rows = %d, want 1", got)
	}
	if got := client.CaptureArtifact.Query().CountX(auth.WithUser(context.Background(), second)); got != 0 {
		t.Fatalf("second tenant sees %d artifacts, want 0", got)
	}
	body["contentHash"] = strings.Repeat("c", 64)
	badHash := requestAs(t, router, first, http.MethodPost, "/v1/capture-artifacts", body, headers)
	if badHash.Code != http.StatusBadRequest {
		t.Fatalf("bad hash status = %d, want 400", badHash.Code)
	}

	nullHash := sha256.Sum256([]byte("null"))
	tombstoneID := strings.Repeat("d", 64)
	body["eventId"] = tombstoneID
	body["operation"] = "delete"
	body["content"] = nil
	body["contentHash"] = hex.EncodeToString(nullHash[:])
	tombstone := requestAs(t, router, first, http.MethodPost, "/v1/capture-artifacts", body, map[string]string{"Idempotency-Key": tombstoneID})
	if tombstone.Code != http.StatusAccepted || !strings.Contains(tombstone.Body.String(), `"status":"deleted"`) {
		t.Fatalf("tombstone = %d: %s", tombstone.Code, tombstone.Body.String())
	}
}
