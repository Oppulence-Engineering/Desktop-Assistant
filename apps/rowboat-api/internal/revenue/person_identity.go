package revenue

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
	"time"

	entsql "entgo.io/ent/dialect/sql"
	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/personidentity"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/personmergecandidate"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
)

// Canonical person resolution.
//
// This mirrors resolveObservationRelationship's contract exactly, because the
// safety property is the same one: 0 matches creates, 1 match binds and enriches,
// and more than one match NEVER picks a winner. A multi-match creates an isolated
// person plus one reviewable candidate per colliding owner.
//
// The hash grammar is deliberately shared with the relationship namespace —
// sha256(kind + "\x00" + value) via newRelationshipIdentitySignal — so one address
// produces one traceable key_hash no matter which namespace stored it. Only the
// table and its unique index differ.

/** How deep to follow merge tombstones before giving up. */
const personMergeFollowDepth = 8

// PersonResolutionInput is what a single participant contributes to identity.
type PersonResolutionInput struct {
	DisplayName  string
	Email        string
	ExternalRefs []string
	Source       string
	ObservedAt   time.Time
}

// personIdentitySignals extracts person-scope anchors.
//
// A domain is never a person anchor: it is shared by every coworker, and binding it
// would collapse an entire company into one human. bindRelationshipIdentities applies
// that same reasoning conditionally, by relationship kind; here it is unconditional,
// which is why PersonIdentity has no "domain" kind at all.
//
// isPublicMailboxDomain is deliberately NOT consulted to reject an email anchor:
// jane@gmail.com identifies exactly one person and is a perfectly good anchor. It is
// only used to refuse org_domain *enrichment*, in the projector.
func personIdentitySignals(in PersonResolutionInput) []relationshipIdentitySignal {
	out := make([]relationshipIdentitySignal, 0, len(in.ExternalRefs)+1)
	if email := normalizeEmail(in.Email); email != "" && !isNoReply(email) {
		out = append(out, newRelationshipIdentitySignal("email", "", email, 1))
	}
	for _, ref := range in.ExternalRefs {
		ref = strings.TrimSpace(ref)
		if ref == "" {
			continue
		}
		provider := ref
		if idx := strings.Index(ref, ":"); idx > 0 {
			provider = ref[:idx]
		}
		out = append(out, newRelationshipIdentitySignal("resource_ref", provider, ref, 1))
	}
	return dedupeRelationshipIdentitySignals(out)
}

// followMergedPerson resolves a tombstone to the surviving person.
func followMergedPerson(ctx context.Context, client *ent.Client, p *ent.Person) (*ent.Person, error) {
	for depth := 0; p.Status == "merged" && p.MergedIntoPersonID != nil; depth++ {
		if depth >= personMergeFollowDepth {
			return nil, fmt.Errorf("%w: person merge chain is cyclic or too deep", ErrConflict)
		}
		next, err := client.Person.Get(ctx, *p.MergedIntoPersonID)
		if err != nil {
			return nil, err
		}
		p = next
	}
	return p, nil
}

// resolvePerson finds or creates the canonical person for one participant.
//
// Returns nil (with no error) when the input carries nothing that could identify a
// human — a provider alias with no name and no address is not enough evidence to
// invent a person, exactly as it is not enough to invent a participant.
func resolvePerson(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	u *ent.User,
	in PersonResolutionInput,
) (*ent.Person, error) {
	displayName := strings.TrimSpace(in.DisplayName)
	email := normalizeEmail(in.Email)
	if displayName == "" && email == "" {
		return nil, nil
	}
	// A no-reply address is a system, not a person.
	if email != "" && isNoReply(email) {
		return nil, nil
	}

	signals := personIdentitySignals(in)
	observedAt := in.ObservedAt
	if observedAt.IsZero() {
		observedAt = time.Now().UTC()
	}

	matches := map[uuid.UUID]*ent.Person{}
	if len(signals) > 0 {
		hashes := make([]string, 0, len(signals))
		for _, signal := range signals {
			hashes = append(hashes, signal.KeyHash)
		}
		identities, err := client.PersonIdentity.Query().
			Where(
				personidentity.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
				personidentity.KeyHashIn(hashes...),
			).
			WithPerson().
			All(ctx)
		if err != nil {
			return nil, err
		}
		for _, identity := range identities {
			owner, edgeErr := identity.Edges.PersonOrErr()
			if edgeErr != nil {
				return nil, edgeErr
			}
			// A tombstoned person is never a resolution target.
			survivor, followErr := followMergedPerson(ctx, client, owner)
			if followErr != nil {
				return nil, followErr
			}
			matches[survivor.ID] = survivor
		}
	}

	if len(matches) > 1 {
		// Never pick a winner. Accept the evidence on an isolated person and make
		// each collision independently reviewable.
		proposed, err := createProposedPerson(ctx, client, ws, u, displayName, email, observedAt)
		if err != nil {
			return nil, err
		}
		created := map[uuid.UUID]bool{}
		for _, signal := range signals {
			identity, lookupErr := client.PersonIdentity.Query().
				Where(
					personidentity.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
					personidentity.KeyHashEQ(signal.KeyHash),
				).WithPerson().Only(ctx)
			if lookupErr != nil {
				if ent.IsNotFound(lookupErr) {
					continue
				}
				return nil, lookupErr
			}
			owner, edgeErr := identity.Edges.PersonOrErr()
			if edgeErr != nil {
				return nil, edgeErr
			}
			if created[owner.ID] {
				continue
			}
			if _, err := createPersonMergeCandidate(
				ctx, client, ws, u, proposed, owner, signal, "multi_match", observedAt,
			); err != nil {
				return nil, err
			}
			created[owner.ID] = true
		}
		return proposed, nil
	}

	for _, existing := range matches {
		if err := bindPersonIdentities(ctx, client, ws, u, existing, signals, in.Source, observedAt); err != nil {
			return nil, err
		}
		return existing, nil
	}

	if displayName == "" {
		displayName = email
	}
	create := client.Person.Create().
		SetWorkspace(ws).
		SetUser(u).
		SetDisplayName(displayName)
	if email != "" {
		create.SetPrimaryEmail(email)
	}
	created, err := create.Save(ctx)
	if err != nil {
		return nil, err
	}
	if err := bindPersonIdentities(ctx, client, ws, u, created, signals, in.Source, observedAt); err != nil {
		return nil, err
	}
	return created, nil
}

func createProposedPerson(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	u *ent.User,
	displayName, email string,
	observedAt time.Time,
) (*ent.Person, error) {
	if displayName == "" {
		displayName = email
	}
	if displayName == "" {
		displayName = "Identity review required"
	}
	create := client.Person.Create().
		SetWorkspace(ws).
		SetUser(u).
		SetDisplayName(displayName)
	if email != "" {
		create.SetPrimaryEmail(email)
	}
	return create.Save(ctx)
}

// bindPersonIdentities attaches anchors, holding a collision for review.
//
// The conflict-safe insert plus read-the-winner is copied from
// bindRelationshipIdentities on purpose: a raised constraint error aborts the
// surrounding PostgreSQL transaction, so this must never be "simplified" into an
// upsert whose error is inspected.
func bindPersonIdentities(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	u *ent.User,
	p *ent.Person,
	signals []relationshipIdentitySignal,
	source string,
	seenAt time.Time,
) error {
	signals = dedupeRelationshipIdentitySignals(signals)
	if len(signals) == 0 {
		return nil
	}
	if seenAt.IsZero() {
		seenAt = time.Now().UTC()
	}
	for _, signal := range signals {
		existing, err := client.PersonIdentity.Query().
			Where(
				personidentity.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
				personidentity.KeyHashEQ(signal.KeyHash),
			).
			WithPerson().
			Only(ctx)
		if err == nil {
			owner, edgeErr := existing.Edges.PersonOrErr()
			if edgeErr != nil {
				return edgeErr
			}
			if owner.ID != p.ID {
				if _, candidateErr := createPersonMergeCandidate(
					ctx, client, ws, u, p, owner, signal, "anchor_collision", seenAt,
				); candidateErr != nil {
					return candidateErr
				}
				continue
			}
			update := existing.Update()
			changed := false
			if seenAt.Before(existing.FirstSeenAt) {
				update.SetFirstSeenAt(seenAt.UTC())
				changed = true
			}
			if seenAt.After(existing.LastSeenAt) {
				update.SetLastSeenAt(seenAt.UTC()).SetSource(source)
				changed = true
			}
			if !changed {
				continue
			}
			if _, err = update.Save(ctx); err != nil {
				return err
			}
			continue
		}
		if !ent.IsNotFound(err) {
			return err
		}
		err = client.PersonIdentity.Create().
			SetWorkspace(ws).SetPerson(p).SetUser(u).
			SetKind(signal.Kind).SetProvider(signal.Provider).
			SetKeyHash(signal.KeyHash).SetNormalizedValue(signal.Value).
			SetSource(source).SetConfidence(signal.Confidence).
			SetFirstSeenAt(seenAt.UTC()).SetLastSeenAt(seenAt.UTC()).
			OnConflict(
				entsql.ConflictColumns(
					personidentity.FieldKeyHash,
					personidentity.WorkspaceColumn,
				),
				entsql.DoNothing(),
			).Exec(ctx)
		if err != nil {
			return err
		}
		winner, err := client.PersonIdentity.Query().Where(
			personidentity.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
			personidentity.KeyHashEQ(signal.KeyHash),
		).WithPerson().Only(ctx)
		if err != nil {
			return err
		}
		owner, err := winner.Edges.PersonOrErr()
		if err != nil {
			return err
		}
		if owner.ID != p.ID {
			if _, err := createPersonMergeCandidate(
				ctx, client, ws, u, p, owner, signal, "anchor_collision", seenAt,
			); err != nil {
				return err
			}
		}
	}
	return nil
}

// createPersonMergeCandidate records two persons an anchor says might be one human.
// Idempotent on the (pair, anchor) dedupe key, using the same construction as
// createIdentityCandidate.
func createPersonMergeCandidate(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	u *ent.User,
	proposed *ent.Person,
	existing *ent.Person,
	signal relationshipIdentitySignal,
	candidateType string,
	seenAt time.Time,
) (*ent.PersonMergeCandidate, error) {
	if proposed.ID == existing.ID {
		return nil, nil
	}
	if candidateType == "" {
		candidateType = "anchor_collision"
	}
	ids := []string{proposed.ID.String(), existing.ID.String()}
	sort.Strings(ids)
	sum := sha256.Sum256([]byte(strings.Join(ids, ":") + ":" + signal.KeyHash))
	dedupe := hex.EncodeToString(sum[:])

	found, err := client.PersonMergeCandidate.Query().
		Where(
			personmergecandidate.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
			personmergecandidate.DedupeKeyEQ(dedupe),
		).Only(ctx)
	if err == nil {
		return found, nil
	}
	if !ent.IsNotFound(err) {
		return nil, err
	}

	anchorLabel := signal.Kind
	if signal.Provider != "" {
		anchorLabel += ":" + signal.Provider
	}
	return client.PersonMergeCandidate.Create().
		SetWorkspace(ws).
		SetUser(u).
		SetProposedPerson(proposed).
		SetExistingPerson(existing).
		SetDedupeKey(dedupe).
		SetCandidateType(candidateType).
		SetAnchorKind(signal.Kind).
		SetAnchorProvider(signal.Provider).
		SetAnchorKeyHash(signal.KeyHash).
		SetAnchorPreview(anchorLabel).
		SetMatchingAnchors([]string{anchorLabel}).
		// An exact anchor match is strong evidence, but "strong" is not "certain":
		// shared mailboxes and role addresses collide legitimately.
		SetRecommendedDecision("merge").
		SetConfidence(signal.Confidence).
		SetCreatedAt(seenAt.UTC()).
		Save(ctx)
}

// personsMatchingEmail is a helper for the API layer and the backfill.
func personsMatchingEmail(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	email string,
) ([]*ent.Person, error) {
	normalized := normalizeEmail(email)
	if normalized == "" {
		return nil, nil
	}
	signal := newRelationshipIdentitySignal("email", "", normalized, 1)
	identities, err := client.PersonIdentity.Query().
		Where(
			personidentity.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
			personidentity.KeyHashEQ(signal.KeyHash),
		).WithPerson().All(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]*ent.Person, 0, len(identities))
	for _, identity := range identities {
		owner, edgeErr := identity.Edges.PersonOrErr()
		if edgeErr != nil {
			return nil, edgeErr
		}
		if owner.Status == "merged" {
			continue
		}
		out = append(out, owner)
	}
	return out, nil
}
