package revenue

import (
	"errors"
	"testing"
	"time"
)

func TestRelationshipGraphReturnsVersionedGovernedProjection(t *testing.T) {
	f := newFixture(t)
	rel := f.relationship(t)
	action, err := f.svc.CreateAction(f.ctx, f.user, ActionInput{
		RelationshipID: rel.ID, ActionType: "warm_follow_up", Channel: "email",
		Reason: "A reviewed graph action", RecipientEmail: "buyer@example.com",
		ProposedSubject: "Following up", ProposedMessage: "A governed draft.",
		ExecutionMode: ExecModeDraft, PriorityScore: 80,
	})
	if err != nil {
		t.Fatalf("action: %v", err)
	}

	aggregate, err := f.svc.RelationshipGraph(f.ctx, f.user, RelationshipGraphFilter{
		Scope:          "relationship",
		RelationshipID: &rel.ID,
		Depth:          2,
		AsOf:           f.svc.now(),
	})
	if err != nil {
		t.Fatalf("relationship graph: %v", err)
	}
	dto := buildRelationshipGraphDTO(aggregate, f.svc.now())
	if dto.ContractVersion != relationshipGraphContractVersion {
		t.Fatalf("contract version = %q", dto.ContractVersion)
	}
	if dto.Scope != "relationship" || dto.RelationshipID != rel.ID.String() {
		t.Fatalf("unexpected relationship scope: %#v", dto)
	}
	if !dto.Permissions.CanApprove || !dto.Permissions.CanExecute {
		t.Fatalf("owner must retain governed-action permissions: %#v", dto.Permissions)
	}

	kinds := map[string]int{}
	var graphAction relationshipGraphNodeDTO
	for _, node := range dto.Nodes {
		kinds[node.Kind]++
		if node.ID == "action:"+action.ID.String() {
			graphAction = node
		}
	}
	if kinds["relationship"] != 1 || kinds["action"] != 1 {
		t.Fatalf("expected relationship and action nodes, got %#v", kinds)
	}
	if graphAction.ApprovalStatus != ApprovalPending || graphAction.ResourceRef != action.ID.String() {
		t.Fatalf("action governance was not projected: %#v", graphAction)
	}
	if len(dto.Edges) == 0 || dto.Edges[0].Label == "" || !dto.Edges[0].Directed {
		t.Fatalf("typed directional edge missing: %#v", dto.Edges)
	}
}

func TestRelationshipGraphRejectsFutureHistoricalBoundary(t *testing.T) {
	f := newFixture(t)
	_, err := f.svc.RelationshipGraph(f.ctx, f.user, RelationshipGraphFilter{
		Scope: "portfolio",
		Depth: 2,
		AsOf:  f.svc.now().Add(2 * time.Minute),
	})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("future asOf: want ErrInvalidInput, got %v", err)
	}
}

func TestRelationshipGraphHistoricalBoundaryUsesEligibleActionRevision(t *testing.T) {
	f := newFixture(t)
	rel := f.relationship(t)
	action, err := f.svc.CreateAction(f.ctx, f.user, ActionInput{
		RelationshipID: rel.ID, ActionType: "warm_follow_up", Channel: "email",
		Reason: "Original evidence-backed reason", RecipientEmail: "buyer@example.com",
		ProposedSubject: "Original subject", ProposedMessage: "Original message.",
		ExecutionMode: ExecModeDraft, PriorityScore: 80,
	})
	if err != nil {
		t.Fatalf("action: %v", err)
	}

	// Capture a boundary after revision 1, then create revision 2. The service
	// clock is advanced independently so the read is unambiguously historical.
	asOf := time.Now().UTC()
	time.Sleep(2 * time.Millisecond)
	revisedType := "meeting_follow_up"
	revisedReason := "Later reason that must not cross the boundary"
	if _, err := f.svc.EditAction(f.ctx, f.user, action.ID, EditInput{
		ActionType: &revisedType,
		Reason:     &revisedReason,
	}); err != nil {
		t.Fatalf("edit action: %v", err)
	}
	f.svc.now = func() time.Time { return asOf.Add(2 * time.Second) }

	aggregate, err := f.svc.RelationshipGraph(f.ctx, f.user, RelationshipGraphFilter{
		Scope: "relationship", RelationshipID: &rel.ID, Depth: 2, AsOf: asOf,
	})
	if err != nil {
		t.Fatalf("historical graph: %v", err)
	}
	dto := buildRelationshipGraphDTO(aggregate, f.svc.now())
	var graphAction relationshipGraphNodeDTO
	for _, node := range dto.Nodes {
		if node.ID == "action:"+action.ID.String() {
			graphAction = node
			break
		}
	}
	if graphAction.ID == "" {
		t.Fatal("historical action node missing")
	}
	if graphAction.Label != "warm follow up" || graphAction.Summary != "Original evidence-backed reason" {
		t.Fatalf("later action revision leaked across asOf: %#v", graphAction)
	}
	if graphAction.Metadata["revision"] != 1 {
		t.Fatalf("historical action revision = %#v, want 1", graphAction.Metadata["revision"])
	}
}
