// Package telemetry wires structured logging (zap) and tracing (OpenTelemetry).
//
// Logs are JSON to stdout (scraped by the cluster's log pipeline). Traces are
// exported via OTLP/HTTP when OTEL_EXPORTER_OTLP_ENDPOINT is set; otherwise a
// tracer provider is still installed (so spans carry IDs that show up in logs)
// but spans are dropped rather than exported.
package telemetry

import (
	"context"
	"fmt"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/version"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	otlptracehttp "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// NewLogger builds a production JSON logger at the configured level.
func NewLogger(cfg appconfig.Config) (*zap.Logger, error) {
	level := zap.NewAtomicLevel()
	if err := level.UnmarshalText([]byte(cfg.LogLevel)); err != nil {
		level.SetLevel(zapcore.InfoLevel)
	}

	encCfg := zap.NewProductionEncoderConfig()
	encCfg.TimeKey = "ts"
	encCfg.EncodeTime = zapcore.ISO8601TimeEncoder
	encCfg.EncodeDuration = zapcore.MillisDurationEncoder

	zcfg := zap.Config{
		Level:            level,
		Encoding:         "json",
		EncoderConfig:    encCfg,
		OutputPaths:      []string{"stdout"},
		ErrorOutputPaths: []string{"stderr"},
		InitialFields: map[string]any{
			"service": cfg.ServiceName,
			"env":     cfg.Environment,
			"version": version.Version,
		},
	}
	if cfg.Environment == "development" {
		zcfg.Development = true
	}
	return zcfg.Build()
}

// InitTracer installs a global tracer provider and propagators. The returned
// shutdown func flushes spans; call it on graceful shutdown.
func InitTracer(ctx context.Context, cfg appconfig.Config) (func(context.Context) error, error) {
	res, err := resource.New(ctx,
		resource.WithAttributes(
			attribute.String("service.name", cfg.ServiceName),
			attribute.String("service.version", version.Version),
			attribute.String("deployment.environment", cfg.Environment),
		),
	)
	if err != nil {
		return nil, fmt.Errorf("build otel resource: %w", err)
	}

	opts := []sdktrace.TracerProviderOption{sdktrace.WithResource(res)}

	if cfg.OTLPEndpoint != "" {
		exp, err := otlptracehttp.New(ctx) // reads OTEL_EXPORTER_OTLP_* env vars
		if err != nil {
			return nil, fmt.Errorf("create otlp exporter: %w", err)
		}
		opts = append(opts, sdktrace.WithBatcher(exp))
	}

	tp := sdktrace.NewTracerProvider(opts...)
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	return tp.Shutdown, nil
}
