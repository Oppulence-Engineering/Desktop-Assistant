package revenue

import (
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
)

type communicationPolicyDTO struct {
	ID                     uuid.UUID `json:"id"`
	SourceAccountID        string    `json:"sourceAccountId"`
	MetadataVisibility     string    `json:"metadataVisibility"`
	ShareSubject           bool      `json:"shareSubject"`
	ShareBody              bool      `json:"shareBody"`
	ShareAttachments       bool      `json:"shareAttachments"`
	SignatureEnrichment    bool      `json:"signatureEnrichment"`
	ModelContactExtraction bool      `json:"modelContactExtraction"`
	RetentionDays          int       `json:"retentionDays"`
	Version                int       `json:"version"`
}

func communicationPolicyToDTO(row *ent.CommunicationPrivacyPolicy) communicationPolicyDTO {
	return communicationPolicyDTO{
		ID: row.ID, SourceAccountID: row.SourceAccountID,
		MetadataVisibility: row.MetadataVisibility, ShareSubject: row.ShareSubject,
		ShareBody: row.ShareBody, ShareAttachments: row.ShareAttachments,
		SignatureEnrichment:    row.SignatureEnrichment,
		ModelContactExtraction: row.ModelContactExtraction,
		RetentionDays:          row.RetentionDays, Version: row.Version,
	}
}

type communicationPrivacyRuleDTO struct {
	ID        uuid.UUID `json:"id"`
	Kind      string    `json:"kind"`
	Value     string    `json:"value"`
	ValueHash string    `json:"valueHash"`
	Active    bool      `json:"active"`
}

func communicationPrivacyRuleToDTO(row *ent.CommunicationPrivacyRule) communicationPrivacyRuleDTO {
	return communicationPrivacyRuleDTO{
		ID: row.ID, Kind: row.Kind, Value: row.Value, ValueHash: row.ValueHash, Active: row.Active,
	}
}

type communicationGrantDTO struct {
	ID           uuid.UUID  `json:"id"`
	Scope        string     `json:"scope"`
	ResourceType string     `json:"resourceType"`
	ResourceID   string     `json:"resourceId"`
	ExpiresAt    *time.Time `json:"expiresAt,omitempty"`
	RevokedAt    *time.Time `json:"revokedAt,omitempty"`
}

func communicationGrantToDTO(row *ent.CommunicationShareGrant) communicationGrantDTO {
	return communicationGrantDTO{
		ID: row.ID, Scope: row.Scope, ResourceType: row.ResourceType,
		ResourceID: row.ResourceID, ExpiresAt: row.ExpiresAt, RevokedAt: row.RevokedAt,
	}
}

// SetWorkspaceCommunicationDefaults updates the metadata-only admin baseline.
func (h *Handler) SetWorkspaceCommunicationDefaults(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	var body CommunicationPolicyInput
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	row, err := h.svc.SetWorkspaceCommunicationDefaults(r.Context(), u, body)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, communicationPolicyToDTO(row))
}

// GetCommunicationPolicy returns the caller's mailbox policy.
func (h *Handler) GetCommunicationPolicy(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	row, err := h.svc.CommunicationPolicy(r.Context(), u, chi.URLParam(r, "sourceAccountId"))
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, communicationPolicyToDTO(row))
}

// PutCommunicationPolicy creates or replaces the caller's mailbox policy.
func (h *Handler) PutCommunicationPolicy(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	var body CommunicationPolicyInput
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	row, err := h.svc.UpsertCommunicationPolicy(r.Context(), u, chi.URLParam(r, "sourceAccountId"), body)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, communicationPolicyToDTO(row))
}

// DeleteCommunicationPolicy removes the caller's mailbox policy override.
func (h *Handler) DeleteCommunicationPolicy(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	if err := h.svc.DeleteCommunicationPolicy(r.Context(), u, chi.URLParam(r, "sourceAccountId")); err != nil {
		h.writeServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ListCommunicationPrivacyRules lists the caller's protected/private rules.
func (h *Handler) ListCommunicationPrivacyRules(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	rows, err := h.svc.CommunicationPrivacyRules(r.Context(), u)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	out := make([]communicationPrivacyRuleDTO, 0, len(rows))
	for _, row := range rows {
		out = append(out, communicationPrivacyRuleToDTO(row))
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"rules": out})
}

// CreateCommunicationPrivacyRule adds a caller-owned protected/private rule.
func (h *Handler) CreateCommunicationPrivacyRule(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	var body CommunicationRuleInput
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	row, err := h.svc.CreateCommunicationPrivacyRule(r.Context(), u, body)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, communicationPrivacyRuleToDTO(row))
}

// SetCommunicationPrivacyRule activates or deactivates a caller-owned rule.
func (h *Handler) SetCommunicationPrivacyRule(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	ruleID, ok := pathUUID(w, r, "ruleId")
	if !ok {
		return
	}
	var body struct {
		Active bool `json:"active"`
	}
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	row, err := h.svc.SetCommunicationPrivacyRuleActive(r.Context(), u, ruleID, body.Active)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, communicationPrivacyRuleToDTO(row))
}

// DeleteCommunicationPrivacyRule deletes a caller-owned rule.
func (h *Handler) DeleteCommunicationPrivacyRule(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	ruleID, ok := pathUUID(w, r, "ruleId")
	if !ok {
		return
	}
	if err := h.svc.DeleteCommunicationPrivacyRule(r.Context(), u, ruleID); err != nil {
		h.writeServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GrantCommunicationAccess creates an owner-controlled bounded grant.
func (h *Handler) GrantCommunicationAccess(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	var body CommunicationGrantInput
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	body.Reason = strings.TrimSpace(body.Reason)
	row, err := h.svc.GrantCommunicationAccess(r.Context(), u, body)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, communicationGrantToDTO(row))
}

// RevokeCommunicationAccess revokes a caller-owned grant.
func (h *Handler) RevokeCommunicationAccess(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	grantID, ok := pathUUID(w, r, "grantId")
	if !ok {
		return
	}
	row, err := h.svc.RevokeCommunicationAccess(r.Context(), u, grantID)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, communicationGrantToDTO(row))
}

// PurgeCommunication retracts one caller-owned communication and derivatives.
func (h *Handler) PurgeCommunication(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	interactionID, ok := pathUUID(w, r, "interactionId")
	if !ok {
		return
	}
	result, err := h.svc.PurgeCommunication(r.Context(), u, interactionID)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, result)
}
