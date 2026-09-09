package revenue

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
)

// registerEntryDTO is one row of the commitment register. It carries the
// derived state and the account name, because the register is read across
// accounts and a row that cannot name its counterparty is not usable.
type registerEntryDTO struct {
	commitmentDTO
	State            string `json:"state"`
	RelationshipID   string `json:"relationshipId,omitempty"`
	RelationshipName string `json:"relationshipName,omitempty"`
}

func registerEntryToDTO(row *ent.Commitment, now time.Time) registerEntryDTO {
	entry := registerEntryDTO{
		commitmentDTO: commitmentToDTO(row),
		State:         commitmentRegisterState(row, now),
	}
	if rel, err := row.Edges.RelationshipOrErr(); err == nil && rel != nil {
		entry.RelationshipID = rel.ID.String()
		entry.RelationshipName = rel.DisplayName
	}
	return entry
}

// ListCommitments serves the commitment register across every account.
//
// The five views of the one-pager §3 are five query strings against this one
// route:
//
//	what we owe      ?direction=promised_by_me&state=open,at_risk
//	what they owe us ?direction=promised_by_them&state=open,at_risk
//	what changed     ?changedSince=<rfc3339>
//	by account       ?relationshipId=<uuid>
//	by owner         ?owner=<participant ref>
func (h *Handler) ListCommitments(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	query := r.URL.Query()
	filter := CommitmentFilter{
		Direction: strings.TrimSpace(query.Get("direction")),
		Owner:     strings.TrimSpace(query.Get("owner")),
	}
	for _, state := range strings.Split(query.Get("state"), ",") {
		if trimmed := strings.TrimSpace(state); trimmed != "" {
			filter.States = append(filter.States, trimmed)
		}
	}
	if raw := strings.TrimSpace(query.Get("relationshipId")); raw != "" {
		id, err := uuid.Parse(raw)
		if err != nil {
			h.writeServiceError(w, fmt.Errorf("%w: invalid relationshipId", ErrInvalidInput))
			return
		}
		filter.RelationshipID = id
	}
	if raw := strings.TrimSpace(query.Get("dueBefore")); raw != "" {
		at, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			h.writeServiceError(w, fmt.Errorf("%w: invalid dueBefore", ErrInvalidInput))
			return
		}
		filter.DueBefore = at
	}
	if raw := strings.TrimSpace(query.Get("changedSince")); raw != "" {
		at, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			h.writeServiceError(w, fmt.Errorf("%w: invalid changedSince", ErrInvalidInput))
			return
		}
		filter.ChangedSince = at
	}
	if raw := strings.TrimSpace(query.Get("limit")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil {
			h.writeServiceError(w, fmt.Errorf("%w: invalid limit", ErrInvalidInput))
			return
		}
		filter.Limit = n
	}
	if raw := strings.TrimSpace(query.Get("offset")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil {
			h.writeServiceError(w, fmt.Errorf("%w: invalid offset", ErrInvalidInput))
			return
		}
		filter.Offset = n
	}
	rows, err := h.svc.ListCommitments(r.Context(), u, filter)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	now := time.Now().UTC()
	out := make([]registerEntryDTO, 0, len(rows))
	for _, row := range rows {
		out = append(out, registerEntryToDTO(row, now))
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"commitments": out})
}

// ExportCommitment returns one commitment as a standalone record: the
// obligation, its full state history, and the verbatim cited evidence.
//
// "?format=md" returns the document a user forwards. The default is JSON, for
// clients that render it themselves.
func (h *Handler) ExportCommitment(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	commitmentID, ok := pathUUID(w, r, "commitmentId")
	if !ok {
		return
	}
	record, err := h.svc.ExportCommitment(r.Context(), u, commitmentID)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	if strings.EqualFold(r.URL.Query().Get("format"), "md") {
		httpx.WriteMarkdownAttachment(w, "commitment-"+record.ID+".md", record.Markdown())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, record)
}

// OpenPromisesReport serves the wedge artifact for one completed scan.
//
// "?format=md" returns the document handed to a prospect. §11: run this by
// hand for the first customers before automating any of it.
func (h *Handler) OpenPromisesReport(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	scanID, ok := pathUUID(w, r, "scanId")
	if !ok {
		return
	}
	report, err := h.svc.OpenPromisesReport(r.Context(), u, scanID)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	if strings.EqualFold(r.URL.Query().Get("format"), "md") {
		httpx.WriteMarkdownAttachment(w, "open-promises.md", report.Markdown())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, report)
}
