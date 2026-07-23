package revenue

import (
	"context"
	"errors"
	"fmt"
	"net"
	"regexp"
	"slices"
	"strings"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/oauthconnection"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/googleapi"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
)

// Gmail OAuth scopes (mirrors backgroundtaskruntime's connector tools).
const (
	scopeGmailCompose = "https://www.googleapis.com/auth/gmail.compose"
	scopeGmailSend    = "https://www.googleapis.com/auth/gmail.send"
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
		id, err := e.google.SendMessage(ctx, token, to, action.ProposedSubject, action.ProposedMessage)
		if err != nil {
			return nil, classifySubmitError(err)
		}
		return &ExecResult{ProviderMessageID: id}, nil
	}
	id, err := e.google.CreateDraft(ctx, token, to, action.ProposedSubject, action.ProposedMessage)
	if err != nil {
		return nil, classifySubmitError(err)
	}
	return &ExecResult{ProviderMessageID: id}, nil
}

// accessToken resolves the assigned user's Google credential, enforcing
// invariant 11 at the credential layer: the sender connection is looked up
// for exactly req.UserID, never substituted.
func (e *GmailExecutor) accessToken(ctx context.Context, req ExecRequest, requiredScope string) (string, error) {
	conn, err := e.client.OAuthConnection.Query().
		Where(
			oauthconnection.ProviderEQ("google"),
			oauthconnection.HasUserWith(user.IDEQ(req.UserID)),
		).
		Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return "", errors.New("revenue: google is not connected for the assigned user")
		}
		return "", fmt.Errorf("revenue: load google connection: %w", err)
	}
	if !slices.Contains(conn.Scopes, requiredScope) {
		return "", fmt.Errorf("revenue: google connection is missing the %s scope; reconnect Google to grant it", requiredScope)
	}
	token, err := e.google.AccessTokenForConnection(ctx, e.sealer, e.secrets, conn)
	if err != nil {
		if errors.Is(err, googleapi.ErrReconnectRequired) {
			return "", errors.New("revenue: google refresh token is invalid; reconnect Google")
		}
		return "", fmt.Errorf("revenue: could not obtain a google access token: %w", err)
	}
	return token, nil
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
	// A 5xx answer proves the request arrived but not whether it was applied;
	// a 4xx is a definite rejection.
	if m := googleStatusRe.FindStringSubmatch(err.Error()); m != nil && strings.HasPrefix(m[1], "5") {
		return fmt.Errorf("%w: %v", ErrAmbiguous, err)
	}
	return err
}
