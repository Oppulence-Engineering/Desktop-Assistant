package db

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// entQueriesTotal counts ent queries by entity type, emitted from the query
// interceptor. Scraped on the /metrics port.
var entQueriesTotal = promauto.NewCounterVec(
	prometheus.CounterOpts{
		Name: "rowboat_ent_queries_total",
		Help: "Total ent queries executed, by entity type.",
	},
	[]string{"type"},
)

var entQueryDuration = promauto.NewHistogramVec(
	prometheus.HistogramOpts{
		Name:    "rowboat_ent_query_duration_seconds",
		Help:    "Ent query latency by entity type and operation.",
		Buckets: prometheus.DefBuckets,
	},
	[]string{"type", "operation"},
)

var entQueryErrorsTotal = promauto.NewCounterVec(
	prometheus.CounterOpts{
		Name: "rowboat_ent_query_errors_total",
		Help: "Ent query failures by entity type and operation.",
	},
	[]string{"type", "operation"},
)
