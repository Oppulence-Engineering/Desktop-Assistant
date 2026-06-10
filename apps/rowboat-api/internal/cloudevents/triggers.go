package cloudevents

import (
	"encoding/json"
	"strings"
)

// taskTriggers is the slice of triggers_json this package reads. Deliberately
// separate from backgroundscheduler.ParseTriggers, which owns the cron/window
// shape and intentionally has no eventMatchCriteria field.
type taskTriggers struct {
	EventMatchCriteria string `json:"eventMatchCriteria"`
}

// eventMatchCriteria extracts a task's eventMatchCriteria, or "" when absent
// or unparseable (a bad triggers_json must not fail routing for other tasks).
func eventMatchCriteria(triggersJSON string) string {
	if triggersJSON == "" {
		return ""
	}
	var tr taskTriggers
	if err := json.Unmarshal([]byte(triggersJSON), &tr); err != nil {
		return ""
	}
	return strings.TrimSpace(tr.EventMatchCriteria)
}
