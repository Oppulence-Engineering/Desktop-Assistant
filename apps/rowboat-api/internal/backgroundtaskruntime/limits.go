package backgroundtaskruntime

import (
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
)

// Limits bounds one run. Breaching any limit fails the run with its specific
// error code (observable via cloud_runtime_limit_exceeded_total{limit}).
type Limits struct {
	MaxDuration      time.Duration
	MaxLLMCalls      int
	MaxToolCalls     int
	MaxArtifactBytes int
	MaxEventBytes    int
}

// DefaultLimits mirrors the RFC 004 defaults (and appconfig's env defaults).
func DefaultLimits() Limits {
	return Limits{
		MaxDuration:      4 * time.Minute,
		MaxLLMCalls:      12,
		MaxToolCalls:     24,
		MaxArtifactBytes: 1 << 20,
		MaxEventBytes:    64 << 10,
	}
}

// LimitsFromConfig maps the CLOUD_RUNTIME_* env values (validated at boot).
func LimitsFromConfig(cfg appconfig.Config) Limits {
	return Limits{
		MaxDuration:      cfg.CloudRuntimeMaxDuration,
		MaxLLMCalls:      cfg.CloudRuntimeMaxLLMCalls,
		MaxToolCalls:     cfg.CloudRuntimeMaxToolCalls,
		MaxArtifactBytes: cfg.CloudRuntimeMaxArtifactBytes,
		MaxEventBytes:    cfg.CloudRuntimeMaxEventBytes,
	}
}
