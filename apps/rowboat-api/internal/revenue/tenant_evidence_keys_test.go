package revenue

import (
	"bytes"
	"errors"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipobservation"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/tenantevidencekey"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
)

func TestTenantEvidenceKeyRotationAndCryptographicErasure(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 7, 31, 21, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	firstPayload := []byte(`{"provider":"hubspot","secret":"first raw evidence"}`)
	first, err := f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{{
		DisplayName: "Encrypted Account", AccountDomain: "encrypted.example",
		Source: "hubspot", ExternalID: "encrypted-v1", EventType: "company.updated",
		OccurredAt: now, ReceivedAt: now, Payload: firstPayload,
	}})
	if err != nil {
		t.Fatalf("ingest first envelope: %v", err)
	}
	storedFirst, err := f.client.RelationshipObservation.Get(f.ctx, first[0].Observation.ID)
	if err != nil {
		t.Fatalf("load first observation: %v", err)
	}
	if storedFirst.EncryptionKeyVersion != 1 || bytes.Contains(storedFirst.PayloadCiphertext, firstPayload) {
		t.Fatalf("first payload is not tenant-enveloped: %#v", storedFirst)
	}
	_, openedFirst, err := f.svc.RelationshipObservationPayload(
		f.ctx, first[0].Relationship.ID, first[0].Observation.ID,
	)
	if err != nil || !bytes.Equal(openedFirst, firstPayload) {
		t.Fatalf("open first envelope: payload=%q err=%v", openedFirst, err)
	}

	rotated, err := f.svc.RotateTenantEvidenceKey(f.ctx, f.user)
	if err != nil || rotated.Version != 2 || rotated.Status != "active" {
		t.Fatalf("rotate key: status=%#v err=%v", rotated, err)
	}
	secondPayload := []byte(`{"provider":"hubspot","secret":"second raw evidence"}`)
	second, err := f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{{
		RelationshipID: first[0].Relationship.ID,
		Source:         "hubspot", ExternalID: "encrypted-v2", EventType: "company.updated",
		OccurredAt: now.Add(time.Minute), ReceivedAt: now.Add(time.Minute), Payload: secondPayload,
	}})
	if err != nil {
		t.Fatalf("ingest second envelope: %v", err)
	}
	storedSecond, err := f.client.RelationshipObservation.Get(f.ctx, second[0].Observation.ID)
	if err != nil || storedSecond.EncryptionKeyVersion != 2 {
		t.Fatalf("new evidence did not use rotated key: %#v err=%v", storedSecond, err)
	}
	_, openedFirst, err = f.svc.RelationshipObservationPayload(
		f.ctx, first[0].Relationship.ID, first[0].Observation.ID,
	)
	if err != nil || !bytes.Equal(openedFirst, firstPayload) {
		t.Fatalf("retired key must remain readable before erasure: payload=%q err=%v", openedFirst, err)
	}

	proofs, err := f.svc.DestroyTenantEvidenceKeys(f.ctx, f.user)
	if err != nil || len(proofs) != 2 {
		t.Fatalf("destroy keys: proofs=%#v err=%v", proofs, err)
	}
	for _, proof := range proofs {
		if proof.Status != "destroyed" || proof.DestroyedAt == nil || proof.ErasureProof == "" {
			t.Fatalf("incomplete erasure proof: %#v", proof)
		}
	}
	remainingWrapped, err := f.client.TenantEvidenceKey.Query().
		Where(tenantevidencekey.WrappedKeyNotNil()).
		Count(f.ctx)
	if err != nil || remainingWrapped != 0 {
		t.Fatalf("wrapped DEKs survived erasure: count=%d err=%v", remainingWrapped, err)
	}
	if _, _, err := f.svc.RelationshipObservationPayload(
		f.ctx, first[0].Relationship.ID, first[0].Observation.ID,
	); !errors.Is(err, ErrEvidenceKeyDestroyed) {
		t.Fatalf("destroyed ciphertext remained decryptable: %v", err)
	}
	if _, err := f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{{
		RelationshipID: first[0].Relationship.ID,
		Source:         "hubspot", ExternalID: "after-erasure", EventType: "company.updated",
		OccurredAt: now.Add(2 * time.Minute), ReceivedAt: now.Add(2 * time.Minute), Payload: []byte(`{"raw":true}`),
	}}); !errors.Is(err, ErrEvidenceKeyDestroyed) {
		t.Fatalf("collection resumed after cryptographic erasure: %v", err)
	}
}

func TestTenantEvidenceKeyRoleBoundary(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 7, 31, 22, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	if _, err := f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{{
		DisplayName: "Key Role Account", AccountDomain: "key-role.example",
		Source: "hubspot", ExternalID: "key-role", EventType: "company.updated",
		OccurredAt: now, ReceivedAt: now, Payload: []byte(`{"raw":true}`),
	}}); err != nil {
		t.Fatalf("seed encrypted evidence: %v", err)
	}
	admin := newUser(t, f.client, "key-admin@x.co", "user_key_admin")
	if _, err := f.svc.UpsertWorkspaceMember(f.ctx, f.user, admin.ID, "admin"); err != nil {
		t.Fatalf("grant admin: %v", err)
	}
	adminCtx := auth.WithUser(f.ctx, admin)
	if _, err := f.svc.RotateTenantEvidenceKey(adminCtx, admin); err != nil {
		t.Fatalf("admin should rotate: %v", err)
	}
	if _, err := f.svc.DestroyTenantEvidenceKeys(adminCtx, admin); !errors.Is(err, ErrForbidden) {
		t.Fatalf("only owner may destroy keys: %v", err)
	}

	viewer := newUser(t, f.client, "key-viewer@x.co", "user_key_viewer")
	if _, err := f.svc.UpsertWorkspaceMember(f.ctx, f.user, viewer.ID, "viewer"); err != nil {
		t.Fatalf("grant viewer: %v", err)
	}
	viewerCtx := auth.WithUser(f.ctx, viewer)
	if _, err := f.svc.RotateTenantEvidenceKey(viewerCtx, viewer); !errors.Is(err, ErrForbidden) {
		t.Fatalf("viewer rotated key: %v", err)
	}
	if count, err := f.client.RelationshipObservation.Query().
		Where(relationshipobservation.HasWorkspaceWith()).Count(viewerCtx); err != nil || count != 1 {
		t.Fatalf("viewer should retain encrypted-evidence metadata access: count=%d err=%v", count, err)
	}
}
