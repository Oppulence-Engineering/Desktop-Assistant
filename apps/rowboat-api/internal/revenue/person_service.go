package revenue

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"entgo.io/ent/dialect/sql"
	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/person"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/personattribute"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/personinteractionstat"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/personmergecandidate"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
)

// PersonFilter narrows a person listing.
type PersonFilter struct {
	Query  string
	Status string
	Limit  int
}

const defaultPersonLimit = 100

// ListPersons returns the workspace's canonical people, most recently active first.
func (s *Service) ListPersons(
	ctx context.Context, u *ent.User, filter PersonFilter,
) ([]*ent.Person, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceView)
	if err != nil {
		return nil, err
	}
	limit := filter.Limit
	if limit <= 0 || limit > 500 {
		limit = defaultPersonLimit
	}
	q := s.client.Person.Query().
		Where(person.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)))

	status := strings.TrimSpace(filter.Status)
	if status == "" {
		// A merged person is a tombstone. It stays addressable by id so an old
		// link still resolves, but it never appears in a list.
		status = "active"
	}
	if status != "all" {
		q = q.Where(person.StatusEQ(status))
	}
	if term := strings.TrimSpace(strings.ToLower(filter.Query)); term != "" {
		q = q.Where(person.Or(
			person.DisplayNameContainsFold(term),
			person.PrimaryEmailContainsFold(term),
			person.OrgNameContainsFold(term),
			person.OrgDomainContainsFold(term),
		))
	}
	return q.
		Order(
			person.ByLastInteractionAt(sql.OrderDesc(), sql.OrderNullsLast()),
			person.ByDisplayName(),
		).
		Limit(limit).
		All(ctx)
}

// GetPerson returns one canonical person, following a merge tombstone so an old
// link keeps resolving to the surviving record.
func (s *Service) GetPerson(ctx context.Context, u *ent.User, id uuid.UUID) (*ent.Person, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceView)
	if err != nil {
		return nil, err
	}
	p, err := s.client.Person.Query().
		Where(
			person.IDEQ(id),
			person.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
		).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, fmt.Errorf("%w: person", ErrNotFound)
	}
	if err != nil {
		return nil, err
	}
	return followMergedPerson(ctx, s.client, p)
}

// PersonAttributes returns the full provenance ledger for a person, newest first.
// This is the answer to "why does it say that?" and includes retracted and
// superseded rows deliberately — an audit trail with the losers removed is not one.
func (s *Service) PersonAttributes(
	ctx context.Context, u *ent.User, id uuid.UUID,
) ([]*ent.PersonAttribute, error) {
	p, err := s.GetPerson(ctx, u, id)
	if err != nil {
		return nil, err
	}
	attributes, err := s.client.PersonAttribute.Query().
		Where(personattribute.HasPersonWith(person.IDEQ(p.ID))).
		Order(
			ent.Desc(personattribute.FieldValidFrom),
			ent.Asc(personattribute.FieldDimension),
		).
		All(ctx)
	if err != nil {
		return nil, err
	}
	return dedupePersonAttributes(attributes), nil
}

// dedupePersonAttributes collapses exact facts written by both the historical
// Gmail scan path and the observation path. Distinct claims remain in the ledger.
func dedupePersonAttributes(attributes []*ent.PersonAttribute) []*ent.PersonAttribute {
	seen := make(map[string]int, len(attributes))
	out := make([]*ent.PersonAttribute, 0, len(attributes))
	for _, attribute := range attributes {
		key := strings.Join([]string{
			attribute.Dimension, attribute.Value, attribute.SourceType, attribute.Source,
			attribute.Extractor, attribute.Status, strconv.FormatFloat(attribute.Confidence, 'g', -1, 64),
			attribute.Reason, attribute.ObservedAt.UTC().Format(time.RFC3339Nano),
			attribute.ValidFrom.UTC().Format(time.RFC3339Nano), optionalTime(attribute.ValidTo),
			optionalTime(attribute.RetractedAt), attribute.SupersedesAttributeID,
			attribute.ExtractorVersion, attribute.CitationsJSON,
		}, "\x00")
		if i, ok := seen[key]; ok {
			if len(out[i].SupportingObservationIds) == 0 && len(attribute.SupportingObservationIds) > 0 {
				out[i] = attribute
			}
			continue
		}
		seen[key] = len(out)
		out = append(out, attribute)
	}
	return out
}

func optionalTime(value *time.Time) string {
	if value == nil {
		return ""
	}
	return value.UTC().Format(time.RFC3339Nano)
}

// PersonInteractions returns the per-account interaction rollups for a person.
func (s *Service) PersonInteractions(
	ctx context.Context, u *ent.User, id uuid.UUID,
) ([]*ent.PersonInteractionStat, error) {
	p, err := s.GetPerson(ctx, u, id)
	if err != nil {
		return nil, err
	}
	return s.client.PersonInteractionStat.Query().
		Where(personinteractionstat.HasPersonWith(person.IDEQ(p.ID))).
		WithRelationship().
		Order(ent.Desc(personinteractionstat.FieldLastInteractionAt)).
		All(ctx)
}

// PersonCorrectionInput is a human overriding a derived value.
type PersonCorrectionInput struct {
	Dimension      string `json:"dimension"`
	Value          string `json:"value"`
	Reason         string `json:"reason"`
	IdempotencyKey string `json:"-"`
}

// CorrectPerson records a user correction and reprojects.
//
// A correction is an assertion like any other, not a direct write: it enters the
// same ledger at the top of the precedence order, so the previous value stays
// visible and the change stays explicable.
func (s *Service) CorrectPerson(
	ctx context.Context, u *ent.User, id uuid.UUID, input PersonCorrectionInput,
) (*ent.Person, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceContribute)
	if err != nil {
		return nil, err
	}
	p, err := s.GetPerson(ctx, u, id)
	if err != nil {
		return nil, err
	}
	dimension := strings.TrimSpace(input.Dimension)
	value := strings.TrimSpace(input.Value)
	if dimension == "" || value == "" {
		return nil, fmt.Errorf("%w: dimension and value are required", ErrInvalidInput)
	}
	now := s.now()
	externalID := strings.TrimSpace(input.IdempotencyKey)
	if externalID == "" {
		externalID = "correction:" + now.UTC().Format(time.RFC3339Nano)
	}
	if err := upsertPersonAttributes(ctx, s.client, ws, u, p, nil, []PersonAttributeInput{{
		Dimension:  dimension,
		Value:      value,
		SourceType: "user_correction",
		Source:     "user",
		Extractor:  "user_entry",
		Confidence: 1,
		Reason:     input.Reason,
		ObservedAt: now,
		ExternalID: externalID,
	}}); err != nil {
		return nil, err
	}
	return projectPersonAttributes(ctx, s.client, p, now)
}

// RetractPersonAttribute withdraws one claim and reprojects without it.
// The row is marked retracted rather than deleted, so the ledger stays complete.
func (s *Service) RetractPersonAttribute(
	ctx context.Context, u *ent.User, personID, attributeID uuid.UUID, reason string,
) (*ent.Person, error) {
	if _, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceContribute); err != nil {
		return nil, err
	}
	p, err := s.GetPerson(ctx, u, personID)
	if err != nil {
		return nil, err
	}
	attribute, err := s.client.PersonAttribute.Query().
		Where(
			personattribute.IDEQ(attributeID),
			personattribute.HasPersonWith(person.IDEQ(p.ID)),
		).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, fmt.Errorf("%w: person attribute", ErrNotFound)
	}
	if err != nil {
		return nil, err
	}
	if attribute.Status == "retracted" {
		return p, nil
	}
	now := s.now()
	update := attribute.Update().SetStatus("retracted").SetRetractedAt(now.UTC())
	if strings.TrimSpace(reason) != "" {
		update.SetReason(reason)
	}
	if _, err := update.Save(ctx); err != nil {
		return nil, err
	}
	return projectPersonAttributes(ctx, s.client, p, now)
}

// ListPersonMergeCandidates returns people an anchor says might be the same human.
func (s *Service) ListPersonMergeCandidates(
	ctx context.Context, u *ent.User, status string,
) ([]*ent.PersonMergeCandidate, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceView)
	if err != nil {
		return nil, err
	}
	q := s.client.PersonMergeCandidate.Query().
		Where(personmergecandidate.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID))).
		WithProposedPerson().
		WithExistingPerson()
	if status = strings.TrimSpace(status); status != "" && status != "all" {
		q = q.Where(personmergecandidate.StatusEQ(status))
	}
	return q.Order(ent.Desc(personmergecandidate.FieldCreatedAt)).All(ctx)
}
