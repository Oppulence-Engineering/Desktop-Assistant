// Package voicecloud serves the Oppulence Voice control plane, opaque sync
// relay, and explicit capture-artifact ingestion boundary.
package voicecloud

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/captureartifact"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/voiceapikey"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/voicesyncitem"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

const (
	maxControlBody  = 64 << 10
	maxSyncBody     = 8 << 20
	maxArtifactBody = 8 << 20
	verifierTTL     = 15 * time.Minute
)

var allowedScopes = []string{
	"notes:read", "notes:write", "transcriptions:read", "transcriptions:delete", "usage:read",
}

// Handler owns the authenticated Oppulence Voice service boundary.
type Handler struct {
	client *ent.Client
	log    *zap.Logger
	now    func() time.Time
}

// New creates a handler with production dependencies.
func New(client *ent.Client, log *zap.Logger) *Handler {
	return &Handler{client: client, log: log, now: func() time.Time { return time.Now().UTC() }}
}

// Session exposes the small Better Auth-compatible session shape consumed by
// the upstream OpenWhispr renderer. Authentication remains WorkOS JWT-based;
// this endpoint is only a response-shape adapter and never mints credentials.
func (h *Handler) Session(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "missing authenticated user", "unauthorized")
		return
	}
	now := h.now()
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"session": map[string]any{
			"id":        "workos:" + u.ID.String(),
			"userId":    u.ID.String(),
			"expiresAt": now.Add(15 * time.Minute),
			"createdAt": u.CreatedAt,
			"updatedAt": now,
		},
		"user": map[string]any{
			"id":            u.ID.String(),
			"email":         u.Email,
			"name":          strings.TrimSpace(strings.SplitN(u.Email, "@", 2)[0]),
			"emailVerified": true,
			"createdAt":     u.CreatedAt,
			"updatedAt":     u.UpdatedAt,
		},
	})
}

type createKeyRequest struct {
	Name          string   `json:"name"`
	Scopes        []string `json:"scopes"`
	ExpiresInDays *int     `json:"expires_in_days"`
}

type keyView struct {
	ID         string     `json:"id"`
	Key        string     `json:"key,omitempty"`
	Name       string     `json:"name"`
	KeyPrefix  string     `json:"key_prefix"`
	Scopes     []string   `json:"scopes"`
	LastUsedAt *time.Time `json:"last_used_at"`
	ExpiresAt  *time.Time `json:"expires_at"`
	CreatedAt  time.Time  `json:"created_at"`
}

// CreateKey handles POST /api/v1/keys/create. API keys are random capability
// secrets; only their digest is persisted.
func (h *Handler) CreateKey(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "missing authenticated user", "unauthorized")
		return
	}
	var req createKeyRequest
	if !httpx.DecodeJSON(w, r, maxControlBody, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || len(req.Name) > 100 {
		httpx.Error(w, http.StatusBadRequest, "name must contain 1 to 100 characters", "validation_error")
		return
	}
	if len(req.Scopes) == 0 {
		req.Scopes = []string{"notes:read"}
	}
	for _, scope := range req.Scopes {
		if !slices.Contains(allowedScopes, scope) {
			httpx.Error(w, http.StatusBadRequest, "unsupported API key scope", "validation_error")
			return
		}
	}
	slices.Sort(req.Scopes)
	req.Scopes = slices.Compact(req.Scopes)
	var expiresAt *time.Time
	if req.ExpiresInDays != nil {
		if *req.ExpiresInDays < 1 || *req.ExpiresInDays > 3650 {
			httpx.Error(w, http.StatusBadRequest, "expires_in_days must be between 1 and 3650", "validation_error")
			return
		}
		value := h.now().Add(time.Duration(*req.ExpiresInDays) * 24 * time.Hour)
		expiresAt = &value
	}
	secret, digest, err := newAPIKey()
	if err != nil {
		h.log.Error("generate voice API key", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not create API key", "internal_error")
		return
	}
	prefix := secret
	if len(prefix) > 16 {
		prefix = prefix[:16]
	}
	created, err := h.client.VoiceAPIKey.Create().
		SetUser(u).
		SetName(req.Name).
		SetKeyDigest(digest).
		SetKeyPrefix(prefix).
		SetScopes(req.Scopes).
		SetNillableExpiresAt(expiresAt).
		Save(r.Context())
	if err != nil {
		h.log.Error("persist voice API key", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not create API key", "internal_error")
		return
	}
	view := apiKeyView(created)
	view.Key = secret
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{"data": view})
}

// ListKeys handles GET /api/v1/keys/list.
func (h *Handler) ListKeys(w http.ResponseWriter, r *http.Request) {
	keys, err := h.client.VoiceAPIKey.Query().Order(ent.Desc(voiceapikey.FieldCreatedAt)).All(r.Context())
	if err != nil {
		h.log.Error("list voice API keys", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not list API keys", "internal_error")
		return
	}
	views := make([]keyView, 0, len(keys))
	for _, key := range keys {
		if key.RevokedAt == nil {
			views = append(views, apiKeyView(key))
		}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"data": views})
}

// RevokeKey handles POST /api/v1/keys/{id}/revoke.
func (h *Handler) RevokeKey(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, http.StatusNotFound, "API key not found", "not_found")
		return
	}
	key, err := h.client.VoiceAPIKey.Query().Where(voiceapikey.IDEQ(id)).Only(r.Context())
	if ent.IsNotFound(err) {
		httpx.Error(w, http.StatusNotFound, "API key not found", "not_found")
		return
	}
	if err != nil {
		h.log.Error("load voice API key", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not revoke API key", "internal_error")
		return
	}
	if key.RevokedAt == nil {
		if _, err := key.Update().SetRevokedAt(h.now()).Save(r.Context()); err != nil {
			h.log.Error("revoke voice API key", zap.Error(err))
			httpx.Error(w, http.StatusInternalServerError, "could not revoke API key", "internal_error")
			return
		}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"message": "API key revoked"})
}

type verifierView struct {
	ID        string     `json:"id"`
	Digest    string     `json:"digest"`
	Scopes    []string   `json:"scopes"`
	ExpiresAt *time.Time `json:"expires_at"`
}

// KeyVerifiers returns a short-lived authenticated snapshot for the loopback
// API. A digest of a 256-bit random key is verifier material, not a reusable
// bearer secret.
func (h *Handler) KeyVerifiers(w http.ResponseWriter, r *http.Request) {
	now := h.now()
	keys, err := h.client.VoiceAPIKey.Query().
		Where(voiceapikey.RevokedAtIsNil(), voiceapikey.Or(voiceapikey.ExpiresAtIsNil(), voiceapikey.ExpiresAtGT(now))).
		All(r.Context())
	if err != nil {
		h.log.Error("list voice API key verifiers", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not list key verifiers", "internal_error")
		return
	}
	views := make([]verifierView, 0, len(keys))
	for _, key := range keys {
		views = append(views, verifierView{ID: key.ID.String(), Digest: key.KeyDigest, Scopes: key.Scopes, ExpiresAt: key.ExpiresAt})
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"data": map[string]any{"verifiers": views, "valid_until": now.Add(verifierTTL)},
	})
}

func newAPIKey() (secret string, digest string, err error) {
	raw := make([]byte, 32)
	if _, err = rand.Read(raw); err != nil {
		return "", "", err
	}
	secret = "opv_live_" + base64.RawURLEncoding.EncodeToString(raw)
	sum := sha256.Sum256([]byte(secret))
	return secret, hex.EncodeToString(sum[:]), nil
}

func apiKeyView(key *ent.VoiceAPIKey) keyView {
	return keyView{ID: key.ID.String(), Name: key.Name, KeyPrefix: key.KeyPrefix, Scopes: key.Scopes,
		LastUsedAt: key.LastUsedAt, ExpiresAt: key.ExpiresAt, CreatedAt: key.CreatedAt}
}

type syncMutationRequest struct {
	SchemaVersion string `json:"schema_version"`
	Collection    string `json:"collection"`
	ItemID        string `json:"item_id"`
	SpaceID       string `json:"space_id"`
	Operation     string `json:"operation"`
	BaseRevision  *int   `json:"base_revision"`
	KeyID         string `json:"key_id"`
	Nonce         string `json:"nonce"`
	Ciphertext    string `json:"ciphertext"`
	ContentHash   string `json:"content_hash"`
	BlindIndex    string `json:"blind_index"`
	OccurredAt    string `json:"occurred_at"`
}

type syncView struct {
	SchemaVersion string     `json:"schema_version"`
	Collection    string     `json:"collection"`
	ItemID        string     `json:"item_id"`
	SpaceID       string     `json:"space_id,omitempty"`
	Operation     string     `json:"operation"`
	Revision      int        `json:"revision"`
	KeyID         string     `json:"key_id"`
	Nonce         string     `json:"nonce"`
	Ciphertext    string     `json:"ciphertext"`
	ContentHash   string     `json:"content_hash"`
	BlindIndex    string     `json:"blind_index,omitempty"`
	OccurredAt    time.Time  `json:"occurred_at"`
	DeletedAt     *time.Time `json:"deleted_at,omitempty"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

// PutSyncItem atomically creates or compare-and-swaps one encrypted item.
func (h *Handler) PutSyncItem(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "missing authenticated user", "unauthorized")
		return
	}
	var req syncMutationRequest
	if !httpx.DecodeJSON(w, r, maxSyncBody, &req) {
		return
	}
	occurredAt, validation := validateSyncMutation(req)
	if validation != "" {
		httpx.Error(w, http.StatusBadRequest, validation, "validation_error")
		return
	}
	current, err := h.client.VoiceSyncItem.Query().
		Where(voicesyncitem.CollectionEQ(req.Collection), voicesyncitem.ItemIDEQ(req.ItemID)).
		Only(r.Context())
	if ent.IsNotFound(err) {
		if req.BaseRevision != nil && *req.BaseRevision != 0 {
			httpx.Error(w, http.StatusConflict, "sync item revision conflict", "sync_revision_conflict")
			return
		}
		create := h.client.VoiceSyncItem.Create().SetUser(u).SetCollection(req.Collection).SetItemID(req.ItemID).
			SetSpaceID(req.SpaceID).SetOperation(req.Operation).SetKeyID(req.KeyID).SetNonce(req.Nonce).
			SetCiphertext(req.Ciphertext).SetContentHash(req.ContentHash).SetBlindIndex(req.BlindIndex).SetOccurredAt(occurredAt)
		if req.Operation == "delete" {
			create.SetDeletedAt(h.now())
		}
		created, createErr := create.Save(r.Context())
		if createErr != nil {
			if ent.IsConstraintError(createErr) {
				httpx.Error(w, http.StatusConflict, "sync item revision conflict", "sync_revision_conflict")
				return
			}
			h.log.Error("create voice sync item", zap.Error(createErr))
			httpx.Error(w, http.StatusInternalServerError, "could not save sync item", "internal_error")
			return
		}
		httpx.WriteJSON(w, http.StatusCreated, map[string]any{"data": syncItemView(created)})
		return
	}
	if err != nil {
		h.log.Error("load voice sync item", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not save sync item", "internal_error")
		return
	}
	if req.BaseRevision == nil || *req.BaseRevision != current.Revision {
		httpx.ErrorWith(w, http.StatusConflict, "sync item revision conflict", "sync_revision_conflict",
			map[string]any{"data": map[string]any{"item": syncItemView(current)}})
		return
	}
	update := h.client.VoiceSyncItem.UpdateOneID(current.ID).
		Where(voicesyncitem.RevisionEQ(current.Revision)).
		SetSpaceID(req.SpaceID).SetOperation(req.Operation).AddRevision(1).SetKeyID(req.KeyID).
		SetNonce(req.Nonce).SetCiphertext(req.Ciphertext).SetContentHash(req.ContentHash).
		SetBlindIndex(req.BlindIndex).SetOccurredAt(occurredAt)
	if req.Operation == "delete" {
		update.SetDeletedAt(h.now())
	} else {
		update.ClearDeletedAt()
	}
	updated, err := update.Save(r.Context())
	if ent.IsNotFound(err) {
		httpx.Error(w, http.StatusConflict, "sync item revision conflict", "sync_revision_conflict")
		return
	}
	if err != nil {
		h.log.Error("update voice sync item", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not save sync item", "internal_error")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"data": syncItemView(updated)})
}

// ListSyncItems returns a bounded deterministic change feed. The opaque cursor
// carries (updated_at, id), so an update to an existing logical item appears in
// a later incremental pull instead of being hidden behind its original UUID.
func (h *Handler) ListSyncItems(w http.ResponseWriter, r *http.Request) {
	limit := 100
	if raw := r.URL.Query().Get("limit"); raw != "" {
		var parsed int
		if _, err := fmt.Sscan(raw, &parsed); err != nil || parsed < 1 || parsed > 500 {
			httpx.Error(w, http.StatusBadRequest, "limit must be between 1 and 500", "validation_error")
			return
		}
		limit = parsed
	}
	query := h.client.VoiceSyncItem.Query().Order(
		ent.Asc(voicesyncitem.FieldUpdatedAt),
		ent.Asc(voicesyncitem.FieldID),
	)
	if collection := r.URL.Query().Get("collection"); collection != "" {
		query.Where(voicesyncitem.CollectionEQ(collection))
	}
	if rawCursor := r.URL.Query().Get("cursor"); rawCursor != "" {
		cursor, err := decodeSyncCursor(rawCursor)
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, "invalid cursor", "validation_error")
			return
		}
		query.Where(voicesyncitem.Or(
			voicesyncitem.UpdatedAtGT(cursor.UpdatedAt),
			voicesyncitem.And(
				voicesyncitem.UpdatedAtEQ(cursor.UpdatedAt),
				voicesyncitem.IDGT(cursor.ID),
			),
		))
	}
	items, err := query.Limit(limit + 1).All(r.Context())
	if err != nil {
		h.log.Error("list voice sync items", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not list sync items", "internal_error")
		return
	}
	hasMore := len(items) > limit
	if hasMore {
		items = items[:limit]
	}
	views := make([]syncView, 0, len(items))
	for _, item := range items {
		views = append(views, syncItemView(item))
	}
	var nextCursor *string
	if len(items) > 0 {
		value := encodeSyncCursor(syncCursor{
			UpdatedAt: items[len(items)-1].UpdatedAt,
			ID:        items[len(items)-1].ID,
		})
		nextCursor = &value
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"data": views, "has_more": hasMore, "next_cursor": nextCursor})
}

type syncCursor struct {
	UpdatedAt time.Time `json:"updated_at"`
	ID        uuid.UUID `json:"id"`
}

func encodeSyncCursor(cursor syncCursor) string {
	raw, _ := json.Marshal(cursor)
	return base64.RawURLEncoding.EncodeToString(raw)
}

func decodeSyncCursor(value string) (syncCursor, error) {
	if len(value) > 1024 {
		return syncCursor{}, errors.New("cursor too long")
	}
	raw, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return syncCursor{}, err
	}
	var cursor syncCursor
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&cursor); err != nil || cursor.UpdatedAt.IsZero() || cursor.ID == uuid.Nil {
		return syncCursor{}, errors.New("invalid cursor payload")
	}
	return cursor, nil
}

func validateSyncMutation(req syncMutationRequest) (time.Time, string) {
	if req.SchemaVersion != "1.0" {
		return time.Time{}, "unsupported schema_version"
	}
	if !slices.Contains([]string{"note", "folder", "transcription", "dictionary", "snippet", "speaker_profile"}, req.Collection) ||
		!slices.Contains([]string{"upsert", "delete"}, req.Operation) {
		return time.Time{}, "unsupported collection or operation"
	}
	if strings.TrimSpace(req.ItemID) == "" || strings.TrimSpace(req.KeyID) == "" || strings.TrimSpace(req.Nonce) == "" || strings.TrimSpace(req.Ciphertext) == "" {
		return time.Time{}, "item_id, key_id, nonce, and ciphertext are required"
	}
	if len(req.ContentHash) != 64 {
		return time.Time{}, "content_hash must be SHA-256 hex"
	}
	if _, err := hex.DecodeString(req.ContentHash); err != nil {
		return time.Time{}, "content_hash must be SHA-256 hex"
	}
	occurredAt, err := time.Parse(time.RFC3339Nano, req.OccurredAt)
	if err != nil {
		return time.Time{}, "occurred_at must be RFC 3339"
	}
	return occurredAt.UTC(), ""
}

func syncItemView(item *ent.VoiceSyncItem) syncView {
	return syncView{SchemaVersion: "1.0", Collection: item.Collection, ItemID: item.ItemID, SpaceID: item.SpaceID,
		Operation: item.Operation, Revision: item.Revision, KeyID: item.KeyID, Nonce: item.Nonce,
		Ciphertext: item.Ciphertext, ContentHash: item.ContentHash, BlindIndex: item.BlindIndex,
		OccurredAt: item.OccurredAt, DeletedAt: item.DeletedAt, UpdatedAt: item.UpdatedAt}
}

type captureEnvelope struct {
	SchemaVersion string          `json:"schemaVersion"`
	EventID       string          `json:"eventId"`
	ArtifactID    string          `json:"artifactId"`
	Kind          string          `json:"kind"`
	Operation     string          `json:"operation"`
	OccurredAt    json.RawMessage `json:"occurredAt"`
	Source        struct {
		Application    string `json:"application"`
		DistributionID string `json:"distributionId"`
		LocalID        string `json:"localId"`
		Event          string `json:"event"`
	} `json:"source"`
	Consent struct {
		Basis       string `json:"basis"`
		Destination string `json:"destination"`
	} `json:"consent"`
	ContentHash string          `json:"contentHash"`
	Content     json.RawMessage `json:"content"`
}

// IngestCapture accepts an explicitly consented Rowboat handoff. It validates
// the source hash and persists the immutable envelope exactly once.
func (h *Handler) IngestCapture(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "missing authenticated user", "unauthorized")
		return
	}
	body, ok := httpx.ReadBody(w, r, maxArtifactBody)
	if !ok {
		return
	}
	var envelope captureEnvelope
	if err := json.Unmarshal(body, &envelope); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid capture artifact", "validation_error")
		return
	}
	if message := validateCaptureEnvelope(envelope, r.Header.Get("Idempotency-Key")); message != "" {
		httpx.Error(w, http.StatusBadRequest, message, "validation_error")
		return
	}
	occurredAt, err := parseArtifactTime(envelope.OccurredAt)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "occurredAt must be an RFC 3339 string or millisecond timestamp", "validation_error")
		return
	}
	existing, err := h.client.CaptureArtifact.Query().Where(captureartifact.EventIDEQ(envelope.EventID)).Only(r.Context())
	if err == nil {
		if subtle.ConstantTimeCompare([]byte(existing.ContentHash), []byte(envelope.ContentHash)) != 1 ||
			subtle.ConstantTimeCompare([]byte(existing.PayloadJSON), body) != 1 {
			httpx.Error(w, http.StatusConflict, "eventId was already used for different content", "idempotency_conflict")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, captureResponse(existing, true))
		return
	}
	if !ent.IsNotFound(err) {
		h.log.Error("load capture artifact", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not accept capture artifact", "internal_error")
		return
	}
	status := "accepted"
	if envelope.Operation == "delete" {
		status = "deleted"
	}
	created, err := h.client.CaptureArtifact.Create().SetUser(u).SetEventID(envelope.EventID).
		SetArtifactID(envelope.ArtifactID).SetSchemaVersion(envelope.SchemaVersion).SetKind(envelope.Kind).
		SetOperation(envelope.Operation).SetSourceProduct(envelope.Source.DistributionID).
		SetConsentBasis(envelope.Consent.Basis).SetContentHash(envelope.ContentHash).
		SetPayloadJSON(string(body)).SetStatus(status).SetOccurredAt(occurredAt).Save(r.Context())
	if ent.IsConstraintError(err) {
		existing, lookupErr := h.client.CaptureArtifact.Query().Where(captureartifact.EventIDEQ(envelope.EventID)).Only(r.Context())
		if lookupErr == nil &&
			subtle.ConstantTimeCompare([]byte(existing.ContentHash), []byte(envelope.ContentHash)) == 1 &&
			subtle.ConstantTimeCompare([]byte(existing.PayloadJSON), body) == 1 {
			httpx.WriteJSON(w, http.StatusOK, captureResponse(existing, true))
			return
		}
		httpx.Error(w, http.StatusConflict, "capture artifact already exists", "idempotency_conflict")
		return
	}
	if err != nil {
		h.log.Error("persist capture artifact", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not accept capture artifact", "internal_error")
		return
	}
	httpx.WriteJSON(w, http.StatusAccepted, captureResponse(created, false))
}

// GetCapture returns ingestion status without exposing the submitted payload.
func (h *Handler) GetCapture(w http.ResponseWriter, r *http.Request) {
	item, err := h.client.CaptureArtifact.Query().Where(captureartifact.EventIDEQ(chi.URLParam(r, "eventId"))).Only(r.Context())
	if ent.IsNotFound(err) {
		httpx.Error(w, http.StatusNotFound, "capture artifact not found", "not_found")
		return
	}
	if err != nil {
		h.log.Error("load capture artifact status", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not load capture artifact", "internal_error")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, captureResponse(item, true))
}

func validateCaptureEnvelope(value captureEnvelope, idempotencyKey string) string {
	if value.SchemaVersion != "1.0" || len(value.EventID) != 64 || len(value.ContentHash) != 64 {
		return "unsupported schemaVersion or invalid hash identifier"
	}
	if _, err := hex.DecodeString(value.EventID); err != nil {
		return "eventId must be SHA-256 hex"
	}
	if _, err := hex.DecodeString(value.ContentHash); err != nil {
		return "contentHash must be SHA-256 hex"
	}
	if idempotencyKey == "" || subtle.ConstantTimeCompare([]byte(idempotencyKey), []byte(value.EventID)) != 1 {
		return "Idempotency-Key must equal eventId"
	}
	if value.ArtifactID == "" || !slices.Contains([]string{"note", "transcription", "speaker_mapping"}, value.Kind) ||
		!slices.Contains([]string{"upsert", "delete"}, value.Operation) {
		return "invalid artifact identity, kind, or operation"
	}
	if value.Consent.Basis != "user_opt_in" || value.Consent.Destination != "rowboat" {
		return "explicit Rowboat consent is required"
	}
	if value.Source.DistributionID == "" || value.Source.LocalID == "" || len(value.Content) == 0 {
		return "source and content are required"
	}
	if value.Operation == "delete" && string(value.Content) != "null" {
		return "delete artifacts must contain a null content tombstone"
	}
	sum := sha256.Sum256(value.Content)
	if subtle.ConstantTimeCompare([]byte(hex.EncodeToString(sum[:])), []byte(value.ContentHash)) != 1 {
		return "contentHash does not match content"
	}
	return ""
}

func parseArtifactTime(raw json.RawMessage) (time.Time, error) {
	var text string
	if json.Unmarshal(raw, &text) == nil {
		return time.Parse(time.RFC3339Nano, text)
	}
	var milliseconds int64
	if json.Unmarshal(raw, &milliseconds) == nil {
		return time.UnixMilli(milliseconds).UTC(), nil
	}
	return time.Time{}, errors.New("invalid artifact time")
}

func captureResponse(item *ent.CaptureArtifact, duplicate bool) map[string]any {
	return map[string]any{"data": map[string]any{
		"event_id": item.EventID, "artifact_id": item.ArtifactID, "status": item.Status,
		"duplicate": duplicate, "accepted_at": item.CreatedAt,
	}}
}
