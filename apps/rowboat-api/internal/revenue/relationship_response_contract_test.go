package revenue

import (
	"encoding/json"
	"testing"

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
