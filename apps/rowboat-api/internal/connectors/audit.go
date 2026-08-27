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
	records := append([]auditRecord{record}, semanticAuditRecords(record)...)
	for _, durable := range records {
		if err := h.persistAuditReconciled(ctx, owner, durable); err != nil && h != nil && h.log != nil {
			h.log.Error("reconcile connector audit event", zap.String("event_type", durable.EventType), zap.String("connector", durable.Connector), zap.Error(err))
		}
	}
}

// persistAuditReconciled detaches audit durability from request cancellation and
// retries transient database failures. Security transitions call appendAudit
// after their state write, so this bounded reconciliation prevents a client
// disconnect from silently dropping the corresponding durable event.
func (h *Handler) persistAuditReconciled(ctx context.Context, owner *ent.User, record auditRecord) error {
	var err error
	for attempt := 0; attempt < 3; attempt++ {
		detached, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
		err = h.persistAudit(detached, owner, record)
		cancel()
		if err == nil {
			return nil
		}
		if attempt < 2 {
			time.Sleep(time.Duration(attempt+1) * 25 * time.Millisecond)
		}
	}
	return err
}

func semanticAuditRecords(record auditRecord) []auditRecord {
	semantic := func(eventType, result string) auditRecord {
		derived := record
		derived.EventType = eventType
		derived.EventID = ""
		derived.Result = result
		return derived
	}
	switch record.EventType {
	case "oauth_started":
		return []auditRecord{semantic("entitlement.check", "allowed")}
	case "token_minted":
		return []auditRecord{semantic("entitlement.check", "allowed"), semantic("token.refreshed", "success")}
	case "oauth_start_rejected", "token_mint_rejected":
		if isEntitlementAuditReason(record.Reason) {
			return []auditRecord{semantic("entitlement.check", "denied")}
		}
	case "connection_invalidated":
		if record.Reason == "refresh_token_reuse" {
			return []auditRecord{semantic("token.reuse_detected", "credential_family_invalidated"), semantic("token.revoked", "invalidated")}
		}
		return []auditRecord{semantic("token.revoked", "invalidated")}
	case "connection_revoked":
		return []auditRecord{semantic("token.revoked", "revoked")}
	case "connection_revocation_completed":
		return []auditRecord{semantic("token.revoked", "retry_success")}
	}
	return nil
}

func isEntitlementAuditReason(reason string) bool {
	switch reason {
	case "no_subscription", "scope_not_in_plan", "user_banned", "org_mismatch", "connector_disabled", "entitlement_unavailable":
		return true
	default:
		return false
	}
}

// persistAudit performs the durable write used by the consent hook. Callers
// that must fail closed use its error directly. Best-effort lifecycle callers
// use appendAudit above. Neither path records credentials or raw OAuth state.
func (h *Handler) persistAudit(ctx context.Context, owner *ent.User, record auditRecord) error {
	if h == nil {
		return errors.New("invalid connector audit handler")
	}
	return h.persistAuditWithClient(ctx, h.client, owner, record)
}

func (h *Handler) persistAuditWithClient(ctx context.Context, client *ent.Client, owner *ent.User, record auditRecord) error {
	if client == nil || owner == nil || record.EventType == "" || record.Connector == "" {
		return errors.New("invalid connector audit record")
	}
	actorKind := "system"
	if actor, ok := auth.ActorFromCtx(ctx); ok {
		actorKind = string(actor.Kind)
	}
	create := client.ConnectorAuditEvent.Create().
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
