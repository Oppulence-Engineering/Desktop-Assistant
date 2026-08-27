package entities

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"regexp"
	"sort"
	"strings"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	entitypred "github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/entity"
	identifierpred "github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/entityidentifier"
	refpred "github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/entityresourceref"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/predicate"
	workspacepred "github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/entitymetrics"
)

var (
	ErrNotFound  = errors.New("entity not found")
	ErrAmbiguous = errors.New("entity reconciliation ambiguous")
	ErrConflict  = errors.New("entity version conflict")
	ErrForbidden = errors.New("entity operation forbidden")
)

var ulidRE = regexp.MustCompile(`^[0-9A-HJKMNP-TV-Z]{26}$`)
var identifierFingerprintRE = regexp.MustCompile(`^sha256:v1:[0-9a-f]{64}$`)
var resourceRefPartRE = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,63}$`)

type Operation string

const (
	OperationRead  Operation = "read"
	OperationWrite Operation = "write"
)

type Scope struct {
	Workspace *ent.RevenueWorkspace
	User      *ent.User
}
type ResolveScope func(context.Context) (Scope, error)
type Authorize func(context.Context, Scope, Operation) error

type Service struct {
	client    *ent.Client
	resolve   ResolveScope
	authorize Authorize
}

func New(client *ent.Client, resolve ResolveScope, authorize Authorize) *Service {
	return &Service{client: client, resolve: resolve, authorize: authorize}
}

type Projection struct {
	ID              string              `json:"id"`
	Kind            string              `json:"kind"`
	DisplayName     string              `json:"displayName"`
	ResourceRefs    []string            `json:"resourceRefs"`
	Identifiers     map[string][]string `json:"identifiers"`
	OneLineSummary  string              `json:"oneLineSummary,omitempty"`
	ExpectedVersion *int                `json:"expectedVersion,omitempty"`
}
type View struct {
	ID                string              `json:"id"`
	Kind              string              `json:"kind"`
	DisplayName       string              `json:"displayName"`
	ResourceRefs      []string            `json:"resourceRefs"`
	Identifiers       map[string][]string `json:"identifiers,omitempty"`
	OneLineSummary    string              `json:"oneLineSummary,omitempty"`
	Status            string              `json:"status"`
	CanonicalEntityID string              `json:"canonicalEntityId,omitempty"`
	Version           int                 `json:"version"`
}
type MergeInput struct {
	SourceID              string `json:"sourceId"`
	TargetID              string `json:"targetId"`
	ExpectedSourceVersion *int   `json:"expectedSourceVersion,omitempty"`
	ExpectedTargetVersion *int   `json:"expectedTargetVersion,omitempty"`
}
type MergeResult struct {
	Canonical  View `json:"canonical"`
	Tombstone  View `json:"tombstone"`
	Idempotent bool `json:"idempotent"`
}

func (s *Service) scope(ctx context.Context, op Operation) (Scope, error) {
	sc, err := s.resolve(ctx)
	if err != nil {
		return Scope{}, err
	}
	if sc.Workspace == nil || sc.User == nil || strings.TrimSpace(sc.Workspace.WorkosOrgID) == "" || sc.User.WorkosOrgID != sc.Workspace.WorkosOrgID {
		return Scope{}, ErrForbidden
	}
	if s.authorize != nil {
		if err := s.authorize(ctx, sc, op); err != nil {
			return Scope{}, ErrForbidden
		}
	}
	return sc, nil
}

func normalizeProjection(p Projection) (Projection, error) {
	p.ID = strings.TrimSpace(p.ID)
	p.Kind = strings.ToLower(strings.TrimSpace(p.Kind))
	p.DisplayName = strings.TrimSpace(p.DisplayName)
	p.OneLineSummary = strings.TrimSpace(p.OneLineSummary)
	if p.ID == "" || p.Kind == "" || p.DisplayName == "" {
		return p, fmt.Errorf("id, kind, and displayName are required")
	}
	if !ulidRE.MatchString(p.ID) {
		return p, fmt.Errorf("invalid entity ULID")
	}
	if len(p.ResourceRefs) > 100 || len(p.Identifiers) > 32 {
		return p, fmt.Errorf("projection collection exceeds limit")
	}
	if len(p.ID) > 64 || len(p.Kind) > 64 || len([]rune(p.DisplayName)) > 200 || len([]rune(p.OneLineSummary)) > 500 {
		return p, fmt.Errorf("projection field exceeds limit")
	}
	refs := map[string]struct{}{}
	for _, raw := range p.ResourceRefs {
		r := strings.TrimSpace(raw)
		parts := strings.SplitN(r, ":", 3)
		if len(parts) != 3 || !resourceRefPartRE.MatchString(parts[0]) || !resourceRefPartRE.MatchString(parts[1]) || strings.TrimSpace(parts[2]) == "" || len(parts[2]) > 256 {
			return p, fmt.Errorf("invalid resourceRef")
		}
		for _, character := range parts[2] {
			if character < 32 || character == 127 {
				return p, fmt.Errorf("invalid resourceRef")
			}
		}
		r = parts[0] + ":" + parts[1] + ":" + strings.TrimSpace(parts[2])
		refs[r] = struct{}{}
	}
	p.ResourceRefs = sortedKeys(refs)
	out := map[string][]string{}
	totalValues := 0
	for k, vals := range p.Identifiers {
		k = strings.TrimSpace(k)
		if k == "" || len(k) > 64 || len(vals) > 100 {
			return p, fmt.Errorf("invalid identifier")
		}
		totalValues += len(vals)
		if totalValues > 256 {
			return p, fmt.Errorf("identifier values exceed limit")
		}
		set := map[string]struct{}{}
		for _, raw := range vals {
			v := strings.ToLower(strings.TrimSpace(raw))
			if !identifierFingerprintRE.MatchString(v) {
				return p, fmt.Errorf("invalid identifier")
			}
			set[v] = struct{}{}
		}
		out[k] = sortedKeys(set)
	}
	p.Identifiers = out
	return p, nil
}
func sortedKeys(m map[string]struct{}) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
func view(e *ent.Entity) View {
	return View{ID: e.EntityID, Kind: e.Kind, DisplayName: e.DisplayName, ResourceRefs: e.ResourceRefs, Identifiers: e.Identifiers, OneLineSummary: e.OneLineSummary, Status: e.Status, CanonicalEntityID: e.CanonicalEntityID, Version: e.Version}
}

func (s *Service) Get(ctx context.Context, id string) (View, error) {
	sc, err := s.scope(ctx, OperationRead)
	if err != nil {
		return View{}, err
	}
	e, err := s.client.Entity.Query().Where(entitypred.EntityIDEQ(strings.TrimSpace(id)), entitypred.HasWorkspaceWith(workspacepred.IDEQ(sc.Workspace.ID))).Only(ctx)
	if ent.IsNotFound(err) {
		return View{}, ErrNotFound
	}
	if err != nil {
		return View{}, err
	}
	entitymetrics.SpineSync.WithLabelValues("down").Inc()
	return view(e), nil
}
func (s *Service) ResolveRef(ctx context.Context, ref string) (View, error) {
	sc, err := s.scope(ctx, OperationRead)
	if err != nil {
		return View{}, err
	}
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return View{}, fmt.Errorf("ref is required")
	}
	row, err := s.client.EntityResourceRef.Query().
		Where(refpred.RefEQ(ref), refpred.HasWorkspaceWith(workspacepred.IDEQ(sc.Workspace.ID)), refpred.HasEntityWith(entitypred.StatusEQ("active"))).
		Only(ctx)
	if ent.IsNotFound(err) {
		entitymetrics.Resolve.WithLabelValues("unlinked").Inc()
		return View{}, ErrNotFound
	}
	if err != nil {
		return View{}, err
	}
	found, err := row.QueryEntity().Only(ctx)
	if err != nil {
		return View{}, err
	}
	entitymetrics.Resolve.WithLabelValues("linked").Inc()
	entitymetrics.SpineSync.WithLabelValues("down").Inc()
	return view(found), nil
}

func findMatches(ctx context.Context, refs *ent.EntityResourceRefClient, identifiers *ent.EntityIdentifierClient, workspace *ent.RevenueWorkspace, p Projection, excludeID string) ([]*ent.Entity, error) {
	byID := map[string]*ent.Entity{}
	if len(p.ResourceRefs) > 0 {
		rows, err := refs.Query().
			Where(refpred.RefIn(p.ResourceRefs...), refpred.HasWorkspaceWith(workspacepred.IDEQ(workspace.ID)), refpred.HasEntityWith(entitypred.StatusEQ("active"))).
			QueryEntity().All(ctx)
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			if row.EntityID != excludeID {
				byID[row.EntityID] = row
			}
		}
	}
	identifierPredicates := make([]predicate.EntityIdentifier, 0, len(p.Identifiers))
	for key, fingerprints := range p.Identifiers {
		if len(fingerprints) > 0 {
			identifierPredicates = append(identifierPredicates, identifierpred.And(identifierpred.KeyEQ(key), identifierpred.FingerprintIn(fingerprints...)))
		}
	}
	if len(identifierPredicates) > 0 {
		rows, err := identifiers.Query().
			Where(identifierpred.Or(identifierPredicates...), identifierpred.HasWorkspaceWith(workspacepred.IDEQ(workspace.ID)), identifierpred.HasEntityWith(entitypred.StatusEQ("active"))).
			QueryEntity().All(ctx)
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			if row.EntityID != excludeID {
				byID[row.EntityID] = row
			}
		}
	}
	out := make([]*ent.Entity, 0, len(byID))
	for _, row := range byID {
		out = append(out, row)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].EntityID < out[j].EntityID })
	return out, nil
}

func syncNormalized(ctx context.Context, refs *ent.EntityResourceRefClient, identifiers *ent.EntityIdentifierClient, workspace *ent.RevenueWorkspace, entity *ent.Entity, resourceRefs []string, values map[string][]string) error {
	existingRefs, err := refs.Query().Where(refpred.HasEntityWith(entitypred.IDEQ(entity.ID))).All(ctx)
	if err != nil {
		return err
	}
	seenRefs := map[string]struct{}{}
	for _, row := range existingRefs {
		seenRefs[row.Ref] = struct{}{}
	}
	for _, ref := range resourceRefs {
		if _, ok := seenRefs[ref]; ok {
			continue
		}
		if _, err := refs.Create().SetRef(ref).SetWorkspace(workspace).SetEntity(entity).Save(ctx); err != nil {
			return err
		}
	}
	existingIdentifiers, err := identifiers.Query().Where(identifierpred.HasEntityWith(entitypred.IDEQ(entity.ID))).All(ctx)
	if err != nil {
		return err
	}
	seenIdentifiers := map[string]struct{}{}
	for _, row := range existingIdentifiers {
		seenIdentifiers[row.Key+"\x00"+row.Fingerprint] = struct{}{}
	}
	for key, fingerprints := range values {
		for _, fingerprint := range fingerprints {
			compound := key + "\x00" + fingerprint
			if _, ok := seenIdentifiers[compound]; ok {
				continue
			}
			if _, err := identifiers.Create().SetKey(key).SetFingerprint(fingerprint).SetWorkspace(workspace).SetEntity(entity).Save(ctx); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Service) Upsert(ctx context.Context, pathID string, p Projection) (View, error) {
	sc, err := s.scope(ctx, OperationWrite)
	if err != nil {
		return View{}, err
	}
	p.ID = strings.TrimSpace(pathID)
	p, err = normalizeProjection(p)
	if err != nil {
		return View{}, err
	}
	for attempt := 0; attempt < 2; attempt++ {
		result, retry, upsertErr := s.upsertOnce(ctx, sc, p)
		if !retry {
			return result, upsertErr
		}
	}
	return View{}, ErrConflict
}

func (s *Service) upsertOnce(ctx context.Context, sc Scope, p Projection) (View, bool, error) {
	mutationCtx := auth.WithInternalOnly(ctx)
	tx, err := s.client.Tx(mutationCtx)
	if err != nil {
		return View{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	existing, err := tx.Entity.Query().Where(entitypred.EntityIDEQ(p.ID), entitypred.HasWorkspaceWith(workspacepred.IDEQ(sc.Workspace.ID))).Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return View{}, false, err
	}
	if err == nil && existing.Status == "merged" {
		return view(existing), false, nil
	}
	if err == nil && p.ExpectedVersion != nil && *p.ExpectedVersion != existing.Version {
		return View{}, false, ErrConflict
	}
	excludeID := ""
	if existing != nil {
		excludeID = existing.EntityID
	}
	matches, err := findMatches(ctx, tx.EntityResourceRef, tx.EntityIdentifier, sc.Workspace, p, excludeID)
	if err != nil {
		return View{}, false, err
	}
	if len(matches) > 1 {
		entitymetrics.Resolve.WithLabelValues("ambiguous").Inc()
		return View{}, false, ErrAmbiguous
	}
	if len(matches) == 1 {
		matched := matches[0]
		// Independent devices can discover the same entity in either order. The
		// lexicographically earliest ULID is a deterministic canonical choice, so
		// retries cannot create alias cycles by alternately adopting one another.
		if p.ID < matched.EntityID {
			mergedRefs := union(matched.ResourceRefs, p.ResourceRefs)
			mergedIdentifiers := unionIDs(matched.Identifiers, p.Identifiers)
			if existing != nil {
				mergedRefs = union(mergedRefs, existing.ResourceRefs)
				mergedIdentifiers = unionIDs(mergedIdentifiers, existing.Identifiers)
			}
			if _, err := tx.EntityResourceRef.Delete().Where(refpred.HasEntityWith(entitypred.IDEQ(matched.ID))).Exec(mutationCtx); err != nil {
				return View{}, false, err
			}
			if _, err := tx.EntityIdentifier.Delete().Where(identifierpred.HasEntityWith(entitypred.IDEQ(matched.ID))).Exec(mutationCtx); err != nil {
				return View{}, false, err
			}
			var canonical *ent.Entity
			if existing == nil {
				canonical, err = tx.Entity.Create().
					SetEntityID(p.ID).SetKind(p.Kind).SetDisplayName(p.DisplayName).
					SetResourceRefs(mergedRefs).SetIdentifiers(mergedIdentifiers).
					SetOneLineSummary(p.OneLineSummary).SetStatus("active").
					SetWorkspace(sc.Workspace).SetUser(sc.User).Save(mutationCtx)
			} else {
				canonical, err = tx.Entity.UpdateOne(existing).
					SetKind(p.Kind).SetDisplayName(p.DisplayName).
					SetResourceRefs(mergedRefs).SetIdentifiers(mergedIdentifiers).
					SetOneLineSummary(p.OneLineSummary).SetVersion(existing.Version + 1).
					Save(mutationCtx)
			}
			if err != nil {
				return View{}, ent.IsConstraintError(err), err
			}
			if err := syncNormalized(mutationCtx, tx.EntityResourceRef, tx.EntityIdentifier, sc.Workspace, canonical, mergedRefs, mergedIdentifiers); err != nil {
				return View{}, ent.IsConstraintError(err), err
			}
			if _, err := tx.Entity.UpdateOne(matched).
				SetStatus("merged").SetCanonicalEntityID(canonical.EntityID).
				SetVersion(matched.Version + 1).Save(mutationCtx); err != nil {
				return View{}, false, err
			}
			if err := tx.Commit(); err != nil {
				return View{}, ent.IsConstraintError(err), err
			}
			entitymetrics.Resolve.WithLabelValues("linked").Inc()
			entitymetrics.SpineSync.WithLabelValues("up").Inc()
			return view(canonical), false, nil
		}

		canonical := matched
		mergedRefs := union(canonical.ResourceRefs, p.ResourceRefs)
		mergedIdentifiers := unionIDs(canonical.Identifiers, p.Identifiers)
		if existing != nil {
			// A device can first create an independent active entity and only later
			// discover a deterministic key for an existing canonical entity. Move
			// every ref and fingerprint accumulated by that device, not just the
			// latest payload, before turning its row into a durable alias.
			mergedRefs = union(mergedRefs, existing.ResourceRefs)
			mergedIdentifiers = unionIDs(mergedIdentifiers, existing.Identifiers)
			if _, err := tx.EntityResourceRef.Delete().Where(refpred.HasEntityWith(entitypred.IDEQ(existing.ID))).Exec(mutationCtx); err != nil {
				return View{}, false, err
			}
			if _, err := tx.EntityIdentifier.Delete().Where(identifierpred.HasEntityWith(entitypred.IDEQ(existing.ID))).Exec(mutationCtx); err != nil {
				return View{}, false, err
			}
		}
		canonical, err = tx.Entity.UpdateOne(canonical).
			SetResourceRefs(mergedRefs).
			SetIdentifiers(mergedIdentifiers).
			SetVersion(canonical.Version + 1).
			Save(mutationCtx)
		if err != nil {
			return View{}, false, err
		}
		if err := syncNormalized(mutationCtx, tx.EntityResourceRef, tx.EntityIdentifier, sc.Workspace, canonical, mergedRefs, mergedIdentifiers); err != nil {
			return View{}, ent.IsConstraintError(err), err
		}
		if existing == nil {
			existing, err = tx.Entity.Create().
				SetEntityID(p.ID).SetKind(p.Kind).SetDisplayName(p.DisplayName).
				SetResourceRefs(p.ResourceRefs).SetIdentifiers(p.Identifiers).
				SetOneLineSummary(p.OneLineSummary).SetStatus("merged").
				SetCanonicalEntityID(canonical.EntityID).SetWorkspace(sc.Workspace).SetUser(sc.User).
				Save(mutationCtx)
		} else {
			existing, err = tx.Entity.UpdateOne(existing).
				SetStatus("merged").SetCanonicalEntityID(canonical.EntityID).
				SetResourceRefs(union(existing.ResourceRefs, p.ResourceRefs)).
				SetIdentifiers(unionIDs(existing.Identifiers, p.Identifiers)).
				SetVersion(existing.Version + 1).Save(mutationCtx)
		}
		if err != nil {
			return View{}, false, err
		}
		if err := tx.Commit(); err != nil {
			return View{}, ent.IsConstraintError(err), err
		}
		entitymetrics.Resolve.WithLabelValues("linked").Inc()
		entitymetrics.SpineSync.WithLabelValues("up").Inc()
		return view(existing), false, nil
	}

	if existing == nil {
		existing, err = tx.Entity.Create().
			SetEntityID(p.ID).SetKind(p.Kind).SetDisplayName(p.DisplayName).
			SetResourceRefs(p.ResourceRefs).SetIdentifiers(p.Identifiers).
			SetOneLineSummary(p.OneLineSummary).SetStatus("active").
			SetWorkspace(sc.Workspace).SetUser(sc.User).Save(mutationCtx)
	} else {
		mergedRefs := union(existing.ResourceRefs, p.ResourceRefs)
		mergedIdentifiers := unionIDs(existing.Identifiers, p.Identifiers)
		if existing.Kind == p.Kind && existing.DisplayName == p.DisplayName && reflect.DeepEqual(existing.ResourceRefs, mergedRefs) && reflect.DeepEqual(existing.Identifiers, mergedIdentifiers) && existing.OneLineSummary == p.OneLineSummary {
			if err := syncNormalized(mutationCtx, tx.EntityResourceRef, tx.EntityIdentifier, sc.Workspace, existing, mergedRefs, mergedIdentifiers); err != nil {
				return View{}, ent.IsConstraintError(err), err
			}
			if err := tx.Commit(); err != nil {
				return View{}, ent.IsConstraintError(err), err
			}
			entitymetrics.SpineSync.WithLabelValues("up").Inc()
			return view(existing), false, nil
		}
		existing, err = tx.Entity.UpdateOne(existing).
			SetKind(p.Kind).SetDisplayName(p.DisplayName).
			SetResourceRefs(mergedRefs).SetIdentifiers(mergedIdentifiers).
			SetOneLineSummary(p.OneLineSummary).SetVersion(existing.Version + 1).
			Save(mutationCtx)
	}
	if err != nil {
		return View{}, ent.IsConstraintError(err), err
	}
	if err := syncNormalized(mutationCtx, tx.EntityResourceRef, tx.EntityIdentifier, sc.Workspace, existing, existing.ResourceRefs, existing.Identifiers); err != nil {
		return View{}, ent.IsConstraintError(err), err
	}
	if err := tx.Commit(); err != nil {
		return View{}, ent.IsConstraintError(err), err
	}
	entitymetrics.Resolve.WithLabelValues("unlinked").Inc()
	entitymetrics.SpineSync.WithLabelValues("up").Inc()
	return view(existing), false, nil
}

func union(a, b []string) []string {
	m := map[string]struct{}{}
	for _, x := range append(append([]string{}, a...), b...) {
		m[x] = struct{}{}
	}
	return sortedKeys(m)
}
func unionIDs(a, b map[string][]string) map[string][]string {
	out := map[string][]string{}
	for k, v := range a {
		out[k] = union(out[k], v)
	}
	for k, v := range b {
		out[k] = union(out[k], v)
	}
	return out
}
func (s *Service) Merge(ctx context.Context, in MergeInput) (MergeResult, error) {
	sc, err := s.scope(ctx, OperationWrite)
	if err != nil {
		return MergeResult{}, err
	}
	in.SourceID = strings.TrimSpace(in.SourceID)
	in.TargetID = strings.TrimSpace(in.TargetID)
	if in.SourceID == "" || in.TargetID == "" || in.SourceID == in.TargetID {
		return MergeResult{}, fmt.Errorf("distinct sourceId and targetId are required")
	}
	mutationCtx := auth.WithInternalOnly(ctx)
	tx, err := s.client.Tx(mutationCtx)
	if err != nil {
		return MergeResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	src, err := tx.Entity.Query().Where(entitypred.EntityIDEQ(in.SourceID), entitypred.HasWorkspaceWith(workspacepred.IDEQ(sc.Workspace.ID))).Only(ctx)
	if ent.IsNotFound(err) {
		return MergeResult{}, ErrNotFound
	}
	if err != nil {
		return MergeResult{}, err
	}
	if src.Status == "merged" && src.CanonicalEntityID == in.TargetID {
		target, er := tx.Entity.Query().Where(entitypred.EntityIDEQ(in.TargetID), entitypred.HasWorkspaceWith(workspacepred.IDEQ(sc.Workspace.ID))).Only(ctx)
		if er != nil {
			return MergeResult{}, er
		}
		_ = tx.Commit()
		return MergeResult{Canonical: view(target), Tombstone: view(src), Idempotent: true}, nil
	}
	target, err := tx.Entity.Query().Where(entitypred.EntityIDEQ(in.TargetID), entitypred.StatusEQ("active"), entitypred.HasWorkspaceWith(workspacepred.IDEQ(sc.Workspace.ID))).Only(ctx)
	if ent.IsNotFound(err) {
		return MergeResult{}, ErrNotFound
	}
	if err != nil {
		return MergeResult{}, err
	}
	if in.ExpectedSourceVersion == nil || in.ExpectedTargetVersion == nil || *in.ExpectedSourceVersion != src.Version || *in.ExpectedTargetVersion != target.Version {
		return MergeResult{}, ErrConflict
	}
	mergedRefs := union(target.ResourceRefs, src.ResourceRefs)
	mergedIdentifiers := unionIDs(target.Identifiers, src.Identifiers)
	_, err = tx.EntityResourceRef.Delete().Where(refpred.HasEntityWith(entitypred.IDEQ(src.ID))).Exec(mutationCtx)
	if err != nil {
		return MergeResult{}, ErrConflict
	}
	_, err = tx.EntityIdentifier.Delete().Where(identifierpred.HasEntityWith(entitypred.IDEQ(src.ID))).Exec(mutationCtx)
	if err != nil {
		return MergeResult{}, ErrConflict
	}
	target, err = tx.Entity.UpdateOne(target).SetResourceRefs(mergedRefs).SetIdentifiers(mergedIdentifiers).SetVersion(target.Version + 1).Save(mutationCtx)
	if err != nil {
		return MergeResult{}, ErrConflict
	}
	if err := syncNormalized(mutationCtx, tx.EntityResourceRef, tx.EntityIdentifier, sc.Workspace, target, mergedRefs, mergedIdentifiers); err != nil {
		return MergeResult{}, ErrConflict
	}
	_, err = tx.Entity.UpdateOne(src).SetStatus("merged").SetCanonicalEntityID(target.EntityID).SetVersion(src.Version + 1).Save(mutationCtx)
	if err != nil {
		return MergeResult{}, ErrConflict
	}
	target, err = tx.Entity.Get(mutationCtx, target.ID)
	if err != nil {
		return MergeResult{}, err
	}
	src, err = tx.Entity.Get(mutationCtx, src.ID)
	if err != nil {
		return MergeResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return MergeResult{}, err
	}
	entitymetrics.Merge.Inc()
	return MergeResult{Canonical: view(target), Tombstone: view(src)}, nil
}
