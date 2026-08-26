package revenue

import (
	"context"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
)

// IngestRelationshipObservations preserves the package's trusted test fixture
// API without exposing the authority-bearing ingestion path in production.
func (s *Service) IngestRelationshipObservations(
	ctx context.Context,
	u *ent.User,
	inputs []RelationshipObservationInput,
) ([]RelationshipObservationResult, error) {
	return s.ingestTrustedRelationshipObservations(ctx, u, inputs)
}
