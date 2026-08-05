package revenue

import (
	"context"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/person"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/personinteractionstat"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/personmergecandidate"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/predicate"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipparticipant"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
)

func personInWorkspace(ws *ent.RevenueWorkspace) predicate.Person {
	return person.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID))
}

func personMergeCandidateInWorkspace(ws *ent.RevenueWorkspace) predicate.PersonMergeCandidate {
	return personmergecandidate.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID))
}

func personStatFor(p *ent.Person, rel *ent.Relationship) predicate.PersonInteractionStat {
	return personinteractionstat.And(
		personinteractionstat.HasPersonWith(person.IDEQ(p.ID)),
		personinteractionstat.HasRelationshipWith(relationship.IDEQ(rel.ID)),
	)
}

// PersonBackfillReport describes one backfill pass.
type PersonBackfillReport struct {
	ParticipantsScanned int `json:"participantsScanned"`
	ParticipantsLinked  int `json:"participantsLinked"`
	PersonsCreated      int `json:"personsCreated"`
	// Rows sharing (relationship_id, email). The unique index in
	// 20260804122000_participant_person_unique.sql must not be applied until this
	// reaches zero.
	DuplicateParticipants int `json:"duplicateParticipants"`
	MergeCandidates       int `json:"mergeCandidates"`
}

// BackfillWorkspacePersons links existing participants to canonical persons.
//
// Idempotent: already-linked rows are skipped, and resolvePerson dedupes on the same
// anchors the live ingest path uses, so a second pass is a no-op. Anchor collisions
// surface as review candidates exactly as they would at ingest — expect a review
// queue on the first run of a workspace that has been ingesting for a while.
//
// Seeded attributes are marked "deterministic" with modest confidence: they are the
// best reading of data already on the row, not a fresh observation, and a later
// signature or CRM fact should be able to outrank them.
func (s *Service) BackfillWorkspacePersons(
	ctx context.Context,
	u *ent.User,
	ws *ent.RevenueWorkspace,
) (PersonBackfillReport, error) {
	report := PersonBackfillReport{}

	participants, err := s.client.RelationshipParticipant.Query().
		Where(relationshipparticipant.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID))).
		WithRelationship().
		Order(
			ent.Asc(relationshipparticipant.FieldCreatedAt),
			ent.Asc(relationshipparticipant.FieldID),
		).
		All(ctx)
	if err != nil {
		return report, err
	}

	// Count duplicates before touching anything: this is the gate on the unique index.
	seen := map[string]int{}
	for _, participant := range participants {
		email := normalizeEmail(participant.Email)
		if email == "" {
			continue
		}
		rel, relErr := participant.Edges.RelationshipOrErr()
		if relErr != nil {
			continue
		}
		key := rel.ID.String() + "\x00" + email
		seen[key]++
		if seen[key] > 1 {
			report.DuplicateParticipants++
		}
	}

	for _, participant := range participants {
		report.ParticipantsScanned++

		linked, err := participant.QueryPerson().Exist(ctx)
		if err != nil {
			return report, err
		}
		if linked {
			continue
		}
		rel, relErr := participant.Edges.RelationshipOrErr()
		if relErr != nil {
			return report, relErr
		}

		observedAt := participant.CreatedAt
		if observedAt.IsZero() {
			observedAt = time.Now().UTC()
		}

		before, err := s.client.Person.Query().
			Where(personInWorkspace(ws)).
			Count(ctx)
		if err != nil {
			return report, err
		}

		p, err := resolvePerson(ctx, s.client, ws, u, PersonResolutionInput{
			DisplayName:  participant.DisplayName,
			Email:        participant.Email,
			ExternalRefs: participant.ExternalRefs,
			Source:       "crm",
			ObservedAt:   observedAt,
		})
		if err != nil {
			return report, err
		}
		if p == nil {
			continue
		}

		after, err := s.client.Person.Query().
			Where(personInWorkspace(ws)).
			Count(ctx)
		if err != nil {
			return report, err
		}
		if after > before {
			report.PersonsCreated++
		}

		if _, err := participant.Update().SetPersonID(p.ID).Save(ctx); err != nil {
			return report, err
		}
		report.ParticipantsLinked++

		attributes := make([]PersonAttributeInput, 0, 3)
		if name := strings.TrimSpace(participant.DisplayName); name != "" {
			attributes = append(attributes, PersonAttributeInput{
				Dimension: "display_name", Value: name,
				SourceType: "deterministic", Source: "crm", Extractor: "unknown",
				Confidence: 0.4,
				Reason:     "Seeded from an existing participant record during backfill.",
				ObservedAt: observedAt, ExternalID: "backfill:" + participant.ID.String(),
			})
		}
		if title := strings.TrimSpace(participant.Title); title != "" {
			attributes = append(attributes, PersonAttributeInput{
				Dimension: "title", Value: title,
				SourceType: "deterministic", Source: "crm", Extractor: "unknown",
				Confidence: 0.4,
				Reason:     "Seeded from an existing participant record during backfill.",
				ObservedAt: observedAt, ExternalID: "backfill:" + participant.ID.String(),
			})
		}
		if domain := accountDomain(participant.Email); domain != "" {
			attributes = append(attributes, PersonAttributeInput{
				Dimension: "org_domain", Value: domain,
				SourceType: "deterministic", Source: "crm", Extractor: "email_header",
				Confidence: 0.4,
				Reason:     "Derived from the participant's email domain during backfill.",
				ObservedAt: observedAt, ExternalID: "backfill:" + participant.ID.String(),
			})
		}
		if err := upsertPersonAttributes(ctx, s.client, ws, u, p, nil, attributes); err != nil {
			return report, err
		}
		if _, err := projectPersonAttributes(ctx, s.client, p, observedAt); err != nil {
			return report, err
		}
		if err := seedPersonInteractionFromObservations(ctx, s.client, ws, u, p, rel); err != nil {
			return report, err
		}
	}

	candidates, err := s.client.PersonMergeCandidate.Query().
		Where(personMergeCandidateInWorkspace(ws)).
		Count(ctx)
	if err != nil {
		return report, err
	}
	report.MergeCandidates = candidates
	return report, nil
}

// seedPersonInteractionFromObservations derives a starting rollup from the
// observation history that already exists for the account.
//
// Direction is left unknown on purpose: historical observations do not record it,
// and a guessed inbound/outbound split would corrupt every reciprocity signal built
// on top of it. Only the total, the first and the last are seeded.
func seedPersonInteractionFromObservations(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	u *ent.User,
	p *ent.Person,
	rel *ent.Relationship,
) error {
	observations, err := rel.QueryObservations().All(ctx)
	if err != nil {
		return err
	}
	if len(observations) == 0 {
		return nil
	}
	first, last := observations[0].OccurredAt, observations[0].OccurredAt
	counts := map[string]int{}
	for _, observation := range observations {
		if observation.OccurredAt.Before(first) {
			first = observation.OccurredAt
		}
		if observation.OccurredAt.After(last) {
			last = observation.OccurredAt
		}
		counts[channelForSource(observation.Source)]++
	}

	existing, err := client.PersonInteractionStat.Query().
		Where(personStatFor(p, rel)).
		Exist(ctx)
	if err != nil {
		return err
	}
	if existing {
		return nil
	}
	total := 0
	for _, count := range counts {
		total += count
	}
	_, err = client.PersonInteractionStat.Create().
		SetWorkspace(ws).
		SetPerson(p).
		SetRelationship(rel).
		SetFirstInteractionAt(first.UTC()).
		SetLastInteractionAt(last.UTC()).
		SetInteractionCount(total).
		SetChannelCounts(counts).
		SetSourceCounts(map[string]int{"backfill": total}).
		Save(ctx)
	_ = u
	if err != nil {
		return err
	}
	return refreshPersonInteractionRollup(ctx, client, p)
}
