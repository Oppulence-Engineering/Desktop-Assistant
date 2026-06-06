package db

import (
	"context"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/hook"
	"go.uber.org/zap"
)

// registerHooks installs write-side middleware on the client:
//   - append-only enforcement on the credit ledger
//   - audit logging on sensitive writes
func registerHooks(client *ent.Client, log *zap.Logger) {
	// The credit ledger is append-only: reject any update or delete at the ORM
	// layer (belt-and-suspenders with the (request_id, reason) unique index).
	client.CreditLedger.Use(
		hook.Reject(ent.OpUpdate | ent.OpUpdateOne | ent.OpDelete | ent.OpDeleteOne),
	)

	// Audit sensitive writes. Logs metadata only — never token/secret values.
	client.CreditLedger.Use(auditHook(log, "credit_ledger"))
	client.OAuthConnection.Use(auditHook(log, "oauth_connection"))
	client.MCPConnection.Use(auditHook(log, "mcp_connection"))
	client.Subscription.Use(auditHook(log, "subscription"))
	client.BackgroundTask.Use(auditHook(log, "background_task"))
	client.BackgroundTaskArtifact.Use(auditHook(log, "background_task_artifact"))
	client.BackgroundTaskRun.Use(auditHook(log, "background_task_run"))
	client.BackgroundTaskRunEvent.Use(auditHook(log, "background_task_run_event"))
}

// auditHook logs one structured line per successful mutation. For the credit
// ledger it captures the non-sensitive accounting fields; for everything else
// it records the set of changed field names (never their values).
func auditHook(log *zap.Logger, entity string) ent.Hook {
	return func(next ent.Mutator) ent.Mutator {
		return ent.MutateFunc(func(ctx context.Context, m ent.Mutation) (ent.Value, error) {
			v, err := next.Mutate(ctx, m)
			if err != nil {
				return v, err
			}
			fields := []zap.Field{
				zap.String("entity", entity),
				zap.String("op", m.Op().String()),
			}
			if cl, ok := m.(*ent.CreditLedgerMutation); ok {
				if d, exists := cl.Delta(); exists {
					fields = append(fields, zap.Int("delta", d))
				}
				if r, exists := cl.Reason(); exists {
					fields = append(fields, zap.String("reason", r))
				}
				if rid, exists := cl.RequestID(); exists {
					fields = append(fields, zap.String("request_id", rid.String()))
				}
			} else {
				fields = append(fields, zap.Strings("changed", m.Fields()))
			}
			log.Info("audit.write", fields...)
			return v, err
		})
	}
}
