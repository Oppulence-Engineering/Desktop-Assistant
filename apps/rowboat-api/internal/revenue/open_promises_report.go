package revenue

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
)

// The Open Promises report is the wedge (one-pager §11).
//
// Rather than demo the product, connect a prospect's sources and hand them a
// document that says: here are the commitments your team made in the last 90
// days that have no evidence of fulfilment, and here is the exact message that
// created each one.
//
// The artifact sells itself and it is also the onboarding, so the sale and the
// activation are one motion. That is why this lives next to the scan rather
// than in a reporting package.

// ReportItem is one open promise, with the message that created it.
type ReportItem struct {
	CommitmentID string     `json:"commitmentId"`
	Account      string     `json:"account"`
	Direction    string     `json:"direction"`
	Text         string     `json:"text"`
	State        string     `json:"state"`
	DueAt        *time.Time `json:"dueAt,omitempty"`
	DuePhrase    string     `json:"duePhrase,omitempty"`
	Owner        string     `json:"owner,omitempty"`
	SourceQuote  string     `json:"sourceQuote,omitempty"`
	SourceURI    string     `json:"sourceUri,omitempty"`
	OccurredAt   *time.Time `json:"occurredAt,omitempty"`
}

// OpenPromisesReport is what a prospect reads on their first day.
type OpenPromisesReport struct {
	GeneratedAt   time.Time      `json:"generatedAt"`
	LookbackDays  int            `json:"lookbackDays"`
	ThreadsSeen   int            `json:"threadsSeen"`
	ScanStatus    string         `json:"scanStatus"`
	OutboundCount int            `json:"outboundCount"`
	InboundCount  int            `json:"inboundCount"`
	ByAccount     map[string]int `json:"byAccount"`
	Items         []ReportItem   `json:"items"`
	Truncated     bool           `json:"truncated"`
}

// OpenPromisesReport builds the report for one completed scan.
func (s *Service) OpenPromisesReport(
	ctx context.Context,
	u *ent.User,
	scanID uuid.UUID,
) (*OpenPromisesReport, error) {
	scan, err := s.GetScan(ctx, scanID)
	if err != nil {
		return nil, err
	}
	// The scan writes candidates, because nothing a model extracted is a
	// commitment until a human confirms it. The report IS that review surface,
	// so unlike the register it deliberately shows candidates.
	since := scan.CreatedAt.UTC().AddDate(0, 0, -scan.LookbackDays)
	filter := CommitmentFilter{
		States:            []string{RegisterOpen, RegisterAtRisk},
		IncludeCandidates: true,
		EvidenceSince:     since,
		Limit:             200,
	}
	rows, err := s.ListCommitments(ctx, u, filter)
	if err != nil {
		return nil, err
	}
	filter.Offset = len(rows)
	filter.Limit = 1
	more, err := s.ListCommitments(ctx, u, filter)
	if err != nil {
		return nil, err
	}
	now := s.now().UTC()
	report := &OpenPromisesReport{
		GeneratedAt:  now,
		LookbackDays: scan.LookbackDays,
		ThreadsSeen:  scan.ThreadsSeen,
		ScanStatus:   scan.Status,
		ByAccount:    map[string]int{},
		Items:        []ReportItem{},
		Truncated:    len(more) > 0,
	}
	for _, row := range rows {
		item := ReportItem{
			CommitmentID: row.ID.String(),
			Direction:    row.Direction,
			Text:         row.Text,
			State:        commitmentRegisterState(row, now),
			DueAt:        row.DueAt,
			DuePhrase:    row.DuePhrase,
			Owner:        row.OwnerParticipantRef,
			SourceQuote:  row.SourcePhrase,
		}
		if rel, relErr := row.Edges.RelationshipOrErr(); relErr == nil && rel != nil {
			item.Account = rel.DisplayName
		}
		if item.Account == "" {
			item.Account = "Unattributed"
		}
		if evidences, evidenceErr := row.Edges.EvidencesOrErr(); evidenceErr == nil && len(evidences) > 0 {
			evidence := evidences[0]
			item.SourceQuote = evidence.Excerpt
			item.SourceURI = evidence.SourceURI
			item.OccurredAt = &evidence.OccurredAt
		}
		report.ByAccount[item.Account]++
		if row.Direction == "promised_by_them" {
			report.InboundCount++
		} else {
			report.OutboundCount++
		}
		report.Items = append(report.Items, item)
	}
	// At-risk first, then soonest due. The first screen must show the thing
	// most likely to cost the reader something.
	sort.SliceStable(report.Items, func(i, j int) bool {
		a, b := report.Items[i], report.Items[j]
		if (a.State == RegisterAtRisk) != (b.State == RegisterAtRisk) {
			return a.State == RegisterAtRisk
		}
		switch {
		case a.DueAt != nil && b.DueAt != nil:
			return a.DueAt.Before(*b.DueAt)
		case a.DueAt != nil:
			return true
		case b.DueAt != nil:
			return false
		}
		return a.Account < b.Account
	})
	return report, nil
}

// Markdown renders the report as the document handed to a prospect.
func (r *OpenPromisesReport) Markdown() string {
	var b strings.Builder
	b.WriteString("# Open promises\n\n")
	fmt.Fprintf(&b, "Commitments found in the last %d days with no evidence of fulfilment.\n\n",
		r.LookbackDays)
	fmt.Fprintf(&b, "- **%d** promises we made\n", r.OutboundCount)
	fmt.Fprintf(&b, "- **%d** promises made to us\n", r.InboundCount)
	fmt.Fprintf(&b, "- **%d** conversations read\n\n", r.ThreadsSeen)
	if r.Truncated {
		b.WriteString("This report shows the first 200 open promises. Open the register for the complete ledger.\n\n")
	}

	if len(r.Items) == 0 {
		b.WriteString("No open promises were found in this window. ")
		b.WriteString("That is either good news or a sign the sources are not connected yet.\n")
		return b.String()
	}

	accounts := make([]string, 0, len(r.ByAccount))
	for account := range r.ByAccount {
		accounts = append(accounts, account)
	}
	sort.Strings(accounts)
	b.WriteString("| Account | Open promises |\n|---|---|\n")
	for _, account := range accounts {
		fmt.Fprintf(&b, "| %s | %d |\n", account, r.ByAccount[account])
	}
	b.WriteString("\n## The promises\n\n")

	for _, item := range r.Items {
		owed := "We owe"
		if item.Direction == "promised_by_them" {
			owed = "They owe"
		}
		fmt.Fprintf(&b, "### %s — %s\n\n", item.Account, item.Text)
		fmt.Fprintf(&b, "%s · state **%s**", owed, registerStateLabel(item.State))
		switch {
		case item.DueAt != nil:
			fmt.Fprintf(&b, " · due %s", item.DueAt.UTC().Format("2006-01-02"))
		case item.DuePhrase != "":
			fmt.Fprintf(&b, " · due %q as stated", item.DuePhrase)
		default:
			fmt.Fprintf(&b, " · due unspecified")
		}
		if item.Owner != "" {
			fmt.Fprintf(&b, " · owner %s", item.Owner)
		}
		b.WriteString("\n\n")
		// Every claim carries its citation, or it is not made.
		if quote := strings.TrimSpace(item.SourceQuote); quote != "" {
			fmt.Fprintf(&b, "> %s\n\n", strings.ReplaceAll(quote, "\n", "\n> "))
		}
		if item.OccurredAt != nil {
			fmt.Fprintf(&b, "Source observed %s", item.OccurredAt.UTC().Format(time.RFC3339))
			if item.SourceURI != "" {
				fmt.Fprintf(&b, " · %s", item.SourceURI)
			}
			b.WriteString("\n\n")
		}
	}
	fmt.Fprintf(&b, "\n---\n\nGenerated %s. Every promise above includes the source evidence available at scan time.\n",
		r.GeneratedAt.Format(time.RFC3339))
	return b.String()
}
