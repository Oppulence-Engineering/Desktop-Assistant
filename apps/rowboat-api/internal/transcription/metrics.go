package transcription

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// Meeting-minutes metrics (RFC 009 Appendix O.7). Labelled only by bounded
// dimensions; never by user id.
var (
	// MeetingMinutesUsedSecondsTotal counts cloud meeting seconds settled against
	// the free allowance (incremented by whatever fronts Deepgram on Settle).
	MeetingMinutesUsedSecondsTotal = promauto.NewCounter(prometheus.CounterOpts{
		Name: "voice_meeting_minutes_used_seconds_total",
		Help: "Cloud meeting seconds metered against the free allowance.",
	})
	// MeetingMinutesExhaustedTotal counts reservations rejected for an exhausted
	// free allowance (the desktop then falls back to on-device).
	MeetingMinutesExhaustedTotal = promauto.NewCounter(prometheus.CounterOpts{
		Name: "voice_meeting_minutes_exhausted_total",
		Help: "Meeting reservations rejected because free minutes were exhausted.",
	})
	// MeetingQuotaReadsTotal counts reads of the per-user quota endpoint.
	MeetingQuotaReadsTotal = promauto.NewCounter(prometheus.CounterOpts{
		Name: "voice_meeting_quota_reads_total",
		Help: "Reads of the per-user meeting-minutes quota endpoint.",
	})
)
