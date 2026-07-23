package revenue

import (
	"context"
	"fmt"
	"html"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueaction"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
)

// digestTopN is how many open actions a digest highlights.
const digestTopN = 5

// DigestAction is one highlighted open loop in a digest.
type DigestAction struct {
	Detector  string `json:"detector"`
	Recipient string `json:"recipient"`
	Reason    string `json:"reason"`
	Priority  int    `json:"priority"`
}

// Digest is the proactive summary of a user's revenue queue.
type Digest struct {
	GeneratedAt time.Time      `json:"generatedAt"`
	OpenCount   int            `json:"openCount"`
	Top         []DigestAction `json:"top"`
	Replied     int            `json:"replied"`
	Meetings    int            `json:"meetingsBooked"`
	Handled     int            `json:"handled"`
}

// Empty reports whether there is nothing worth sending.
func (d *Digest) Empty() bool { return d.OpenCount == 0 }

// Digest composes the summary for one user: the top open loops by priority
// plus the running impact counts.
func (s *Service) Digest(ctx context.Context, u *ent.User) (*Digest, error) {
	actions, err := s.ListActions(ctx, u, ListFilter{QueueStatus: QueueOpen, Limit: digestTopN})
	if err != nil {
		return nil, err
	}
	openCount, err := s.client.RevenueAction.Query().
		Where(
			revenueaction.HasUserWith(user.IDEQ(u.ID)),
			revenueaction.QueueStatusEQ(QueueOpen),
		).
		Count(ctx)
	if err != nil {
		return nil, err
	}
	imp, err := s.Impact(ctx, u)
	if err != nil {
		return nil, err
	}
	d := &Digest{
		GeneratedAt: s.now(),
		OpenCount:   openCount,
		Replied:     imp.OutcomeCount("replied"),
		Meetings:    imp.OutcomeCount("meeting_booked"),
		Handled:     imp.Handled,
	}
	for _, a := range actions {
		d.Top = append(d.Top, DigestAction{
			Detector:  detectorDisplay[a.Detector],
			Recipient: a.RecipientEmail,
			Reason:    a.Reason,
			Priority:  a.PriorityScore,
		})
	}
	return d, nil
}

// detectorDisplay maps detector keys to human labels for the digest (the www
// side has its own copy; this keeps the email self-contained).
var detectorDisplay = map[string]string{
	"requested_follow_up_due":   "Follow-up due",
	"unanswered_proposal":       "Unanswered proposal",
	"waiting_on_me":             "Waiting on you",
	"dormant_warm_opportunity":  "Dormant opportunity",
	"neglected_referral":        "Neglected referral",
	"former_customer_reconnect": "Former customer",
	"manual":                    "Manual",
}

// RenderDigest builds the subject and HTML/plain bodies for a digest email.
// appURL is the dashboard base so the CTA links to the queue.
func RenderDigest(d *Digest, appURL string) (subject, htmlBody, textBody string) {
	noun := "open loop"
	if d.OpenCount != 1 {
		noun = "open loops"
	}
	subject = fmt.Sprintf("%d %s slipping in your inbox", d.OpenCount, noun)
	queueURL := strings.TrimRight(appURL, "/") + "/app"

	var h strings.Builder
	h.WriteString(`<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">`)
	fmt.Fprintf(&h, `<h2 style="font-size:18px;margin:0 0 4px">%d %s to review</h2>`, d.OpenCount, noun)
	h.WriteString(`<p style="color:#666;font-size:14px;margin:0 0 20px">The follow-ups, proposals, and warm relationships going quiet — ranked by how much they matter.</p>`)

	var t strings.Builder
	fmt.Fprintf(&t, "%s to review\n\n", subject)

	for _, a := range d.Top {
		recipient := a.Recipient
		if recipient == "" {
			recipient = "a contact"
		}
		h.WriteString(`<div style="border:1px solid #eee;border-radius:4px;padding:12px;margin-bottom:8px">`)
		fmt.Fprintf(&h,
			`<div style="display:flex;justify-content:space-between"><strong style="font-size:14px">%s</strong><span style="color:#999;font-size:12px">priority %d</span></div>`,
			html.EscapeString(recipient), a.Priority)
		fmt.Fprintf(&h, `<div style="color:#888;font-size:12px;margin:2px 0 4px">%s</div>`, html.EscapeString(a.Detector))
		fmt.Fprintf(&h, `<div style="color:#444;font-size:13px">%s</div>`, html.EscapeString(a.Reason))
		h.WriteString(`</div>`)

		fmt.Fprintf(&t, "• [%d] %s — %s\n  %s\n", a.Priority, recipient, a.Detector, a.Reason)
	}

	fmt.Fprintf(&h,
		`<a href="%s" style="display:inline-block;margin-top:12px;background:#e0522c;color:#fff;text-decoration:none;padding:10px 18px;border-radius:4px;font-size:14px">Review your queue</a>`,
		html.EscapeString(queueURL))
	if d.Replied+d.Meetings+d.Handled > 0 {
		fmt.Fprintf(&h,
			`<p style="color:#999;font-size:12px;margin-top:20px">So far: %d handled · %d replied · %d meetings booked.</p>`,
			d.Handled, d.Replied, d.Meetings)
		fmt.Fprintf(&t, "\nSo far: %d handled, %d replied, %d meetings booked.\n", d.Handled, d.Replied, d.Meetings)
	}
	h.WriteString(`</div>`)
	fmt.Fprintf(&t, "\nReview your queue: %s\n", queueURL)

	return subject, h.String(), t.String()
}
