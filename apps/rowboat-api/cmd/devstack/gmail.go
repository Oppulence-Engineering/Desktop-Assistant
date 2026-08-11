package main

// Gmail API mock.
//
// The desktop app talks to Gmail through the googleapis client, which takes a
// rootUrl option; pointing that at devstack routes every call here. Without
// this, dogfooding mail sync, thread classification, and embedding generation
// meant signing in to a real Google account and syncing real mail — so the
// paths that matter most went untested locally, and the ones that mutate a
// mailbox (archive, mark-read, trash, send) were untestable at all.
//
// What this deliberately does NOT do is imitate Gmail faithfully. It serves a
// small fixed corpus and supports the exact query subset sync_gmail.ts sends
// (`after:`, `-in:spam`, `-in:trash`, and labelIds). Anything beyond that is
// rejected loudly rather than silently ignored, because a mock that quietly
// returns everything for a query it did not understand turns a broken filter
// into a passing test.

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	gmailMockUser  = "dogfood@devstack.local"
	gmailHistoryID = "1000"
)

// gmailStore holds the mutable mailbox. Label edits made through modify/trash
// are visible to subsequent reads, which is the whole point: it lets a
// dogfooding session verify that archiving a thread actually removes it from
// the next INBOX listing instead of just returning 200.
type gmailStore struct {
	mu      sync.Mutex
	threads []*gmailThread
	sent    int
}

type gmailThread struct {
	ID        string
	HistoryID string
	Messages  []*gmailMessage
}

type gmailMessage struct {
	ID       string
	From     string
	To       string
	Subject  string
	Date     time.Time
	Body     string
	LabelIDs []string
}

var gmail = newGmailStore()

func registerGmailMock(mux *http.ServeMux) {
	// Go 1.22 pattern routing. userId is always "me" in practice but is matched
	// as a wildcard so a caller passing the address instead is not a 404.
	mux.HandleFunc("GET /gmail/v1/users/{userId}/profile", gmailProfile)
	mux.HandleFunc("GET /gmail/v1/users/{userId}/threads", gmailThreadsList)
	mux.HandleFunc("GET /gmail/v1/users/{userId}/threads/{id}", gmailThreadsGet)
	mux.HandleFunc("POST /gmail/v1/users/{userId}/threads/{id}/modify", gmailThreadsModify)
	mux.HandleFunc("POST /gmail/v1/users/{userId}/threads/{id}/trash", gmailThreadsTrash)
	mux.HandleFunc("GET /gmail/v1/users/{userId}/history", gmailHistoryList)
	mux.HandleFunc("POST /gmail/v1/users/{userId}/messages/send", gmailMessagesSend)
	mux.HandleFunc("GET /gmail/v1/users/{userId}/drafts", gmailDraftsList)
	mux.HandleFunc("DELETE /gmail/v1/users/{userId}/drafts/{id}", gmailDraftsDelete)
}

// --- corpus ----------------------------------------------------------------

// The corpus is dated relative to process start so that sync's `after:` window
// always includes it. A fixed calendar date would have made mail sync silently
// return nothing once the date fell outside the default lookback.
//
// Everything sits inside the last ~24h for the same reason: the desktop's
// incremental sync only classifies threads inside that window, so older fixtures
// were listed but never classified, which reads exactly like a broken classifier.
func newGmailStore() *gmailStore {
	now := time.Now().UTC()
	ago := func(h int) time.Time { return now.Add(-time.Duration(h) * time.Hour) }

	seeds := []struct {
		id       string
		subject  string
		labels   []string
		messages []struct {
			from, body string
			hoursAgo   int
		}
	}{
		{
			id:      "t_renewal",
			subject: "Northwind renewal — pricing for the 40-seat tier",
			labels:  []string{"INBOX", "UNREAD", "IMPORTANT"},
			messages: []struct {
				from, body string
				hoursAgo   int
			}{
				{"Dana Whitfield <dana@northwind.example>", "Hi,\n\nOur team has grown to 38 people and we'll cross 40 seats before the March renewal. Can you send updated pricing for the 40-seat tier, and confirm whether the annual discount still applies if we upgrade mid-term?\n\nWe'd like to get this signed off before end of quarter.\n\nThanks,\nDana", 4},
				{"me <" + gmailMockUser + ">", "Dana,\n\nSending the updated sheet today. The annual discount carries over on a mid-term upgrade — we prorate the difference rather than restarting the term.\n\nBest", 2},
			},
		},
		{
			id:      "t_soc2",
			subject: "SOC 2 evidence request — access reviews",
			labels:  []string{"INBOX", "UNREAD"},
			messages: []struct {
				from, body string
				hoursAgo   int
			}{
				{"Priya Raman <priya@auditpartners.example>", "Good morning,\n\nFor the Type II window we still need quarterly access review records for the production database and the admin console. Screenshots with timestamps are fine.\n\nDeadline for the evidence package is the 28th.\n\nRegards,\nPriya", 10},
			},
		},
		{
			id:      "t_candidate",
			subject: "Re: Senior backend role — availability for a final round",
			labels:  []string{"INBOX"},
			messages: []struct {
				from, body string
				hoursAgo   int
			}{
				{"Marcus Bell <marcus.bell@example.com>", "Thanks for the quick turnaround on the take-home.\n\nI'm available Tuesday or Thursday afternoon next week for the final round. I'd also appreciate a sense of how the team splits on-call responsibilities.\n\nMarcus", 15},
			},
		},
		{
			id:      "t_incident",
			subject: "Postmortem: elevated 5xx on the ingest path",
			labels:  []string{"INBOX", "IMPORTANT"},
			messages: []struct {
				from, body string
				hoursAgo   int
			}{
				{"Sam Okafor <sam@internal.example>", "Draft postmortem attached inline below.\n\nTrigger: a deploy shipped a connection-pool size of 4 instead of 40. Ingest saturated within ninety seconds and returned 5xx for eleven minutes.\n\nAction items: pin pool size in config review, add a saturation alert at 70%, and stop letting deploys skip the staging soak.\n\nSam", 18},
			},
		},
		{
			id:      "t_newsletter",
			subject: "The Weekly Ledger — 5 charts on Q3 SaaS multiples",
			labels:  []string{"INBOX", "CATEGORY_PROMOTIONS"},
			messages: []struct {
				from, body string
				hoursAgo   int
			}{
				{"The Weekly Ledger <hello@weeklyledger.example>", "This week: multiples compressed again, but net revenue retention held above 110% for the top quartile.\n\nRead online. Unsubscribe at any time.", 8},
			},
		},
		{
			id:      "t_receipt",
			subject: "Your receipt from Cloudscale Hosting",
			labels:  []string{"INBOX", "CATEGORY_UPDATES"},
			messages: []struct {
				from, body string
				hoursAgo   int
			}{
				{"billing@cloudscale.example", "Receipt #48812\n\nAmount: $412.90\nPeriod: monthly compute and egress\n\nThis is an automated message; replies are not monitored.", 13},
			},
		},
		{
			id:      "t_archived",
			subject: "Offsite logistics — hotel block released",
			labels:  []string{}, // already archived: proves INBOX filtering works
			messages: []struct {
				from, body string
				hoursAgo   int
			}{
				{"Lena Fischer <lena@internal.example>", "The hotel block is released and everyone who booked got a confirmation. Nothing further needed here.\n\nLena", 21},
			},
		},
		{
			id:      "t_spam",
			subject: "URGENT: your domain listing expires today",
			labels:  []string{"SPAM"}, // must be skipped by the thread reader
			messages: []struct {
				from, body string
				hoursAgo   int
			}{
				{"notices@domain-registry-alerts.example", "Final notice regarding your domain listing. Remit payment immediately to avoid cancellation.", 5},
			},
		},
	}

	s := &gmailStore{}
	for _, seed := range seeds {
		th := &gmailThread{ID: seed.id, HistoryID: gmailHistoryID}
		for i, m := range seed.messages {
			labels := append([]string{}, seed.labels...)
			// Only the first message carries UNREAD, mirroring a thread where
			// the user has already replied to later messages.
			if i > 0 {
				labels = removeLabel(labels, "UNREAD")
			}
			th.Messages = append(th.Messages, &gmailMessage{
				ID:       fmt.Sprintf("%s_m%d", seed.id, i+1),
				From:     m.from,
				To:       gmailMockUser,
				Subject:  seed.subject,
				Date:     ago(m.hoursAgo),
				Body:     m.body,
				LabelIDs: labels,
			})
		}
		s.threads = append(s.threads, th)
	}
	return s
}

// --- handlers --------------------------------------------------------------

func gmailProfile(w http.ResponseWriter, _ *http.Request) {
	gmail.mu.Lock()
	total := 0
	for _, t := range gmail.threads {
		total += len(t.Messages)
	}
	gmail.mu.Unlock()
	writeJSON(w, map[string]any{
		"emailAddress":  gmailMockUser,
		"messagesTotal": total,
		"threadsTotal":  len(gmail.threads),
		"historyId":     gmailHistoryID,
	})
}

func gmailThreadsList(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	filter, err := parseGmailQuery(q.Get("q"))
	if err != nil {
		gmailError(w, http.StatusBadRequest, err.Error())
		return
	}
	wantLabels := q["labelIds"]

	maxResults := 100
	if raw := q.Get("maxResults"); raw != "" {
		if n, convErr := strconv.Atoi(raw); convErr == nil && n > 0 {
			maxResults = n
		}
	}

	gmail.mu.Lock()
	defer gmail.mu.Unlock()

	out := []map[string]any{}
	for _, t := range gmail.threads {
		if !filter.matches(t) || !threadHasAllLabels(t, wantLabels) {
			continue
		}
		out = append(out, map[string]any{
			"id":        t.ID,
			"historyId": t.HistoryID,
			"snippet":   snippet(t.Messages[0].Body),
		})
	}
	if len(out) > maxResults {
		out = out[:maxResults]
	}
	// No nextPageToken: the corpus is small enough to fit one page, and handing
	// back a token we cannot honour would loop the caller forever.
	writeJSON(w, map[string]any{"threads": out, "resultSizeEstimate": len(out)})
}

func gmailThreadsGet(w http.ResponseWriter, r *http.Request) {
	gmail.mu.Lock()
	defer gmail.mu.Unlock()

	t := findThread(r.PathValue("id"))
	if t == nil {
		gmailError(w, http.StatusNotFound, "Requested entity was not found.")
		return
	}
	msgs := make([]map[string]any, 0, len(t.Messages))
	for _, m := range t.Messages {
		msgs = append(msgs, gmailMessageJSON(t.ID, m))
	}
	writeJSON(w, map[string]any{
		"id":        t.ID,
		"historyId": t.HistoryID,
		"messages":  msgs,
	})
}

func gmailThreadsModify(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AddLabelIDs    []string `json:"addLabelIds"`
		RemoveLabelIDs []string `json:"removeLabelIds"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		gmailError(w, http.StatusBadRequest, "malformed request body")
		return
	}

	gmail.mu.Lock()
	defer gmail.mu.Unlock()

	t := findThread(r.PathValue("id"))
	if t == nil {
		gmailError(w, http.StatusNotFound, "Requested entity was not found.")
		return
	}
	for _, m := range t.Messages {
		for _, l := range body.RemoveLabelIDs {
			m.LabelIDs = removeLabel(m.LabelIDs, l)
		}
		for _, l := range body.AddLabelIDs {
			m.LabelIDs = addLabel(m.LabelIDs, l)
		}
	}
	log.Printf("gmail-mock: thread %s labels +%v -%v", t.ID, body.AddLabelIDs, body.RemoveLabelIDs)
	writeJSON(w, map[string]any{"id": t.ID, "historyId": t.HistoryID})
}

func gmailThreadsTrash(w http.ResponseWriter, r *http.Request) {
	gmail.mu.Lock()
	defer gmail.mu.Unlock()

	t := findThread(r.PathValue("id"))
	if t == nil {
		gmailError(w, http.StatusNotFound, "Requested entity was not found.")
		return
	}
	for _, m := range t.Messages {
		m.LabelIDs = addLabel(removeLabel(m.LabelIDs, "INBOX"), "TRASH")
	}
	log.Printf("gmail-mock: thread %s trashed", t.ID)
	writeJSON(w, map[string]any{"id": t.ID, "historyId": t.HistoryID})
}

// The corpus is static, so there is never incremental history to report. An
// empty history list with the current historyId is the honest answer and drives
// the caller down its "nothing changed" path rather than a full resync.
func gmailHistoryList(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, map[string]any{"historyId": gmailHistoryID})
}

func gmailMessagesSend(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Raw      string `json:"raw"`
		ThreadID string `json:"threadId"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)

	gmail.mu.Lock()
	gmail.sent++
	id := fmt.Sprintf("sent_%d", gmail.sent)
	gmail.mu.Unlock()

	// Decoded only to prove the caller produced a well-formed RFC 822 message;
	// the content is not stored, and it is never logged — outbound drafts are
	// the user's words.
	if decoded, err := base64.URLEncoding.WithPadding(base64.NoPadding).DecodeString(body.Raw); err != nil {
		log.Printf("gmail-mock: send rejected, raw is not base64url")
		gmailError(w, http.StatusBadRequest, "raw must be base64url-encoded")
		return
	} else if !strings.Contains(string(decoded), "To:") {
		log.Printf("gmail-mock: send rejected, no To: header")
		gmailError(w, http.StatusBadRequest, "message is missing a To header")
		return
	}

	threadID := body.ThreadID
	if threadID == "" {
		threadID = id
	}
	log.Printf("gmail-mock: send accepted (thread=%s bytes=%d)", threadID, len(body.Raw))
	writeJSON(w, map[string]any{"id": id, "threadId": threadID, "labelIds": []string{"SENT"}})
}

func gmailDraftsList(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, map[string]any{"drafts": []any{}, "resultSizeEstimate": 0})
}

func gmailDraftsDelete(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusNoContent)
}

// --- query parsing ---------------------------------------------------------

// gmailQuery is the subset of Gmail search the desktop actually sends.
type gmailQuery struct {
	after       time.Time
	excludeSpam bool
	excludeTrsh bool
}

// Unrecognised operators are an error, not a no-op. Gmail would apply them; a
// mock that drops them would return a superset and make a broken filter look
// like a working one.
func parseGmailQuery(raw string) (gmailQuery, error) {
	var q gmailQuery
	for _, term := range strings.Fields(raw) {
		switch {
		case strings.HasPrefix(term, "after:"):
			v := strings.TrimPrefix(term, "after:")
			// Gmail accepts YYYY/MM/DD and epoch seconds.
			if secs, err := strconv.ParseInt(v, 10, 64); err == nil {
				q.after = time.Unix(secs, 0).UTC()
				continue
			}
			t, err := time.Parse("2006/01/02", v)
			if err != nil {
				return q, fmt.Errorf("unsupported after: value %q", v)
			}
			q.after = t
		case term == "-in:spam":
			q.excludeSpam = true
		case term == "-in:trash":
			q.excludeTrsh = true
		default:
			return q, fmt.Errorf("devstack gmail mock does not implement query term %q", term)
		}
	}
	return q, nil
}

func (q gmailQuery) matches(t *gmailThread) bool {
	if q.excludeSpam && threadHasLabel(t, "SPAM") {
		return false
	}
	if q.excludeTrsh && threadHasLabel(t, "TRASH") {
		return false
	}
	if !q.after.IsZero() {
		newest := time.Time{}
		for _, m := range t.Messages {
			if m.Date.After(newest) {
				newest = m.Date
			}
		}
		if !newest.After(q.after) {
			return false
		}
	}
	return true
}

// --- helpers ---------------------------------------------------------------

func gmailMessageJSON(threadID string, m *gmailMessage) map[string]any {
	return map[string]any{
		"id":           m.ID,
		"threadId":     threadID,
		"labelIds":     m.LabelIDs,
		"snippet":      snippet(m.Body),
		"internalDate": strconv.FormatInt(m.Date.UnixMilli(), 10),
		"payload": map[string]any{
			"mimeType": "text/plain",
			"headers": []map[string]string{
				{"name": "From", "value": m.From},
				{"name": "To", "value": m.To},
				{"name": "Subject", "value": m.Subject},
				{"name": "Date", "value": m.Date.Format(time.RFC1123Z)},
				{"name": "Message-ID", "value": "<" + m.ID + "@devstack.local>"},
			},
			"body": map[string]any{
				"size": len(m.Body),
				"data": base64.URLEncoding.WithPadding(base64.NoPadding).EncodeToString([]byte(m.Body)),
			},
		},
	}
}

// Callers hold gmail.mu.
func findThread(id string) *gmailThread {
	for _, t := range gmail.threads {
		if t.ID == id {
			return t
		}
	}
	return nil
}

func threadHasLabel(t *gmailThread, label string) bool {
	for _, m := range t.Messages {
		for _, l := range m.LabelIDs {
			if l == label {
				return true
			}
		}
	}
	return false
}

func threadHasAllLabels(t *gmailThread, labels []string) bool {
	for _, want := range labels {
		if !threadHasLabel(t, want) {
			return false
		}
	}
	return true
}

func addLabel(labels []string, label string) []string {
	for _, l := range labels {
		if l == label {
			return labels
		}
	}
	return append(labels, label)
}

func removeLabel(labels []string, label string) []string {
	out := labels[:0:0]
	for _, l := range labels {
		if l != label {
			out = append(out, l)
		}
	}
	return out
}

func snippet(body string) string {
	s := strings.Join(strings.Fields(body), " ")
	if len(s) > 120 {
		s = s[:120]
	}
	return s
}

func gmailError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]any{"code": status, "message": message},
	})
}
