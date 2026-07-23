package revenue

import (
	"context"
	"sort"
	"strings"

	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/mailsignal"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/mailthread"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/embeddings"
)

// SetEmbedder wires the Layer-2 embedder (RFC 031). A nil/disabled embedder
// leaves Layer 2 inert — no signals are computed and semantic search returns
// an unavailable error.
func (s *Service) SetEmbedder(e embeddings.Embedder) { s.embedder = e }

// detectorClass maps a detector to a Layer-2 classification.
var detectorClass = map[string]string{
	"unanswered_proposal":       "deal",
	"requested_follow_up_due":   "deal",
	"dormant_warm_opportunity":  "deal",
	"waiting_on_me":             "client",
	"neglected_referral":        "referral",
	"former_customer_reconnect": "client",
	"manual":                    "other",
}

// computeSignal derives and stores the Layer-2 signal for a relevant thread:
// a classification, a bounded summary, and an embedding over derived text
// (subject + snippet + reason — never a body). Best-effort and idempotent
// (upsert per thread); a failure must not abort a scan.
func (s *Service) computeSignal(ctx context.Context, u *ent.User, sum *threadSummary, hit *detectorHit) error {
	if s.embedder == nil || !s.embedder.Enabled() {
		return nil
	}
	thread, err := s.client.MailThread.Query().
		Where(
			mailthread.HasUserWith(user.IDEQ(u.ID)),
			mailthread.ProviderThreadIDEQ(sum.ThreadID),
		).
		WithSignal().
		Only(ctx)
	if err != nil {
		return err
	}
	// Skip if a fresh signal already exists for this thread's latest activity.
	if existing, _ := thread.Edges.SignalOrErr(); existing != nil {
		return nil
	}

	class := detectorClass[hit.Detector]
	if class == "" {
		class = "other"
	}
	summary := hit.Reason
	// Derived text for the embedding: subject + last snippet + reason. Bounded.
	text := strings.TrimSpace(sum.Subject + "\n" + lastSnippet(sum) + "\n" + hit.Reason)
	vec, err := s.embedder.Embed(ctx, text)
	if err != nil {
		return err
	}
	create := s.client.MailSignal.Create().
		SetUser(u).
		SetThread(thread).
		SetClassification(class).
		SetSummary(summary).
		SetEmbeddingModel(s.embedder.Model()).
		SetEmbedding(embeddings.Encode(vec)).
		SetComputedAt(s.now())
	if err := create.Exec(ctx); err != nil && !ent.IsConstraintError(err) {
		return err
	}
	return nil
}

// SemanticMatch is one semantic-search result.
type SemanticMatch struct {
	ThreadID       string  `json:"threadId"`
	Subject        string  `json:"subject"`
	Counterparty   string  `json:"counterparty"`
	Classification string  `json:"classification"`
	Summary        string  `json:"summary"`
	Score          float64 `json:"score"`
}

// SemanticSearch embeds the query and returns the caller's most similar
// relevant threads (RFC 031 Layer 2). Cosine similarity is computed in Go over
// the user's bounded signal set — portable, no vector-DB dependency.
func (s *Service) SemanticSearch(ctx context.Context, u *ent.User, query string, limit int) ([]SemanticMatch, error) {
	if s.embedder == nil || !s.embedder.Enabled() {
		return nil, ErrEmbeddingsUnavailable
	}
	if limit <= 0 || limit > 20 {
		limit = 10
	}
	qvec, err := s.embedder.Embed(ctx, query)
	if err != nil {
		return nil, err
	}
	signals, err := s.client.MailSignal.Query().
		Where(mailsignal.HasUserWith(user.IDEQ(u.ID))).
		WithThread().
		All(ctx)
	if err != nil {
		return nil, err
	}
	matches := make([]SemanticMatch, 0, len(signals))
	for _, sig := range signals {
		if len(sig.Embedding) == 0 {
			continue
		}
		score := embeddings.Cosine(qvec, embeddings.Decode(sig.Embedding))
		th, terr := sig.Edges.ThreadOrErr()
		if terr != nil {
			continue
		}
		matches = append(matches, SemanticMatch{
			ThreadID:       th.ProviderThreadID,
			Subject:        th.Subject,
			Counterparty:   th.CounterpartyEmail,
			Classification: sig.Classification,
			Summary:        sig.Summary,
			Score:          score,
		})
	}
	sort.Slice(matches, func(i, j int) bool { return matches[i].Score > matches[j].Score })
	if len(matches) > limit {
		matches = matches[:limit]
	}
	return matches, nil
}

// PurgeMailSignals is folded into PurgeMailIndex; exposed for completeness.
func (s *Service) purgeSignals(ctx context.Context, uid uuid.UUID) (int, error) {
	return s.client.MailSignal.Delete().
		Where(mailsignal.HasUserWith(user.IDEQ(uid))).Exec(ctx)
}

// ErrEmbeddingsUnavailable means semantic search was asked for but no embedder
// is configured.
var ErrEmbeddingsUnavailable = embeddingsUnavailable{}

type embeddingsUnavailable struct{}

func (embeddingsUnavailable) Error() string { return "revenue: semantic search unavailable" }
