package revenue

import (
	"context"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipidentitycandidate"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
)

// Durable identity anchors for relationships that predate the identity engine.
//
// resolveObservationRelationship resolves by anchor first and falls back to matching
// primary_email and account_domain columns directly. That fallback exists precisely
// because older relationships were created without anchors -- by the Gmail scanner,
// by Service.CreateRelationship, and by any ingest that ran before RFC 038.
//
// Those un-anchored rows are a latent problem, not a stable state. The moment a
// caller is rerouted through the identity engine, each one produces a fresh
// multi_match candidate on its first observation, and the review queue fills with
// work that is really just missing backfill. Running this once, deliberately, makes
// the collisions surface as a single reviewable batch instead of trickling in.
//
// Idempotent: a relationship whose anchors already exist binds to itself and the
// bind is a no-op.

// AnchorBackfillReport describes one pass.
type AnchorBackfillReport struct {
	RelationshipsScanned  int `json:"relationshipsScanned"`
	RelationshipsAnchored int `json:"relationshipsAnchored"`
	AnchorsCreated        int `json:"anchorsCreated"`
	// Collisions held for human review rather than merged. Expected to be non-zero
	// on the first run of a workspace that has been ingesting for a while.
	CandidatesRaised int `json:"candidatesRaised"`
}

// BackfillWorkspaceAnchors binds identity anchors for every relationship that lacks
// them. Run before rerouting any caller through resolveObservationRelationship.
func (s *Service) BackfillWorkspaceAnchors(
	ctx context.Context,
	u *ent.User,
	ws *ent.RevenueWorkspace,
) (AnchorBackfillReport, error) {
	report := AnchorBackfillReport{}

	relationships, err := s.client.Relationship.Query().
		Where(relationship.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID))).
		Order(ent.Asc(relationship.FieldCreatedAt)).
		All(ctx)
	if err != nil {
		return report, err
	}

	before, err := s.countWorkspaceCandidates(ctx, ws)
	if err != nil {
		return report, err
	}

	for _, rel := range relationships {
		report.RelationshipsScanned++

		signals := relationshipIdentitySignals(rel)
		if len(signals) == 0 {
			continue
		}
		existing, err := rel.QueryIdentities().Count(ctx)
		if err != nil {
			return report, err
		}

		// bindRelationshipIdentities is the same function the live path uses, so
		// the public-domain guard, the conflict-safe insert and the never-merge
		// posture all apply here without being restated.
		if err := bindRelationshipIdentities(
			ctx, s.client, ws, u, rel, signals, "backfill", rel.CreatedAt,
		); err != nil {
			return report, err
		}

		after, err := rel.QueryIdentities().Count(ctx)
		if err != nil {
			return report, err
		}
		if after > existing {
			report.RelationshipsAnchored++
			report.AnchorsCreated += after - existing
		}
	}

	total, err := s.countWorkspaceCandidates(ctx, ws)
	if err != nil {
		return report, err
	}
	report.CandidatesRaised = total - before
	return report, nil
}

func (s *Service) countWorkspaceCandidates(
	ctx context.Context,
	ws *ent.RevenueWorkspace,
) (int, error) {
	return s.client.RelationshipIdentityCandidate.Query().
		Where(relationshipidentitycandidate.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID))).
		Count(ctx)
}
