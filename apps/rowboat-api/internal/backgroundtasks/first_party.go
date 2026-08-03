package backgroundtasks

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtask"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

const (
	firstPartyProvisionInterval = 5 * time.Minute
	firstPartyProvisionPageSize = 200
)

// EnsureFirstParty handles POST /v1/background-tasks/first-party/ensure. It is
// useful immediately after first sign-in; the server-side reconciler is the
// durable fallback for users who never open the workflow console.
func (h *Handler) EnsureFirstParty(w http.ResponseWriter, r *http.Request) {
	owner, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	tasks, err := h.ensureFirstPartyTasks(r.Context(), owner)
	if err != nil {
		h.log.Error("ensure first-party workflows", zap.String("user", owner.ID.String()), zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not provision first-party workflows", "internal_error")
		return
	}
	views := make([]taskView, 0, len(tasks))
	for _, task := range tasks {
		views = append(views, viewTask(task))
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"tasks": views})
}

// RunFirstPartyProvisioner continuously reconciles the six product workflows
// for every user. Database uniqueness makes it safe on every API replica; the
// losing creator simply reloads the row. Version upgrades preserve a user's
// active/paused choice while updating the product-owned definition.
func (h *Handler) RunFirstPartyProvisioner(ctx context.Context) error {
	if h == nil || h.client == nil {
		return errors.New("backgroundtasks: first-party provisioner is not configured")
	}
	if err := h.reconcileAllFirstPartyTasks(ctx); err != nil {
		h.log.Warn("initial first-party workflow reconciliation", zap.Error(err))
	}
	ticker := time.NewTicker(firstPartyProvisionInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if err := h.reconcileAllFirstPartyTasks(ctx); err != nil {
				h.log.Warn("first-party workflow reconciliation", zap.Error(err))
			}
		}
	}
}

func (h *Handler) reconcileAllFirstPartyTasks(ctx context.Context) error {
	internal := auth.WithInternalOnly(ctx)
	var afterID *uuid.UUID
	var errs []error
	for {
		query := h.client.User.Query().Order(ent.Asc(user.FieldID)).Limit(firstPartyProvisionPageSize)
		if afterID != nil {
			query = query.Where(user.IDGT(*afterID))
		}
		owners, err := query.All(internal)
		if err != nil {
			return errors.Join(append(errs, err)...)
		}
		for _, owner := range owners {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if _, err := h.ensureFirstPartyTasks(auth.WithUser(ctx, owner), owner); err != nil {
				errs = append(errs, fmt.Errorf("user %s: %w", owner.ID, err))
			}
		}
		if len(owners) < firstPartyProvisionPageSize {
			return errors.Join(errs...)
		}
		last := owners[len(owners)-1].ID
		afterID = &last
	}
}

func (h *Handler) ensureFirstPartyTasks(ctx context.Context, owner *ent.User) ([]*ent.BackgroundTask, error) {
	if owner == nil {
		return nil, errors.New("missing workflow owner")
	}
	ownerCtx := auth.WithUser(ctx, owner)
	tasks := make([]*ent.BackgroundTask, 0, 6)
	var errs []error
	for _, tpl := range builtInTaskTemplates {
		if !tpl.FirstParty {
			continue
		}
		task, err := h.ensureFirstPartyTask(ownerCtx, owner, tpl)
		if err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", tpl.Slug, err))
			continue
		}
		tasks = append(tasks, task)
	}
	return tasks, errors.Join(errs...)
}

func (h *Handler) ensureFirstPartyTask(ctx context.Context, owner *ent.User, tpl taskTemplate) (*ent.BackgroundTask, error) {
	version := max(tpl.Version, 1)
	task, err := h.client.BackgroundTask.Query().
		Where(backgroundtask.SlugEQ(tpl.TaskSlug), backgroundtask.HasUserWith(user.IDEQ(owner.ID))).
		Only(ctx)
	if ent.IsNotFound(err) {
		req := tpl.createRequest(instantiateTemplateRequest{})
		req.TemplateSlug = tpl.Slug
		req.TemplateVersion = version
		req.SystemManaged = true
		task, err = h.createTaskFromRequest(ctx, owner, req)
		if ent.IsConstraintError(err) {
			// Another API replica won the same create. Reload the canonical row.
			task, err = h.client.BackgroundTask.Query().
				Where(backgroundtask.SlugEQ(tpl.TaskSlug), backgroundtask.HasUserWith(user.IDEQ(owner.ID))).
				Only(ctx)
		}
		return task, err
	}
	if err != nil {
		return nil, err
	}
	if !task.SystemManaged || task.TemplateSlug != tpl.Slug {
		return nil, fmt.Errorf("reserved task slug %q is owned by a user-authored task", tpl.TaskSlug)
	}
	if task.TemplateVersion >= version {
		return task, nil
	}

	previous := task
	update := h.client.BackgroundTask.Update().
		Where(backgroundtask.IDEQ(task.ID), backgroundtask.TemplateVersionLT(version), backgroundtask.SystemManagedEQ(true)).
		SetName(tpl.Name).
		SetInstructions(tpl.Instructions).
		SetTriggersJSON(string(tpl.Triggers)).
		SetExecutionTarget(tpl.ExecutionTarget).
		SetTemplateVersion(version).
		AddRevision(1)
	if tpl.Model == "" {
		update = update.ClearModel()
	} else {
		update = update.SetModel(tpl.Model)
	}
	if tpl.Provider == "" {
		update = update.ClearProvider()
	} else {
		update = update.SetProvider(tpl.Provider)
	}
	if _, err := update.Save(ctx); err != nil {
		return nil, err
	}
	task, err = h.client.BackgroundTask.Get(ctx, task.ID)
	if err != nil {
		return nil, err
	}
	if h.schedules != nil {
		task = h.schedules.AfterWrite(ctx, owner.ID.String(), previous, task)
	}
	return task, nil
}
