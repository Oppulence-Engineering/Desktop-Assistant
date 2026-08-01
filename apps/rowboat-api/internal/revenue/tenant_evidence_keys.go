package revenue

import (
	"context"
	cryptorand "crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/tenantevidencekey"
	appcrypto "github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
)

var (
	// ErrEvidenceEncryptionUnavailable means the deployment has no configured
	// key-encryption key and therefore must refuse evidence writes.
	ErrEvidenceEncryptionUnavailable = errors.New("revenue: tenant evidence encryption unavailable")
	// ErrEvidenceKeyDestroyed means the tenant deliberately erased the wrapping
	// material needed to read retained evidence ciphertext.
	ErrEvidenceKeyDestroyed = errors.New("revenue: tenant evidence key destroyed")
)

// TenantEvidenceKeyManager wraps per-workspace data-encryption keys with the
// deployment key-encryption key and never persists plaintext tenant keys.
type TenantEvidenceKeyManager struct {
	client *ent.Client
	kek    *appcrypto.Sealer
	log    *zap.Logger
	now    func() time.Time
}

// EvidenceKeyStatus is the non-secret key lifecycle metadata returned to
// owners and diagnostics.
type EvidenceKeyStatus struct {
	Version        int        `json:"version"`
	Status         string     `json:"status"`
	KeyFingerprint string     `json:"keyFingerprint"`
	CreatedAt      time.Time  `json:"createdAt"`
	RotatedAt      *time.Time `json:"rotatedAt,omitempty"`
	DestroyedAt    *time.Time `json:"destroyedAt,omitempty"`
	ErasureProof   string     `json:"erasureProof,omitempty"`
}

// NewTenantEvidenceKeyManager constructs the tenant envelope-key manager.
func NewTenantEvidenceKeyManager(
	client *ent.Client,
	kek *appcrypto.Sealer,
	log *zap.Logger,
) *TenantEvidenceKeyManager {
	if log == nil {
		log = zap.NewNop()
	}
	return &TenantEvidenceKeyManager{
		client: client, kek: kek, log: log, now: func() time.Time { return time.Now().UTC() },
	}
}

// SetEvidenceSealer configures the deployment key-encryption key used by all
// subsequent tenant evidence operations.
func (s *Service) SetEvidenceSealer(sealer *appcrypto.Sealer) {
	s.sealer = sealer
	if sealer == nil {
		s.evidenceKeys = nil
		return
	}
	s.evidenceKeys = NewTenantEvidenceKeyManager(s.client, sealer, s.log)
}

// Seal encrypts evidence under the workspace's active data-encryption key and
// returns the key version required for later decryption.
func (m *TenantEvidenceKeyManager) Seal(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	u *ent.User,
	plaintext []byte,
) ([]byte, int, error) {
	key, err := m.activeKey(ctx, client, ws, u)
	if err != nil {
		return nil, 0, err
	}
	dek, err := m.kek.Open(key.WrappedKey)
	if err != nil {
		return nil, 0, fmt.Errorf("unwrap tenant evidence key: %w", err)
	}
	defer wipeBytes(dek)
	sealer, err := appcrypto.NewSealerFromKey(dek)
	if err != nil {
		return nil, 0, err
	}
	sealed, err := sealer.SealWithAAD(plaintext, evidenceKeyAAD(ws.ID, key.Version))
	return sealed, key.Version, err
}

// Open decrypts ciphertext only with a live or retired key version belonging
// to the requested workspace.
func (m *TenantEvidenceKeyManager) Open(
	ctx context.Context,
	workspaceID uuid.UUID,
	version int,
	ciphertext []byte,
) ([]byte, error) {
	if version == 0 {
		// Rows written before per-tenant envelopes remain readable until an
		// operator rewraps them; new writes never use version zero.
		return m.kek.Open(ciphertext)
	}
	key, err := m.client.TenantEvidenceKey.Query().
		Where(
			tenantevidencekey.VersionEQ(version),
			tenantevidencekey.StatusIn("active", "retired"),
			tenantevidencekey.HasWorkspaceWith(revenueworkspace.IDEQ(workspaceID)),
		).
		Only(ctx)
	if ent.IsNotFound(err) {
		return nil, ErrEvidenceKeyDestroyed
	}
	if err != nil {
		return nil, err
	}
	if len(key.WrappedKey) == 0 {
		return nil, ErrEvidenceKeyDestroyed
	}
	dek, err := m.kek.Open(key.WrappedKey)
	if err != nil {
		return nil, fmt.Errorf("unwrap tenant evidence key: %w", err)
	}
	defer wipeBytes(dek)
	sealer, err := appcrypto.NewSealerFromKey(dek)
	if err != nil {
		return nil, err
	}
	return sealer.OpenWithAAD(ciphertext, evidenceKeyAAD(workspaceID, version))
}

func (m *TenantEvidenceKeyManager) activeKey(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	u *ent.User,
) (*ent.TenantEvidenceKey, error) {
	key, err := client.TenantEvidenceKey.Query().
		Where(
			tenantevidencekey.StatusEQ("active"),
			tenantevidencekey.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
		).
		Only(ctx)
	if err == nil {
		return key, nil
	}
	if !ent.IsNotFound(err) {
		return nil, err
	}
	destroyed, err := client.TenantEvidenceKey.Query().
		Where(
			tenantevidencekey.StatusEQ("destroyed"),
			tenantevidencekey.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
		).
		Exist(ctx)
	if err != nil {
		return nil, err
	}
	if destroyed {
		return nil, ErrEvidenceKeyDestroyed
	}
	return m.createKeyVersion(ctx, client, ws, u, 1)
}

func (m *TenantEvidenceKeyManager) createKeyVersion(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	u *ent.User,
	version int,
) (*ent.TenantEvidenceKey, error) {
	dek := make([]byte, 32)
	if _, err := io.ReadFull(cryptorand.Reader, dek); err != nil {
		return nil, fmt.Errorf("generate tenant evidence key: %w", err)
	}
	defer wipeBytes(dek)
	wrapped, err := m.kek.Seal(dek)
	if err != nil {
		return nil, err
	}
	fingerprint := sha256.Sum256(dek)
	key, err := client.TenantEvidenceKey.Create().
		SetWorkspace(ws).
		SetUser(u).
		SetVersion(version).
		SetStatus("active").
		SetWrappedKey(wrapped).
		SetKeyFingerprint("sha256:" + hex.EncodeToString(fingerprint[:])).
		Save(ctx)
	if err == nil {
		return key, nil
	}
	if !ent.IsConstraintError(err) {
		return nil, err
	}
	return client.TenantEvidenceKey.Query().
		Where(
			tenantevidencekey.VersionEQ(version),
			tenantevidencekey.StatusEQ("active"),
			tenantevidencekey.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
		).
		Only(ctx)
}

// RotateTenantEvidenceKey retires the active workspace key and atomically
// creates the next wrapped version.
func (s *Service) RotateTenantEvidenceKey(
	ctx context.Context,
	u *ent.User,
) (*EvidenceKeyStatus, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceManageSources)
	if err != nil {
		return nil, err
	}
	if s.evidenceKeys == nil {
		return nil, ErrEvidenceEncryptionUnavailable
	}
	latest, err := s.client.TenantEvidenceKey.Query().
		Where(tenantevidencekey.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID))).
		Order(ent.Desc(tenantevidencekey.FieldVersion)).
		First(ctx)
	if ent.IsNotFound(err) {
		latest, err = s.evidenceKeys.activeKey(ctx, s.client, ws, u)
	}
	if err != nil {
		return nil, err
	}
	if latest.Status == "destroyed" {
		return nil, ErrEvidenceKeyDestroyed
	}
	now := s.now().UTC()
	tx, err := s.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := tx.Client().TenantEvidenceKey.Update().
		Where(
			tenantevidencekey.StatusEQ("active"),
			tenantevidencekey.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
		).
		SetStatus("retired").
		SetRotatedAt(now).
		Save(ctx); err != nil {
		_ = tx.Rollback()
		return nil, err
	}
	created, err := s.evidenceKeys.createKeyVersion(ctx, tx.Client(), ws, u, latest.Version+1)
	if err != nil {
		_ = tx.Rollback()
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return evidenceKeyStatus(created.Unwrap()), nil
}

// DestroyTenantEvidenceKeys cryptographically erases every readable tenant key
// version and disconnects the workspace; only an owner may invoke it.
func (s *Service) DestroyTenantEvidenceKeys(
	ctx context.Context,
	u *ent.User,
) ([]EvidenceKeyStatus, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceManageSources)
	if err != nil {
		return nil, err
	}
	role, err := s.WorkspaceRole(ctx, u, ws)
	if err != nil {
		return nil, err
	}
	if role != "owner" {
		return nil, ErrForbidden
	}
	if s.evidenceKeys == nil {
		return nil, ErrEvidenceEncryptionUnavailable
	}
	keys, err := s.client.TenantEvidenceKey.Query().
		Where(
			tenantevidencekey.StatusNEQ("destroyed"),
			tenantevidencekey.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
		).
		Order(ent.Asc(tenantevidencekey.FieldVersion)).
		All(ctx)
	if err != nil {
		return nil, err
	}
	now := s.now().UTC()
	tx, err := s.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	statuses := make([]EvidenceKeyStatus, 0, len(keys))
	for _, key := range keys {
		proof := evidenceErasureProof(ws.ID, key, now)
		destroyed, updateErr := tx.Client().TenantEvidenceKey.UpdateOneID(key.ID).
			SetStatus("destroyed").
			ClearWrappedKey().
			SetDestroyedAt(now).
			SetErasureProof(proof).
			Save(ctx)
		if updateErr != nil {
			_ = tx.Rollback()
			return nil, updateErr
		}
		statuses = append(statuses, *evidenceKeyStatus(destroyed))
	}
	if _, err := tx.Client().RevenueWorkspace.UpdateOneID(ws.ID).
		SetStatus("disconnected").
		Save(ctx); err != nil {
		_ = tx.Rollback()
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	s.log.Warn("tenant evidence keys cryptographically erased",
		zap.String("workspace", ws.ID.String()), zap.Int("versions", len(statuses)))
	return statuses, nil
}

// TenantEvidenceKeyStatuses returns non-secret lifecycle metadata for all key
// versions in the current workspace.
func (s *Service) TenantEvidenceKeyStatuses(
	ctx context.Context,
	u *ent.User,
) ([]EvidenceKeyStatus, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceView)
	if err != nil {
		return nil, err
	}
	keys, err := s.client.TenantEvidenceKey.Query().
		Where(tenantevidencekey.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID))).
		Order(ent.Asc(tenantevidencekey.FieldVersion)).All(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]EvidenceKeyStatus, 0, len(keys))
	for _, key := range keys {
		out = append(out, *evidenceKeyStatus(key))
	}
	return out, nil
}

func evidenceKeyStatus(key *ent.TenantEvidenceKey) *EvidenceKeyStatus {
	return &EvidenceKeyStatus{
		Version: key.Version, Status: key.Status, KeyFingerprint: key.KeyFingerprint,
		CreatedAt: key.CreatedAt, RotatedAt: key.RotatedAt, DestroyedAt: key.DestroyedAt,
		ErasureProof: key.ErasureProof,
	}
}

func evidenceKeyAAD(workspaceID uuid.UUID, version int) []byte {
	return []byte(fmt.Sprintf("oppulence:tenant-evidence:%s:v%d", workspaceID, version))
}

func evidenceErasureProof(workspaceID uuid.UUID, key *ent.TenantEvidenceKey, at time.Time) string {
	digest := sha256.Sum256([]byte(fmt.Sprintf(
		"oppulence:erasure:v1:%s:%d:%s:%s",
		workspaceID, key.Version, key.KeyFingerprint, at.Format(time.RFC3339Nano),
	)))
	return "sha256:" + hex.EncodeToString(digest[:])
}

func wipeBytes(value []byte) {
	for i := range value {
		value[i] = 0
	}
}
