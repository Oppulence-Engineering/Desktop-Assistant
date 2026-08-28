package connectors

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/google/uuid"
	"go.uber.org/zap"
	"golang.org/x/sync/singleflight"
)

const (
	connectorRefreshResultTTL = 90 * time.Second
	connectorRefreshLockTTL   = 45 * time.Second
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
	TryLock(context.Context, string, time.Duration) (string, bool, error)
	Renew(context.Context, string, string, time.Duration) (bool, error)
	Unlock(context.Context, string, string) error
}

// connectorRefreshContext binds one cached provider result to the immutable
// connection identity and the exact credential generation that initiated the
// rotation. Generation changes fence cached results after disconnect,
// invalidation, reconnect, and subsequent credential rotation.
type connectorRefreshContext struct {
	Connector                    string   `json:"connector"`
	ConnectionID                 string   `json:"connection_id"`
	OrganizationID               string   `json:"organization_id"`
	ExpectedCredentialGeneration int64    `json:"expected_credential_generation"`
	Audience                     string   `json:"audience"`
	GrantedScopes                []string `json:"granted_scopes"`
}

func newConnectorRefreshContext(connector, connectionID, organizationID string, generation int64, audience string, scopes []string) connectorRefreshContext {
	canonicalScopes := slices.Clone(scopes)
	slices.Sort(canonicalScopes)
	canonicalScopes = slices.Compact(canonicalScopes)
	return connectorRefreshContext{
		Connector:                    connector,
		ConnectionID:                 connectionID,
		OrganizationID:               organizationID,
		ExpectedCredentialGeneration: generation,
		Audience:                     audience,
		GrantedScopes:                canonicalScopes,
	}
}

func (c connectorRefreshContext) valid() bool {
	return c.Connector != "" && c.ConnectionID != "" && c.OrganizationID != "" && c.ExpectedCredentialGeneration > 0 && c.Audience != ""
}

func (c connectorRefreshContext) equal(other connectorRefreshContext) bool {
	return c.Connector == other.Connector &&
		c.ConnectionID == other.ConnectionID &&
		c.OrganizationID == other.OrganizationID &&
		c.ExpectedCredentialGeneration == other.ExpectedCredentialGeneration &&
		c.Audience == other.Audience &&
		slices.Equal(c.GrantedScopes, other.GrantedScopes)
}

type connectorRefreshResult struct {
	Context                     connectorRefreshContext `json:"context"`
	CurrentCredentialGeneration int64                   `json:"current_credential_generation"`
	Token                       oryToken                `json:"token"`
}

func (r *connectorRefreshResult) validFor(expected connectorRefreshContext) bool {
	if r == nil || !r.Context.equal(expected) || r.Token.AccessToken == "" {
		return false
	}
	currentGeneration := expected.ExpectedCredentialGeneration
	if r.Token.RefreshToken != "" {
		currentGeneration++
	}
	return r.CurrentCredentialGeneration == currentGeneration
}

// refreshDeduper serializes rotation of one-use connector refresh tokens both
// within a process and across replicas. Successful results are sealed before
// entering Redis because they contain live access and refresh credentials.
type refreshDeduper struct {
	cache                        RefreshCache
	sealer                       *crypto.Sealer
	client                       *ent.Client
	log                          *zap.Logger
	custody                      *credentialCustodySupervisor
	afterProviderResponseForTest func()
	sf                           singleflight.Group
}

func (d *refreshDeduper) configure(cache RefreshCache, sealer *crypto.Sealer, client *ent.Client, log *zap.Logger) {
	d.cache = cache
	d.sealer = sealer
	d.client = client
	d.log = log
}

func (d *refreshDeduper) refresh(
	ctx context.Context,
	bound connectorRefreshContext,
	ory *oryClient,
	oldRefresh string,
	persist func(context.Context, *oryToken, uuid.UUID) (int64, error),
) (*connectorRefreshResult, error) {
	if d.cache == nil || d.sealer == nil {
		return nil, errors.New("connector refresh dedup is not configured")
	}
	if !bound.valid() || oldRefresh == "" {
		return nil, errors.New("connector refresh context is incomplete")
	}
	keyMaterial, err := json.Marshal(struct {
		Context      connectorRefreshContext `json:"context"`
		RefreshToken string                  `json:"refresh_token"`
	}{Context: bound, RefreshToken: oldRefresh})
	if err != nil {
		return nil, fmt.Errorf("marshal connector refresh context: %w", err)
	}
	sum := sha256.Sum256(keyMaterial)
	key := hex.EncodeToString(sum[:])
	resultKey := "connectors:refresh:result:v2:" + key
	lockKey := "connectors:refresh:lock:v2:" + key

	if result, ok := d.cached(ctx, resultKey, bound); ok {
		return result, nil
	}

	v, err, _ := d.sf.Do(key, func() (any, error) {
		// Token rotation must survive the first request disconnecting. Otherwise
		// the upstream may consume the token while persistence is canceled.
		detached, cancel := context.WithTimeout(context.WithoutCancel(ctx), 25*time.Second)
		defer cancel()

		owner, locked, err := d.cache.TryLock(detached, lockKey, connectorRefreshLockTTL)
		if err != nil {
			return nil, fmt.Errorf("acquire connector refresh lock: %w", err)
		}
		if !locked {
			deadline := time.Now().Add(connectorRefreshPollWait)
			for time.Now().Before(deadline) {
				if result, ok := d.cached(detached, resultKey, bound); ok {
					return result, nil
				}
				select {
				case <-detached.Done():
					return nil, errConnectorRefreshInProgress
				case <-time.After(100 * time.Millisecond):
				}
			}
			return nil, errConnectorRefreshInProgress
		}
		stopRenewal := keepConnectorRefreshLease(detached, cancel, d.cache, lockKey, owner, connectorRefreshLockTTL, d.log)
		defer stopRenewal()
		unlock := true
		defer func() {
			if !unlock {
				return
			}
			if err := d.cache.Unlock(context.Background(), lockKey, owner); err != nil && d.log != nil {
				d.log.Warn("connector refresh unlock failed", zap.Error(err))
			}
		}()

		if result, ok := d.cached(detached, resultKey, bound); ok {
			return result, nil
		}
		if err := requireConnectorRefreshOwnership(detached, d.cache, lockKey, owner); err != nil {
			return nil, err
		}
		var permit *credentialCustodyPermit
		if d.custody != nil {
			permit, err = d.custody.acquireProviderOperation()
			if err != nil {
				return nil, err
			}
			defer permit.release()
		}
		tok, err := ory.refresh(detached, oldRefresh)
		if err != nil {
			return nil, err
		}
		// This hook marks the exact irreducible crash boundary for tests. No
		// production work may be inserted between provider response receipt and
		// encrypted custody establishment below.
		if d.afterProviderResponseForTest != nil {
			d.afterProviderResponseForTest()
		}

		if persist == nil || d.client == nil {
			return nil, errors.New("connector refresh persistence is not configured")
		}
		cleanupID := uuid.Nil
		if tok.RefreshToken != "" {
			escrowCtx, escrowCancel := context.WithTimeout(context.WithoutCancel(detached), 5*time.Second)
			cleanupID, err = d.enqueueCredentialCleanup(escrowCtx, bound, tok.RefreshToken)
			escrowCancel()
			if err != nil {
				// The normal cleanup outbox and the recovery journal are distinct
				// durable ownership paths. If the primary insert fails, first try to
				// confirm revocation. When that is also unavailable, the encrypted
				// credential must enter the independent journal before this call can
				// return. No connection persistence is attempted after an unconfirmed
				// revoke, because the provider may already have accepted it.
				if revokeErr := revokeCredentialBounded(context.WithoutCancel(detached), ory, tok.RefreshToken); revokeErr != nil {
					recoveryID, revoked, recoveryErr := establishCredentialRecovery(
						d.custody, permit, d.client, d.sealer, ory, d.log, uuid.New(),
						bound.Connector, credentialRecoveryOwnerRotation, bound.ConnectionID,
						tok.RefreshToken, time.Now().UTC(),
					)
					if revoked {
						return nil, fmt.Errorf("durably escrow rotated connector credential: %w; provider revocation confirmed during recovery", err)
					}
					if recoveryErr != nil {
						return nil, fmt.Errorf(
							"durably escrow rotated connector credential: %w",
							errors.Join(err, fmt.Errorf("credential recovery: %w", recoveryErr)),
						)
					}
					return nil, fmt.Errorf("durably escrow rotated connector credential: %w; encrypted recovery journal %s retained", err, recoveryID)
				}
				return nil, fmt.Errorf("durably escrow rotated connector credential: %w", err)
			}
		}
		if err := requireConnectorRefreshOwnership(detached, d.cache, lockKey, owner); err != nil {
			d.compensateCredential(context.WithoutCancel(detached), ory, cleanupID, tok.RefreshToken, "lease_lost_before_persist")
			return nil, err
		}
		currentGeneration, err := persist(detached, tok, cleanupID)
		if err != nil {
			// The one-use upstream token may already be consumed. Keep the lock
			// until its TTL rather than immediately allowing a second rotation.
			unlock = false
			d.compensateCredential(context.WithoutCancel(detached), ory, cleanupID, tok.RefreshToken, "persistence_declined")
			return nil, err
		}
		result := &connectorRefreshResult{
			Context:                     bound,
			CurrentCredentialGeneration: currentGeneration,
			Token:                       *tok,
		}
		if !result.validFor(bound) {
			unlock = false
			d.compensateCredential(context.WithoutCancel(detached), ory, cleanupID, tok.RefreshToken, "generation_mismatch")
			return nil, errors.New("connector refresh persistence returned an unexpected credential generation")
		}
		if err := requireConnectorRefreshOwnership(detached, d.cache, lockKey, owner); err != nil {
			return nil, err
		}
		if err := d.store(detached, resultKey, result); err != nil {
			// Persistence already succeeded, so do not fail the request. A cache
			// outage may make a replay return refresh_in_progress/error, but never
			// justifies issuing a second rotation call here.
			if d.log != nil {
				d.log.Warn("connector refresh result cache write failed", zap.Error(err))
			}
			unlock = false
		}
		return result, nil
	})
	if err != nil {
		return nil, err
	}
	result, ok := v.(*connectorRefreshResult)
	if !ok || !result.validFor(bound) {
		return nil, errors.New("invalid connector refresh result")
	}
	return result, nil
}

func requireConnectorRefreshOwnership(ctx context.Context, cache RefreshCache, key, owner string) error {
	owned, err := cache.Renew(ctx, key, owner, connectorRefreshLockTTL)
	if err != nil {
		return fmt.Errorf("renew connector refresh lock: %w", err)
	}
	if !owned {
		return errConnectorRefreshInProgress
	}
	return nil
}

func keepConnectorRefreshLease(ctx context.Context, cancel context.CancelFunc, cache RefreshCache, key, owner string, ttl time.Duration, log *zap.Logger) func() {
	stop := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(ttl / 3)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ctx.Done():
				return
			case <-ticker.C:
				owned, err := cache.Renew(ctx, key, owner, ttl)
				if err != nil || !owned {
					if log != nil {
						log.Warn("connector refresh lock renewal failed", zap.Bool("still_owner", owned), zap.Error(err))
					}
					cancel()
					return
				}
			}
		}
	}()
	return func() {
		close(stop)
		<-done
	}
}

func (d *refreshDeduper) cached(ctx context.Context, key string, expected connectorRefreshContext) (*connectorRefreshResult, bool) {
	sealed, ok, err := d.cache.Get(ctx, key)
	if err != nil || !ok {
		return nil, false
	}
	raw, err := d.sealer.Open(sealed)
	if err != nil {
		return nil, false
	}
	var result connectorRefreshResult
	if json.Unmarshal(raw, &result) != nil || !result.validFor(expected) {
		return nil, false
	}
	return &result, true
}

func (d *refreshDeduper) store(ctx context.Context, key string, result *connectorRefreshResult) error {
	raw, err := json.Marshal(result)
	if err != nil {
		return err
	}
	sealed, err := d.sealer.Seal(raw)
	if err != nil {
		return err
	}
	return d.cache.Set(ctx, key, sealed, connectorRefreshResultTTL)
}
