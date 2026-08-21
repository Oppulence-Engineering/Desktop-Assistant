package temporaltest

import (
	"context"
	"net/http"
	"time"

	"go.temporal.io/sdk/workflow"
)

func Good(ctx workflow.Context) error {
	_ = workflow.Now(ctx)
	return workflow.Sleep(ctx, time.Second)
}

func Bad(ctx workflow.Context) error {
	_ = time.Now()                         // want "RB003_TEMPORAL_SIDE_EFFECT"
	time.Sleep(time.Second)                // want "RB003_TEMPORAL_SIDE_EFFECT"
	_, _ = http.Get("https://example.com") // want "RB003_TEMPORAL_SIDE_EFFECT"
	go func() {}()                         // want "RB003_TEMPORAL_SIDE_EFFECT"
	return nil
}

func Activity(context.Context) {
	_ = time.Now()
}
