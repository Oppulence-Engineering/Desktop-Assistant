package google

import (
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestCompletionTargetUsesWebReturn(t *testing.T) {
	h := &Handler{deepLinkScheme: "rowboat"}
	h.SetWebReturnURL("http://localhost:3000/app/settings?settings=connections")
	target, err := url.Parse(h.completionTarget("ticket", "success"))
	if err != nil || target.Query().Get("settings") != "connections" ||
		target.Query().Get("google_session") != "ticket" || target.Query().Get("google_status") != "success" {
		t.Fatalf("completion target = %q, err = %v", target, err)
	}
}

func TestDeepLinkScrubsOAuthCallbackAndShowsCompletion(t *testing.T) {
	h := &Handler{deepLinkScheme: "rowboat"}
	rec := httptest.NewRecorder()
	h.deepLink(rec, "ticket", "success")

	body := rec.Body.String()
	for _, want := range []string{
		"history.replaceState(null,'','/oauth/google/callback/complete')",
		"Google connected",
		"Google connected | Oppulence",
		"Oppulence is now syncing your Google data.",
		"You can close this tab and return to Oppulence.",
		"rowboat://oauth/google/done?session=ticket&amp;status=success",
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("completion page missing %q: %s", want, body)
		}
	}
	if strings.Contains(body, "Rowboat") {
		t.Fatalf("legacy Rowboat branding leaked into completion page: %s", body)
	}
	if csp := rec.Header().Get("Content-Security-Policy"); !strings.Contains(csp, "script-src 'nonce-ticket'") || !strings.Contains(csp, "style-src 'nonce-ticket'") {
		t.Fatalf("unexpected CSP: %q", csp)
	}
}

func TestDeepLinkShowsRetryCopyOnError(t *testing.T) {
	h := &Handler{deepLinkScheme: "rowboat"}
	rec := httptest.NewRecorder()
	h.deepLink(rec, "ticket", "error")

	body := rec.Body.String()
	if !strings.Contains(body, "Google connection incomplete") || !strings.Contains(body, "try connecting Google again") {
		t.Fatalf("error completion page is unclear: %s", body)
	}
}
