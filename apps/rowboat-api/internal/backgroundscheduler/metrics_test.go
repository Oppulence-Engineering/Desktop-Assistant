package backgroundscheduler

import (
	"testing"

	"github.com/prometheus/client_golang/prometheus/testutil"
)

// TestMetricsAreWired exercises every scheduler series so a mislabeled vector
// (wrong label count) would panic here, and confirms counters advance. It also
// documents the low-cardinality label sets (trigger, stage).
func TestMetricsAreWired(t *testing.T) {
	before := testutil.ToFloat64(metrics.Ticks)
	metrics.Ticks.Inc()
	metrics.TasksScanned.Add(3)
	metrics.DueTasks.WithLabelValues("cron").Inc()
	metrics.DueTasks.WithLabelValues("window").Inc()
	metrics.RunsTriggered.WithLabelValues("cron").Inc()
	metrics.DuplicateSuppressed.Inc()
	metrics.BackoffSuppressed.Inc()
	metrics.InFlightSuppressed.Inc()
	for _, stage := range []string{"query", "parse", "user_edge", "lease", "start"} {
		metrics.Errors.WithLabelValues(stage).Inc()
	}
	metrics.TickDuration.Observe(0.01)

	if got := testutil.ToFloat64(metrics.Ticks) - before; got != 1 {
		t.Fatalf("ticks delta = %v, want 1", got)
	}
	if got := testutil.ToFloat64(metrics.Errors.WithLabelValues("parse")); got < 1 {
		t.Fatalf("errors{parse} = %v, want >= 1", got)
	}
}
