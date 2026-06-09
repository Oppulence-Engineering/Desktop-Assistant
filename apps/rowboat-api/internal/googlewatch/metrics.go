package googlewatch

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	metricRenewals = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "google_watch_renewals_total",
		Help: "Successful Google watch registrations/renewals, by kind.",
	}, []string{"kind"})

	metricFailures = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "google_watch_failures_total",
		Help: "Failed Google watch registrations, by kind and stage (register, invalid_grant).",
	}, []string{"kind", "stage"})

	metricOrphansSwept = promauto.NewCounter(prometheus.CounterOpts{
		Name: "google_watch_orphans_swept_total",
		Help: "Watch rows removed because their Google connection was disconnected.",
	})
)
