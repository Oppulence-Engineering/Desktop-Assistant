package revenue

import (
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/conversationintelligenceartifact"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipobservation"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueevidence"
)

func TestConversationDeletionHonorsLegalHoldThenRemovesServerContentIdempotently(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 8, 5, 12, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	results, err := f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{
		compiledConversationInput(now, "deletion-meeting-1", "v1"),
	})
	if err != nil {
		t.Fatal(err)
	}
	rel := results[0].Relationship
	policy := ConversationPolicyLayer{
		LayerID: "account:deletion-test", Scope: "account", Enforced: true,
		Capture: "require_consent", ModelRoute: "hosted_allowed", PublishEvidence: true,
		ExternalShare: true, RetentionDays: 30,
		RedactionClasses: []string{"credentials", "personal_identifier"}, LegalHold: true,
	}
	if _, err := f.svc.SaveConversationPolicyLayers(f.ctx, f.user, rel.ID, []ConversationPolicyLayer{policy}); err != nil {
		t.Fatal(err)
	}
	blocked, err := f.svc.RequestConversationDeletion(f.ctx, f.user, rel.ID, "delete-held-1")
	if err != nil || blocked.Status != "blocked" || !blocked.LegalHold || blocked.Targets[0].ErrorCode != "legal_hold" {
		t.Fatalf("legal hold did not fail closed: %#v err=%v", blocked, err)
	}
	if count := f.client.RelationshipObservation.Query().Where(
		relationshipobservation.HasRelationshipWith(relationship.IDEQ(rel.ID)),
	).CountX(f.ctx); count == 0 {
		t.Fatal("legal hold removed conversation observations")
	}

	policy.LegalHold = false
	if _, err := f.svc.SaveConversationPolicyLayers(f.ctx, f.user, rel.ID, []ConversationPolicyLayer{policy}); err != nil {
		t.Fatal(err)
	}
	receipt, err := f.svc.RequestConversationDeletion(f.ctx, f.user, rel.ID, "delete-released-1")
	if err != nil || receipt.Status != "partial" || receipt.LegalHold {
		t.Fatalf("released deletion failed: %#v err=%v", receipt, err)
	}
	replay, err := f.svc.RequestConversationDeletion(f.ctx, f.user, rel.ID, "delete-released-1")
	if err != nil || replay.ReceiptID != receipt.ReceiptID || replay.RequestedAt != receipt.RequestedAt {
		t.Fatalf("deletion retry was not idempotent: %#v err=%v", replay, err)
	}
	otherRelationship := f.relationship(t)
	if _, err := f.svc.RequestConversationDeletion(f.ctx, f.user, otherRelationship.ID, "delete-released-1"); err == nil {
		t.Fatal("deletion request id was allowed to cross relationship scopes")
	}
	observations, err := f.client.RelationshipObservation.Query().Where(
		relationshipobservation.HasRelationshipWith(relationship.IDEQ(rel.ID)),
	).All(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, observation := range observations {
		if observation.Source == "meeting" && (observation.Summary != "" || observation.NormalizedFactsJSON != "{}" || len(observation.PayloadCiphertext) != 0) {
			t.Fatalf("deleted observation retained content: %#v", observation)
		}
	}
	evidences, err := f.client.RevenueEvidence.Query().Where(
		revenueevidence.HasRelationshipsWith(relationship.IDEQ(rel.ID)),
		revenueevidence.SourceEQ("meeting"),
	).All(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, evidence := range evidences {
		if evidence.Excerpt != "" || len(evidence.PayloadCiphertext) != 0 || evidence.SourceURI != "" {
			t.Fatalf("deleted evidence retained content: %#v", evidence)
		}
	}
	if count := f.client.ConversationIntelligenceArtifact.Query().Where(
		conversationintelligenceartifact.HasRelationshipWith(relationship.IDEQ(rel.ID)),
		conversationintelligenceartifact.KindIn(conversationArtifactContentKinds...),
	).CountX(f.ctx); count != 0 {
		t.Fatalf("deleted conversation artifacts remain: %d", count)
	}
	if count := f.client.ConversationIntelligenceArtifact.Query().Where(
		conversationintelligenceartifact.KindEQ("deletion_receipt"),
		conversationintelligenceartifact.StableIDEQ("delete-released-1"),
	).CountX(f.ctx); count != 1 {
		t.Fatalf("want one immutable deletion receipt, got %d", count)
	}
}
