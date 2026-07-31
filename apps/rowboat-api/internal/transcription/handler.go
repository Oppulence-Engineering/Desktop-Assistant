// Package transcription serves the per-user transcription quota the desktop
// reads to decide whether meetings stay on cloud or fall back to on-device
// (RFC 009 §16, Appendix O.6/O.8).
package transcription

import (
	"context"
	"net/http"

	"go.uber.org/zap"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/minutes"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
)

// Handler serves the authenticated transcription quota endpoint.
type Handler struct {
	gate        *minutes.Gate
	client      *ent.Client
	cfg         appconfig.Config
	log         *zap.Logger
	secrets     *secrets.Store
	deepgramURL string
}

// New builds the transcription handler.
func New(gate *minutes.Gate, client *ent.Client, cfg appconfig.Config, sec *secrets.Store, log *zap.Logger) *Handler {
	return &Handler{
		gate: gate, client: client, cfg: cfg, secrets: sec, log: log,
		deepgramURL: "wss://api.deepgram.com/v1/listen",
	}
}

type transcriptionDefaults struct {
	VoiceProvider   string `json:"voiceProvider"`
	MeetingProvider string `json:"meetingProvider"`
}

type quotaResponse struct {
	// MeetingMinutesRemaining is the free cloud minutes left this UTC month.
	MeetingMinutesRemaining int `json:"meetingMinutesRemaining"`
	// Unlimited is true for paid plans (no metering).
	Unlimited bool `json:"unlimited"`
	// TranscriptionDefaults are the A/B-able fleet defaults (the kill switch).
	TranscriptionDefaults transcriptionDefaults `json:"transcriptionDefaults"`
}

// Quota handles GET /v1/transcription/quota. The desktop reads
// meetingMinutesRemaining to switch meetings to on-device at 0, and the
// transcriptionDefaults to follow (or flip) the fleet default.
func (h *Handler) Quota(w http.ResponseWriter, r *http.Request) {
	if _, ok := auth.UserFromCtx(r.Context()); !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	MeetingQuotaReadsTotal.Inc()

	plan, err := h.planFor(r.Context())
	if err != nil {
		// A real lookup failure must not be silently treated as the free plan
		// (which would meter a paying user / bump them to on-device).
		h.log.Warn("plan lookup", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not read plan", "internal_error")
		return
	}
	remainingSeconds, err := h.gate.Remaining(r.Context(), plan)
	if err != nil {
		h.log.Warn("meeting minutes remaining", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not read quota", "internal_error")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, quotaResponse{
		// Ceil, not truncate: 1–59 leftover seconds must still read as ≥1 minute, or the
		// desktop's "<=0 → fall back to on-device" gate discards up to 59s of allowance.
		MeetingMinutesRemaining: (remainingSeconds + 59) / 60,
		Unlimited:               h.gate.IsUnlimited(plan),
		TranscriptionDefaults: transcriptionDefaults{
			VoiceProvider:   h.cfg.TranscriptionVoiceDefault,
			MeetingProvider: h.cfg.TranscriptionMeetingDefault,
		},
	})
}

// planFor returns the scoped user's *entitled* subscription plan. A genuinely
// absent subscription resolves to "free"; any other error is propagated so the
// caller fails closed (500) instead of misclassifying a paid user as free.
//
// Plan and status are tracked independently: a canceled/past_due row can still
// carry plan="pro". Only active/trialing subscriptions confer the paid (unlimited)
// allowance — otherwise a lapsed payer would keep unlimited free cloud minutes.
func (h *Handler) planFor(ctx context.Context) (string, error) {
	sub, err := h.client.Subscription.Query().Only(ctx)
	if ent.IsNotFound(err) {
		return "free", nil
	}
	if err != nil {
		return "", err
	}
	if sub.Status != "active" && sub.Status != "trialing" {
		return "free", nil
	}
	return sub.Plan, nil
}
