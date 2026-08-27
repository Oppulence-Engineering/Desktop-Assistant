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
	if sc.Workspace == nil || sc.User == nil || strings.TrimSpace(sc.Workspace.WorkosOrgID) == "" {
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
		if len(parts) != 3 || parts[0] == "" || parts[1] == "" || parts[2] == "" || len(r) > 512 {
			return p, fmt.Errorf("invalid resourceRef")
		}
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
	_ = sc
	if err != nil {
		return View{}, err
	}
	e, err := s.client.Entity.Query().Where(entitypred.EntityIDEQ(strings.TrimSpace(id)), entitypred.HasWorkspaceWith()).Only(ctx)
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
	_ = sc
	if err != nil {
		return View{}, err
	}
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return View{}, fmt.Errorf("ref is required")
	}
	rows, err := s.client.Entity.Query().Where(entitypred.StatusEQ("active")).Limit(501).All(ctx)
	if err != nil {
		return View{}, err
	}
	var found []*ent.Entity
	for _, e := range rows {
		for _, r := range e.ResourceRefs {
			if r == ref {
				found = append(found, e)
				break
			}
		}
	}
	if len(found) == 0 {
		entitymetrics.Resolve.WithLabelValues("unlinked").Inc()
		return View{}, ErrNotFound
	}
	if len(found) > 1 {
		entitymetrics.Resolve.WithLabelValues("ambiguous").Inc()
		return View{}, ErrAmbiguous
	}
	entitymetrics.Resolve.WithLabelValues("linked").Inc()
	entitymetrics.SpineSync.WithLabelValues("down").Inc()
	return view(found[0]), nil
}

func exactMatch(a Projection, e *ent.Entity) bool {
	for _, ar := range a.ResourceRefs {
		for _, er := range e.ResourceRefs {
			if ar == er {
				return true
			}
		}
	}
	for k, av := range a.Identifiers {
		ev := e.Identifiers[k]
		for _, x := range av {
			for _, y := range ev {
				if x == strings.ToLower(strings.TrimSpace(y)) {
					return true
				}
			}
		}
	}
	return false
}
func (s *Service) Upsert(ctx context.Context, pathID string, p Projection) (View, error) {
	sc, err := s.scope(ctx, OperationWrite)
	if err != nil {
		return View{}, err
	}
	p.ID = strings.TrimSpace(pathID)
	mutationCtx := auth.WithInternalOnly(ctx)
	p, err = normalizeProjection(p)
	if err != nil {
		return View{}, err
	}
	existing, err := s.client.Entity.Query().Where(entitypred.EntityIDEQ(p.ID)).Only(ctx)
	if err == nil {
		if existing.Status == "merged" {
			// Return the durable tombstone on every replay so a device that lost the
			// first response still receives canonicalEntityId and converges.
			return view(existing), nil
		}
		if p.ExpectedVersion != nil && *p.ExpectedVersion != existing.Version {
			return View{}, ErrConflict
		}
		mergedRefs := union(existing.ResourceRefs, p.ResourceRefs)
		mergedIdentifiers := unionIDs(existing.Identifiers, p.Identifiers)
		if existing.Kind == p.Kind && existing.DisplayName == p.DisplayName && reflect.DeepEqual(existing.ResourceRefs, mergedRefs) && reflect.DeepEqual(existing.Identifiers, mergedIdentifiers) && existing.OneLineSummary == p.OneLineSummary {
			entitymetrics.SpineSync.WithLabelValues("up").Inc()
			return view(existing), nil
		}
		_, err := s.client.Entity.UpdateOne(existing).SetKind(p.Kind).SetDisplayName(p.DisplayName).SetResourceRefs(mergedRefs).SetIdentifiers(mergedIdentifiers).SetOneLineSummary(p.OneLineSummary).SetVersion(existing.Version + 1).Save(mutationCtx)
		if err != nil {
			return View{}, err
		}
		e, err := s.client.Entity.Get(ctx, existing.ID)
		if err != nil {
			return View{}, err
		}
		entitymetrics.SpineSync.WithLabelValues("up").Inc()
		return view(e), nil
	}
	if !ent.IsNotFound(err) {
		return View{}, err
	}
	rows, err := s.client.Entity.Query().Where(entitypred.StatusEQ("active")).Limit(501).All(ctx)
	if err != nil {
		return View{}, err
	}
	matches := []*ent.Entity{}
	for _, e := range rows {
		if exactMatch(p, e) {
			matches = append(matches, e)
		}
	}
	if len(matches) > 1 {
		entitymetrics.Resolve.WithLabelValues("ambiguous").Inc()
		return View{}, ErrAmbiguous
	}
	status, canonical := "active", ""
	if len(matches) == 1 {
		status = "merged"
		canonical = matches[0].EntityID
		candidate := matches[0]
		_, updateErr := s.client.Entity.UpdateOne(candidate).SetResourceRefs(union(candidate.ResourceRefs, p.ResourceRefs)).SetIdentifiers(unionIDs(candidate.Identifiers, p.Identifiers)).SetVersion(candidate.Version + 1).Save(mutationCtx)
		if updateErr != nil {
			return View{}, updateErr
		}
		entitymetrics.Resolve.WithLabelValues("linked").Inc()
	} else {
		entitymetrics.Resolve.WithLabelValues("unlinked").Inc()
	}
	create := s.client.Entity.Create().SetEntityID(p.ID).SetKind(p.Kind).SetDisplayName(p.DisplayName).SetResourceRefs(p.ResourceRefs).SetIdentifiers(p.Identifiers).SetOneLineSummary(p.OneLineSummary).SetStatus(status).SetWorkspace(sc.Workspace).SetUser(sc.User)
	if canonical != "" {
		create.SetCanonicalEntityID(canonical)
	}
	e, err := create.Save(mutationCtx)
	if err != nil {
		return View{}, err
	}
	entitymetrics.SpineSync.WithLabelValues("up").Inc()
	return view(e), nil
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
	_, err := s.scope(ctx, OperationWrite)
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
	src, err := tx.Entity.Query().Where(entitypred.EntityIDEQ(in.SourceID)).Only(mutationCtx)
	if ent.IsNotFound(err) {
		return MergeResult{}, ErrNotFound
	}
	if err != nil {
		return MergeResult{}, err
	}
	if src.Status == "merged" && src.CanonicalEntityID == in.TargetID {
		target, er := tx.Entity.Query().Where(entitypred.EntityIDEQ(in.TargetID)).Only(mutationCtx)
		if er != nil {
			return MergeResult{}, er
		}
		_ = tx.Commit()
		return MergeResult{Canonical: view(target), Tombstone: view(src), Idempotent: true}, nil
	}
	target, err := tx.Entity.Query().Where(entitypred.EntityIDEQ(in.TargetID), entitypred.StatusEQ("active")).Only(mutationCtx)
	if ent.IsNotFound(err) {
		return MergeResult{}, ErrNotFound
	}
	if err != nil {
		return MergeResult{}, err
	}
	if in.ExpectedSourceVersion == nil || in.ExpectedTargetVersion == nil || *in.ExpectedSourceVersion != src.Version || *in.ExpectedTargetVersion != target.Version {
		return MergeResult{}, ErrConflict
	}
	_, err = tx.Entity.UpdateOne(target).SetResourceRefs(union(target.ResourceRefs, src.ResourceRefs)).SetIdentifiers(unionIDs(target.Identifiers, src.Identifiers)).SetVersion(target.Version + 1).Save(mutationCtx)
	if err != nil {
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
