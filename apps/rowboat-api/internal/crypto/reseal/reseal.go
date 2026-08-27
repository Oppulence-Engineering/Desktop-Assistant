// Package reseal inventories and re-encrypts connector credentials during
// DB_ENCRYPTION_KEY rotation. It deliberately uses compare-and-swap writes so
// an operational pass cannot overwrite a credential concurrently rotated by a
// live API replica.
package reseal

import (
	"bytes"
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strings"

	appcrypto "github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
)

// Source identifies one encrypted connector payload class.
type Source struct {
	Name   string `json:"name"`
	Table  string `json:"-"`
	Column string `json:"-"`
}

// ConnectorSources is the complete inventory of connector-related encrypted
// database payloads, including immutable history and durable revocation work.
var ConnectorSources = []Source{
	{Name: "mcp_connection.refresh_token", Table: "mcp_connections", Column: "refresh_token_encrypted"},
	{Name: "mcp_connection.api_key", Table: "mcp_connections", Column: "api_key_encrypted"},
	{Name: "mcp_connection_history.refresh_token", Table: "mcp_connection_histories", Column: "refresh_token_encrypted"},
	{Name: "mcp_connection_history.api_key", Table: "mcp_connection_histories", Column: "api_key_encrypted"},
	{Name: "oauth_pending.payload", Table: "oauth_pendings", Column: "payload_encrypted"},
	{Name: "connector_revocation_job.refresh_token", Table: "connector_revocation_jobs", Column: "refresh_token_encrypted"},
	{Name: "oauth_connection.refresh_token", Table: "oauth_connections", Column: "refresh_token_encrypted"},
	{Name: "oauth_connection_history.refresh_token", Table: "oauth_connection_histories", Column: "refresh_token_encrypted"},
}

// RefreshCachePrefix identifies encrypted cross-replica refresh results that
// must be included in key inventory and resealing.
const RefreshCachePrefix = "connectors:refresh:result:v1:"

// Record is one encrypted database value.
type Record struct {
	ID         string
	Ciphertext []byte
}

// Store provides resumable ordered scans and compare-and-swap replacement.
type Store interface {
	Scan(context.Context, Source, string, int) ([]Record, error)
	CompareAndSwap(context.Context, Source, Record, []byte) (bool, error)
}

// Cache provides the shared encrypted refresh-result cache operations needed by
// the rotation job. Cursor follows Redis SCAN semantics. A nil Cache means no
// shared cache is configured; in-process entries expire after 90 seconds.
type Cache interface {
	Scan(context.Context, uint64, string, int64) (keys []string, next uint64, err error)
	Get(context.Context, string) ([]byte, bool, error)
	CompareAndSwap(context.Context, string, []byte, []byte) (bool, error)
}

// Checkpoint is durably persisted by the command after every completed batch.
// Repeating a batch is safe because all writes are compare-and-swap and sealing
// with the primary key is idempotent at the semantic level.
type Checkpoint struct {
	SourceIndex int    `json:"source_index"`
	Cursor      string `json:"cursor,omitempty"`
	CacheCursor uint64 `json:"cache_cursor,omitempty"`
	Completed   bool   `json:"completed"`
}

// Report exposes aggregate and per-payload-class key dependency counts.
type Report struct {
	PrimaryKeyID string                      `json:"primary_key_id"`
	ByKey        map[string]int64            `json:"by_key"`
	BySource     map[string]map[string]int64 `json:"by_source"`
	Legacy       map[string]int64            `json:"legacy_by_key"`
	Scanned      int64                       `json:"scanned"`
	Resealed     int64                       `json:"resealed"`
	CASMisses    int64                       `json:"cas_misses"`
}

// Runner performs verified inventory and re-encryption.
type Runner struct {
	Store     Store
	Cache     Cache
	Sealer    *appcrypto.Sealer
	BatchSize int
}

// Inventory decrypts every payload to verify readability and attributes legacy
// ciphertext to the key that authenticated it.
func (r Runner) Inventory(ctx context.Context) (Report, error) {
	report := r.newReport()
	for _, source := range ConnectorSources {
		cursor := ""
		for {
			records, err := r.Store.Scan(ctx, source, cursor, r.batchSize())
			if err != nil {
				return report, fmt.Errorf("inventory %s after %q: %w", source.Name, cursor, err)
			}
			if len(records) == 0 {
				break
			}
			for _, record := range records {
				if err := r.inspect(&report, source.Name, record.Ciphertext); err != nil {
					return report, fmt.Errorf("inventory %s row %s: %w", source.Name, record.ID, err)
				}
				cursor = record.ID
			}
		}
	}
	if err := r.inventoryCache(ctx, &report); err != nil {
		return report, err
	}
	return report, nil
}

// Reseal resumes from checkpoint, verifies every ciphertext, and replaces every
// legacy/non-primary value with a fresh primary-key envelope. checkpoint is
// called after each database batch and Redis SCAN page.
func (r Runner) Reseal(ctx context.Context, state *Checkpoint, checkpoint func(Checkpoint) error) (Report, error) {
	if state == nil {
		state = &Checkpoint{}
	}
	if state.Completed {
		*state = Checkpoint{}
	}
	report := r.newReport()
	for sourceIndex := state.SourceIndex; sourceIndex < len(ConnectorSources); sourceIndex++ {
		source := ConnectorSources[sourceIndex]
		cursor := state.Cursor
		for {
			records, err := r.Store.Scan(ctx, source, cursor, r.batchSize())
			if err != nil {
				return report, fmt.Errorf("reseal %s after %q: %w", source.Name, cursor, err)
			}
			if len(records) == 0 {
				state.SourceIndex = sourceIndex + 1
				state.Cursor = ""
				if err := saveCheckpoint(checkpoint, *state); err != nil {
					return report, err
				}
				break
			}
			for _, record := range records {
				_, err := r.resealValue(ctx, &report, source.Name, record.Ciphertext, func(next []byte) (bool, error) {
					return r.Store.CompareAndSwap(ctx, source, record, next)
				})
				if err != nil {
					return report, fmt.Errorf("reseal %s row %s: %w", source.Name, record.ID, err)
				}
				cursor = record.ID
			}
			state.SourceIndex = sourceIndex
			state.Cursor = cursor
			if err := saveCheckpoint(checkpoint, *state); err != nil {
				return report, err
			}
		}
	}
	if r.Cache != nil {
		cursor := state.CacheCursor
		for {
			keys, next, err := r.Cache.Scan(ctx, cursor, RefreshCachePrefix+"*", int64(r.batchSize()))
			if err != nil {
				return report, fmt.Errorf("reseal connector refresh cache at cursor %d: %w", cursor, err)
			}
			sort.Strings(keys)
			for _, key := range keys {
				sealed, ok, err := r.Cache.Get(ctx, key)
				if err != nil {
					return report, fmt.Errorf("read connector refresh cache key: %w", err)
				}
				if !ok {
					continue
				}
				_, err = r.resealValue(ctx, &report, "connector_refresh_cache", sealed, func(resealed []byte) (bool, error) {
					return r.Cache.CompareAndSwap(ctx, key, sealed, resealed)
				})
				if err != nil {
					return report, fmt.Errorf("reseal connector refresh cache key: %w", err)
				}
			}
			state.CacheCursor = next
			if err := saveCheckpoint(checkpoint, *state); err != nil {
				return report, err
			}
			if next == 0 {
				break
			}
			cursor = next
		}
	}
	state.Completed = true
	state.SourceIndex = len(ConnectorSources)
	state.Cursor = ""
	state.CacheCursor = 0
	if err := saveCheckpoint(checkpoint, *state); err != nil {
		return report, err
	}
	return report, nil
}

// RetirementGate fails while any verified payload still depends on retiringKeyID.
func (r Runner) RetirementGate(ctx context.Context, retiringKeyID string) (Report, error) {
	retiringKeyID = strings.TrimSpace(retiringKeyID)
	if retiringKeyID == "" {
		return Report{}, fmt.Errorf("retiring key ID is required")
	}
	if retiringKeyID == r.Sealer.PrimaryKeyID() {
		return Report{}, fmt.Errorf("cannot retire active primary key %q", retiringKeyID)
	}
	report, err := r.Inventory(ctx)
	if err != nil {
		return report, err
	}
	if dependencies := report.ByKey[retiringKeyID]; dependencies != 0 {
		return report, fmt.Errorf("retirement blocked: %d encrypted connector payloads still depend on key %q", dependencies, retiringKeyID)
	}
	return report, nil
}

func (r Runner) inventoryCache(ctx context.Context, report *Report) error {
	if r.Cache == nil {
		return nil
	}
	var cursor uint64
	for {
		keys, next, err := r.Cache.Scan(ctx, cursor, RefreshCachePrefix+"*", int64(r.batchSize()))
		if err != nil {
			return fmt.Errorf("inventory connector refresh cache at cursor %d: %w", cursor, err)
		}
		for _, key := range keys {
			sealed, ok, err := r.Cache.Get(ctx, key)
			if err != nil {
				return fmt.Errorf("read connector refresh cache key: %w", err)
			}
			if ok {
				if err := r.inspect(report, "connector_refresh_cache", sealed); err != nil {
					return fmt.Errorf("inventory connector refresh cache key: %w", err)
				}
			}
		}
		if next == 0 {
			return nil
		}
		cursor = next
	}
}

func (r Runner) resealValue(ctx context.Context, report *Report, source string, sealed []byte, replace func([]byte) (bool, error)) (bool, error) {
	_ = ctx
	keyID, versioned, err := appcrypto.CiphertextKeyID(sealed)
	if err != nil {
		return false, err
	}
	plain, authenticatedKeyID, err := r.Sealer.OpenAndKeyID(sealed)
	if err != nil {
		return false, err
	}
	if keyID == "" {
		keyID = authenticatedKeyID
	}
	r.count(report, source, keyID, !versioned)
	if versioned && authenticatedKeyID == r.Sealer.PrimaryKeyID() {
		return false, nil
	}
	resealed, err := r.Sealer.Seal(plain)
	if err != nil {
		return false, err
	}
	updated, err := replace(resealed)
	if err != nil {
		return false, err
	}
	if updated {
		report.Resealed++
	} else {
		report.CASMisses++
	}
	return updated, nil
}

func (r Runner) inspect(report *Report, source string, sealed []byte) error {
	_, versioned, err := appcrypto.CiphertextKeyID(sealed)
	if err != nil {
		return err
	}
	_, keyID, err := r.Sealer.OpenAndKeyID(sealed)
	if err != nil {
		return err
	}
	r.count(report, source, keyID, !versioned)
	return nil
}

func (r Runner) count(report *Report, source, keyID string, legacy bool) {
	if keyID == "" {
		keyID = "unattributed-legacy"
	}
	report.Scanned++
	report.ByKey[keyID]++
	if report.BySource[source] == nil {
		report.BySource[source] = map[string]int64{}
	}
	report.BySource[source][keyID]++
	if legacy {
		report.Legacy[keyID]++
	}
}

func (r Runner) newReport() Report {
	return Report{PrimaryKeyID: r.Sealer.PrimaryKeyID(), ByKey: map[string]int64{}, BySource: map[string]map[string]int64{}, Legacy: map[string]int64{}}
}

func (r Runner) batchSize() int {
	if r.BatchSize <= 0 {
		return 250
	}
	if r.BatchSize > 5000 {
		return 5000
	}
	return r.BatchSize
}

func saveCheckpoint(fn func(Checkpoint) error, state Checkpoint) error {
	if fn == nil {
		return nil
	}
	if err := fn(state); err != nil {
		return fmt.Errorf("persist reseal checkpoint: %w", err)
	}
	return nil
}

// SQLStore implements Store over PostgreSQL or SQLite.
type SQLStore struct {
	DB      *sql.DB
	Dialect string
}

// Scan returns one stable ID-ordered page from a known encrypted source.
func (s SQLStore) Scan(ctx context.Context, source Source, cursor string, limit int) ([]Record, error) {
	if !knownSource(source) {
		return nil, fmt.Errorf("unknown encrypted source %q", source.Name)
	}
	// Source table and column names are selected only from ConnectorSources.
	query := fmt.Sprintf(`SELECT CAST("id" AS TEXT), "%s" FROM "%s" WHERE "%s" IS NOT NULL AND CAST("id" AS TEXT) > %s ORDER BY CAST("id" AS TEXT) LIMIT %s`, source.Column, source.Table, source.Column, s.bind(1), s.bind(2)) // #nosec G201
	rows, err := s.DB.QueryContext(ctx, query, cursor, limit)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var records []Record
	for rows.Next() {
		var record Record
		if err := rows.Scan(&record.ID, &record.Ciphertext); err != nil {
			return nil, err
		}
		record.Ciphertext = bytes.Clone(record.Ciphertext)
		records = append(records, record)
	}
	return records, rows.Err()
}

// CompareAndSwap replaces a ciphertext only if the scanned value is unchanged.
func (s SQLStore) CompareAndSwap(ctx context.Context, source Source, record Record, replacement []byte) (bool, error) {
	if !knownSource(source) {
		return false, fmt.Errorf("unknown encrypted source %q", source.Name)
	}
	// Source table and column names are selected only from ConnectorSources.
	query := fmt.Sprintf(`UPDATE "%s" SET "%s" = %s WHERE "id" = %s AND "%s" = %s`, source.Table, source.Column, s.bind(1), s.bind(2), source.Column, s.bind(3)) // #nosec G201
	result, err := s.DB.ExecContext(ctx, query, replacement, record.ID, record.Ciphertext)
	if err != nil {
		return false, err
	}
	rows, err := result.RowsAffected()
	return rows == 1, err
}

func (s SQLStore) bind(position int) string {
	if strings.EqualFold(s.Dialect, "postgres") {
		return fmt.Sprintf("$%d", position)
	}
	return "?"
}

func knownSource(candidate Source) bool {
	for _, source := range ConnectorSources {
		if candidate == source {
			return true
		}
	}
	return false
}
