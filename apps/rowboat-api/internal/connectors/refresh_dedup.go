package connectors

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"go.uber.org/zap"
	"golang.org/x/sync/singleflight"
)

const (
	connectorRefreshResultTTL = 90 * time.Second
	connectorRefreshLockTTL   = 30 * time.Second
	connectorRefreshPollWait  = 5 * time.Second
)

var errConnectorRefreshInProgress = errors.New("connector refresh in progress")
var errConnectorCredentialSuperseded = errors.New("connector credential generation superseded")

// RefreshCache is structurally compatible with workosauth.RefreshCache. The
// connector package owns only the behavior it needs and does not depend on the
// sign-in broker implementation.
type RefreshCache interface {
	Get(context.Context, string) ([]byte, bool, error)
	Set(context.Context, string, []byte, time.Duration) error
	TryLock(context.Context, string, time.Duration) (bool, error)
	Unlock(context.Context, string) error
}

// refreshDeduper serializes rotation of one-use connector refresh tokens both
// within a process and across replicas. Successful results are sealed before
// entering Redis because they contain live access and refresh credentials.
type refreshDeduper struct {
	cache  RefreshCache
	sealer *crypto.Sealer
	log    *zap.Logger
	sf     singleflight.Group
}

func (d *refreshDeduper) configure(cache RefreshCache, sealer *crypto.Sealer, log *zap.Logger) {
	d.cache = cache
	d.sealer = sealer
	d.log = log
}

func (d *refreshDeduper) refresh(ctx context.Context, connector string, mc *ent.MCPConnection, ory *oryClient, oldRefresh string, persist func(context.Context, *oryToken) error) (*oryToken, error) {
	if d.cache == nil || d.sealer == nil {
		return nil, errors.New("connector refresh dedup is not configured")
	}
	sum := sha256.Sum256([]byte(connector + "\x00" + oldRefresh))
	key := hex.EncodeToString(sum[:])
	resultKey := "connectors:refresh:result:v1:" + key
	lockKey := "connectors:refresh:lock:v1:" + key

	if tok, ok := d.cached(ctx, resultKey); ok {
		return tok, nil
	}

	v, err, _ := d.sf.Do(key, func() (any, error) {
		// Token rotation must survive the first request disconnecting; otherwise
		// the upstream may consume the token while persistence is canceled.
		detached, cancel := context.WithTimeout(context.WithoutCancel(ctx), 25*time.Second)
		defer cancel()

		locked, err := d.cache.TryLock(detached, lockKey, connectorRefreshLockTTL)
		if err != nil {
			return nil, fmt.Errorf("acquire connector refresh lock: %w", err)
		}
		if !locked {
			deadline := time.Now().Add(connectorRefreshPollWait)
			for time.Now().Before(deadline) {
				if tok, ok := d.cached(detached, resultKey); ok {
					return tok, nil
				}
				select {
				case <-detached.Done():
					return nil, errConnectorRefreshInProgress
				case <-time.After(100 * time.Millisecond):
				}
			}
			return nil, errConnectorRefreshInProgress
		}
		unlock := true
		defer func() {
			if !unlock {
				return
			}
			if err := d.cache.Unlock(context.Background(), lockKey); err != nil && d.log != nil {
				d.log.Warn("connector refresh unlock failed", zap.Error(err))
			}
		}()

		if tok, ok := d.cached(detached, resultKey); ok {
			return tok, nil
		}
		tok, err := ory.refresh(detached, oldRefresh)
		if err != nil {
			return nil, err
		}

		if persist == nil {
			return nil, errors.New("connector refresh persistence is not configured")
		}
		if err := persist(detached, tok); err != nil {
			// The one-use upstream token may already be consumed. Keep the lock
			// until its TTL rather than immediately allowing a second rotation.
			unlock = false
			if errors.Is(err, errConnectorCredentialSuperseded) && tok.RefreshToken != "" {
				// A disconnect/reconnect fence won after the provider rotated the
				// one-use credential. Revoke the newly issued generation so an
				// orphan grant cannot outlive a successful disconnect.
				_ = ory.revoke(context.WithoutCancel(detached), tok.RefreshToken)
			}
			return nil, err
		}
		if err := d.store(detached, resultKey, tok); err != nil {
			// Persistence already succeeded, so do not fail the request. A cache
			// outage may make a replay return refresh_in_progress/error, but never
			// justifies issuing a second rotation call here.
			if d.log != nil {
				d.log.Warn("connector refresh result cache write failed", zap.Error(err))
			}
			unlock = false
		}
		return tok, nil
	})
	if err != nil {
		return nil, err
	}
	tok, ok := v.(*oryToken)
	if !ok || tok == nil {
		return nil, errors.New("invalid connector refresh result")
	}
	return tok, nil
}

func (d *refreshDeduper) cached(ctx context.Context, key string) (*oryToken, bool) {
	sealed, ok, err := d.cache.Get(ctx, key)
	if err != nil || !ok {
		return nil, false
	}
	raw, err := d.sealer.Open(sealed)
	if err != nil {
		return nil, false
	}
	var tok oryToken
	if json.Unmarshal(raw, &tok) != nil || tok.AccessToken == "" {
		return nil, false
	}
	return &tok, true
}

func (d *refreshDeduper) store(ctx context.Context, key string, tok *oryToken) error {
	raw, err := json.Marshal(tok)
	if err != nil {
		return err
	}
	sealed, err := d.sealer.Seal(raw)
	if err != nil {
		return err
	}
	return d.cache.Set(ctx, key, sealed, connectorRefreshResultTTL)
}
