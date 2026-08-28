package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// OAuthPending is an ephemeral, TTL'd row used by handoff flows: the webapp
// parks an encrypted payload keyed by a state ticket; the desktop redeems it.
// Reading consumes the row.
type OAuthPending struct{ ent.Schema }

// Mixin of the OAuthPending.
func (OAuthPending) Mixin() []ent.Mixin { return []ent.Mixin{mixin.BaseMixin{}} }

// Fields of the OAuthPending.
func (OAuthPending) Fields() []ent.Field {
	return []ent.Field{
		// Steady-state writers store only a non-secret sha256:<hex> sentinel here.
		// The raw browser/desktop bearer is never persisted after the contract phase.
		field.String("state").Unique().NotEmpty(),
		// Optional in the Ent model so the expand-phase compatibility binary can
		// consume rows minted before backfill. The PostgreSQL contract migration
		// makes this globally NOT NULL after the maximum pending TTL plus skew.
		field.String("state_hash").Optional().Unique(),
		field.String("provider"),                     // google | canvas | corinthian | wispr
		field.Bytes("payload_encrypted").Sensitive(), // AES-GCM-sealed JSON
		field.Time("expires_at"),                     // 10 min TTL
		field.String("lifecycle_status").Optional(),
		field.String("owner_workos_user_id").Optional(),
		field.String("owner_org_id").Optional(),
		field.Strings("requested_scopes").Optional(),
		field.String("redirect_target").Optional(),
		field.String("consent_challenge").Optional(),
		field.String("context_request_id").Optional(),
		field.String("hydra_client_id").Optional(),
		field.Time("callback_at").Optional(),
		field.UUID("callback_claim_id", uuid.UUID{}).Optional(),
		field.Time("callback_claimed_until").Optional(),
		field.Int("callback_attempts").Default(0).NonNegative(),
		field.Time("claimed_at").Optional(),
		field.String("failure_reason").Optional(),
	}
}

// Indexes of the OAuthPending.
func (OAuthPending) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("expires_at"), // sweep expired rows
		index.Fields("provider", "lifecycle_status"),
		index.Fields("owner_workos_user_id"),
		index.Fields("context_request_id"),
		index.Fields("consent_challenge"),
		index.Fields("callback_claimed_until"),
	}
}
