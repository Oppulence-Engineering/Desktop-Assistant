package revenue

import (
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
)

func TestRelationshipDTOEmitsEmptyCollectionsInsteadOfNull(t *testing.T) {
	t.Parallel()
	raw, err := json.Marshal(relationshipToDTO(&ent.Relationship{}))
	if err != nil {
		t.Fatalf("marshal relationship DTO: %v", err)
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatalf("decode relationship DTO: %v", err)
	}
	for _, field := range []string{"risks", "milestones", "resourceRefs"} {
		values, ok := payload[field].([]any)
		if !ok || len(values) != 0 {
			t.Fatalf("%s = %#v, want an empty JSON array", field, payload[field])
		}
	}
}

// ListRelationships JSON is validated by the web app's Orval strictObject.
// A DTO field that is not on RevenueRelationship is not a "different
// versions" deploy problem — it is a contract hole that only shows up after
// the browser parses the list. Fail here when Go can emit a key the spec
// does not document.
func TestRelationshipDTOJSONKeysAreDocumentedInOpenAPI(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 9, 19, 16, 0, 0, 0, time.UTC)
	raw, err := json.Marshal(relationshipDTO{
		ID:                    "9c8dfa9b-a7b2-46ea-982c-622a914c00e5",
		Kind:                  "company",
		DisplayName:           "Acme",
		PrimaryEmail:          "buyer@example.com",
		AccountDomain:         "example.com",
		Summary:               "Asked for pricing.",
		Status:                "active",
		LastTouchAt:           &now,
		NextActionAt:          &now,
		OpenActions:           1,
		PeopleCount:           3,
		EmailThreadCount:      12,
		CommitmentCount:       4,
		NextAction:            "Confirm the owner.",
		Lifecycle:             "evaluation",
		Engagement:            "declining",
		Sentiment:             "mixed",
		Health:                "needs_attention",
		StateReason:           "Security review has no owner.",
		StateVersion:          4,
		StateHash:             "sha256:ab12cd34",
		ProjectorVersion:      2,
		ProjectedAt:           &now,
		LastChangedAt:         &now,
		Risks:                 []string{"Security review has no owner."},
		Milestones:            []string{"Proposal shared."},
		ResourceRefs:          []string{"hubspot:company:123"},
		Categories:            []string{"Artificial intelligence"},
		CompanyDescription:    "Builds AI infrastructure.",
		LinkedInURL:           "https://www.linkedin.com/company/acme",
		CompanyEnrichmentRefs: map[string][]string{"description": {"https://example.com"}},
		CompanyEnrichmentData: map[string]string{"description": "Builds AI infrastructure."},
		CompanyEnrichedAt:     &now,
	})
	if err != nil {
		t.Fatalf("marshal populated relationship DTO: %v", err)
	}

	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatalf("decode relationship DTO: %v", err)
	}

	documented := openAPISchemaPropertyNames(t, "RevenueRelationship")
	for key := range payload {
		if !documented[key] {
			t.Errorf("relationshipDTO emits %q, but OpenAPI RevenueRelationship does not document it", key)
		}
	}
}

func openAPISchemaPropertyNames(t *testing.T, schemaName string) map[string]bool {
	t.Helper()
	raw, err := os.ReadFile("../../api/openapi.json")
	if err != nil {
		t.Fatalf("read checked-in openapi json: %v", err)
	}
	var spec map[string]any
	if err := json.Unmarshal(raw, &spec); err != nil {
		t.Fatalf("parse checked-in openapi json: %v", err)
	}
	components, _ := spec["components"].(map[string]any)
	schemas, _ := components["schemas"].(map[string]any)
	schema, _ := schemas[schemaName].(map[string]any)
	properties, _ := schema["properties"].(map[string]any)
	if len(properties) == 0 {
		t.Fatalf("OpenAPI schema %s has no properties", schemaName)
	}
	names := make(map[string]bool, len(properties))
	for name := range properties {
		names[name] = true
	}
	return names
}
