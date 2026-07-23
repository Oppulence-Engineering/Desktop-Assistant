package main

import (
	"context"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/actions"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/cloudevents"
)

// actionWatcherAdapter adapts the RFC 023 broker to the cloud-event router's
// ActionWatcher seam, keeping internal/cloudevents free of a dependency on
// internal/actions.
type actionWatcherAdapter struct {
	broker *actions.Broker
}

func (a actionWatcherAdapter) IsProductSource(source string) bool {
	return actions.IsProductSource(source)
}

func (a actionWatcherAdapter) CorrelateReturn(ctx context.Context, owner *ent.User, ev *ent.CloudEvent) (cloudevents.ActionWatchResult, error) {
	m, err := a.broker.CorrelateReturn(ctx, owner, ev)
	if err != nil {
		return cloudevents.ActionWatchResult{}, err
	}
	return cloudevents.ActionWatchResult{
		Matched:       m.Matched,
		AlreadyClosed: m.AlreadyClosed,
		OriginRunID:   m.OriginRunID,
		Kind:          m.Kind,
		Target:        m.Target,
		ResultRef:     m.ResultRef,
	}, nil
}
