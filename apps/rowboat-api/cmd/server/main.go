// Command server is the rowboat-api entrypoint. It wires dependencies
// (config, logging, tracing, database, redis, secrets), mounts the feature
// routers, and runs the HTTP + metrics listeners until a shutdown signal.
package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/server"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/telemetry"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/version"
	"go.uber.org/zap"
)

func main() {
	cfg := appconfig.Load()

	log, err := telemetry.NewLogger(cfg)
	if err != nil {
		panic(err)
	}

	if runErr := run(cfg, log); runErr != nil {
		log.Error("server exited with error", zap.Error(runErr))
		_ = log.Sync()
		os.Exit(1)
	}
	_ = log.Sync()
}

func run(cfg appconfig.Config, log *zap.Logger) error {
	log.Info("starting rowboat-api",
		zap.String("build_info", version.String()),
		zap.String("http_addr", cfg.HTTPAddr),
		zap.String("metrics_addr", cfg.MetricsAddr),
	)

	if err := cfg.Validate(); err != nil {
		return err
	}

	// Root context cancelled on SIGINT/SIGTERM for graceful shutdown.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	shutdownTracer, err := telemetry.InitTracer(ctx, cfg)
	if err != nil {
		return err
	}
	defer func() {
		// HTTP/gRPC and resource custody each receive their own ShutdownTimeout
		// phase. Keep the final telemetry flush short so the complete process
		// lifecycle remains inside the chart's termination grace period.
		shCtx, cancel := context.WithTimeout(context.Background(), min(cfg.ShutdownTimeout, 5*time.Second))
		defer cancel()
		_ = shutdownTracer(shCtx)
	}()

	srv := server.New(cfg, log)

	// Feature routers are mounted here as milestones land. The wiring helper
	// (mountRoutes) keeps main.go small while still being the single place
	// that assembles the application.
	if err := mountRoutes(ctx, srv, cfg, log); err != nil {
		return err
	}

	return srv.Run(ctx)
}
