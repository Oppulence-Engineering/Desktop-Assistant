package revenue

import (
	"context"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/mailbodycache"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/mailmessagemeta"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/mailsignal"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/mailthread"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
)

// quietAfter is when a thread with no recent activity is considered dormant.
const quietAfter = 30 * 24 * time.Hour

// indexThread upserts the Layer-1 mail index (RFC 031) for one swept thread:
// the MailThread row plus one MailMessageMeta per message. It stores metadata
// only — direction, participants, timestamps, subject, labels — never bodies
// or snippets. Idempotent: reruns update the thread and skip already-indexed
// messages. Best-effort; a failure here must not abort a scan.
func (s *Service) indexThread(ctx context.Context, u *ent.User, sum *threadSummary) error {
	now := s.now()
	var replyState string
	lastDir := "outbound"
	if !sum.LastOutbound {
		lastDir = "inbound"
	}
	switch {
	case now.Sub(sum.LastAt) >= quietAfter:
		replyState = "quiet"
	case sum.LastOutbound:
		replyState = "awaiting_reply" // we wrote last; waiting on them
	default:
		replyState = "needs_reply" // they wrote last; we owe a reply
	}

	existing, err := s.client.MailThread.Query().
		Where(
			mailthread.HasUserWith(user.IDEQ(u.ID)),
			mailthread.ProviderThreadIDEQ(sum.ThreadID),
		).
		Only(ctx)
	var thread *ent.MailThread
	switch {
	case ent.IsNotFound(err):
		create := s.client.MailThread.Create().
			SetUser(u).
			SetProvider("gmail").
			SetProviderThreadID(sum.ThreadID).
			SetSubject(sum.Subject).
			// emailDomain, not accountDomain: a thread's domain is thread-level
			// metadata, so gmail.com is the correct value here. Only an account
			// claim needs the public-mailbox filter.
			SetAccountDomain(emailDomain(sum.Counterparty)).
			SetLabels([]string{}).
			SetReplyState(replyState).
			SetLastDirection(lastDir).
			SetLastActivityAt(sum.LastAt).
			SetMessageCount(len(sum.Messages)).
			SetOutboundCount(sum.OutboundCount).
			SetInboundCount(sum.InboundCount)
		if sum.Counterparty != "" {
			create.SetCounterpartyEmail(sum.Counterparty)
		}
		thread, err = create.Save(ctx)
		if err != nil {
			if ent.IsConstraintError(err) {
				// A concurrent scan created it; fall through to update path.
				thread, err = s.client.MailThread.Query().
					Where(
						mailthread.HasUserWith(user.IDEQ(u.ID)),
						mailthread.ProviderThreadIDEQ(sum.ThreadID),
					).Only(ctx)
			}
			if err != nil {
				return err
			}
		}
	case err != nil:
		return err
	default:
		thread, err = existing.Update().
			SetSubject(sum.Subject).
			SetReplyState(replyState).
			SetLastDirection(lastDir).
			SetLastActivityAt(sum.LastAt).
			SetMessageCount(len(sum.Messages)).
			SetOutboundCount(sum.OutboundCount).
			SetInboundCount(sum.InboundCount).
			Save(ctx)
		if err != nil {
			return err
		}
	}

	for _, m := range sum.Messages {
		if m.ID == "" {
			continue
		}
		dir := "inbound"
		if m.Outbound {
			dir = "outbound"
		}
		occurred := m.At
		if occurred.IsZero() {
			occurred = sum.LastAt
		}
		create := s.client.MailMessageMeta.Create().
			SetUser(u).
			SetThread(thread).
			SetProviderMessageID(m.ID).
			SetOccurredAt(occurred).
			SetDirection(dir).
			SetSubject(m.Subject).
			SetLabels([]string{})
		if m.From != "" {
			create.SetFromAddr(m.From)
		}
		if m.To != "" {
			create.SetToAddr(m.To)
		}
		// Skip already-indexed messages (unique on (user, message id)).
		if err := create.Exec(ctx); err != nil && !ent.IsConstraintError(err) {
			return err
		}
	}
	return nil
}

// PurgeMailIndex deletes the caller's Layer-1/2/3 mail data (RFC 031 retention:
// disconnecting Gmail drops the index immediately). Layer-4 evidence quotes
// survive — they are the customer's own action history. Runs in the caller's
// tenant scope.
func (s *Service) PurgeMailIndex(ctx context.Context, u *ent.User) (int, error) {
	signals, err := s.purgeSignals(ctx, u.ID)
	if err != nil {
		return 0, err
	}
	bodies, err := s.client.MailBodyCache.Delete().
		Where(mailbodycache.HasUserWith(user.IDEQ(u.ID))).Exec(ctx)
	if err != nil {
		return signals, err
	}
	msgs, err := s.client.MailMessageMeta.Delete().
		Where(mailmessagemeta.HasUserWith(user.IDEQ(u.ID))).Exec(ctx)
	if err != nil {
		return bodies, err
	}
	threads, err := s.client.MailThread.Delete().
		Where(mailthread.HasUserWith(user.IDEQ(u.ID))).Exec(ctx)
	if err != nil {
		return signals + bodies + msgs, err
	}
	return signals + bodies + msgs + threads, nil
}

// SweepMailRetention deletes Layer-1 rows whose last activity is older than the
// retention window, across all users (an internal maintenance query). Messages
// cascade via their thread deletion is not automatic in ent, so messages of
// pruned threads are removed first by timestamp.
func (s *Service) SweepMailRetention(ctx context.Context, olderThan time.Time) (int, error) {
	// Delete stale messages first (they reference threads).
	m, err := s.client.MailMessageMeta.Delete().
		Where(mailmessagemeta.OccurredAtLT(olderThan)).Exec(ctx)
	if err != nil {
		return 0, err
	}
	sig, err := s.client.MailSignal.Delete().
		Where(mailsignal.ComputedAtLT(olderThan)).Exec(ctx)
	if err != nil {
		return m, err
	}
	t, err := s.client.MailThread.Delete().
		Where(mailthread.LastActivityAtLT(olderThan)).Exec(ctx)
	if err != nil {
		return m + sig, err
	}
	return m + sig + t, nil
}
