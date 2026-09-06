package google

import (
	"net/url"
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
