package agentworkflow

import (
	"context"
	"fmt"
	"strings"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/oauthconnection"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/slackclient"
	"go.uber.org/zap"
)

// Channel-delivery activity registration names (RFC 027 channels — the CloudTag
// round-trip and the Slack-surfaced HITL approval).
const (
	ActivityDeliverChannelReply    = "rowboat.agent.deliver_channel_reply.v1"
	ActivityDeliverApprovalRequest = "rowboat.agent.deliver_approval_request.v1"
)

// DeliverChannelReplyInput carries one turn's final assistant message to post
// back into the session's originating channel.
type DeliverChannelReplyInput struct {
	UserID    string `json:"userId"`
	SessionID string `json:"sessionId"`
	Text      string `json:"text"`
}

// DeliverApprovalRequestInput carries one pending HITL approval to surface as
// Approve/Deny buttons in the session's originating channel.
type DeliverApprovalRequestInput struct {
	UserID       string `json:"userId"`
	SessionID    string `json:"sessionId"`
	ApprovalID   string `json:"approvalId"`
	Tool         string `json:"tool"`
	TrustTier    string `json:"trustTier"`
	ArgsPreview  string `json:"argsPreview"`
	InitiatorRef string `json:"initiatorRef"` // Slack user id allowed to approve
}

// DeliverChannelReply posts the turn's final assistant message back into the
// session's originating channel thread (RFC 027 channels — the CloudTag
// round-trip). Only Slack is wired today; other channels are a no-op. The
// workflow invokes this only for slack-channel sessions, so non-channel sessions
// (http/subagent/schedule) never add this activity to history (preserving
// replay). A delivery failure is returned so Temporal retries it, but the
// workflow ignores the result so a Slack outage never fails the turn.
func (a *Activities) DeliverChannelReply(ctx context.Context, in DeliverChannelReplyInput) error {
	ctx = auth.WithInternal(ctx)
	text := strings.TrimSpace(in.Text)
	if text == "" {
		return nil
	}
	botToken, channel, thread, ok, err := a.slackTarget(ctx, in.UserID, in.SessionID)
	if err != nil || !ok {
		return err
	}
	if err := a.Slack.PostMessage(ctx, botToken, channel, thread, text); err != nil {
		return fmt.Errorf("post slack reply: %w", err)
	}
	return nil
}

// DeliverApprovalRequest posts Approve/Deny buttons into the Slack thread for a
// pending HITL approval (RFC 027 P3 surfaced in Slack). Same guards and
// retry/ignore semantics as DeliverChannelReply: only slack-channel sessions
// reach here, and a delivery outage never fails the turn (the gate still resolves
// via the HTTP approval path).
func (a *Activities) DeliverApprovalRequest(ctx context.Context, in DeliverApprovalRequestInput) error {
	ctx = auth.WithInternal(ctx)
	botToken, channel, thread, ok, err := a.slackTarget(ctx, in.UserID, in.SessionID)
	if err != nil || !ok {
		return err
	}
	header := fmt.Sprintf("*Approval needed* — `%s` (%s)", in.Tool, in.TrustTier)
	if p := strings.TrimSpace(in.ArgsPreview); p != "" {
		header += "\n" + p
	}
	if err := a.Slack.PostApprovalRequest(ctx, botToken, channel, thread, header, in.ApprovalID, in.SessionID, in.UserID, in.InitiatorRef); err != nil {
		return fmt.Errorf("post slack approval request: %w", err)
	}
	return nil
}

// slackTarget resolves the bot token + (channel, thread) to deliver into for a
// session. ok=false means delivery is not applicable — a non-slack channel, the
// Slack client/sealer not configured, or an unparseable channel key — and the
// caller should skip silently. A non-nil err is a real failure (DB read /
// decryption) the caller returns so Temporal retries.
func (a *Activities) slackTarget(ctx context.Context, userID, sessionID string) (botToken, channel, thread string, ok bool, err error) {
	sess, owner, lerr := a.loadSessionAndUser(ctx, userID, sessionID)
	if lerr != nil {
		return "", "", "", false, lerr
	}
	if sess.Channel != "slack" {
		return "", "", "", false, nil
	}
	if a.Slack == nil || (a.Sealer == nil && a.SlackTokens == nil) {
		if a.Log != nil {
			a.Log.Warn("slack delivery skipped: not configured", zap.String("sessionId", sessionID))
		}
		return "", "", "", false, nil
	}
	team, ch, th, parsed := slackclient.ParseChannelKey(sess.ChannelKey)
	if !parsed {
		if a.Log != nil {
			a.Log.Warn("slack delivery skipped: unparseable channel key",
				zap.String("sessionId", sessionID), zap.String("channelKey", sess.ChannelKey))
		}
		return "", "", "", false, nil
	}
	if a.SlackTokens != nil {
		token, oerr := a.SlackTokens.ResolveTeam(ctx, owner.ID.String(), team)
		if oerr != nil {
			return "", "", "", false, fmt.Errorf("resolve slack bot token: %w", oerr)
		}
		return token, ch, th, true, nil
	}
	// The bot token is keyed by (provider=slack, team_id) and scoped to the
	// session owner — two users may connect the same workspace (non-unique
	// index), so the owner scope picks the right credential.
	conn, qerr := a.Client.OAuthConnection.Query().
		Where(
			oauthconnection.ProviderEQ("slack"),
			oauthconnection.ExternalAccountIDEQ(team),
			oauthconnection.HasUserWith(user.IDEQ(owner.ID)),
		).
		Only(ctx)
	if qerr != nil {
		return "", "", "", false, fmt.Errorf("resolve slack connection: %w", qerr)
	}
	token, oerr := a.Sealer.OpenString(conn.RefreshTokenEncrypted)
	if oerr != nil {
		return "", "", "", false, fmt.Errorf("open slack bot token: %w", oerr)
	}
	return token, ch, th, true, nil
}
