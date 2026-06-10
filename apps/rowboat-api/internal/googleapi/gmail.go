package googleapi

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
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
