package reseal

import (
	"bytes"
	"context"
	"errors"
	"sort"
	"strings"
	"sync"
	"testing"

	appcrypto "github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
)

type fakeStore struct {
	mu   sync.Mutex
	rows map[string]map[string][]byte
}

func (s *fakeStore) Scan(_ context.Context, source Source, cursor string, limit int) ([]Record, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ids := make([]string, 0, len(s.rows[source.Name]))
	for id := range s.rows[source.Name] {
		if id > cursor {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	if len(ids) > limit {
		ids = ids[:limit]
	}
	out := make([]Record, 0, len(ids))
	for _, id := range ids {
		out = append(out, Record{ID: id, Ciphertext: bytes.Clone(s.rows[source.Name][id])})
	}
	return out, nil
}

func (s *fakeStore) CompareAndSwap(_ context.Context, source Source, record Record, next []byte) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	current := s.rows[source.Name][record.ID]
	if !bytes.Equal(current, record.Ciphertext) {
		return false, nil
	}
	s.rows[source.Name][record.ID] = bytes.Clone(next)
	return true, nil
}

type fakeCache struct {
	mu     sync.Mutex
	values map[string][]byte
}

func TestConnectorSourcesContainOnlyLiveCredentialStores(t *testing.T) {
	want := map[string]Source{
		"mcp_connection.refresh_token":                   {Name: "mcp_connection.refresh_token", Table: "mcp_connections", Column: "refresh_token_encrypted"},
		"mcp_connection.api_key":                         {Name: "mcp_connection.api_key", Table: "mcp_connections", Column: "api_key_encrypted"},
		"oauth_pending.payload":                          {Name: "oauth_pending.payload", Table: "oauth_pendings", Column: "payload_encrypted"},
		"connector_revocation_job.refresh_token":         {Name: "connector_revocation_job.refresh_token", Table: "connector_revocation_jobs", Column: "refresh_token_encrypted"},
		"connector_credential_cleanup_job.refresh_token": {Name: "connector_credential_cleanup_job.refresh_token", Table: "connector_credential_cleanup_jobs", Column: "refresh_token_encrypted"},
		"connector_credential_recovery.refresh_token":    {Name: "connector_credential_recovery.refresh_token", Table: "connector_credential_recoveries", Column: "refresh_token_encrypted"},
		"oauth_connection.refresh_token":                 {Name: "oauth_connection.refresh_token", Table: "oauth_connections", Column: "refresh_token_encrypted"},
	}
	for _, source := range ConnectorSources {
		if strings.Contains(source.Name, "history") || strings.Contains(source.Table, "histories") {
			t.Fatalf("immutable history remains in live reseal inventory: %+v", source)
		}
		expected, ok := want[source.Name]
		if !ok || source != expected {
			t.Fatalf("unexpected reseal source: %+v", source)
		}
		delete(want, source.Name)
	}
	if len(want) != 0 {
		t.Fatalf("missing live reseal sources: %v", want)
	}
}

func TestRecoveryRowsAndRollingRefreshCachesBlockRetirementUntilResealed(t *testing.T) {
	oldOnly, err := appcrypto.NewKeyringSealer("old", map[string]string{"old": "old-key-material"})
	if err != nil {
		t.Fatal(err)
	}
	rotating, err := appcrypto.NewKeyringSealer("new", map[string]string{"old": "old-key-material", "new": "new-key-material"})
	if err != nil {
		t.Fatal(err)
	}
	oldRecovery, _ := oldOnly.SealString("recovery-token")
	oldV2Result, _ := oldOnly.SealString("current-cache-result")
	oldV1Result, _ := oldOnly.SealString("rolling-cache-result")
	recoverySource := Source{Name: "connector_credential_recovery.refresh_token", Table: "connector_credential_recoveries", Column: "refresh_token_encrypted"}
	store := &fakeStore{rows: map[string]map[string][]byte{
		recoverySource.Name: {"recovery-001": oldRecovery},
	}}
	cache := &fakeCache{values: map[string][]byte{
		"connectors:refresh:result:v2:current": oldV2Result,
		"connectors:refresh:result:v1:rolling": oldV1Result,
		"connectors:refresh:result:v0:expired": oldV1Result,
	}}
	runner := Runner{Store: store, Cache: cache, Sealer: rotating, BatchSize: 1}

	report, err := runner.RetirementGate(context.Background(), "old")
	if err == nil {
		t.Fatal("retirement gate allowed recovery and refresh-cache dependencies")
	}
	if report.BySource[recoverySource.Name]["old"] != 1 || report.BySource["connector_refresh_cache"]["old"] != 2 {
		t.Fatalf("retirement inventory missed recovery or rolling cache dependencies: %+v", report)
	}

	state := Checkpoint{}
	resealed, err := runner.Reseal(context.Background(), &state, func(next Checkpoint) error {
		state = next
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if resealed.Resealed != 3 {
		t.Fatalf("resealed = %d, want recovery plus v2 and retained v1 cache", resealed.Resealed)
	}
	if _, err := runner.RetirementGate(context.Background(), "old"); err != nil {
		t.Fatalf("retirement remained blocked after complete reseal: %v", err)
	}
	for _, key := range []string{"connectors:refresh:result:v2:current", "connectors:refresh:result:v1:rolling"} {
		sealed, _, _ := cache.Get(context.Background(), key)
		if _, keyID, err := rotating.OpenAndKeyID(sealed); err != nil || keyID != "new" {
			t.Fatalf("cache key %q was not resealed: key=%q err=%v", key, keyID, err)
		}
	}
	sealedRecovery := store.rows[recoverySource.Name]["recovery-001"]
	if _, keyID, err := rotating.OpenAndKeyID(sealedRecovery); err != nil || keyID != "new" {
		t.Fatalf("recovery row was not resealed: key=%q err=%v", keyID, err)
	}
	untouched, _, _ := cache.Get(context.Background(), "connectors:refresh:result:v0:expired")
	if _, keyID, err := rotating.OpenAndKeyID(untouched); err != nil || keyID != "old" {
		t.Fatalf("unretained cache generation changed: key=%q err=%v", keyID, err)
	}
}

func (c *fakeCache) Scan(_ context.Context, cursor uint64, pattern string, limit int64) ([]string, uint64, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	prefix := strings.TrimSuffix(pattern, "*")
	keys := make([]string, 0, len(c.values))
	for key := range c.values {
		if strings.HasPrefix(key, prefix) {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	start := int(cursor)
	if start >= len(keys) {
		return nil, 0, nil
	}
	end := start + int(limit)
	if end >= len(keys) {
		end = len(keys)
		return keys[start:end], 0, nil
	}
	return keys[start:end], uint64(end), nil
}

func (c *fakeCache) Get(_ context.Context, key string) ([]byte, bool, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	value, ok := c.values[key]
	return bytes.Clone(value), ok, nil
}

func (c *fakeCache) CompareAndSwap(_ context.Context, key string, old, next []byte) (bool, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !bytes.Equal(c.values[key], old) {
		return false, nil
	}
	c.values[key] = bytes.Clone(next)
	return true, nil
}

func TestInventoryResealResumeAndRetirementGate(t *testing.T) {
	oldOnly, err := appcrypto.NewKeyringSealer("old", map[string]string{"old": "old-key-material"})
	if err != nil {
		t.Fatal(err)
	}
	rotating, err := appcrypto.NewKeyringSealer("new", map[string]string{"old": "old-key-material", "new": "new-key-material"})
	if err != nil {
		t.Fatal(err)
	}
	legacy, err := appcrypto.NewSealer("old-key-material")
	if err != nil {
		t.Fatal(err)
	}
	oldEnvelope, _ := oldOnly.SealString("old-envelope")
	legacyCiphertext, _ := legacy.SealString("legacy")
	primary, _ := rotating.SealString("primary")
	cacheOld, _ := oldOnly.SealString("cache")

	store := &fakeStore{rows: map[string]map[string][]byte{
		ConnectorSources[0].Name: {"001": oldEnvelope, "002": legacyCiphertext, "003": primary},
	}}
	cache := &fakeCache{values: map[string][]byte{RefreshCachePrefix + "one": cacheOld, "unrelated": oldEnvelope}}
	runner := Runner{Store: store, Cache: cache, Sealer: rotating, BatchSize: 1}

	before, err := runner.Inventory(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if before.ByKey["old"] != 3 || before.ByKey["new"] != 1 || before.Legacy["old"] != 1 {
		t.Fatalf("unexpected inventory: %+v", before)
	}
	if _, err := runner.RetirementGate(context.Background(), "old"); err == nil {
		t.Fatal("retirement gate allowed dependent old key")
	}

	state := Checkpoint{}
	checkpoints := 0
	stop := errors.New("simulated interruption")
	_, err = runner.Reseal(context.Background(), &state, func(next Checkpoint) error {
		state = next
		checkpoints++
		if checkpoints == 1 {
			return stop
		}
		return nil
	})
	if !errors.Is(err, stop) {
		t.Fatalf("interrupted reseal error = %v", err)
	}
	if state.Cursor != "001" {
		t.Fatalf("checkpoint cursor = %q, want 001", state.Cursor)
	}

	report, err := runner.Reseal(context.Background(), &state, func(next Checkpoint) error { state = next; return nil })
	if err != nil {
		t.Fatal(err)
	}
	if !state.Completed || report.Resealed != 2 { // legacy DB row + cache; 001 was committed before interruption.
		t.Fatalf("resume state/report = %+v / %+v", state, report)
	}
	for _, ciphertext := range store.rows[ConnectorSources[0].Name] {
		_, keyID, err := rotating.OpenAndKeyID(ciphertext)
		if err != nil || keyID != "new" {
			t.Fatalf("database ciphertext was not resealed: key=%q err=%v", keyID, err)
		}
	}
	cached, _, _ := cache.Get(context.Background(), RefreshCachePrefix+"one")
	if _, keyID, err := rotating.OpenAndKeyID(cached); err != nil || keyID != "new" {
		t.Fatalf("cache ciphertext was not resealed: key=%q err=%v", keyID, err)
	}
	if _, err := runner.RetirementGate(context.Background(), "old"); err != nil {
		t.Fatalf("retirement remained blocked after verified reseal: %v", err)
	}

	retired, err := appcrypto.NewKeyringSealer("new", map[string]string{"new": "new-key-material"})
	if err != nil {
		t.Fatal(err)
	}
	for _, ciphertext := range store.rows[ConnectorSources[0].Name] {
		if _, err := retired.Open(ciphertext); err != nil {
			t.Fatalf("post-retirement read failed: %v", err)
		}
	}
}

func TestResealUsesCompareAndSwap(t *testing.T) {
	oldOnly, _ := appcrypto.NewKeyringSealer("old", map[string]string{"old": "old"})
	rotating, _ := appcrypto.NewKeyringSealer("new", map[string]string{"old": "old", "new": "new"})
	oldCiphertext, _ := oldOnly.SealString("stale")
	newCiphertext, _ := rotating.SealString("concurrent")
	store := &fakeStore{rows: map[string]map[string][]byte{ConnectorSources[0].Name: {"001": oldCiphertext}}}

	records, _ := store.Scan(context.Background(), ConnectorSources[0], "", 1)
	store.rows[ConnectorSources[0].Name]["001"] = newCiphertext
	report := Runner{Store: store, Sealer: rotating}.newReport()
	updated, err := (Runner{Store: store, Sealer: rotating}).resealValue(context.Background(), &report, ConnectorSources[0].Name, records[0].Ciphertext, func(next []byte) (bool, error) {
		return store.CompareAndSwap(context.Background(), ConnectorSources[0], records[0], next)
	})
	if err != nil || updated || report.CASMisses != 1 {
		t.Fatalf("CAS result updated=%v report=%+v err=%v", updated, report, err)
	}
	plain, err := rotating.Open(store.rows[ConnectorSources[0].Name]["001"])
	if err != nil || string(plain) != "concurrent" {
		t.Fatalf("concurrent value was overwritten: %q %v", plain, err)
	}
}
