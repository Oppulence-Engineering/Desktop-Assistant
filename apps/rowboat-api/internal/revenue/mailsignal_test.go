package revenue

import (
	"context"
	"errors"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/mailsignal"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
)

// fakeEmbedder returns a deterministic vector derived from the text so that
// similar text yields similar vectors, without a network call.
type fakeEmbedder struct{ enabled bool }

func (f *fakeEmbedder) Enabled() bool { return f.enabled }
func (f *fakeEmbedder) Model() string { return "fake" }
func (f *fakeEmbedder) Embed(_ context.Context, text string) ([]float32, error) {
	// A simple bag-of-bytes vector: dimension i counts byte value i%16.
	v := make([]float32, 16)
	for _, b := range []byte(text) {
		v[int(b)%16]++
	}
	return v, nil
}

func TestSemanticSearchDisabledIsUnavailable(t *testing.T) {
	f := newFixture(t)
	// No embedder set → search is unavailable (not an error the UI must show).
	if _, err := f.svc.SemanticSearch(f.ctx, f.user, "anything", 5); !errors.Is(err, ErrEmbeddingsUnavailable) {
		t.Fatalf("want ErrEmbeddingsUnavailable, got %v", err)
	}
}

func TestScanComputesSignalsAndSearchRanks(t *testing.T) {
	f := newFixture(t)
	f.svc.SetSweeper(&fakeSweeper{threads: scanFixtureThreads(), email: selfAddr})
	f.svc.SetEmbedder(&fakeEmbedder{enabled: true})

	scan, err := f.svc.StartScan(f.ctx, f.user, 90)
	if err != nil {
		t.Fatalf("scan: %v", err)
	}
	waitScan(t, f, scan.ID)

	// Detector hits (2 in the fixture) should have produced signals.
	signals := f.client.MailSignal.Query().Where(mailsignal.HasUserWith(user.IDEQ(f.user.ID))).CountX(f.ctx)
	if signals == 0 {
		t.Fatal("expected Layer-2 signals for detector-hit threads")
	}
	// A signal must carry an embedding and a classification.
	sig := f.client.MailSignal.Query().Where(mailsignal.HasUserWith(user.IDEQ(f.user.ID))).FirstX(f.ctx)
	if len(sig.Embedding) == 0 || sig.Classification == "" {
		t.Fatalf("signal incomplete: emb=%d class=%q", len(sig.Embedding), sig.Classification)
	}

	// Search returns ranked matches (highest cosine first).
	matches, err := f.svc.SemanticSearch(f.ctx, f.user, "proposal pricing", 5)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(matches) == 0 {
		t.Fatal("expected search matches")
	}
	for i := 1; i < len(matches); i++ {
		if matches[i-1].Score < matches[i].Score {
			t.Fatal("matches must be sorted by descending score")
		}
	}
}

// The purge removes Layer-2 signals too.
func TestPurgeRemovesSignals(t *testing.T) {
	f := newFixture(t)
	f.svc.SetSweeper(&fakeSweeper{threads: scanFixtureThreads(), email: selfAddr})
	f.svc.SetEmbedder(&fakeEmbedder{enabled: true})
	scan, _ := f.svc.StartScan(f.ctx, f.user, 90)
	waitScan(t, f, scan.ID)

	if n := f.client.MailSignal.Query().CountX(f.ctx); n == 0 {
		t.Fatal("precondition: signals should exist")
	}
	if _, err := f.svc.PurgeMailIndex(f.ctx, f.user); err != nil {
		t.Fatalf("purge: %v", err)
	}
	if n := f.client.MailSignal.Query().CountX(f.ctx); n != 0 {
		t.Fatalf("signals must be purged on disconnect, got %d", n)
	}
}
