package connectors

import "testing"

func TestSemanticAuditRecords(t *testing.T) {
	tests := []struct {
		name string
		in   auditRecord
		want []string
	}{
		{name: "entitlement allowed at start", in: auditRecord{EventType: "oauth_started"}, want: []string{"entitlement.check"}},
		{name: "mint and entitlement allowed", in: auditRecord{EventType: "token_minted"}, want: []string{"entitlement.check", "token.minted"}},
		{name: "provider refresh committed", in: auditRecord{EventType: "token_refresh_committed"}, want: []string{"token.refreshed"}},
		{name: "entitlement denied", in: auditRecord{EventType: "oauth_start_rejected", Reason: "connector_disabled"}, want: []string{"entitlement.check"}},
		{name: "reuse invalidates family", in: auditRecord{EventType: "connection_invalidated", Reason: "refresh_token_reuse"}, want: []string{"token.reuse_detected", "token.revoked"}},
		{name: "disconnect revokes", in: auditRecord{EventType: "connection_revoked"}, want: []string{"token.revoked"}},
		{name: "unrelated rejection", in: auditRecord{EventType: "oauth_start_rejected", Reason: "invalid_scope"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := semanticAuditRecords(tt.in)
			if len(got) != len(tt.want) {
				t.Fatalf("got %d semantic records, want %d: %#v", len(got), len(tt.want), got)
			}
			for i := range got {
				if got[i].EventType != tt.want[i] {
					t.Fatalf("record %d event = %q, want %q", i, got[i].EventType, tt.want[i])
				}
			}
		})
	}
}
