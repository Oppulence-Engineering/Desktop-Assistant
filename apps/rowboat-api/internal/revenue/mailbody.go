package revenue

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/mailbodycache"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/mailmessagemeta"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueevidence"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
)

// ErrBodyUnavailable means the message body could not be produced (no fetcher
// configured, or Gmail returned nothing).
var ErrBodyUnavailable = errors.New("revenue: message body unavailable")

// MailBodyFetcher fetches one message's plain-text body from the provider for
// the given user. GmailExecutor implements it against the read-only scope.
type MailBodyFetcher interface {
	FetchBody(ctx context.Context, userID uuid.UUID, messageID string) (string, error)
}

// SetBodyFetcher wires the Layer-3 body path: the provider fetcher, the sealer
// used to encrypt cached bodies, and the cache TTL. A nil sealer disables the
// at-rest cache (bodies are fetched fresh every time and never stored).
func (s *Service) SetBodyFetcher(f MailBodyFetcher, sealer *crypto.Sealer, ttl time.Duration) {
	s.bodyFetcher = f
	s.sealer = sealer
	if ttl <= 0 {
		ttl = 72 * time.Hour
	}
	s.mailBodyTTL = ttl
}

// MessageBody returns the plain-text body of one of the caller's indexed
// messages (RFC 031 Layer 3). Authorization: the message must already exist in
// the caller's Layer-1 index — you can only read bodies of your own mail. The
// body is served from the sealed short-TTL cache when fresh, else fetched from
// Gmail and cached. Gmail stays the system of record; nothing is archived.
func (s *Service) MessageBody(ctx context.Context, u *ent.User, messageID string) (string, error) {
	if s.bodyFetcher == nil {
		return "", ErrBodyUnavailable
	}
	// Ownership gate: the message must be in the caller's index.
	owns, err := s.client.MailMessageMeta.Query().
		Where(
			mailmessagemeta.HasUserWith(user.IDEQ(u.ID)),
			mailmessagemeta.ProviderMessageIDEQ(messageID),
		).
		Exist(ctx)
	if err != nil {
		return "", err
	}
	if !owns {
		return "", ErrNotFound
	}

	now := s.now()
	// Serve from the sealed cache when fresh.
	if s.sealer != nil {
		if row, err := s.client.MailBodyCache.Query().
			Where(
				mailbodycache.HasUserWith(user.IDEQ(u.ID)),
				mailbodycache.ProviderMessageIDEQ(messageID),
				mailbodycache.ExpiresAtGT(now),
			).
			First(ctx); err == nil {
			if body, oerr := s.sealer.OpenString(row.SealedBody); oerr == nil {
				return body, nil
			}
			// A body we cannot unseal is useless; drop it and re-fetch.
			_ = s.client.MailBodyCache.DeleteOne(row).Exec(ctx)
		}
	}

	body, err := s.bodyFetcher.FetchBody(ctx, u.ID, messageID)
	if err != nil {
		return "", err
	}
	if body == "" {
		return "", ErrBodyUnavailable
	}

	if s.sealer != nil {
		if sealed, serr := s.sealer.SealString(body); serr == nil {
			// Upsert: replace any prior (expired) row for this message.
			_, _ = s.client.MailBodyCache.Delete().
				Where(
					mailbodycache.HasUserWith(user.IDEQ(u.ID)),
					mailbodycache.ProviderMessageIDEQ(messageID),
				).Exec(ctx)
			_ = s.client.MailBodyCache.Create().
				SetUser(u).
				SetProviderMessageID(messageID).
				SetSealedBody(sealed).
				SetExpiresAt(now.Add(s.mailBodyTTL)).
				Exec(ctx)
		}
	}
	return body, nil
}

// ActionSourceBody returns the original email body behind one action, by
// resolving the action's evidence anchor message and fetching it through the
// Layer-3 path. Used by the review UI's "view original email".
func (s *Service) ActionSourceBody(ctx context.Context, u *ent.User, actionID uuid.UUID) (string, error) {
	action, err := s.GetAction(ctx, actionID)
	if err != nil {
		return "", err
	}
	ev, err := action.QueryEvidences().
		Where(revenueevidence.SourceMessageIDNEQ("")).
		Order(ent.Desc(revenueevidence.FieldOccurredAt)).
		First(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return "", ErrBodyUnavailable
		}
		return "", err
	}
	return s.MessageBody(ctx, u, ev.SourceMessageID)
}

// SweepBodyCache deletes expired Layer-3 cache rows across all users (an
// internal maintenance delete keyed on expiry).
func (s *Service) SweepBodyCache(ctx context.Context, now time.Time) (int, error) {
	return s.client.MailBodyCache.Delete().
		Where(mailbodycache.ExpiresAtLT(now)).Exec(ctx)
}
