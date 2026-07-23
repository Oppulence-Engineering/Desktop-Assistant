package revenue

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/mail"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueaction"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueleakscan"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/googleapi"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/revenuemetrics"
)

// Scan bounds (RFC 030 WP3 historical boundary). All hard caps: a scan can
// finish early but never exceed them.
const (
	scanMaxThreads   = 100
	scanDeadline     = 2 * time.Minute
	scanMaxActions   = 25
	excerptMaxRunes  = 200
	defaultLookback  = 90
	scanQueryMaxDays = 365
)

// ThreadSweeper lists candidate threads from a mail source. GmailExecutor is
// the first implementation; tests substitute a fake.
type ThreadSweeper interface {
	// SweepThreads returns the metadata-only messages of up to maxThreads
	// recent threads plus the scanning user's own address (to classify
	// counterparties). Never bodies.
	SweepThreads(ctx context.Context, userID uuid.UUID, lookbackDays, maxThreads int) ([][]googleapi.GmailThreadMessage, string, error)
}

// SetSweeper installs the scan source (nil leaves scans unavailable).
func (s *Service) SetSweeper(sw ThreadSweeper) { s.sweeper = sw }

// ErrScanUnavailable means no scan source is configured or one is already
// running for the workspace.
var ErrScanUnavailable = errors.New("revenue: scan unavailable")

// StartScan creates the scan row and runs the bounded sweep in the
// background; GET /v1/revenue-leak-scans/{id} polls progress. One running
// scan per workspace at a time.
func (s *Service) StartScan(ctx context.Context, u *ent.User, lookbackDays int) (*ent.RevenueLeakScan, error) {
	if s.sweeper == nil {
		return nil, fmt.Errorf("%w: no scan source configured", ErrScanUnavailable)
	}
	if lookbackDays <= 0 {
		lookbackDays = defaultLookback
	}
	if lookbackDays > scanQueryMaxDays {
		lookbackDays = scanQueryMaxDays
	}
	ws, err := s.CurrentWorkspace(ctx, u)
	if err != nil {
		return nil, err
	}
	running, err := s.client.RevenueLeakScan.Query().
		Where(
			revenueleakscan.HasUserWith(user.IDEQ(u.ID)),
			revenueleakscan.StatusIn("pending", "running"),
		).
		Exist(ctx)
	if err != nil {
		return nil, err
	}
	if running {
		return nil, fmt.Errorf("%w: a scan is already running", ErrScanUnavailable)
	}
	scan, err := s.client.RevenueLeakScan.Create().
		SetWorkspace(ws).
		SetUser(u).
		SetStatus("running").
		SetMode(ws.Mode).
		SetLookbackDays(lookbackDays).
		SetStartedAt(s.now()).
		Save(ctx)
	if err != nil {
		return nil, err
	}
	// The request context dies with the response; the scan continues on a
	// detached context bounded by its own deadline. Restart loses at most one
	// scan run — reruns are cheap and dedupe by design.
	bg, cancel := context.WithTimeout(auth.WithUser(context.WithoutCancel(ctx), u), scanDeadline)
	go func() {
		defer cancel()
		s.runScan(bg, u, scan)
	}()
	return scan, nil
}

// GetScan returns one scan's progress.
func (s *Service) GetScan(ctx context.Context, id uuid.UUID) (*ent.RevenueLeakScan, error) {
	scan, err := s.client.RevenueLeakScan.Query().Where(revenueleakscan.IDEQ(id)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, ErrNotFound
	}
	return scan, err
}

// runScan performs the sweep, detection, and queue writes, then finalizes the
// scan row. Errors mark the scan failed; partial progress is kept (actions
// already written stay — they dedupe on rerun).
func (s *Service) runScan(ctx context.Context, u *ent.User, scan *ent.RevenueLeakScan) {
	start := s.now()
	stats, err := s.scanOnce(ctx, u, scan)
	elapsed := s.now().Sub(start).Seconds()
	revenuemetrics.ScanDuration.WithLabelValues(scan.Mode).Observe(elapsed)

	upd := s.client.RevenueLeakScan.UpdateOneID(scan.ID).
		SetThreadsSeen(stats.threads).
		SetCandidatesSeen(stats.candidates).
		SetRelationshipsCreated(stats.relationships).
		SetEvidencesCreated(stats.evidences).
		SetActionsCreated(stats.actions).
		SetCompletedAt(s.now())
	if stats.freshest != nil {
		upd.SetSourceFreshnessAt(*stats.freshest)
	}
	if err != nil {
		// Bounded error only: never a provider payload.
		msg := err.Error()
		if len(msg) > 500 {
			msg = msg[:500]
		}
		upd.SetStatus("failed").SetError(msg)
		revenuemetrics.Scans.WithLabelValues("failed", scan.Mode).Inc()
	} else {
		upd.SetStatus("completed")
		revenuemetrics.Scans.WithLabelValues("completed", scan.Mode).Inc()
	}
	if _, uerr := upd.Save(ctx); uerr != nil {
		s.log.Error("revenue: finalize scan", zap.Error(uerr))
	}
}

type scanStats struct {
	threads       int
	candidates    int
	relationships int
	evidences     int
	actions       int
	freshest      *time.Time
}

func (s *Service) scanOnce(ctx context.Context, u *ent.User, scan *ent.RevenueLeakScan) (scanStats, error) {
	var stats scanStats
	threads, selfEmail, err := s.sweeper.SweepThreads(ctx, u.ID, scan.LookbackDays, scanMaxThreads)
	if err != nil {
		return stats, err
	}
	now := s.now()
	for _, msgs := range threads {
		stats.threads++
		sum := summarizeThread(selfEmail, msgs)
		if sum == nil {
			continue
		}
		if stats.freshest == nil || sum.LastAt.After(*stats.freshest) {
			t := sum.LastAt
			stats.freshest = &t
		}
		hit := detectThread(sum, now)
		if hit == nil {
			revenuemetrics.DetectorCandidates.WithLabelValues("none", "skipped").Inc()
			continue
		}
		stats.candidates++
		revenuemetrics.DetectorCandidates.WithLabelValues(hit.Detector, "candidate").Inc()
		if stats.actions >= scanMaxActions {
			continue // count candidates past the cap, emit nothing more
		}
		created, madeRel, madeEv, err := s.materializeHit(ctx, u, sum, hit)
		if err != nil {
			s.log.Warn("revenue: materialize scan hit", zap.String("detector", hit.Detector), zap.Error(err))
			continue
		}
		if madeRel {
			stats.relationships++
		}
		if madeEv {
			stats.evidences++
		}
		if created {
			stats.actions++
		}
	}
	return stats, nil
}

// materializeHit writes relationship + evidence + queue action for one
// detector hit. Reruns dedupe: the relationship by primary email, the
// evidence by (source, record, hash), the action by its dedupe key.
func (s *Service) materializeHit(ctx context.Context, u *ent.User, sum *threadSummary, hit *detectorHit) (createdAction, createdRel, createdEv bool, err error) {
	ws, err := s.CurrentWorkspace(ctx, u)
	if err != nil {
		return false, false, false, err
	}

	rel, err := s.client.Relationship.Query().
		Where(
			relationship.HasUserWith(user.IDEQ(u.ID)),
			relationship.PrimaryEmailEQ(sum.Counterparty),
		).
		First(ctx)
	if ent.IsNotFound(err) {
		rel, err = s.client.Relationship.Create().
			SetWorkspace(ws).
			SetUser(u).
			SetKind("person").
			SetDisplayName(coalesce(sum.CounterpartyName, sum.Counterparty)).
			SetPrimaryEmail(sum.Counterparty).
			SetAccountDomain(domainOf(sum.Counterparty)).
			SetLastTouchAt(sum.LastAt).
			Save(ctx)
		createdRel = err == nil
	}
	if err != nil {
		return false, createdRel, false, err
	}

	anchorHash := sha256.Sum256([]byte(hit.Anchor.ID + ":" + hit.Anchor.Snippet))
	ev, err := s.client.RevenueEvidence.Create().
		SetWorkspace(ws).
		SetUser(u).
		SetSource("gmail").
		SetSourceRecordID(sum.ThreadID).
		SetContentHash("sha256:" + hex.EncodeToString(anchorHash[:])).
		SetExcerpt(truncateRunes(hit.Anchor.Snippet, excerptMaxRunes)).
		SetOccurredAt(hit.Anchor.At).
		SetObservedAt(s.now()).
		AddRelationships(rel).
		Save(ctx)
	switch {
	case err == nil:
		createdEv = true
	case ent.IsConstraintError(err):
		ev = nil // evidence already recorded on a prior run
	default:
		return false, createdRel, false, err
	}

	dedupeKey := hit.Detector + ":" + sum.ThreadID
	existed, err := s.client.RevenueAction.Query().
		Where(revenueaction.DedupeKeyEQ(dedupeKey)).
		Exist(ctx)
	if err != nil {
		return false, createdRel, createdEv, err
	}
	action, err := s.CreateAction(ctx, u, ActionInput{
		RelationshipID:  rel.ID,
		ActionType:      hit.ActionType,
		Channel:         "email",
		Detector:        hit.Detector,
		DedupeKey:       dedupeKey,
		Reason:          hit.Reason,
		RecipientEmail:  sum.Counterparty,
		ProposedSubject: replySubject(sum.Subject),
		ProposedMessage: hit.ProposedMessage,
		ExecutionMode:   ExecModeDraft,
		PriorityScore:   scoreOf(hit.Components),
		PriorityParts:   hit.Components,
	})
	if err != nil {
		return false, createdRel, createdEv, err
	}
	createdAction = !existed
	if ev != nil {
		// Best-effort evidence link; the action stands without it.
		_ = s.client.RevenueAction.UpdateOneID(action.ID).AddEvidences(ev).Exec(ctx)
	}
	return createdAction, createdRel, createdEv, nil
}

// --- deterministic detection -------------------------------------------------

// threadSummary is the derived per-thread shape detectors read.
type threadSummary struct {
	ThreadID         string
	Subject          string
	Counterparty     string // lowercased email
	CounterpartyName string
	LastAt           time.Time
	LastOutbound     bool
	OutboundCount    int
	InboundCount     int
	Messages         []googleapi.GmailThreadMessage
}

// detectorHit is one detector's evidence-backed proposal.
type detectorHit struct {
	Detector        string
	ActionType      string
	Reason          string
	ProposedMessage string
	Components      map[string]int
	Anchor          googleapi.GmailThreadMessage
}

var (
	proposalRe = regexp.MustCompile(`(?i)\b(proposal|quote|quotation|pricing|estimate|contract|sow|statement of work|invoice)\b`)
	followUpRe = regexp.MustCompile(`(?i)\b(follow up|follow-up|circle back|check back|touch base|reconnect|next (week|month|quarter))\b`)
	introRe    = regexp.MustCompile(`(?i)\b(intro|introduc|referr|connect(ing)? you|looping in|cc'?ing)\b`)
	askRe      = regexp.MustCompile(`(?i)(\?|can you|could you|would you|let me know|what do you think|any update|thoughts)`)
)

// summarizeThread derives the detector input for one thread. Returns nil for
// threads with no external counterparty (self-mail, no-reply noise).
func summarizeThread(selfEmail string, msgs []googleapi.GmailThreadMessage) *threadSummary {
	if len(msgs) == 0 {
		return nil
	}
	self := strings.ToLower(strings.TrimSpace(selfEmail))
	sum := &threadSummary{ThreadID: msgs[0].ThreadID, Messages: msgs}
	for _, m := range msgs {
		if m.At.After(sum.LastAt) {
			sum.LastAt = m.At
			sum.LastOutbound = m.Outbound
		}
		if sum.Subject == "" && m.Subject != "" {
			sum.Subject = m.Subject
		}
		var addr string
		if m.Outbound {
			sum.OutboundCount++
			addr = m.To
		} else {
			sum.InboundCount++
			addr = m.From
		}
		if sum.Counterparty == "" {
			if email, name := parseAddress(addr); email != "" && email != self && !isNoReply(email) {
				sum.Counterparty = email
				sum.CounterpartyName = name
			}
		}
	}
	if sum.Counterparty == "" || sum.LastAt.IsZero() {
		return nil
	}
	return sum
}

// detectThread runs the deterministic detectors in precedence order and
// returns at most one hit per thread (queue quality beats recall; RFC: the
// queue is the ten highest-priority actions, not every possible reminder).
// The LLM cannot bypass any rule here — there is no LLM in this path.
func detectThread(sum *threadSummary, now time.Time) *detectorHit {
	age := now.Sub(sum.LastAt)
	ageDays := int(age.Hours() / 24)
	text := sum.Subject + " " + lastSnippet(sum)

	// requested_follow_up_due: an explicit follow-up promise with nothing after it.
	if followUpRe.MatchString(text) && age >= 14*24*time.Hour {
		return &detectorHit{
			Detector:   "requested_follow_up_due",
			ActionType: "warm_follow_up",
			Reason: fmt.Sprintf("A follow-up was promised in this thread and nothing has happened for %d days (last touch %s).",
				ageDays, sum.LastAt.Format("Jan 2")),
			ProposedMessage: fmt.Sprintf("Hi %s — following up as promised on \"%s\". Is this still on your radar?", firstName(sum), sum.Subject),
			Components: map[string]int{
				"commitment_urgency": 30,
				"recency_signal":     recencyScore(ageDays, 14),
				"relationship_value": relationshipValue(sum),
				"evidence_quality":   15,
			},
			Anchor: lastMessage(sum),
		}
	}
	// unanswered_proposal: we sent something proposal-like and they never replied.
	if sum.LastOutbound && proposalRe.MatchString(text) && age >= 5*24*time.Hour {
		return &detectorHit{
			Detector:   "unanswered_proposal",
			ActionType: "proposal_nudge",
			Reason: fmt.Sprintf("You sent a proposal-stage message %d days ago and there has been no reply.",
				ageDays),
			ProposedMessage: fmt.Sprintf("Hi %s — checking in on \"%s\". Happy to answer any questions or adjust the scope.", firstName(sum), sum.Subject),
			Components: map[string]int{
				"commitment_urgency": 25,
				"recency_signal":     recencyScore(ageDays, 5),
				"relationship_value": relationshipValue(sum),
				"evidence_quality":   15,
			},
			Anchor: lastMessage(sum),
		}
	}
	// waiting_on_me: they wrote last with an ask and it has sat unanswered.
	if !sum.LastOutbound && askRe.MatchString(lastSnippet(sum)) && age >= 3*24*time.Hour {
		return &detectorHit{
			Detector:   "waiting_on_me",
			ActionType: "warm_follow_up",
			Reason: fmt.Sprintf("%s asked you something %d days ago and is still waiting on a reply.",
				coalesce(sum.CounterpartyName, sum.Counterparty), ageDays),
			ProposedMessage: fmt.Sprintf("Hi %s — sorry for the slow reply on \"%s\". ", firstName(sum), sum.Subject),
			Components: map[string]int{
				"commitment_urgency":  25,
				"recency_signal":      recencyScore(ageDays, 3),
				"relationship_value":  relationshipValue(sum),
				"evidence_quality":    10,
				"uncertainty_penalty": -5,
			},
			Anchor: lastMessage(sum),
		}
	}
	// neglected_referral: an introduction that was never followed through.
	if introRe.MatchString(text) && age >= 14*24*time.Hour {
		return &detectorHit{
			Detector:   "neglected_referral",
			ActionType: "referral_reconnect",
			Reason: fmt.Sprintf("An introduction in this thread has had no contact for %d days.",
				ageDays),
			ProposedMessage: fmt.Sprintf("Hi %s — picking this back up from the intro thread \"%s\". Would love to find time to connect.", firstName(sum), sum.Subject),
			Components: map[string]int{
				"commitment_urgency":  15,
				"recency_signal":      recencyScore(ageDays, 14),
				"relationship_value":  relationshipValue(sum),
				"evidence_quality":    10,
				"uncertainty_penalty": -5,
			},
			Anchor: lastMessage(sum),
		}
	}
	// dormant_warm_opportunity: a real two-way exchange that went quiet.
	if sum.OutboundCount >= 2 && sum.InboundCount >= 2 && age >= 30*24*time.Hour {
		return &detectorHit{
			Detector:   "dormant_warm_opportunity",
			ActionType: "warm_follow_up",
			Reason: fmt.Sprintf("A warm two-way conversation (%d messages) has been dormant for %d days.",
				sum.OutboundCount+sum.InboundCount, ageDays),
			ProposedMessage: fmt.Sprintf("Hi %s — it's been a while since \"%s\". Is this still something worth exploring?", firstName(sum), sum.Subject),
			Components: map[string]int{
				"commitment_urgency":  10,
				"recency_signal":      5,
				"relationship_value":  relationshipValue(sum),
				"evidence_quality":    10,
				"uncertainty_penalty": -10,
			},
			Anchor: lastMessage(sum),
		}
	}
	// former_customer_reconnect needs customer/CRM evidence (RFC): deferred
	// until a CRM connector is live — a keyword guess would violate the
	// deterministic-signal rule.
	return nil
}

// --- scoring and small helpers ----------------------------------------------

// recencyScore rewards items just past their threshold (act now) and decays
// as they go stale, bottoming at 2.
func recencyScore(ageDays, thresholdDays int) int {
	over := ageDays - thresholdDays
	switch {
	case over <= 7:
		return 20
	case over <= 21:
		return 12
	case over <= 60:
		return 6
	default:
		return 2
	}
}

// relationshipValue scores conversational depth: 5 per exchanged message,
// capped at 20.
func relationshipValue(sum *threadSummary) int {
	v := (sum.OutboundCount + sum.InboundCount) * 5
	if v > 20 {
		v = 20
	}
	return v
}

// scoreOf clamps the explainable component sum to the schema's 0-100.
func scoreOf(components map[string]int) int {
	total := 0
	for _, v := range components {
		total += v
	}
	if total < 0 {
		return 0
	}
	if total > 100 {
		return 100
	}
	return total
}

func lastMessage(sum *threadSummary) googleapi.GmailThreadMessage {
	last := sum.Messages[0]
	for _, m := range sum.Messages {
		if m.At.After(last.At) {
			last = m
		}
	}
	return last
}

func lastSnippet(sum *threadSummary) string { return lastMessage(sum).Snippet }

func parseAddress(header string) (email, name string) {
	addr, err := mail.ParseAddress(header)
	if err != nil {
		// Header may hold a bare list; take the first token that looks like
		// an address.
		for _, tok := range strings.FieldsFunc(header, func(r rune) bool { return r == ',' || r == ';' || r == ' ' }) {
			if strings.Contains(tok, "@") {
				return strings.ToLower(strings.Trim(tok, "<>")), ""
			}
		}
		return "", ""
	}
	return strings.ToLower(addr.Address), addr.Name
}

func isNoReply(email string) bool {
	local := email
	if i := strings.IndexByte(email, '@'); i > 0 {
		local = email[:i]
	}
	local = strings.ReplaceAll(strings.ReplaceAll(local, "-", ""), "_", "")
	return strings.Contains(local, "noreply") || strings.Contains(local, "donotreply") ||
		strings.HasPrefix(local, "notifications") || strings.HasPrefix(local, "mailer")
}

func domainOf(email string) string {
	if i := strings.IndexByte(email, '@'); i >= 0 && i+1 < len(email) {
		return email[i+1:]
	}
	return ""
}

func firstName(sum *threadSummary) string {
	if sum.CounterpartyName != "" {
		return strings.Fields(sum.CounterpartyName)[0]
	}
	if i := strings.IndexByte(sum.Counterparty, '@'); i > 0 {
		return sum.Counterparty[:i]
	}
	return "there"
}

func replySubject(subject string) string {
	if subject == "" {
		return "Following up"
	}
	if strings.HasPrefix(strings.ToLower(subject), "re:") {
		return subject
	}
	return "Re: " + subject
}

func coalesce(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

func truncateRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}
