package schema

import (
	"strings"
	"testing"

	"entgo.io/ent"
	"entgo.io/ent/schema/field"
)

// TestNoMailBodyOutsideCache is the RFC 031 storage guard: no Layer-1 mail
// entity may carry a message body/snippet/content column. Bodies live only in
// the short-TTL MailBodyCache (Layer 3); quotes only in RevenueEvidence
// (Layer 4). This test fails CI if a future contributor adds a body column to
// the index, so the "copy almost nothing" posture cannot silently erode.
func TestNoMailBodyOutsideCache(t *testing.T) {
	// Field names that would represent stored message content.
	banned := []string{"body", "snippet", "content", "html", "text_body", "raw"}

	// Layer-1 index entities that must never store content.
	indexEntities := []ent.Interface{
		MailThread{},
		MailMessageMeta{},
	}

	for _, e := range indexEntities {
		name := entTypeName(e)
		for _, f := range e.Fields() {
			desc := f.Descriptor()
			lower := strings.ToLower(desc.Name)
			for _, b := range banned {
				if lower == b || strings.HasSuffix(lower, "_"+b) {
					t.Errorf("%s has a content-bearing field %q; mail bodies belong only in MailBodyCache (RFC 031)", name, desc.Name)
				}
			}
		}
	}
}

// entTypeName returns a readable schema name for error messages.
func entTypeName(e ent.Interface) string {
	switch e.(type) {
	case MailThread:
		return "MailThread"
	case MailMessageMeta:
		return "MailMessageMeta"
	default:
		return "unknown"
	}
}

// compile-time assurance the guard uses the field package (keeps the import
// meaningful if the banned-field walk changes).
var _ = field.String
