package backgroundtaskworkflow

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskrun"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskrunevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
	"github.com/google/uuid"
)

type runControlSource struct {
	a         *Activities
	runID     uuid.UUID
	lastSeq   int
	paused    bool
	approvals map[string]backgroundtaskruntime.ToolApprovalDecision
}

func newRunControlSource(a *Activities, run *ent.BackgroundTaskRun) *runControlSource {
	return &runControlSource{a: a, runID: run.ID, lastSeq: -1, approvals: map[string]backgroundtaskruntime.ToolApprovalDecision{}}
}

func (s *runControlSource) Checkpoint(ctx context.Context) (backgroundtaskruntime.ControlState, error) {
	events, err := s.a.Client.BackgroundTaskRunEvent.Query().
		Where(
			backgroundtaskrunevent.HasRunWith(backgroundtaskrun.IDEQ(s.runID)),
			backgroundtaskrunevent.EventTypeEQ(EventSignal),
			backgroundtaskrunevent.SeqGT(s.lastSeq),
		).
		Order(backgroundtaskrunevent.BySeq()).
		All(ctx)
	if err != nil {
		return backgroundtaskruntime.ControlState{}, err
	}

	state := backgroundtaskruntime.ControlState{Paused: s.paused, ToolApprovals: copyToolApprovals(s.approvals)}
	for _, ev := range events {
		if ev.Seq > s.lastSeq {
			s.lastSeq = ev.Seq
		}
		var envelope map[string]any
		if err := json.Unmarshal([]byte(ev.EventJSON), &envelope); err != nil {
			continue
		}
		signal, _ := envelope["signal"].(string)
		switch signal {
		case "pause":
			s.paused = true
		case "resume":
			s.paused = false
		case "update_context":
			if text := contextUpdateText(envelope["payload"]); text != "" {
				state.ContextUpdates = append(state.ContextUpdates, text)
			}
		case "approve_tool", "deny_tool":
			if approvalID := approvalIDFromSignalPayload(envelope["payload"]); approvalID != "" {
				decision := backgroundtaskruntime.ToolApprovalDecision{
					Approved: signal == "approve_tool",
				}
				if payload, _ := envelope["payload"].(map[string]any); payload != nil {
					if resolvedBy, _ := payload["resolvedBy"].(string); strings.TrimSpace(resolvedBy) != "" {
						decision.ResolvedBy = strings.TrimSpace(resolvedBy)
					}
					if reason, _ := payload["reason"].(string); strings.TrimSpace(reason) != "" {
						decision.Reason = strings.TrimSpace(reason)
					}
				}
				s.approvals[approvalID] = decision
				state.ToolApprovals[approvalID] = decision
			}
		}
		state.Paused = s.paused
	}
	return state, nil
}

func copyToolApprovals(in map[string]backgroundtaskruntime.ToolApprovalDecision) map[string]backgroundtaskruntime.ToolApprovalDecision {
	if len(in) == 0 {
		return map[string]backgroundtaskruntime.ToolApprovalDecision{}
	}
	out := make(map[string]backgroundtaskruntime.ToolApprovalDecision, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

func approvalIDFromSignalPayload(payload any) string {
	switch v := payload.(type) {
	case map[string]any:
		for _, key := range []string{"approvalId", "approvalID", "id"} {
			if text, ok := v[key].(string); ok && strings.TrimSpace(text) != "" {
				return strings.TrimSpace(text)
			}
		}
	case string:
		return strings.TrimSpace(v)
	}
	return ""
}

func contextUpdateText(payload any) string {
	switch v := payload.(type) {
	case string:
		return strings.TrimSpace(v)
	case map[string]any:
		for _, key := range []string{"context", "requestedContext", "input", "message", "text"} {
			if text, ok := v[key].(string); ok && strings.TrimSpace(text) != "" {
				return strings.TrimSpace(text)
			}
		}
		if len(v) == 0 {
			return ""
		}
		raw, err := json.Marshal(v)
		if err != nil {
			return ""
		}
		return string(raw)
	default:
		return ""
	}
}
