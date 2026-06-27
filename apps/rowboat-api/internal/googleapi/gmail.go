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
)

// maxGmailMessages caps the messages.list → messages.get fan-out: each listed
// id costs one extra metadata GET, so one tool invoke is at most 1+N calls.
const maxGmailMessages = 10

// GmailMessage is the narrow read shape the runtime's connector tool returns
// (RFC 004 contract): headers + snippet, never raw bodies in v1.
type GmailMessage struct {
	ID         string `json:"id"`
	ThreadID   string `json:"threadId"`
	From       string `json:"from"`
	Subject    string `json:"subject"`
	ReceivedAt string `json:"receivedAt"`
	Snippet    string `json:"snippet"`
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
		mq.Add("metadataHeaders", "Subject")
		mq.Add("metadataHeaders", "Date")
		var detail struct {
			ID       string `json:"id"`
			ThreadID string `json:"threadId"`
			Snippet  string `json:"snippet"`
			Payload  struct {
				Headers []struct {
					Name  string `json:"name"`
					Value string `json:"value"`
				} `json:"headers"`
			} `json:"payload"`
		}
		if err := c.GetJSON(ctx, token, c.cfg.GmailBaseURL+"/gmail/v1/users/me/messages/"+url.PathEscape(m.ID), mq, &detail); err != nil {
			return nil, fmt.Errorf("gmail messages.get %s: %w", m.ID, err)
		}
		msg := GmailMessage{ID: detail.ID, ThreadID: detail.ThreadID, Snippet: detail.Snippet}
		for _, h := range detail.Payload.Headers {
			switch h.Name {
			case "From":
				msg.From = h.Value
			case "Subject":
				msg.Subject = h.Value
			case "Date":
				msg.ReceivedAt = h.Value
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
	if strings.TrimSpace(to) == "" {
		return "", fmt.Errorf("draft recipient is required")
	}
	msg := buildPlainTextMIME(encodeAddressHeader(sanitizeHeader(to)), encodeWord(sanitizeHeader(subject)), body)
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
	if strings.TrimSpace(to) == "" {
		return "", fmt.Errorf("message recipient is required")
	}
	msg := buildPlainTextMIME(encodeAddressHeader(sanitizeHeader(to)), encodeWord(sanitizeHeader(subject)), body)
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

// buildPlainTextMIME assembles a minimal RFC 822 plain-text message.
func buildPlainTextMIME(to, subject, body string) string {
	var b strings.Builder
	b.WriteString("To: " + to + "\r\n")
	b.WriteString("Subject: " + subject + "\r\n")
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString("Content-Type: text/plain; charset=\"UTF-8\"\r\n")
	b.WriteString("\r\n")
	b.WriteString(body)
	return b.String()
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
