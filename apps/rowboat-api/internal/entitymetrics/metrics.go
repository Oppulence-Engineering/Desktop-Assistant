// Package entitymetrics holds bounded-cardinality RFC 022 entity-spine metrics.
package entitymetrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	// Resolve counts bounded reconciliation outcomes.
	Resolve = promauto.NewCounterVec(prometheus.CounterOpts{Name: "entity_resolve_total", Help: "Entity reconciliation outcomes."}, []string{"result"})
	// SpineSync counts bounded upload and download projection events.
	SpineSync = promauto.NewCounterVec(prometheus.CounterOpts{Name: "entity_spine_sync_total", Help: "Entity spine projection sync volume."}, []string{"direction"})
	// Merge counts completed explicit entity merges.
	Merge = promauto.NewCounter(prometheus.CounterOpts{Name: "entity_merge_total", Help: "Idempotent entity merges completed."})
)
