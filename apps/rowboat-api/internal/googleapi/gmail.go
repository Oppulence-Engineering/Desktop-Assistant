package googleapi

import (
	"context"
	"encoding/base64"
	"fmt"
	"mime"
	"net/mail"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// maxGmailMessages caps the messages.list → messages.get fan-out: each listed
// id costs one extra metadata GET, so one tool invoke is at most 1+N calls.
const maxGmailMessages = 10

// GmailMessage is the narrow read shape the runtime's connector tool returns
// (RFC 004 contract): headers + snippet, never raw bodies in v1.
type GmailMessage struct {
	ID         string   `json:"id"`
	ThreadID   string   `json:"threadId"`
	From       string   `json:"from"`
	To         string   `json:"to,omitempty"`
	Cc         string   `json:"cc,omitempty"`
	Subject    string   `json:"subject"`
	ReceivedAt string   `json:"receivedAt"`
	Snippet    string   `json:"snippet"`
	Labels     []string `json:"labels,omitempty"`
	Outbound   bool     `json:"outbound"`
}

// ListMessages searches the connected mailbox (Gmail query syntax) and
// returns up to limit message summaries (clamped to maxGmailMessages).
func (c *Client) ListMessages(ctx context.Context, token, query string, limit int) ([]GmailMessage, error) {
	if limit <= 0 || limit > maxGmailMessages {
		limit = maxGmailMessages
	}
	q := url.Values{}
	if query != "" {
		q.Set("q", query)
	}
	q.Set("maxResults", strconv.Itoa(limit))

	var list struct {
		Messages []struct {
			ID       string `json:"id"`
			ThreadID string `json:"threadId"`
		} `json:"messages"`
	}
	if err := c.GetJSON(ctx, token, c.cfg.GmailBaseURL+"/gmail/v1/users/me/messages", q, &list); err != nil {
		return nil, fmt.Errorf("gmail messages.list: %w", err)
	}

	out := make([]GmailMessage, 0, len(list.Messages))
	for _, m := range list.Messages {
		mq := url.Values{}
		mq.Set("format", "metadata")
		mq.Add("metadataHeaders", "From")
		mq.Add("metadataHeaders", "To")
		mq.Add("metadataHeaders", "Cc")
		mq.Add("metadataHeaders", "Subject")
		mq.Add("metadataHeaders", "Date")
		var detail struct {
			ID           string   `json:"id"`
			ThreadID     string   `json:"threadId"`
			Snippet      string   `json:"snippet"`
			LabelIDs     []string `json:"labelIds"`
			InternalDate string   `json:"internalDate"`
			Payload      struct {
				Headers []struct {
					Name  string `json:"name"`
					Value string `json:"value"`
				} `json:"headers"`
			} `json:"payload"`
		}
		if err := c.GetJSON(ctx, token, c.cfg.GmailBaseURL+"/gmail/v1/users/me/messages/"+url.PathEscape(m.ID), mq, &detail); err != nil {
			return nil, fmt.Errorf("gmail messages.get %s: %w", m.ID, err)
		}
		msg := GmailMessage{ID: detail.ID, ThreadID: detail.ThreadID, Snippet: detail.Snippet, Labels: detail.LabelIDs}
		for _, label := range detail.LabelIDs {
			if label == "SENT" {
				msg.Outbound = true
			}
		}
		if ms, err := strconv.ParseInt(detail.InternalDate, 10, 64); err == nil && ms > 0 {
			msg.ReceivedAt = time.UnixMilli(ms).UTC().Format(time.RFC3339)
		}
		for _, h := range detail.Payload.Headers {
			switch strings.ToLower(h.Name) {
			case "from":
				msg.From = h.Value
			case "to":
				msg.To = h.Value
			case "cc":
				msg.Cc = h.Value
			case "subject":
				msg.Subject = h.Value
			case "date":
				if msg.ReceivedAt == "" {
					msg.ReceivedAt = h.Value
				}
			}
		}
		out = append(out, msg)
	}
	return out, nil
}

// CreateDraft creates a Gmail draft (it does NOT send) addressed to `to` with the
// given subject and plain-text body, returning the draft id. The caller supplies
// a token carrying the gmail.compose scope. Header values are sanitized to
// prevent CRLF header injection.
func (c *Client) CreateDraft(ctx context.Context, token, to, subject, body string) (string, error) {
	return c.CreateDraftWithMessageID(ctx, token, to, subject, body, "")
}

// CreateDraftWithMessageID creates a draft carrying a deterministic RFC 822
// Message-ID. Gmail can later find that marker if the create response is lost.
func (c *Client) CreateDraftWithMessageID(ctx context.Context, token, to, subject, body, messageID string) (string, error) {
	if strings.TrimSpace(to) == "" {
		return "", fmt.Errorf("draft recipient is required")
	}
	msg := buildPlainTextMIMEWithMessageID(encodeAddressHeader(sanitizeHeader(to)), encodeWord(sanitizeHeader(subject)), body, messageID)
	raw := base64.URLEncoding.EncodeToString([]byte(msg))
	reqBody := map[string]any{"message": map[string]any{"raw": raw}}

	var out struct {
		ID      string `json:"id"`
		Message struct {
			ID string `json:"id"`
		} `json:"message"`
	}
	if err := c.PostJSON(ctx, token, c.cfg.GmailBaseURL+"/gmail/v1/users/me/drafts", reqBody, &out); err != nil {
		return "", fmt.Errorf("gmail drafts.create: %w", err)
	}
	return out.ID, nil
}

// SendMessage sends a plain-text Gmail message and returns the message id. The
// caller supplies a token carrying gmail.send or gmail.compose. Header values
// are sanitized to prevent CRLF header injection.
func (c *Client) SendMessage(ctx context.Context, token, to, subject, body string) (string, error) {
	return c.SendMessageWithMessageID(ctx, token, to, subject, body, "")
}

// SendMessageWithMessageID sends a message carrying a deterministic RFC 822
// Message-ID so an ambiguous result can be reconciled without resending it.
func (c *Client) SendMessageWithMessageID(ctx context.Context, token, to, subject, body, messageID string) (string, error) {
	if strings.TrimSpace(to) == "" {
		return "", fmt.Errorf("message recipient is required")
	}
	msg := buildPlainTextMIMEWithMessageID(encodeAddressHeader(sanitizeHeader(to)), encodeWord(sanitizeHeader(subject)), body, messageID)
	raw := base64.URLEncoding.EncodeToString([]byte(msg))
	reqBody := map[string]any{"raw": raw}

	var out struct {
		ID       string `json:"id"`
		ThreadID string `json:"threadId"`
	}
	if err := c.PostJSON(ctx, token, c.cfg.GmailBaseURL+"/gmail/v1/users/me/messages/send", reqBody, &out); err != nil {
		return "", fmt.Errorf("gmail messages.send: %w", err)
	}
	return out.ID, nil
}

func buildPlainTextMIMEWithMessageID(to, subject, body, messageID string) string {
	var b strings.Builder
	b.WriteString("To: " + to + "\r\n")
	b.WriteString("Subject: " + subject + "\r\n")
	if messageID = sanitizeHeader(strings.TrimSpace(messageID)); messageID != "" {
		b.WriteString("Message-ID: " + messageID + "\r\n")
	}
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString("Content-Type: text/plain; charset=\"UTF-8\"\r\n")
	b.WriteString("\r\n")
	b.WriteString(body)
	return b.String()
}

// FindMessageByRFC822MessageID searches every mailbox location, including
// Drafts and Sent, for the deterministic Message-ID used by an action write.
func (c *Client) FindMessageByRFC822MessageID(ctx context.Context, token, messageID string) (*GmailMessage, error) {
	messageID = strings.TrimSpace(messageID)
	if messageID == "" {
		return nil, fmt.Errorf("gmail reconciliation message id is required")
	}
	// Gmail documents rfc822msgid with the RFC 822 angle brackets intact.
	messages, err := c.ListMessages(ctx, token, "in:anywhere rfc822msgid:"+messageID, 2)
	if err != nil {
		return nil, err
	}
	if len(messages) == 0 {
		return nil, nil
	}
	return &messages[0], nil
}

// encodeWord RFC 2047-encodes a header value when it contains non-ASCII (a no-op
// for pure ASCII), so subjects with accents/emoji are not mangled.
func encodeWord(s string) string {
	return mime.QEncoding.Encode("utf-8", s)
}

// encodeAddressHeader encodes the display-name part of a "Name <addr>" header
// (leaving the address itself untouched). A bare address passes through, and an
// unparseable value is emitted as-is (already CRLF-sanitized).
func encodeAddressHeader(to string) string {
	addr, err := mail.ParseAddress(to)
	if err != nil {
		return to
	}
	if addr.Name == "" {
		return addr.Address
	}
	return encodeWord(addr.Name) + " <" + addr.Address + ">"
}

// sanitizeHeader strips CR/LF so a recipient/subject cannot inject extra headers.
func sanitizeHeader(s string) string {
	return strings.NewReplacer("\r", "", "\n", "").Replace(s)
}

// maxGmailThreads caps a thread sweep: one threads.list call plus at most this
// many threads.get calls per scan page (RFC 030 WP3 historical boundary).
const maxGmailThreads = 100

// GmailThreadMessage is the metadata-only per-message shape a thread sweep
// returns: headers and snippet, never bodies. Outbound reports whether the
// message carries the SENT label (the user wrote it).
type GmailThreadMessage struct {
	ID       string    `json:"id"`
	ThreadID string    `json:"threadId"`
	From     string    `json:"from"`
	To       string    `json:"to"`
	Subject  string    `json:"subject"`
	Snippet  string    `json:"snippet"`
	Outbound bool      `json:"outbound"`
	At       time.Time `json:"at"`
	// Labels is kept so that "this thread has no outbound message", on a sweep
	// anchored to in:sent, is diagnosable rather than a guess.
	Labels []string `json:"labels,omitempty"`
}

// ListThreadIDs searches the mailbox (Gmail query syntax) and returns up to
// max thread ids (clamped to maxGmailThreads). One API call.
func (c *Client) ListThreadIDs(ctx context.Context, token, query string, limit int) ([]string, error) {
	if limit <= 0 || limit > maxGmailThreads {
		limit = maxGmailThreads
	}
	q := url.Values{}
	if query != "" {
		q.Set("q", query)
	}
	q.Set("maxResults", strconv.Itoa(limit))
	var list struct {
		Threads []struct {
			ID string `json:"id"`
		} `json:"threads"`
	}
	if err := c.GetJSON(ctx, token, c.cfg.GmailBaseURL+"/gmail/v1/users/me/threads", q, &list); err != nil {
		return nil, fmt.Errorf("gmail threads.list: %w", err)
	}
	ids := make([]string, 0, len(list.Threads))
	for _, t := range list.Threads {
		ids = append(ids, t.ID)
	}
	return ids, nil
}

// GetThreadMessages returns the metadata-only messages of one thread in
// chronological order. One API call per thread.
func (c *Client) GetThreadMessages(ctx context.Context, token, threadID string) ([]GmailThreadMessage, error) {
	q := url.Values{}
	q.Set("format", "metadata")
	q.Add("metadataHeaders", "From")
	q.Add("metadataHeaders", "To")
	q.Add("metadataHeaders", "Subject")
	var thread struct {
		Messages []struct {
			ID           string   `json:"id"`
			ThreadID     string   `json:"threadId"`
			Snippet      string   `json:"snippet"`
			LabelIDs     []string `json:"labelIds"`
			InternalDate string   `json:"internalDate"`
			Payload      struct {
				Headers []struct {
					Name  string `json:"name"`
					Value string `json:"value"`
				} `json:"headers"`
			} `json:"payload"`
		} `json:"messages"`
	}
	if err := c.GetJSON(ctx, token, c.cfg.GmailBaseURL+"/gmail/v1/users/me/threads/"+url.PathEscape(threadID), q, &thread); err != nil {
		return nil, fmt.Errorf("gmail threads.get %s: %w", threadID, err)
	}
	out := make([]GmailThreadMessage, 0, len(thread.Messages))
	for _, m := range thread.Messages {
		msg := GmailThreadMessage{ID: m.ID, ThreadID: m.ThreadID, Snippet: m.Snippet, Labels: m.LabelIDs}
		for _, l := range m.LabelIDs {
			if l == "SENT" {
				msg.Outbound = true
			}
		}
		if ms, err := strconv.ParseInt(m.InternalDate, 10, 64); err == nil && ms > 0 {
			msg.At = time.UnixMilli(ms).UTC()
		}
		for _, h := range m.Payload.Headers {
			switch h.Name {
			case "From":
				msg.From = h.Value
			case "To":
				msg.To = h.Value
			case "Subject":
				msg.Subject = h.Value
			}
		}
		out = append(out, msg)
	}
	return out, nil
}

type GmailAttachment struct {
	ID       string `json:"id,omitempty"`
	Filename string `json:"filename"`
	MIMEType string `json:"mimeType,omitempty"`
	Size     int    `json:"size,omitempty"`
}

type GmailMessageContent struct {
	MessageID   string            `json:"messageId"`
	ThreadID    string            `json:"threadId"`
	From        string            `json:"from,omitempty"`
	To          string            `json:"to,omitempty"`
	Cc          string            `json:"cc,omitempty"`
	Subject     string            `json:"subject,omitempty"`
	ReceivedAt  string            `json:"receivedAt,omitempty"`
	Snippet     string            `json:"snippet,omitempty"`
	Labels      []string          `json:"labels,omitempty"`
	Outbound    bool              `json:"outbound"`
	Body        string            `json:"body"`
	Attachments []GmailAttachment `json:"attachments"`
}

// GetMessageContent fetches one message with format=full and returns its
// plain-text body plus attachment metadata. It never downloads attachment
// bytes or renders HTML. One API call.
func (c *Client) GetMessageContent(ctx context.Context, token, messageID string) (GmailMessageContent, error) {
	q := url.Values{}
	q.Set("format", "full")
	var msg struct {
		ID           string    `json:"id"`
		ThreadID     string    `json:"threadId"`
		Snippet      string    `json:"snippet"`
		LabelIDs     []string  `json:"labelIds"`
		InternalDate string    `json:"internalDate"`
		Payload      gmailPart `json:"payload"`
	}
	if err := c.GetJSON(ctx, token, c.cfg.GmailBaseURL+"/gmail/v1/users/me/messages/"+url.PathEscape(messageID), q, &msg); err != nil {
		return GmailMessageContent{}, fmt.Errorf("gmail messages.get content %s: %w", messageID, err)
	}
	content := GmailMessageContent{
		MessageID: msg.ID, ThreadID: msg.ThreadID, Snippet: msg.Snippet, Labels: msg.LabelIDs,
		Body: extractPlainText(&msg.Payload), Attachments: []GmailAttachment{},
	}
	for _, label := range msg.LabelIDs {
		if label == "SENT" {
			content.Outbound = true
		}
	}
	if ms, err := strconv.ParseInt(msg.InternalDate, 10, 64); err == nil && ms > 0 {
		content.ReceivedAt = time.UnixMilli(ms).UTC().Format(time.RFC3339)
	}
	for _, header := range msg.Payload.Headers {
		switch strings.ToLower(header.Name) {
		case "from":
			content.From = header.Value
		case "to":
			content.To = header.Value
		case "cc":
			content.Cc = header.Value
		case "subject":
			content.Subject = header.Value
		case "date":
			if content.ReceivedAt == "" {
				content.ReceivedAt = header.Value
			}
		}
	}
	collectAttachments(&msg.Payload, &content.Attachments)
	return content, nil
}

// GetMessageBody preserves the ingestion path's body-only contract.
func (c *Client) GetMessageBody(ctx context.Context, token, messageID string) (string, error) {
	content, err := c.GetMessageContent(ctx, token, messageID)
	return content.Body, err
}

type gmailPart struct {
	Filename string      `json:"filename"`
	MimeType string      `json:"mimeType"`
	Body     gmailBody   `json:"body"`
	Parts    []gmailPart `json:"parts"`
	Headers  []struct {
		Name  string `json:"name"`
		Value string `json:"value"`
	} `json:"headers"`
}

type gmailBody struct {
	AttachmentID string `json:"attachmentId"`
	Data         string `json:"data"`
	Size         int    `json:"size"`
}

func collectAttachments(part *gmailPart, out *[]GmailAttachment) {
	if part == nil {
		return
	}
	if part.Filename != "" {
		*out = append(*out, GmailAttachment{ID: part.Body.AttachmentID, Filename: part.Filename, MIMEType: part.MimeType, Size: part.Body.Size})
	}
	for i := range part.Parts {
		collectAttachments(&part.Parts[i], out)
	}
}

// extractPlainText returns the first text/plain body found in the MIME tree,
// decoding Gmail's URL-safe base64.
func extractPlainText(p *gmailPart) string {
	if p == nil {
		return ""
	}
	if strings.HasPrefix(p.MimeType, "text/plain") && p.Body.Data != "" {
		if decoded, err := base64.URLEncoding.DecodeString(p.Body.Data); err == nil {
			return string(decoded)
		}
	}
	for i := range p.Parts {
		if s := extractPlainText(&p.Parts[i]); s != "" {
			return s
		}
	}
	// Fall back to a bare body on a leaf with no explicit text/plain part.
	if len(p.Parts) == 0 && p.Body.Data != "" && !strings.HasPrefix(p.MimeType, "text/html") {
		if decoded, err := base64.URLEncoding.DecodeString(p.Body.Data); err == nil {
			return string(decoded)
		}
	}
	return ""
}

// ErrHistoryGap means the startHistoryId is older than Gmail retains (a 404):
// the caller must fall back to a full re-sync rather than an incremental walk.
var ErrHistoryGap = fmt.Errorf("gmail: history id too old; full re-sync required")

// maxHistoryPages bounds the history.list pagination per push (one busy
// mailbox update is a handful of pages at most).
const maxHistoryPages = 10

// ListHistory walks users.history.list from startHistoryID and returns the
// unique thread ids touched by added messages, plus the mailbox's latest
// historyId. A 404 (cursor too old) surfaces as ErrHistoryGap. Metadata only —
// no bodies are fetched here.
func (c *Client) ListHistory(ctx context.Context, token, startHistoryID string) (threadIDs []string, latestHistoryID string, err error) {
	seen := map[string]struct{}{}
	pageToken := ""
	for page := 0; page < maxHistoryPages; page++ {
		q := url.Values{}
		q.Set("startHistoryId", startHistoryID)
		q.Add("historyTypes", "messageAdded")
		if pageToken != "" {
			q.Set("pageToken", pageToken)
		}
		var resp struct {
			History []struct {
				MessagesAdded []struct {
					Message struct {
						ID       string `json:"id"`
						ThreadID string `json:"threadId"`
					} `json:"message"`
				} `json:"messagesAdded"`
			} `json:"history"`
			HistoryID     string `json:"historyId"`
			NextPageToken string `json:"nextPageToken"`
		}
		if err := c.GetJSON(ctx, token, c.cfg.GmailBaseURL+"/gmail/v1/users/me/history", q, &resp); err != nil {
			if isNotFound(err) {
				return nil, "", ErrHistoryGap
			}
			return nil, "", fmt.Errorf("gmail history.list: %w", err)
		}
		if resp.HistoryID != "" {
			latestHistoryID = resp.HistoryID
		}
		for _, h := range resp.History {
			for _, m := range h.MessagesAdded {
				tid := m.Message.ThreadID
				if tid == "" {
					continue
				}
				if _, ok := seen[tid]; !ok {
					seen[tid] = struct{}{}
					threadIDs = append(threadIDs, tid)
				}
			}
		}
		if resp.NextPageToken == "" {
			break
		}
		pageToken = resp.NextPageToken
	}
	return threadIDs, latestHistoryID, nil
}

// isNotFound reports whether err is a googleapi status error with code 404
// (doJSON formats these as "... returned 404").
func isNotFound(err error) bool {
	return err != nil && strings.Contains(err.Error(), "returned 404")
}
