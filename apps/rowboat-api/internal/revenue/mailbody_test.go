package revenue

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/mailbodycache"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
)

// fakeBodyFetcher returns a scripted body and counts provider hits.
type fakeBodyFetcher struct {
	body  string
	calls int
	err   error
}

func (f *fakeBodyFetcher) FetchBody(context.Context, uuid.UUID, string) (string, error) {
	f.calls++
	if f.err != nil {
		return "", f.err
	}
	return f.body, nil
}

func newSealer(t *testing.T) *crypto.Sealer {
	t.Helper()
	s, err := crypto.NewSealer("test-key-for-mail-body-cache")
	if err != nil {
		t.Fatalf("sealer: %v", err)
	}
	return s
}

// indexMessage puts one message into the Layer-1 index so MessageBody's
// ownership gate passes.
func indexMessage(t *testing.T, f *fixture, messageID string) {
	t.Helper()
	th := f.client.MailThread.Create().
		SetUser(f.user).SetProvider("gmail").SetProviderThreadID("t-" + messageID).
		SetReplyState("quiet").SaveX(f.ctx)
	f.client.MailMessageMeta.Create().
		SetUser(f.user).SetThread(th).SetProviderMessageID(messageID).
		SetOccurredAt(time.Now()).SetDirection("inbound").SaveX(f.ctx)
}

func TestMessageBodyCachesAndReuses(t *testing.T) {
	f := newFixture(t)
	fetcher := &fakeBodyFetcher{body: "the original email text"}
	f.svc.SetBodyFetcher(fetcher, newSealer(t), 72*time.Hour)
	indexMessage(t, f, "m1")

	// First read hits the provider and caches (sealed).
	body, err := f.svc.MessageBody(f.ctx, f.user, "m1")
	if err != nil || body != "the original email text" {
		t.Fatalf("first read: body=%q err=%v", body, err)
	}
	if fetcher.calls != 1 {
		t.Fatalf("expected 1 provider call, got %d", fetcher.calls)
	}
	// The cached body is sealed, not plaintext, at rest.
	row := f.client.MailBodyCache.Query().
		Where(mailbodycache.HasUserWith(user.IDEQ(f.user.ID))).OnlyX(f.ctx)
	if string(row.SealedBody) == body {
		t.Fatal("cached body must be sealed, not stored as plaintext")
	}

	// Second read is served from cache — no new provider call.
	if _, err := f.svc.MessageBody(f.ctx, f.user, "m1"); err != nil {
		t.Fatalf("second read: %v", err)
	}
	if fetcher.calls != 1 {
		t.Fatalf("cache should have served the second read, provider calls=%d", fetcher.calls)
	}
}

func TestMessageBodyOwnershipGate(t *testing.T) {
	f := newFixture(t)
	f.svc.SetBodyFetcher(&fakeBodyFetcher{body: "x"}, newSealer(t), time.Hour)
	// No index row for "unknown" → not the caller's message.
	if _, err := f.svc.MessageBody(f.ctx, f.user, "unknown"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("un-indexed message must be denied, got %v", err)
	}
}

func TestBodyCacheSweep(t *testing.T) {
	f := newFixture(t)
	f.client.MailBodyCache.Create().
		SetUser(f.user).SetProviderMessageID("expired").
		SetSealedBody([]byte("x")).SetExpiresAt(time.Now().Add(-time.Hour)).SaveX(f.ctx)
	f.client.MailBodyCache.Create().
		SetUser(f.user).SetProviderMessageID("fresh").
		SetSealedBody([]byte("y")).SetExpiresAt(time.Now().Add(time.Hour)).SaveX(f.ctx)

	if _, err := f.svc.SweepBodyCache(f.ctx, time.Now()); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if n := f.client.MailBodyCache.Query().CountX(f.ctx); n != 1 {
		t.Fatalf("expected only the fresh row to remain, got %d", n)
	}
}

// The purge (disconnect) removes cached bodies too.
func TestPurgeRemovesBodyCache(t *testing.T) {
	f := newFixture(t)
	indexMessage(t, f, "m2")
	f.client.MailBodyCache.Create().
		SetUser(f.user).SetProviderMessageID("m2").
		SetSealedBody([]byte("z")).SetExpiresAt(time.Now().Add(time.Hour)).SaveX(f.ctx)

	if _, err := f.svc.PurgeMailIndex(f.ctx, f.user); err != nil {
		t.Fatalf("purge: %v", err)
	}
	if n := f.client.MailBodyCache.Query().CountX(f.ctx); n != 0 {
		t.Fatalf("body cache must be purged on disconnect, got %d", n)
	}
}
