package revenue

import (
	"context"
	"strings"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipparticipant"
)

// linkParticipantPerson connects one participant row to its canonical person and
// records what the observation says about that person. It returns the resolved
// person, or nil when the input identifies nobody.
//
// It deliberately does NOT count an interaction. Attribute writes are idempotent --
// they dedupe on a content key -- but a counter is not, and the two callers have
// different notions of "new". Observation ingest dedupes upstream and reaches this
// once per observation; the Gmail scanner re-materializes the same thread on every
// periodic run. Bundling the bump in here made a rerun inflate the count, so
// interaction totals measured how often the scanner ran rather than how often the
// user actually talked to someone. Callers bump explicitly when they know the
// evidence is new.
//
// Everything here is derived from data the workspace already holds — a display name
// and a title that arrived on the observation — so it adds no new egress and no new
// consent surface. Enrichment values become PersonAttribute assertions rather than
// direct writes, so every projected value keeps a source, a confidence and a time.
func linkParticipantPerson(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	u *ent.User,
	rel *ent.Relationship,
	observation *ent.RelationshipObservation,
	input RelationshipObservationInput,
	participant RelationshipParticipantInput,
) (*ent.Person, error) {
	p, err := resolvePerson(ctx, client, ws, u, PersonResolutionInput{
		DisplayName:  participant.DisplayName,
		Email:        participant.Email,
		ExternalRefs: participant.ExternalRefs,
		Source:       input.Source,
		ObservedAt:   input.OccurredAt,
	})
	if err != nil {
		return nil, err
	}
	// A provider alias with no name and no address identifies nobody.
	if p == nil {
		return nil, nil
	}

	if err := attachPersonToParticipant(ctx, client, rel, participant, p); err != nil {
		return nil, err
	}

	attributes := make([]PersonAttributeInput, 0, 3)
	if name := strings.TrimSpace(participant.DisplayName); name != "" {
		attributes = append(attributes, PersonAttributeInput{
			Dimension: "display_name", Value: name,
			SourceType: "source_fact", Source: input.Source,
			Extractor: "display_name_header", Confidence: 0.8,
			Reason:     "Name as it appeared on the source record.",
			ObservedAt: input.OccurredAt, ExternalID: input.ExternalID,
		})
		attributes = append(attributes, PersonAttributeInput{
			Dimension: "alias", Value: name,
			SourceType: "deterministic", Source: input.Source,
			Extractor: "display_name_header", Confidence: 0.5,
			Reason:     "Every name we have seen for this person.",
			ObservedAt: input.OccurredAt, ExternalID: input.ExternalID,
		})
	}
	if title := strings.TrimSpace(participant.Title); title != "" {
		attributes = append(attributes, PersonAttributeInput{
			Dimension: "title", Value: title,
			SourceType: "source_fact", Source: input.Source,
			Extractor: "crm_field", Confidence: 0.7,
			Reason:     "Title supplied by the source record.",
			ObservedAt: input.OccurredAt, ExternalID: input.ExternalID,
		})
	}
	// The organization the account itself represents is a claim about the person
	// only when it is a real org domain, which accountDomain already enforces.
	if domain := accountDomain(participant.Email); domain != "" {
		attributes = append(attributes, PersonAttributeInput{
			Dimension: "org_domain", Value: domain,
			SourceType: "deterministic", Source: input.Source,
			Extractor: "email_header", Confidence: 0.6,
			Reason:     "Derived from the participant's email domain.",
			ObservedAt: input.OccurredAt, ExternalID: input.ExternalID,
		})
	}

	// A departure observation is the mail system telling us this person no longer
	// works where we last saw them — a hard bounce naming their address, or an
	// autoreply that says so in words. It rides the ordinary participant path so it
	// competes on the same ladder as everything else: a user_correction saying
	// "no, they are still there" beats it without any special case.
	//
	// The claim is deliberately narrow. `source_fact` because the mail server's own
	// 5.1.1 is a fact about the mailbox, not an inference about the person, and the
	// confidence gap between the two kinds reflects which of those we actually have:
	// words that name a departure are stronger than an address that stopped
	// accepting mail, because a mistyped address bounces identically to a departed one.
	if input.EventType == "contact_departed" {
		confidence := 0.7
		reason := "Their mail server rejected delivery as an unknown recipient."
		if kind, _ := input.Facts["departure_kind"].(string); kind == "left_organization" {
			confidence = 0.9
			reason = "A reply from this address said the person has left."
		}
		attributes = append(attributes, PersonAttributeInput{
			Dimension: "employment_status", Value: "departed",
			SourceType: "source_fact", Source: input.Source,
			Extractor: "mail_delivery_report", Confidence: confidence,
			Reason:     reason,
			ObservedAt: input.OccurredAt, ExternalID: input.ExternalID,
		})
	}

	if err := upsertPersonAttributes(ctx, client, ws, u, p, observation, attributes); err != nil {
		return nil, err
	}
	if _, err := projectPersonAttributes(ctx, client, p, input.OccurredAt); err != nil {
		return nil, err
	}
	return p, nil
}

// countParticipantInteraction records one interaction for an already-linked person.
// Separate from linking because it is the only non-idempotent step: call it exactly
// once per genuinely new piece of evidence.
func countParticipantInteraction(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	u *ent.User,
	rel *ent.Relationship,
	p *ent.Person,
	input RelationshipObservationInput,
	participant RelationshipParticipantInput,
) error {
	if p == nil {
		return nil
	}
	direction := participant.Direction
	if direction == "" {
		direction = input.Direction
	}
	return bumpPersonInteraction(
		ctx, client, ws, u, p, rel,
		input.Channel, direction, input.Source, input.OccurredAt,
	)
}

// attachPersonToParticipant sets person_id on the participant row this input
// resolved to, matching the same way upsertRelationshipParticipant did.
func attachPersonToParticipant(
	ctx context.Context,
	client *ent.Client,
	rel *ent.Relationship,
	participant RelationshipParticipantInput,
	p *ent.Person,
) error {
	email := normalizeEmail(participant.Email)
	query := client.RelationshipParticipant.Query().
		Where(relationshipparticipant.HasRelationshipWith(relationship.IDEQ(rel.ID)))
	if email != "" {
		// Several rows may share an address -- the duplicate-participant case --
		// and they are all the same human, so all of them link.
		query = query.Where(relationshipparticipant.EmailEQ(email))
	} else {
		// No address to match on, so fall back to the name -- but only against rows
		// that are equally addressless. Matching a named row that *does* carry an
		// address would let two different people who share a display name collapse
		// onto one person, which is exactly what the anchor design refuses to do.
		query = query.Where(
			relationshipparticipant.DisplayNameEQ(strings.TrimSpace(participant.DisplayName)),
			relationshipparticipant.Or(
				relationshipparticipant.EmailEQ(""),
				relationshipparticipant.EmailIsNil(),
			),
		)
	}
	// Only unlinked rows. Re-pointing an existing link is a merge, and merges are a
	// reviewed operation, never a side effect of ingest.
	rows, err := query.
		Where(relationshipparticipant.Not(relationshipparticipant.HasPerson())).
		Order(
			ent.Asc(relationshipparticipant.FieldCreatedAt),
			ent.Asc(relationshipparticipant.FieldID),
		).
		All(ctx)
	if err != nil {
		return err
	}
	for _, row := range rows {
		if _, err := row.Update().SetPersonID(p.ID).Save(ctx); err != nil {
			return err
		}
	}
	return nil
}
