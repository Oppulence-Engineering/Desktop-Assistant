package revenue

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/commitment"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/commitmentevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
)

// The exportable record is a first-class product surface, not a reporting
// feature (one-pager §3). A record that cannot leave the tool cannot settle an
// argument, and settling arguments is what the ledger is for.
//
// Markdown, not PDF, on purpose: the record's job is to be forwarded in an
// email, and Markdown pastes. PDF can follow when a customer asks for it.

// ExportedEvidence is one cited source behind a commitment.
type ExportedEvidence struct {
	Source      string    `json:"source"`
	SourceURI   string    `json:"sourceUri,omitempty"`
	Excerpt     string    `json:"excerpt"`
	OccurredAt  time.Time `json:"occurredAt"`
	ContentHash string    `json:"contentHash"`
}

// ExportedTransition is one state change in the record's history.
type ExportedTransition struct {
	Version    int       `json:"version"`
	Kind       string    `json:"kind"`
	ActorType  string    `json:"actorType"`
	ActorRef   string    `json:"actorRef,omitempty"`
	OccurredAt time.Time `json:"occurredAt"`
}

// CommitmentRecord is one commitment, its full state history, and the verbatim
// evidence that created it.
type CommitmentRecord struct {
	ID           string               `json:"id"`
	GeneratedAt  time.Time            `json:"generatedAt"`
	Account      string               `json:"account"`
	Direction    string               `json:"direction"`
	Text         string               `json:"text"`
	State        string               `json:"state"`
	DueAt        *time.Time           `json:"dueAt,omitempty"`
	DuePhrase    string               `json:"duePhrase,omitempty"`
	Owner        string               `json:"owner,omitempty"`
	Counterparty string               `json:"counterparty,omitempty"`
	Confidence   float64              `json:"confidence"`
	Evidence     []ExportedEvidence   `json:"evidence"`
	History      []ExportedTransition `json:"history"`
}

// ExportCommitment assembles the record for one commitment in the caller's
// workspace.
func (s *Service) ExportCommitment(
	ctx context.Context,
	u *ent.User,
	commitmentID uuid.UUID,
) (*CommitmentRecord, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceView)
	if err != nil {
		return nil, err
	}
	row, err := s.client.Commitment.Query().Where(
		commitment.IDEQ(commitmentID),
		commitment.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
	).WithRelationship().WithEvidences().Only(ctx)
	if ent.IsNotFound(err) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	events, err := s.client.CommitmentEvent.Query().Where(
		commitmentevent.HasCommitmentWith(commitment.IDEQ(commitmentID)),
	).Order(ent.Asc(commitmentevent.FieldVersion)).All(ctx)
	if err != nil {
		return nil, err
	}
	record := &CommitmentRecord{
		ID:           row.ID.String(),
		GeneratedAt:  s.now().UTC(),
		Direction:    row.Direction,
		Text:         row.Text,
		State:        commitmentRegisterState(row, s.now().UTC()),
		DueAt:        row.DueAt,
		DuePhrase:    row.DuePhrase,
		Owner:        row.OwnerParticipantRef,
		Counterparty: row.CounterpartyParticipantRef,
		Confidence:   row.Confidence,
		Evidence:     []ExportedEvidence{},
		History:      []ExportedTransition{},
	}
	if rel, relErr := row.Edges.RelationshipOrErr(); relErr == nil && rel != nil {
		record.Account = rel.DisplayName
	}
	if evidences, evErr := row.Edges.EvidencesOrErr(); evErr == nil {
		for _, evidence := range evidences {
			record.Evidence = append(record.Evidence, ExportedEvidence{
				Source:      evidence.Source,
				SourceURI:   evidence.SourceURI,
				Excerpt:     evidence.Excerpt,
				OccurredAt:  evidence.OccurredAt,
				ContentHash: evidence.ContentHash,
			})
		}
	}
	for _, event := range events {
		record.History = append(record.History, ExportedTransition{
			Version:    event.Version,
			Kind:       event.Kind,
			ActorType:  event.ActorType,
			ActorRef:   event.ActorRef,
			OccurredAt: event.OccurredAt,
		})
	}
	return record, nil
}

// registerStateLabel renders a state the way a reader says it.
//
// This document is forwarded into a customer conversation to settle an
// argument about what was agreed. A raw "at_risk" in that table reads as a
// database dump and undermines the record it is meant to prove.
func registerStateLabel(state string) string {
	switch state {
	case RegisterAtRisk:
		return "At risk"
	case RegisterMet:
		return "Met"
	case RegisterMissed:
		return "Missed"
	case RegisterWaived:
		return "Waived"
	case RegisterDisputed:
		return "Disputed"
	case RegisterOpen:
		return "Open"
	default:
		return strings.ToUpper(state[:1]) + strings.ReplaceAll(state[1:], "_", " ")
	}
}

// Markdown renders the record as the document a user forwards.
//
// Every claim in the output carries its citation. If the record has no
// evidence, the document says so plainly rather than presenting an unsourced
// assertion as fact — one-pager §14: no commitment is asserted without a
// citation to its source evidence.
func (r *CommitmentRecord) Markdown() string {
	var b strings.Builder
	direction := "We promised"
	switch r.Direction {
	case "promised_by_them":
		direction = "They promised"
	case "mutual":
		direction = "Mutually agreed"
	}

	fmt.Fprintf(&b, "# Commitment record\n\n")
	fmt.Fprintf(&b, "**%s:** %s\n\n", direction, r.Text)

	fmt.Fprintf(&b, "| Field | Value |\n|---|---|\n")
	if r.Account != "" {
		fmt.Fprintf(&b, "| Account | %s |\n", r.Account)
	}
	fmt.Fprintf(&b, "| State | %s |\n", registerStateLabel(r.State))
	switch {
	case r.DueAt != nil:
		fmt.Fprintf(&b, "| Due | %s |\n", r.DueAt.UTC().Format("2006-01-02"))
	case r.DuePhrase != "":
		fmt.Fprintf(&b, "| Due | %s (as stated, not resolved to a date) |\n", r.DuePhrase)
	default:
		// One-pager §4: due dates are never guessed.
		fmt.Fprintf(&b, "| Due | unspecified |\n")
	}
	if r.Owner != "" {
		fmt.Fprintf(&b, "| Owner | %s |\n", r.Owner)
	}
	if r.Counterparty != "" {
		fmt.Fprintf(&b, "| Counterparty | %s |\n", r.Counterparty)
	}
	fmt.Fprintf(&b, "| Record generated | %s |\n\n", r.GeneratedAt.Format(time.RFC3339))

	b.WriteString("## Evidence\n\n")
	if len(r.Evidence) == 0 {
		b.WriteString("No source evidence is attached to this record.\n\n")
	}
	for _, evidence := range r.Evidence {
		fmt.Fprintf(&b, "> %s\n\n", strings.ReplaceAll(strings.TrimSpace(evidence.Excerpt), "\n", "\n> "))
		fmt.Fprintf(&b, "— %s, %s", evidence.Source, evidence.OccurredAt.UTC().Format(time.RFC3339))
		if evidence.SourceURI != "" {
			fmt.Fprintf(&b, " · %s", evidence.SourceURI)
		}
		fmt.Fprintf(&b, "\n\nContent hash `%s`\n\n", evidence.ContentHash)
	}

	b.WriteString("## History\n\n")
	if len(r.History) == 0 {
		b.WriteString("No recorded transitions.\n")
	}
	for _, transition := range r.History {
		fmt.Fprintf(&b, "%d. **%s** — %s",
			transition.Version, transition.Kind, transition.OccurredAt.UTC().Format(time.RFC3339))
		fmt.Fprintf(&b, " (%s", transition.ActorType)
		if transition.ActorRef != "" {
			fmt.Fprintf(&b, " %s", transition.ActorRef)
		}
		b.WriteString(")\n")
	}
	return b.String()
}
