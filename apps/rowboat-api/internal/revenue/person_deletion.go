package revenue

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/person"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/personattribute"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/personidentity"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/personinteractionstat"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/personmergecandidate"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/personsuppression"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipparticipant"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
)

// Deleting a person, and making it stay deleted.
//
// Person data was unreachable by every deletion path in the product.
// conversation_deletion.go removes assertions, observations, evidence, actions and
// commitments for a relationship, and does not mention Person at all — so
// display_name, title, phone, org and the normalized email address all survived a
// deletion the user was told had completed.
//
// Removing the rows is only half of it. Every sync re-derives people from message
// headers and calendar invites, so resolvePerson recreates whoever was removed on
// the next pass. Without a tombstone, "delete" means "until tomorrow", which for a
// counterparty who asked to be forgotten is worse than offering nothing.

// PersonDeletionReceipt records what was removed, so a deletion can be evidenced
// rather than asserted. Mirrors ConversationDeletionReceipt's posture.
type PersonDeletionReceipt struct {
	ReceiptID    string `json:"receiptId"`
	PersonID     string `json:"personId"`
	RequestedAt  string `json:"requestedAt"`
	CompletedAt  string `json:"completedAt"`
	Reason       string `json:"reason"`
	Suppressed   int    `json:"suppressedIdentities"`
	Attributes   int    `json:"attributesDeleted"`
	Identities   int    `json:"identitiesDeleted"`
	Interactions int    `json:"interactionStatsDeleted"`
	Candidates   int    `json:"mergeCandidatesDeleted"`
}

// DeletePerson removes a canonical person and every row derived from them, and
// writes suppression anchors so ingest cannot recreate them.
//
// `reason` is "subject_request" when the person themselves asked to be removed and
// "user_action" when the account holder is tidying their own graph. The distinction
// is recorded because only one of them is a promise to a third party.
//
// Ordering matters: identities are read before anything is deleted, because they
// are what the suppression anchors are derived from. Delete them first and there is
// nothing left to suppress, which is precisely how a delete quietly becomes
// temporary.
func (s *Service) DeletePerson(
	ctx context.Context,
	u *ent.User,
	workspaceID uuid.UUID,
	personID uuid.UUID,
	reason string,
	note string,
) (PersonDeletionReceipt, error) {
	if reason != "subject_request" {
		reason = "user_action"
	}
	requestedAt := time.Now().UTC()

	receipt := PersonDeletionReceipt{
		ReceiptID:   uuid.NewString(),
		PersonID:    personID.String(),
		RequestedAt: requestedAt.Format(time.RFC3339),
		Reason:      reason,
	}

	tx, err := s.client.Tx(ctx)
	if err != nil {
		return PersonDeletionReceipt{}, err
	}
	defer func() { _ = tx.Rollback() }()
	txc := tx.Client()

	ws, err := txc.RevenueWorkspace.Get(ctx, workspaceID)
	if err != nil {
		return PersonDeletionReceipt{}, err
	}
	txu, err := txc.User.Get(ctx, u.ID)
	if err != nil {
		return PersonDeletionReceipt{}, err
	}
	target, err := txc.Person.Query().
		Where(person.IDEQ(personID), person.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID))).
		Only(ctx)
	if err != nil {
		return PersonDeletionReceipt{}, err
	}

	// Read the anchors before deleting anything — they are the only record of
	// which identities must stay suppressed.
	identities, err := txc.PersonIdentity.Query().
		Where(personidentity.HasPersonWith(person.IDEQ(target.ID))).All(ctx)
	if err != nil {
		return PersonDeletionReceipt{}, err
	}

	for _, identity := range identities {
		// A re-deletion of the same address must not fail on the unique index.
		exists, existErr := txc.PersonSuppression.Query().
			Where(
				personsuppression.KeyHashEQ(identity.KeyHash),
				personsuppression.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
			).Exist(ctx)
		if existErr != nil {
			return PersonDeletionReceipt{}, existErr
		}
		if exists {
			continue
		}
		if _, createErr := txc.PersonSuppression.Create().
			SetKeyHash(identity.KeyHash).
			SetKind(identity.Kind).
			SetReason(reason).
			SetSuppressedAt(requestedAt).
			SetNote(note).
			SetWorkspace(ws).
			SetUser(txu).
			Save(ctx); createErr != nil {
			return PersonDeletionReceipt{}, createErr
		}
		receipt.Suppressed++
	}

	// Derived rows first: every person FK is ON DELETE NO ACTION, so the person
	// row cannot be removed while anything still references it.
	if receipt.Attributes, err = txc.PersonAttribute.Delete().
		Where(personattribute.HasPersonWith(person.IDEQ(target.ID))).Exec(ctx); err != nil {
		return PersonDeletionReceipt{}, err
	}
	if receipt.Interactions, err = txc.PersonInteractionStat.Delete().
		Where(personinteractionstat.HasPersonWith(person.IDEQ(target.ID))).Exec(ctx); err != nil {
		return PersonDeletionReceipt{}, err
	}
	// A merge candidate references the person from either side.
	if receipt.Candidates, err = txc.PersonMergeCandidate.Delete().
		Where(personmergecandidate.Or(
			personmergecandidate.HasProposedPersonWith(person.IDEQ(target.ID)),
			personmergecandidate.HasExistingPersonWith(person.IDEQ(target.ID)),
		)).Exec(ctx); err != nil {
		return PersonDeletionReceipt{}, err
	}
	if receipt.Identities, err = txc.PersonIdentity.Delete().
		Where(personidentity.HasPersonWith(person.IDEQ(target.ID))).Exec(ctx); err != nil {
		return PersonDeletionReceipt{}, err
	}
	// Participants keep their row — a participant is a statement about a
	// relationship, not about the person — but must stop pointing at a person who
	// no longer exists.
	if _, err = txc.RelationshipParticipant.Update().
		Where(relationshipparticipant.HasPersonWith(person.IDEQ(target.ID))).
		ClearPerson().Save(ctx); err != nil {
		return PersonDeletionReceipt{}, err
	}
	if err = txc.Person.DeleteOne(target).Exec(ctx); err != nil {
		return PersonDeletionReceipt{}, err
	}
	if err = tx.Commit(); err != nil {
		return PersonDeletionReceipt{}, err
	}

	receipt.CompletedAt = time.Now().UTC().Format(time.RFC3339)
	return receipt, nil
}

// personIdentitySuppressed reports whether any of the resolution signals for an
// incoming person has been suppressed in this workspace.
func personIdentitySuppressed(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	signals []relationshipIdentitySignal,
) (bool, error) {
	if len(signals) == 0 {
		return false, nil
	}
	hashes := make([]string, 0, len(signals))
	for _, signal := range signals {
		hashes = append(hashes, signal.KeyHash)
	}
	return client.PersonSuppression.Query().
		Where(
			personsuppression.KeyHashIn(hashes...),
			personsuppression.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
		).Exist(ctx)
}
