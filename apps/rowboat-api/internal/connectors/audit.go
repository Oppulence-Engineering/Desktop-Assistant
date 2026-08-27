package connectors

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

type auditRecord struct {
	EventType      string
	EventID        string
	Connector      string
	ConnectionID   uuid.UUID
	Audience       string
	Requested      []string
	Granted        []string
	Reason         string
	Metadata       map[string]any
	ConsentSession string
	ContextRequest string
	Challenge      string
	ClientID       string
	Result         string
	OccurredAt     time.Time
}

func (h *Handler) appendAudit(ctx context.Context, owner *ent.User, record auditRecord) {
	if err := h.persistAudit(ctx, owner, record); err != nil && h != nil && h.log != nil {
		h.log.Warn("append connector audit event", zap.String("event_type", record.EventType), zap.String("connector", record.Connector), zap.Error(err))
	}
}

// persistAudit performs the durable write used by the consent hook. Callers
// that must fail closed use its error directly. Best-effort lifecycle callers
// use appendAudit above. Neither path records credentials or raw OAuth state.
func (h *Handler) persistAudit(ctx context.Context, owner *ent.User, record auditRecord) error {
	if h == nil || h.client == nil || owner == nil || record.EventType == "" || record.Connector == "" {
		return errors.New("invalid connector audit record")
	}
	actorKind := "system"
	if actor, ok := auth.ActorFromCtx(ctx); ok {
		actorKind = string(actor.Kind)
	}
	create := h.client.ConnectorAuditEvent.Create().
		SetUser(owner).
		SetEventType(record.EventType).
		SetConnector(record.Connector).
		SetOwnerWorkosUserID(owner.WorkosUserID).
		SetActorKind(actorKind)
	if record.EventID != "" {
		create.SetEventID(record.EventID)
	}
	if owner.WorkosOrgID != "" {
		create.SetOrgID(owner.WorkosOrgID)
	}
	if record.ConnectionID != uuid.Nil {
		create.SetConnectionID(record.ConnectionID)
	}
	if record.Audience != "" {
		create.SetAudience(record.Audience)
	}
	if len(record.Requested) > 0 {
		create.SetRequestedScopes(record.Requested)
	}
	if len(record.Granted) > 0 {
		create.SetGrantedScopes(record.Granted)
	}
	if record.Reason != "" {
		create.SetReason(record.Reason)
	}
	if len(record.Metadata) > 0 {
		if raw, err := json.Marshal(record.Metadata); err == nil {
			create.SetMetadataJSON(string(raw))
		}
	}
	if record.ConsentSession != "" {
		create.SetConsentSessionID(record.ConsentSession)
	}
	if record.ContextRequest != "" {
		create.SetContextRequestID(record.ContextRequest)
	}
	if record.Challenge != "" {
		create.SetChallenge(record.Challenge)
	}
	if record.ClientID != "" {
		create.SetClientID(record.ClientID)
	}
	if record.Result != "" {
		create.SetResult(record.Result)
	}
	if !record.OccurredAt.IsZero() {
		create.SetOccurredAt(record.OccurredAt)
	}
	return create.Exec(auth.WithUser(ctx, owner))
}
