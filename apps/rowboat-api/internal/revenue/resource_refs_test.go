package revenue

import (
	"errors"
	"reflect"
	"testing"
)

func TestNormalizeResourceRefsCanonicalizesAndDeduplicates(t *testing.T) {
	got, err := normalizeResourceRefs([]string{
		" HubSpot:Contacts:12345 ",
		"slack:channel:C123",
		"hubspot:contacts:12345",
		"Slack:Thread:C123:1712345678.001",
	})
	if err != nil {
		t.Fatalf("normalize: %v", err)
	}
	want := []string{
		"hubspot:contacts:12345",
		"slack:channel:C123",
		"slack:thread:C123:1712345678.001",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("refs = %#v, want %#v", got, want)
	}
}

func TestCreateRelationshipRejectsMalformedResourceRef(t *testing.T) {
	f := newFixture(t)
	_, err := f.svc.CreateRelationship(f.ctx, f.user, RelationshipInput{
		Kind: "person", DisplayName: "Jordan Buyer", ResourceRefs: []string{"not-a-provider-target"},
	})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("malformed ref error = %v, want ErrInvalidInput", err)
	}
}

func TestCreateRelationshipPersistsProviderTargets(t *testing.T) {
	f := newFixture(t)
	rel, err := f.svc.CreateRelationship(f.ctx, f.user, RelationshipInput{
		Kind: "person", DisplayName: "Jordan Buyer",
		ResourceRefs: []string{"slack:channel:C123", "hubspot:contact:12345"},
	})
	if err != nil {
		t.Fatalf("create relationship: %v", err)
	}
	want := []string{"hubspot:contact:12345", "slack:channel:C123"}
	if !reflect.DeepEqual(rel.ResourceRefs, want) {
		t.Fatalf("stored refs = %#v, want %#v", rel.ResourceRefs, want)
	}
}
