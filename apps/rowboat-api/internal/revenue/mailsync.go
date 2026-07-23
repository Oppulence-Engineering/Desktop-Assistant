package revenue

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/googleapi"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/revenuemetrics"
)

// MailSyncer performs an incremental Gmail History-API sync for one user from a
// stored cursor. GmailExecutor implements it.
type MailSyncer interface {
	SyncHistory(ctx context.Context, userID uuid.UUID, startHistoryID string) (threads [][]googleapi.GmailThreadMessage, selfEmail, latestHistoryID string, err error)
}

// SetMailSyncer wires the RFC 031 Layer-1 push sync. Nil leaves push sync off
// (the scan still populates the index).
func (s *Service) SetMailSyncer(m MailSyncer) { s.mailSyncer = m }

// SyncMailFromPush keeps the Layer-1 index live in response to a Gmail push. It
// walks the History API from the workspace's stored cursor, upserts the touched
// threads' metadata, and advances the cursor. It is idempotent (indexThread
// upserts) and self-healing: a first push, or a stale cursor
// (googleapi.ErrHistoryGap), records the new cursor and defers full coverage to
// the next scan rather than re-walking the whole mailbox here.
func (s *Service) SyncMailFromPush(ctx context.Context, u *ent.User, pushHistoryID uint64) error {
	if s.mailSyncer == nil {
		return nil
	}
	ws, err := s.CurrentWorkspace(ctx, u)
	if err != nil {
		return err
	}
	newCursor := fmt.Sprintf("%d", pushHistoryID)
	cursor := ws.MailHistoryID
	if cursor == "" {
		// Bootstrap: record where we are; the scan seeds the index.
		return ws.Update().SetMailHistoryID(newCursor).Exec(ctx)
	}

	threads, selfEmail, latest, err := s.mailSyncer.SyncHistory(ctx, u.ID, cursor)
	if err != nil {
		if errors.Is(err, googleapi.ErrHistoryGap) {
			// Cursor too old: reset to the push id; the next scan re-covers.
			revenuemetrics.MailSyncGaps.Inc()
			return ws.Update().SetMailHistoryID(newCursor).Exec(ctx)
		}
		return err
	}

	indexed := 0
	for _, msgs := range threads {
		sum := summarizeThread(selfEmail, msgs)
		if sum == nil {
			continue
		}
		if ierr := s.indexThread(ctx, u, sum); ierr != nil {
			s.log.Debug("revenue: push index thread", zap.Error(ierr))
			continue
		}
		indexed++
	}
	revenuemetrics.MailSyncThreads.Add(float64(indexed))

	// Advance the cursor to the newest history id observed (fall back to the
	// push id when the walk returned none).
	if latest == "" {
		latest = newCursor
	}
	return ws.Update().SetMailHistoryID(latest).Exec(ctx)
}
