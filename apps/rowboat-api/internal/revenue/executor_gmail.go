package revenue

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"net"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/oauthconnection"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/googleapi"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/hubspotapi"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
)

// Gmail OAuth scopes (mirrors backgroundtaskruntime's connector tools).
const (
	scopeGmailReadonly = "https://www.googleapis.com/auth/gmail.readonly"
	scopeGmailCompose  = "https://www.googleapis.com/auth/gmail.compose"
	scopeGmailSend     = "https://www.googleapis.com/auth/gmail.send"
)

// GmailExecutor performs email-channel revenue actions through the executing
// user's own connected Gmail account (RFC 030 execution flow, WP4). Draft
// mode creates a Gmail draft in the operator's mailbox and never sends; send
// mode sends the message. Credentials are resolved server-side for exactly
// the assigned user — the executor never accepts a token from the caller.
type GmailExecutor struct {
	client  *ent.Client
	sealer  *crypto.Sealer
	secrets *secrets.Store
	google  *googleapi.Client
}

// NewGmailExecutor builds the Gmail execution backend.
func NewGmailExecutor(client *ent.Client, sealer *crypto.Sealer, sec *secrets.Store, google *googleapi.Client) *GmailExecutor {
	return &GmailExecutor{client: client, sealer: sealer, secrets: sec, google: google}
}

// Execute performs one approved action revision. Failures before submission
// are plain errors (safe to retry after fixing the cause); only failures
// where the message may have reached Google are classified ErrAmbiguous
// (invariant 8: never auto-resend, reconcile by provider state first).
func (e *GmailExecutor) Execute(ctx context.Context, req ExecRequest) (*ExecResult, error) {
	action := req.Action
	if action.Channel != "email" {
		return nil, fmt.Errorf("revenue: no execution backend for channel %q", action.Channel)
	}
	to := strings.TrimSpace(action.RecipientEmail)
	if to == "" {
		return nil, errors.New("revenue: action has no recipient email")
	}
	if strings.TrimSpace(action.ProposedMessage) == "" {
		return nil, errors.New("revenue: action has no proposed message")
	}

	requiredScope := scopeGmailCompose
	if req.Mode == ExecModeSend {
		requiredScope = scopeGmailSend
	}
	token, err := e.accessToken(ctx, req, requiredScope)
	if err != nil {
		// Token resolution happens before anything reaches Gmail: always a
		// definite failure, never ambiguous.
		return nil, err
	}

	if req.Mode == ExecModeSend {
		id, err := e.google.SendMessageWithMessageID(ctx, token, to, action.ProposedSubject, action.ProposedMessage, gmailActionMessageID(req.IdempotencyKey))
		if err != nil {
			return nil, classifySubmitError(err)
		}
		return &ExecResult{ProviderMessageID: id}, nil
	}
	id, err := e.google.CreateDraftWithMessageID(ctx, token, to, action.ProposedSubject, action.ProposedMessage, gmailActionMessageID(req.IdempotencyKey))
	if err != nil {
		return nil, classifySubmitError(err)
	}
	return &ExecResult{ProviderMessageID: id}, nil
}

// Reconcile searches Gmail by the deterministic RFC 822 Message-ID embedded
// in the one permitted write. It does not call drafts.create or messages.send.
func (e *GmailExecutor) Reconcile(ctx context.Context, req ExecRequest) (*ExecResult, bool, error) {
	_, token, err := e.connection(ctx, req.UserID, scopeGmailReadonly)
	if err != nil {
		return nil, false, err
	}
	message, err := e.google.FindMessageByRFC822MessageID(ctx, token, gmailActionMessageID(req.IdempotencyKey))
	if err != nil {
		return nil, false, err
	}
	if message == nil {
		return nil, false, nil
	}
	return &ExecResult{ProviderMessageID: message.ID, ProviderThreadID: message.ThreadID}, true, nil
}

func gmailActionMessageID(idempotencyKey string) string {
	sum := sha256.Sum256([]byte(idempotencyKey))
	return fmt.Sprintf("<oppulence-%x@actions.oppulence.ai>", sum[:16])
}

// SweepThreads implements ThreadSweeper for the revenue leak scan (RFC 030
// WP3): one threads.list plus one metadata-only threads.get per thread,
// scoped to the scanning user's own mailbox with the read-only scope. The
// second return value is the user's own address for counterparty
// classification.
func (e *GmailExecutor) SweepThreads(ctx context.Context, userID uuid.UUID, lookbackDays, maxThreads int, since *time.Time) ([][]googleapi.GmailThreadMessage, string, error) {
	conn, token, err := e.connection(ctx, userID, scopeGmailReadonly)
	if err != nil {
		return nil, "", err
	}
	// Sent-anchored query: every revenue-relevant thread has at least one
	// outbound message, and it keeps newsletter/notification noise out.
	// With a cursor, bound the lower edge by the last freshness timestamp
	// (Gmail's after: is second-granularity) so a recurring scan only reads
	// new mail; the first scan uses the full lookback window.
	var query string
	if since != nil {
		query = fmt.Sprintf("in:sent after:%d", since.Unix())
	} else {
		query = fmt.Sprintf("in:sent newer_than:%dd", lookbackDays)
	}
	ids, err := e.google.ListThreadIDs(ctx, token, query, maxThreads)
	if err != nil {
		return nil, "", fmt.Errorf("revenue: gmail thread sweep: %w", err)
	}
	threads := make([][]googleapi.GmailThreadMessage, 0, len(ids))
	for _, id := range ids {
		msgs, err := e.google.GetThreadMessages(ctx, token, id)
		if err != nil {
			// One unreadable thread must not abort the sweep.
			continue
		}
		threads = append(threads, msgs)
	}
	return threads, conn.ExternalAccountID, nil
}

// FetchBody implements MailBodyFetcher (RFC 031 Layer 3): the plain-text body
// of one message, read with the user's read-only Gmail scope.
func (e *GmailExecutor) FetchBody(ctx context.Context, userID uuid.UUID, messageID string) (string, error) {
	_, token, err := e.connection(ctx, userID, scopeGmailReadonly)
	if err != nil {
		return "", err
	}
	return e.google.GetMessageBody(ctx, token, messageID)
}

// SyncHistory implements MailSyncer (RFC 031 Layer-1 push sync): from a stored
// history cursor, list the touched threads via the Gmail History API and fetch
// each thread's metadata. Returns the threads, the user's own address, and the
// mailbox's latest history id. googleapi.ErrHistoryGap surfaces a stale cursor.
func (e *GmailExecutor) SyncHistory(ctx context.Context, userID uuid.UUID, startHistoryID string) (threads [][]googleapi.GmailThreadMessage, selfEmail, latestHistoryID string, err error) {
	conn, token, cerr := e.connection(ctx, userID, scopeGmailReadonly)
	if cerr != nil {
		return nil, "", "", cerr
	}
	threadIDs, latest, herr := e.google.ListHistory(ctx, token, startHistoryID)
	if herr != nil {
		return nil, conn.ExternalAccountID, "", herr
	}
	out := make([][]googleapi.GmailThreadMessage, 0, len(threadIDs))
	for _, id := range threadIDs {
		msgs, terr := e.google.GetThreadMessages(ctx, token, id)
		if terr != nil {
			continue // one unreadable thread must not abort the sync
		}
		out = append(out, msgs)
	}
	return out, conn.ExternalAccountID, latest, nil
}

// accessToken resolves the assigned user's Google credential, enforcing
// invariant 11 at the credential layer: the sender connection is looked up
// for exactly req.UserID, never substituted.
func (e *GmailExecutor) accessToken(ctx context.Context, req ExecRequest, requiredScope string) (string, error) {
	_, token, err := e.connection(ctx, req.UserID, requiredScope)
	return token, err
}

// connection loads the user's Google connection, checks the scope, and mints
// an access token.
func (e *GmailExecutor) connection(ctx context.Context, userID uuid.UUID, requiredScope string) (*ent.OAuthConnection, string, error) {
	conn, err := e.client.OAuthConnection.Query().
		Where(
			oauthconnection.ProviderEQ("google"),
			oauthconnection.HasUserWith(user.IDEQ(userID)),
		).
		Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return nil, "", errors.New("revenue: google is not connected for the assigned user")
		}
		return nil, "", fmt.Errorf("revenue: load google connection: %w", err)
	}
	if !slices.Contains(conn.Scopes, requiredScope) {
		return nil, "", fmt.Errorf("revenue: google connection is missing the %s scope; reconnect Google to grant it", requiredScope)
	}
	token, err := e.google.AccessTokenForConnection(ctx, e.sealer, e.secrets, conn)
	if err != nil {
		if errors.Is(err, googleapi.ErrReconnectRequired) {
			return nil, "", errors.New("revenue: google refresh token is invalid; reconnect Google")
		}
		return nil, "", fmt.Errorf("revenue: could not obtain a google access token: %w", err)
	}
	return conn, token, nil
}

// googleStatusRe matches googleapi's status-error format ("returned 503").
var googleStatusRe = regexp.MustCompile(`returned (\d{3})`)

// classifySubmitError decides whether a failed Gmail call is a definite
// failure or ambiguous (the request may have been processed but the result
// was lost). Conservative by design: ambiguity blocks automatic resends.
func classifySubmitError(err error) error {
	// The call was cut off in flight: Google may or may not have processed it.
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return fmt.Errorf("%w: %v", ErrAmbiguous, err)
	}
	var nerr net.Error
	if errors.As(err, &nerr) && nerr.Timeout() {
		return fmt.Errorf("%w: %v", ErrAmbiguous, err)
	}
	if status, ok := hubspotapi.StatusCode(err); ok && status >= 500 {
		return fmt.Errorf("%w: %v", ErrAmbiguous, err)
	}
	// Official provider SDKs such as slack-go expose transport status through
	// this small interface. A 5xx means the write reached the provider boundary
	// but does not prove whether it committed, so a blind retry could duplicate
	// a message or activity.
	var statusErr interface{ HTTPStatusCode() int }
	if errors.As(err, &statusErr) && statusErr.HTTPStatusCode() >= 500 {
		return fmt.Errorf("%w: %v", ErrAmbiguous, err)
	}
	// A 5xx answer proves the request arrived but not whether it was applied;
	// a 4xx is a definite rejection.
	if m := googleStatusRe.FindStringSubmatch(err.Error()); m != nil && strings.HasPrefix(m[1], "5") {
		return fmt.Errorf("%w: %v", ErrAmbiguous, err)
	}
	return err
}

var _ Reconciler = (*GmailExecutor)(nil)
