package connectors

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/connectormetrics"
)

const (
	refreshFailurePersistenceTimeout = 8 * time.Second
	refreshFailureMarkerTimeout      = 2 * time.Second
	refreshFailureMarkerTTL          = maxResourceTokenTTL + 5*time.Minute
)

var errRefreshFailurePersistenceUnacknowledged = errors.New("connector refresh failure persistence is unacknowledged")

// refreshFailureGuard keeps terminal provider signals fail closed when their
// PostgreSQL lifecycle transaction cannot be acknowledged. The shared cache
// marker denies the exact signaled generation on every replica for longer than
// the maximum resource-token lifetime. The local latch also fails readiness and
// denies status on this replica if both shared persistence paths are unavailable.
type refreshFailureGuard struct {
	mu     sync.RWMutex
	cache  RefreshCache
	failed bool
	cause  error
}

func (g *refreshFailureGuard) configure(cache RefreshCache) {
	g.mu.Lock()
	g.cache = cache
	g.mu.Unlock()
}

func refreshFailureMarkerKey(connectionID string, generation int64) string {
	return fmt.Sprintf("connectors:refresh:terminal:v1:%s:%d", connectionID, generation)
}

func (g *refreshFailureGuard) mark(ctx context.Context, previous *ent.MCPConnection) error {
	if g == nil || previous == nil {
		return errors.New("connector refresh failure marker is not configured")
	}
	g.mu.RLock()
	cache := g.cache
	g.mu.RUnlock()
	if cache == nil {
		return errors.New("connector refresh failure shared cache is not configured")
	}
	return cache.Set(ctx, refreshFailureMarkerKey(previous.ID.String(), previous.CredentialGeneration), []byte("deny"), refreshFailureMarkerTTL)
}

func (g *refreshFailureGuard) denied(ctx context.Context, connectionID string, generation int64) (bool, error) {
	if g == nil {
		return false, nil
	}
	g.mu.RLock()
	failed := g.failed
	cache := g.cache
	g.mu.RUnlock()
	if failed {
		return true, nil
	}
	if cache == nil {
		return false, nil
	}
	_, found, err := cache.Get(ctx, refreshFailureMarkerKey(connectionID, generation))
	if err != nil {
		return false, err
	}
	return found, nil
}

func (g *refreshFailureGuard) fail(cause error) {
	if g == nil {
		return
	}
	g.mu.Lock()
	g.failed = true
	g.cause = cause
	g.mu.Unlock()
	connectormetrics.RefreshFailurePersistenceFailed.Set(1)
}

func (g *refreshFailureGuard) ready() error {
	if g == nil {
		return nil
	}
	g.mu.RLock()
	defer g.mu.RUnlock()
	if !g.failed {
		return nil
	}
	if g.cause == nil {
		return errRefreshFailurePersistenceUnacknowledged
	}
	return errors.Join(errRefreshFailurePersistenceUnacknowledged, g.cause)
}

// handleRefreshFailure persists a provider failure with a detached, bounded
// context. Terminal invalid_grant/reuse signals first install a shared exact-
// generation deny marker, then atomically generation-fence state plus audit.
func (h *Handler) handleRefreshFailure(ctx context.Context, owner *ent.User, previous *ent.MCPConnection, refreshErr error) error {
	if h == nil || owner == nil || previous == nil {
		return errors.New("connector refresh failure handling is not configured")
	}
	detached, cancel := context.WithTimeout(context.WithoutCancel(ctx), refreshFailurePersistenceTimeout)
	defer cancel()

	terminal := isRefreshFamilyInvalidation(refreshErr) || isOAuthErrorCode(refreshErr, "invalid_grant")
	var markerErr error
	if terminal {
		markerCtx, markerCancel := context.WithTimeout(detached, refreshFailureMarkerTimeout)
		markerErr = h.refreshFailures.mark(markerCtx, previous)
		markerCancel()
	}

	lifecycle := NewLifecycleService(h.client, h.sealer, h.registry, h.ory)
	lifecycle.SetLogger(h.log)
	var persistErr error
	for attempt := 0; attempt < 3; attempt++ {
		persistErr = lifecycle.HandleRefreshFailure(detached, owner, previous, refreshErr)
		if persistErr == nil || errors.Is(persistErr, errConnectorCredentialSuperseded) {
			connectormetrics.RefreshFailurePersistence.WithLabelValues("acknowledged").Inc()
			return nil
		}
		if attempt < 2 {
			select {
			case <-detached.Done():
				attempt = 2
			case <-time.After(time.Duration(attempt+1) * 25 * time.Millisecond):
			}
		}
	}

	joined := errors.Join(persistErr, markerErr)
	connectormetrics.RefreshFailurePersistence.WithLabelValues("failed").Inc()
	if terminal {
		h.refreshFailures.fail(joined)
	}
	return fmt.Errorf("record connector refresh failure: %w", joined)
}
