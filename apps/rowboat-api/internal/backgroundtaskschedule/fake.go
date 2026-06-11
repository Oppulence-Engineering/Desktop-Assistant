package backgroundtaskschedule

import (
	"context"
	"sync"
)

// FakeManager is an in-memory Manager for handler, syncer, and reconciler
// tests: it records every call and supports injected per-op errors.
type FakeManager struct {
	mu        sync.Mutex
	schedules map[string]DesiredCronSchedule // keyed by ScheduleID()
	Calls     []string                       // "upsert:<id>", "pause:<id>", "delete:<id>", "describe:<id>", "list"

	UpsertErr   error
	PauseErr    error
	DeleteErr   error
	DescribeErr error
	ListErr     error
}

// NewFakeManager builds an empty fake.
func NewFakeManager() *FakeManager {
	return &FakeManager{schedules: map[string]DesiredCronSchedule{}}
}

// UpsertTaskCron implements Manager.
func (f *FakeManager) UpsertTaskCron(_ context.Context, d DesiredCronSchedule) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Calls = append(f.Calls, "upsert:"+d.ScheduleID())
	if f.UpsertErr != nil {
		return "", f.UpsertErr
	}
	prev, ok := f.schedules[d.ScheduleID()]
	f.schedules[d.ScheduleID()] = d
	switch {
	case !ok:
		return "create", nil
	case SpecMatches(memoOf(prev), d) && prev.Paused == d.Paused:
		return "noop", nil
	default:
		return "update", nil
	}
}

// PauseTaskCron implements Manager.
func (f *FakeManager) PauseTaskCron(_ context.Context, userID, slug string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	id := (DesiredCronSchedule{UserID: userID, Slug: slug}).ScheduleID()
	f.Calls = append(f.Calls, "pause:"+id)
	if f.PauseErr != nil {
		return f.PauseErr
	}
	if d, ok := f.schedules[id]; ok {
		d.Paused = true
		f.schedules[id] = d
	}
	return nil
}

// DeleteTaskCron implements Manager.
func (f *FakeManager) DeleteTaskCron(_ context.Context, userID, slug string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	id := (DesiredCronSchedule{UserID: userID, Slug: slug}).ScheduleID()
	f.Calls = append(f.Calls, "delete:"+id)
	if f.DeleteErr != nil {
		return f.DeleteErr
	}
	delete(f.schedules, id)
	return nil
}

// DescribeTaskCron implements Manager.
func (f *FakeManager) DescribeTaskCron(_ context.Context, userID, slug string) (Description, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	id := (DesiredCronSchedule{UserID: userID, Slug: slug}).ScheduleID()
	f.Calls = append(f.Calls, "describe:"+id)
	if f.DescribeErr != nil {
		return Description{}, f.DescribeErr
	}
	d, ok := f.schedules[id]
	if !ok {
		return Description{}, nil
	}
	return Description{Exists: true, Paused: d.Paused, Memo: memoOf(d)}, nil
}

// ListTaskSchedules implements Manager.
func (f *FakeManager) ListTaskSchedules(_ context.Context) ([]ListedSchedule, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Calls = append(f.Calls, "list")
	if f.ListErr != nil {
		return nil, f.ListErr
	}
	out := make([]ListedSchedule, 0, len(f.schedules))
	for id, d := range f.schedules {
		out = append(out, ListedSchedule{ID: id, Paused: d.Paused, Memo: memoOf(d)})
	}
	return out, nil
}

// Schedule returns the stored desired state for assertions.
func (f *FakeManager) Schedule(userID, slug string) (DesiredCronSchedule, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	d, ok := f.schedules[(DesiredCronSchedule{UserID: userID, Slug: slug}).ScheduleID()]
	return d, ok
}

// Seed installs a schedule directly, for reconciler orphan tests.
func (f *FakeManager) Seed(d DesiredCronSchedule) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.schedules[d.ScheduleID()] = d
}

func memoOf(d DesiredCronSchedule) MemoFields {
	return MemoFields{
		UserID: d.UserID, TaskID: d.TaskID, Slug: d.Slug,
		TaskRevision: d.TaskRevision, CronExpr: d.CronExpr,
		Timezone: d.Timezone, TaskQueue: d.TaskQueue,
		Catchup: d.CatchupWindow.String(), Trigger: "cron",
	}
}
