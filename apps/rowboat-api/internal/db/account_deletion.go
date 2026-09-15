package db

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"entgo.io/ent/dialect"
	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/actionoutcome"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/agentdefinition"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/agentdefinitionhistory"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/commitment"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/commitmentdependency"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/commitmentevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/conversationintelligenceartifact"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/entity"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/entityidentifier"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/entityresourceref"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/llmusage"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/llmusagehistory"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/mcpconnection"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/mcpconnectionhistory"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/oauthconnection"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/oauthconnectionhistory"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/person"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/personattribute"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/personidentity"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/personmergecandidate"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/personsuppression"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/policydecisionsnapshot"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipassertion"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipattentionitem"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipidentity"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipidentitycandidate"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipidentitydecision"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshiplineageevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipobservation"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipparticipant"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipprojectionjob"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipreviewacknowledgement"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipsourcestatus"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipstatesnapshot"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueaction"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueactionrevision"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueevidence"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueleakscan"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueoutboxevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenuetrustevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspacemember"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/subscription"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/subscriptionhistory"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/tenantevidencekey"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/userhistory"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/workspacefeaturecontrol"
)

// WorkspaceTransfer gives a shared workspace to a new owner during account
// deletion, so the other members keep their data.
type WorkspaceTransfer struct {
	WorkspaceID uuid.UUID
	SuccessorID uuid.UUID
}

// ErrWorkspaceTransferConflict means that a workspace owner or the chosen
// successor changed between planning and deleting the account.
var ErrWorkspaceTransferConflict = errors.New("db: workspace transfer target changed")

// ErrAccountNotFound means that the user row was already gone.
var ErrAccountNotFound = errors.New("db: account not found")

// workspaceAuthoredTable is a workspace-scoped table whose user column records
// the author. In a workspace that survives the deletion, the author's rows move
// to the workspace owner instead of cascading away with the author.
type workspaceAuthoredTable struct {
	typ             string
	table           string
	userColumn      string
	workspaceColumn string
	// uniqueWith holds the other columns of a unique index that includes the
	// user column. A row that would collide with a row of the new owner is
	// not moved, and the cascade deletes it.
	uniqueWith []string
}

var workspaceAuthoredTables = []workspaceAuthoredTable{
	{typ: ent.TypeRevenueLeakScan, table: revenueleakscan.Table, userColumn: revenueleakscan.UserColumn, workspaceColumn: revenueleakscan.WorkspaceColumn},
	{typ: ent.TypeRelationship, table: relationship.Table, userColumn: relationship.UserColumn, workspaceColumn: relationship.WorkspaceColumn},
	{typ: ent.TypeRelationshipAttentionItem, table: relationshipattentionitem.Table, userColumn: relationshipattentionitem.UserColumn, workspaceColumn: relationshipattentionitem.WorkspaceColumn},
	{typ: ent.TypeRelationshipParticipant, table: relationshipparticipant.Table, userColumn: relationshipparticipant.UserColumn, workspaceColumn: relationshipparticipant.WorkspaceColumn},
	{typ: ent.TypeRelationshipIdentity, table: relationshipidentity.Table, userColumn: relationshipidentity.UserColumn, workspaceColumn: relationshipidentity.WorkspaceColumn},
	{typ: ent.TypeRelationshipIdentityCandidate, table: relationshipidentitycandidate.Table, userColumn: relationshipidentitycandidate.UserColumn, workspaceColumn: relationshipidentitycandidate.WorkspaceColumn},
	{typ: ent.TypeRelationshipIdentityDecision, table: relationshipidentitydecision.Table, userColumn: relationshipidentitydecision.UserColumn, workspaceColumn: relationshipidentitydecision.WorkspaceColumn},
	{typ: ent.TypeRelationshipLineageEvent, table: relationshiplineageevent.Table, userColumn: relationshiplineageevent.UserColumn, workspaceColumn: relationshiplineageevent.WorkspaceColumn},
	{typ: ent.TypeRelationshipObservation, table: relationshipobservation.Table, userColumn: relationshipobservation.UserColumn, workspaceColumn: relationshipobservation.WorkspaceColumn},
	{typ: ent.TypeRelationshipAssertion, table: relationshipassertion.Table, userColumn: relationshipassertion.UserColumn, workspaceColumn: relationshipassertion.WorkspaceColumn},
	{typ: ent.TypeRelationshipProjectionJob, table: relationshipprojectionjob.Table, userColumn: relationshipprojectionjob.UserColumn, workspaceColumn: relationshipprojectionjob.WorkspaceColumn},
	// Unique index: (state_version, relationship_id, user_relationship_review_acknowledgements).
	{typ: ent.TypeRelationshipReviewAcknowledgement, table: relationshipreviewacknowledgement.Table, userColumn: relationshipreviewacknowledgement.UserColumn, workspaceColumn: relationshipreviewacknowledgement.WorkspaceColumn, uniqueWith: []string{"state_version", "relationship_id"}},
	{typ: ent.TypeRelationshipStateSnapshot, table: relationshipstatesnapshot.Table, userColumn: relationshipstatesnapshot.UserColumn, workspaceColumn: relationshipstatesnapshot.WorkspaceColumn},
	{typ: ent.TypeRelationshipSourceStatus, table: relationshipsourcestatus.Table, userColumn: relationshipsourcestatus.UserColumn, workspaceColumn: relationshipsourcestatus.WorkspaceColumn},
	{typ: ent.TypeRevenueEvidence, table: revenueevidence.Table, userColumn: revenueevidence.UserColumn, workspaceColumn: revenueevidence.WorkspaceColumn},
	{typ: ent.TypeCommitment, table: commitment.Table, userColumn: commitment.UserColumn, workspaceColumn: commitment.WorkspaceColumn},
	{typ: ent.TypeCommitmentEvent, table: commitmentevent.Table, userColumn: commitmentevent.UserColumn, workspaceColumn: commitmentevent.WorkspaceColumn},
	{typ: ent.TypeCommitmentDependency, table: commitmentdependency.Table, userColumn: commitmentdependency.UserColumn, workspaceColumn: commitmentdependency.WorkspaceColumn},
	{typ: ent.TypeConversationIntelligenceArtifact, table: conversationintelligenceartifact.Table, userColumn: conversationintelligenceartifact.UserColumn, workspaceColumn: conversationintelligenceartifact.WorkspaceColumn},
	{typ: ent.TypeRevenueAction, table: revenueaction.Table, userColumn: revenueaction.UserColumn, workspaceColumn: revenueaction.WorkspaceColumn},
	{typ: ent.TypePolicyDecisionSnapshot, table: policydecisionsnapshot.Table, userColumn: policydecisionsnapshot.UserColumn, workspaceColumn: policydecisionsnapshot.WorkspaceColumn},
	{typ: ent.TypeActionOutcome, table: actionoutcome.Table, userColumn: actionoutcome.UserColumn, workspaceColumn: actionoutcome.WorkspaceColumn},
	{typ: ent.TypeRevenueOutboxEvent, table: revenueoutboxevent.Table, userColumn: revenueoutboxevent.UserColumn, workspaceColumn: revenueoutboxevent.WorkspaceColumn},
	{typ: ent.TypeTenantEvidenceKey, table: tenantevidencekey.Table, userColumn: tenantevidencekey.UserColumn, workspaceColumn: tenantevidencekey.WorkspaceColumn},
	{typ: ent.TypeWorkspaceFeatureControl, table: workspacefeaturecontrol.Table, userColumn: workspacefeaturecontrol.UserColumn, workspaceColumn: workspacefeaturecontrol.WorkspaceColumn},
	{typ: ent.TypeRevenueTrustEvent, table: revenuetrustevent.Table, userColumn: revenuetrustevent.UserColumn, workspaceColumn: revenuetrustevent.WorkspaceColumn},
	{typ: ent.TypePerson, table: person.Table, userColumn: person.UserColumn, workspaceColumn: person.WorkspaceColumn},
	{typ: ent.TypePersonIdentity, table: personidentity.Table, userColumn: personidentity.UserColumn, workspaceColumn: personidentity.WorkspaceColumn},
	{typ: ent.TypePersonSuppression, table: personsuppression.Table, userColumn: personsuppression.UserColumn, workspaceColumn: personsuppression.WorkspaceColumn},
	{typ: ent.TypePersonAttribute, table: personattribute.Table, userColumn: personattribute.UserColumn, workspaceColumn: personattribute.WorkspaceColumn},
	{typ: ent.TypePersonMergeCandidate, table: personmergecandidate.Table, userColumn: personmergecandidate.UserColumn, workspaceColumn: personmergecandidate.WorkspaceColumn},
	{typ: ent.TypeEntity, table: entity.Table, userColumn: entity.UserColumn, workspaceColumn: entity.WorkspaceColumn},
	{typ: ent.TypeEntityResourceRef, table: entityresourceref.Table, userColumn: entityresourceref.UserColumn, workspaceColumn: entityresourceref.WorkspaceColumn},
	{typ: ent.TypeEntityIdentifier, table: entityidentifier.Table, userColumn: entityidentifier.UserColumn, workspaceColumn: entityidentifier.WorkspaceColumn},
}

// historyTables have no foreign key to their source table, so the cascade
// does not reach them. Their rows are removed through the source rows.
var historyTables = []struct {
	history    string
	source     string
	userColumn string
}{
	{subscriptionhistory.Table, subscription.Table, subscription.UserColumn},
	{llmusagehistory.Table, llmusage.Table, llmusage.UserColumn},
	{mcpconnectionhistory.Table, mcpconnection.Table, mcpconnection.UserColumn},
	{oauthconnectionhistory.Table, oauthconnection.Table, oauthconnection.UserColumn},
	{agentdefinitionhistory.Table, agentdefinition.Table, agentdefinition.UserColumn},
}

// DeleteAccount removes the user and everything the user owns in one
// transaction. It runs as raw SQL: user edges are immutable in Ent, the ORM
// rejects deletes of append-only records, and ON DELETE CASCADE does the rest.
//
// The order is important:
//  1. Shared workspaces move to their successors.
//  2. In every workspace that survives, the user's authored rows move to the
//     workspace owner, so the cascade does not delete shared data.
//  3. History rows go while their source rows still identify the user.
//  4. The user row goes, and the database cascades the delete.
//  5. The user's own history rows go (they hold the email).
func (d *DB) DeleteAccount(ctx context.Context, userID uuid.UUID, transfers []WorkspaceTransfer) error {
	tx, err := d.sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	exec := func(query string, args ...any) (int64, error) {
		result, err := tx.ExecContext(ctx, d.rebind(query), args...)
		if err != nil {
			return 0, err
		}
		return result.RowsAffected()
	}

	ws, wsOwner, wsID := revenueworkspace.Table, revenueworkspace.UserColumn, revenueworkspace.FieldID
	for _, t := range transfers {
		// Identifiers come only from generated constants, never from input.
		n, err := exec(fmt.Sprintf(`UPDATE "%s" SET "%s" = ? WHERE "%s" = ? AND "%s" = ?`, ws, wsOwner, wsID, wsOwner), t.SuccessorID, t.WorkspaceID, userID) // #nosec G201
		if err != nil {
			return fmt.Errorf("transfer workspace %s: %w", t.WorkspaceID, err)
		}
		if n != 1 {
			return ErrWorkspaceTransferConflict
		}
		n, err = exec(fmt.Sprintf(`UPDATE "%s" SET "%s" = 'owner' WHERE "%s" = ? AND "%s" = ? AND "%s" = 'active'`,
			revenueworkspacemember.Table, revenueworkspacemember.FieldRole, revenueworkspacemember.WorkspaceColumn,
			revenueworkspacemember.UserColumn, revenueworkspacemember.FieldStatus), t.WorkspaceID, t.SuccessorID) // #nosec G201
		if err != nil {
			return fmt.Errorf("promote successor in workspace %s: %w", t.WorkspaceID, err)
		}
		if n != 1 {
			return ErrWorkspaceTransferConflict
		}
	}

	for _, t := range workspaceAuthoredTables {
		ownerOfRow := fmt.Sprintf(`(SELECT w."%s" FROM "%s" w WHERE w."%s" = "%s"."%s")`, wsOwner, ws, wsID, t.table, t.workspaceColumn)
		query := fmt.Sprintf(`UPDATE "%s" SET "%s" = %s WHERE "%s" = ? AND "%s" IN (SELECT "%s" FROM "%s" WHERE "%s" <> ?)`,
			t.table, t.userColumn, ownerOfRow, t.userColumn, t.workspaceColumn, wsID, ws, wsOwner) // #nosec G201
		if len(t.uniqueWith) > 0 {
			same := make([]string, 0, len(t.uniqueWith))
			for _, column := range t.uniqueWith {
				same = append(same, fmt.Sprintf(`o."%s" = "%s"."%s"`, column, t.table, column))
			}
			query += fmt.Sprintf(` AND NOT EXISTS (SELECT 1 FROM "%s" o WHERE o."%s" = %s AND %s)`,
				t.table, t.userColumn, ownerOfRow, strings.Join(same, " AND ")) // #nosec G201
		}
		if _, err := exec(query, userID, userID); err != nil {
			return fmt.Errorf("reassign %s: %w", t.table, err)
		}
	}

	// Revisions are scoped through their action, not through a workspace column.
	revisions, actions := revenueactionrevision.Table, revenueaction.Table
	actionOwner := fmt.Sprintf(`SELECT w."%s" FROM "%s" a JOIN "%s" w ON w."%s" = a."%s" WHERE a."%s" = "%s"."%s"`,
		wsOwner, actions, ws, wsID, revenueaction.WorkspaceColumn, revenueaction.FieldID, revisions, revenueactionrevision.ActionColumn)
	sharedActions := fmt.Sprintf(`SELECT a."%s" FROM "%s" a JOIN "%s" w ON w."%s" = a."%s" WHERE w."%s" <> ?`,
		revenueaction.FieldID, actions, ws, wsID, revenueaction.WorkspaceColumn, wsOwner)
	if _, err := exec(fmt.Sprintf(`UPDATE "%s" SET "%s" = (%s) WHERE "%s" = ? AND "%s" IN (%s)`,
		revisions, revenueactionrevision.UserColumn, actionOwner, revenueactionrevision.UserColumn, revenueactionrevision.ActionColumn, sharedActions), userID, userID); err != nil { // #nosec G201
		return fmt.Errorf("reassign %s: %w", revisions, err)
	}

	for _, h := range historyTables {
		if _, err := exec(fmt.Sprintf(`DELETE FROM "%s" WHERE "ref" IN (SELECT "id" FROM "%s" WHERE "%s" = ?)`, h.history, h.source, h.userColumn), userID); err != nil { // #nosec G201
			return fmt.Errorf("purge %s: %w", h.history, err)
		}
	}

	n, err := exec(fmt.Sprintf(`DELETE FROM "%s" WHERE "%s" = ?`, user.Table, user.FieldID), userID) // #nosec G201
	if err != nil {
		return fmt.Errorf("delete user: %w", err)
	}
	if n != 1 {
		return ErrAccountNotFound
	}
	if _, err := exec(fmt.Sprintf(`DELETE FROM "%s" WHERE "%s" = ?`, userhistory.Table, userhistory.FieldRef), userID); err != nil { // #nosec G201
		return fmt.Errorf("purge %s: %w", userhistory.Table, err)
	}
	return tx.Commit()
}

// rebind turns "?" placeholders into "$n" for PostgreSQL.
func (d *DB) rebind(query string) string {
	if d.Dialect != dialect.Postgres {
		return query
	}
	var b strings.Builder
	position := 0
	for _, r := range query {
		if r == '?' {
			position++
			fmt.Fprintf(&b, "$%d", position)
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}
