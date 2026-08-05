package google

import (
	"slices"
	"testing"
)

// The desktop and this list have to agree, and twice now they have not.
//
// The sync loop in apps/x/packages/core/src/knowledge/sync_gmail.ts gates on a
// scope by exact name. When it asked for gmail.modify and this list offered
// only readonly/compose/send, every managed mailbox silently never synced —
// the loop logged "missing required Gmail scope" to stdout every 30 seconds
// and slept, while calendar synced normally beside it.
//
// A grant is matched scope-by-scope, not by what one scope implies. gmail.modify
// covers reading, but a desktop gate naming gmail.readonly still fails if
// readonly is absent from the grant. So both belong here, and dropping either
// breaks something on the other side of the wire.
const (
	desktopSyncScope    = "https://www.googleapis.com/auth/gmail.readonly"
	desktopWriteScope   = "https://www.googleapis.com/auth/gmail.modify"
	desktopCalendarSync = "https://www.googleapis.com/auth/calendar.events.readonly"
)

func TestDefaultScopesCoverDesktopRequirements(t *testing.T) {
	for _, tc := range []struct {
		scope string
		why   string
	}{
		{desktopSyncScope, "sync_gmail.ts REQUIRED_SCOPE — mailbox sync stops without it"},
		{desktopWriteScope, "archive/trash/mark-read call threads.modify and threads.trash"},
		{desktopCalendarSync, "sync_calendar.ts REQUIRED_SCOPES"},
	} {
		if !slices.Contains(defaultScopes, tc.scope) {
			t.Errorf("defaultScopes is missing %s (%s)", tc.scope, tc.why)
		}
	}
}

func TestDefaultScopesHaveNoDuplicates(t *testing.T) {
	// A duplicate is harmless to Google but signals a bad merge in a list that
	// two codebases depend on.
	seen := map[string]bool{}
	for _, s := range defaultScopes {
		if seen[s] {
			t.Errorf("duplicate scope %s", s)
		}
		seen[s] = true
	}
}

func TestDefaultScopesExcludeGmailMetadata(t *testing.T) {
	// gmail.metadata is the most restrictive scope a token can carry: it forbids
	// both q= search and format=FULL body fetches, which breaks the desktop's
	// Gmail sync outright. oauthflow.go deliberately omits include_granted_scopes
	// to keep it from being unioned in; it must not arrive by way of this list
	// either.
	if slices.Contains(defaultScopes, "https://www.googleapis.com/auth/gmail.metadata") {
		t.Error("gmail.metadata breaks Gmail sync (no q= search, no format=FULL)")
	}
}
