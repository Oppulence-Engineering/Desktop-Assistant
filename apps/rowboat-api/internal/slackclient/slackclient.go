// Package slackclient is the minimal outbound Slack Web API client used by the
// durable agent runtime: it posts agent replies back into the originating Slack
// thread (RFC 027 channels — the CloudTag round-trip) and reads a thread's
// messages for Slack-native tools. The bot token stays server-held (sealed in
// OAuthConnection) and is passed per call; this package never reads, logs, or
// stores it.
package slackclient

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
)

// defaultBaseURL is the Slack Web API root.
const defaultBaseURL = "https://slack.com/api"

// Client calls the Slack Web API over the shared outbound policy (timeouts,
// retries, circuit breaker, response cap).
type Client struct {
	http    *outbound.Client
	baseURL string
}

// New builds a Slack Web API client. A zero Timeout is bumped to a sane default
// so a misconfigured policy can't hang a delivery activity indefinitely.
func New(policy outbound.Policy) *Client {
	policy.Name = "slack-api"
	if policy.Timeout == 0 {
		policy.Timeout = 15 * time.Second
	}
	return &Client{http: outbound.NewClient(policy), baseURL: defaultBaseURL}
}

// SetBaseURL overrides the API root (tests point this at an httptest server).
func (c *Client) SetBaseURL(u string) {
	if u != "" {
		c.baseURL = strings.TrimRight(u, "/")
	}
}

// Message is one Slack thread message (the fields tools care about).
type Message struct {
	User  string `json:"user"`
	BotID string `json:"bot_id"`
	Text  string `json:"text"`
	TS    string `json:"ts"`
}

// PostMessage posts text into channel, threaded under threadTS when non-empty.
// botToken (xoxb-…) authorizes the call. Slack returns HTTP 200 with
// {"ok":false,"error":"…"} on logical failures (e.g. missing_scope,
// not_in_channel), so a 200 is not success on its own — the body's ok flag is
// authoritative.
func (c *Client) PostMessage(ctx context.Context, botToken, channel, threadTS, text string) error {
	if botToken == "" {
		return fmt.Errorf("slackclient: missing bot token")
	}
	if channel == "" {
		return fmt.Errorf("slackclient: missing channel")
	}
	payload := map[string]any{"channel": channel, "text": text}
	if threadTS != "" {
		payload["thread_ts"] = threadTS
	}
	return c.postMessage(ctx, botToken, payload)
}

// PostApprovalRequest posts a Block Kit message with Approve/Deny buttons into
// the thread, for a human-in-the-loop approval (RFC 027 HITL surfaced in Slack).
// Each button carries the (approvalId, sessionId, userId, decision) the
// interactivity handler needs to resolve the gate; Slack echoes the value back
// signed, so the handler trusts it after verifying the request signature.
// initiatorSlackUser is the Slack user id of the requester; when non-empty the
// interactivity handler requires the clicker to match it (so only the person who
// made the request can approve it).
func (c *Client) PostApprovalRequest(ctx context.Context, botToken, channel, threadTS, headerText, approvalID, sessionID, userID, initiatorSlackUser string) error {
	mkValue := func(decision string) string {
		b, _ := json.Marshal(map[string]string{
			"approvalId": approvalID, "sessionId": sessionID, "userId": userID,
			"decision": decision, "slackUser": initiatorSlackUser,
		})
		return string(b)
	}
	blockID := approvalID
	if len(blockID) > 255 {
		blockID = blockID[:255]
	}
	payload := map[string]any{
		"channel": channel,
		"text":    headerText, // notification fallback
		"blocks": []any{
			map[string]any{"type": "section", "text": map[string]any{"type": "mrkdwn", "text": headerText}},
			map[string]any{"type": "actions", "block_id": blockID, "elements": []any{
				map[string]any{"type": "button", "action_id": ActionApprove, "style": "primary",
					"text": map[string]any{"type": "plain_text", "text": "Approve"}, "value": mkValue("granted")},
				map[string]any{"type": "button", "action_id": ActionDeny, "style": "danger",
					"text": map[string]any{"type": "plain_text", "text": "Deny"}, "value": mkValue("denied")},
			}},
		},
	}
	if threadTS != "" {
		payload["thread_ts"] = threadTS
	}
	return c.postMessage(ctx, botToken, payload)
}

// Action ids carried on the approval buttons; the interactivity handler matches
// on these.
const (
	ActionApprove = "agent_approve"
	ActionDeny    = "agent_deny"
)

// RespondURL posts to a Slack interaction response_url (a short-lived, unsigned
// callback URL) to update or replace the original interactive message. Best
// effort: failures are returned but callers typically log-and-continue.
func (c *Client) RespondURL(ctx context.Context, responseURL string, payload map[string]any) error {
	if responseURL == "" {
		return fmt.Errorf("slackclient: missing response_url")
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, responseURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("slackclient: response_url: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	_, _ = outbound.ReadAll(resp.Body, c.http.MaxResponseBytes())
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("slackclient: response_url status %d", resp.StatusCode)
	}
	return nil
}

// postMessage sends a chat.postMessage payload and enforces the ok-flag contract.
func (c *Client) postMessage(ctx context.Context, botToken string, payload map[string]any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/chat.postMessage", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	req.Header.Set("Authorization", "Bearer "+botToken)

	var sr struct {
		OK    bool   `json:"ok"`
		Error string `json:"error"`
	}
	if err := c.do(req, &sr); err != nil {
		return err
	}
	if !sr.OK {
		return fmt.Errorf("slackclient: chat.postMessage failed: %s", sr.Error)
	}
	return nil
}

// ReadThread returns the messages of a thread (conversations.replies), oldest
// first, capped at limit (default 50, max 200). Requires the channels:history
// scope and the bot being a member of the channel.
func (c *Client) ReadThread(ctx context.Context, botToken, channel, threadTS string, limit int) ([]Message, error) {
	if botToken == "" {
		return nil, fmt.Errorf("slackclient: missing bot token")
	}
	if channel == "" || threadTS == "" {
		return nil, fmt.Errorf("slackclient: missing channel or thread")
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	q := url.Values{}
	q.Set("channel", channel)
	q.Set("ts", threadTS)
	q.Set("limit", fmt.Sprintf("%d", limit))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/conversations.replies?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+botToken)

	var sr struct {
		OK       bool      `json:"ok"`
		Error    string    `json:"error"`
		Messages []Message `json:"messages"`
	}
	if err := c.do(req, &sr); err != nil {
		return nil, err
	}
	if !sr.OK {
		return nil, fmt.Errorf("slackclient: conversations.replies failed: %s", sr.Error)
	}
	return sr.Messages, nil
}

// do executes req, enforces the 200 + response-cap contract, and decodes the
// body into out.
func (c *Client) do(req *http.Request, out any) error {
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("slackclient: %s: %w", req.URL.Path, err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := outbound.ReadAll(resp.Body, c.http.MaxResponseBytes())
	if err != nil {
		return fmt.Errorf("slackclient: read response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("slackclient: unexpected status %d", resp.StatusCode)
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("slackclient: decode response: %w", err)
	}
	return nil
}

// ParseChannelKey splits the "slack:team:channel:thread" key written by the
// Slack channel adapter (agentchannels.SlackInbound). thread is a Slack message
// ts (e.g. "1700000000.000100") and contains no colon, so a 4-way split is exact.
func ParseChannelKey(key string) (team, channel, thread string, ok bool) {
	parts := strings.SplitN(key, ":", 4)
	if len(parts) != 4 || parts[0] != "slack" {
		return "", "", "", false
	}
	if parts[1] == "" || parts[2] == "" || parts[3] == "" {
		return "", "", "", false
	}
	return parts[1], parts[2], parts[3], true
}
