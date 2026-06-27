package backgroundtaskworkflow

const (
	// Temporal task priority: lower values run sooner. Temporal's default
	// server range is 1..5, so keep Rowboat's classes inside that range.
	PriorityHigh    = 1
	PriorityDefault = 3
	PriorityLow     = 5
)
