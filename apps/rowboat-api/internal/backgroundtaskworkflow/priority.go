package backgroundtaskworkflow

const (
	// PriorityHigh runs latency-sensitive tasks before default work.
	PriorityHigh = 1
	// PriorityDefault is the normal Temporal task priority.
	PriorityDefault = 3
	// PriorityLow runs deferrable work after default tasks.
	PriorityLow = 5
)
