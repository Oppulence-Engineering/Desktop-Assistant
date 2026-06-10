package backgroundtaskschedule

import (
	"context"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskworkflow"
	commonpb "go.temporal.io/api/common/v1"
	"go.temporal.io/api/serviceerror"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/converter"
	"go.uber.org/zap"
)

func desired() DesiredCronSchedule {
	return DesiredCronSchedule{
		UserID: "u1", TaskID: "t1", Slug: "daily-digest",
		CronExpr: "0 9 * * *", Timezone: "UTC",
		CatchupWindow: time.Minute, TaskRevision: 3,
	}
}

func TestSpecMatches(t *testing.T) {
	d := desired()
	base := MemoFields{UserID: "u1", TaskID: "t1", Slug: "daily-digest", CronExpr: "0 9 * * *", Timezone: "UTC"}
	if !SpecMatches(base, d) {
		t.Fatal("identical spec must match")
	}
	// TaskRevision is excluded from the diff: sync-state writes bump it.
	rev := base
	rev.TaskRevision = 99
	if !SpecMatches(rev, d) {
		t.Fatal("revision-only difference must still match")
	}
	for name, mutate := range map[string]func(*MemoFields){
		"cron":     func(m *MemoFields) { m.CronExpr = "*/5 * * * *" },
		"timezone": func(m *MemoFields) { m.Timezone = "America/New_York" },
		"user":     func(m *MemoFields) { m.UserID = "u2" },
		"task":     func(m *MemoFields) { m.TaskID = "t2" },
		"slug":     func(m *MemoFields) { m.Slug = "other" },
		"empty":    func(m *MemoFields) { *m = MemoFields{} },
	} {
		m := base
		mutate(&m)
		if SpecMatches(m, d) {
			t.Fatalf("%s difference must not match", name)
		}
	}
}

// --- fake Temporal ScheduleClient/Handle -----------------------------------

type fakeHandle struct {
	id     string
	client *fakeScheduleClient
}

func (h *fakeHandle) GetID() string { return h.id }

func (h *fakeHandle) Delete(context.Context) error {
	h.client.ops = append(h.client.ops, "delete:"+h.id)
	if _, ok := h.client.store[h.id]; !ok {
		return serviceerror.NewNotFound("no schedule")
	}
	delete(h.client.store, h.id)
	return nil
}

func (h *fakeHandle) Backfill(context.Context, client.ScheduleBackfillOptions) error { return nil }
func (h *fakeHandle) Update(context.Context, client.ScheduleUpdateOptions) error     { return nil }
func (h *fakeHandle) Trigger(context.Context, client.ScheduleTriggerOptions) error   { return nil }

func (h *fakeHandle) Describe(context.Context) (*client.ScheduleDescription, error) {
	opts, ok := h.client.store[h.id]
	if !ok {
		return nil, serviceerror.NewNotFound("no schedule")
	}
	dc := converter.GetDefaultDataConverter()
	fields := map[string]*commonpb.Payload{}
	for k, v := range opts.Memo {
		p, err := dc.ToPayload(v)
		if err != nil {
			return nil, err
		}
		fields[k] = p
	}
	return &client.ScheduleDescription{
		Schedule: client.Schedule{State: &client.ScheduleState{Paused: h.client.paused[h.id]}},
		Memo:     &commonpb.Memo{Fields: fields},
	}, nil
}

func (h *fakeHandle) Pause(context.Context, client.SchedulePauseOptions) error {
	h.client.ops = append(h.client.ops, "pause:"+h.id)
	if _, ok := h.client.store[h.id]; !ok {
		return serviceerror.NewNotFound("no schedule")
	}
	h.client.paused[h.id] = true
	return nil
}

func (h *fakeHandle) Unpause(context.Context, client.ScheduleUnpauseOptions) error {
	h.client.ops = append(h.client.ops, "unpause:"+h.id)
	h.client.paused[h.id] = false
	return nil
}

type fakeScheduleClient struct {
	store  map[string]client.ScheduleOptions
	paused map[string]bool
	ops    []string
}

func newFakeScheduleClient() *fakeScheduleClient {
	return &fakeScheduleClient{store: map[string]client.ScheduleOptions{}, paused: map[string]bool{}}
}

func (c *fakeScheduleClient) Create(_ context.Context, options client.ScheduleOptions) (client.ScheduleHandle, error) {
	c.ops = append(c.ops, "create:"+options.ID)
	c.store[options.ID] = options
	c.paused[options.ID] = options.Paused
	return &fakeHandle{id: options.ID, client: c}, nil
}

func (c *fakeScheduleClient) List(context.Context, client.ScheduleListOptions) (client.ScheduleListIterator, error) {
	var entries []*client.ScheduleListEntry
	for id := range c.store {
		entries = append(entries, &client.ScheduleListEntry{ID: id, Paused: c.paused[id]})
	}
	// One non-Rowboat schedule to prove the prefix filter.
	entries = append(entries, &client.ScheduleListEntry{ID: "other-system/sched-1"})
	return &fakeIterator{entries: entries}, nil
}

func (c *fakeScheduleClient) GetHandle(_ context.Context, scheduleID string) client.ScheduleHandle {
	return &fakeHandle{id: scheduleID, client: c}
}

type fakeIterator struct {
	entries []*client.ScheduleListEntry
	i       int
}

func (it *fakeIterator) HasNext() bool { return it.i < len(it.entries) }
func (it *fakeIterator) Next() (*client.ScheduleListEntry, error) {
	e := it.entries[it.i]
	it.i++
	return e, nil
}

func newManager(sc client.ScheduleClient) *TemporalManager {
	return &TemporalManager{schedules: sc, taskQueue: "rowboat-api-background-tasks", log: zap.NewNop()}
}

// ----------------------------------------------------------------------------

func TestUpsertCreatesThenNoops(t *testing.T) {
	sc := newFakeScheduleClient()
	m := newManager(sc)
	d := desired()

	action, err := m.UpsertTaskCron(context.Background(), d)
	if err != nil || action != "create" {
		t.Fatalf("first upsert = %q, %v", action, err)
	}
	opts := sc.store[d.ScheduleID()]
	if got := opts.Spec.CronExpressions; len(got) != 1 || got[0] != d.CronExpr {
		t.Fatalf("spec cron = %v", got)
	}
	act, ok := opts.Action.(*client.ScheduleWorkflowAction)
	if !ok || act.Workflow != backgroundtaskworkflow.SchedulerWorkflowName {
		t.Fatalf("action = %+v", opts.Action)
	}
	if act.ID != backgroundtaskworkflow.ScheduleWorkflowID("u1", "daily-digest") {
		t.Fatalf("action workflow id = %q", act.ID)
	}

	// Same desired state → noop, even with a bumped revision.
	d.TaskRevision = 9
	action, err = m.UpsertTaskCron(context.Background(), d)
	if err != nil || action != "noop" {
		t.Fatalf("second upsert = %q, %v", action, err)
	}
}

func TestUpsertPausedOnlyChangeFlipsInPlace(t *testing.T) {
	sc := newFakeScheduleClient()
	m := newManager(sc)
	d := desired()
	if _, err := m.UpsertTaskCron(context.Background(), d); err != nil {
		t.Fatal(err)
	}

	d.Paused = true
	action, err := m.UpsertTaskCron(context.Background(), d)
	if err != nil || action != "update" {
		t.Fatalf("pause upsert = %q, %v", action, err)
	}
	if !sc.paused[d.ScheduleID()] {
		t.Fatal("schedule not paused")
	}
	// No delete+recreate for a paused-only flip.
	for _, op := range sc.ops {
		if op == "delete:"+d.ScheduleID() {
			t.Fatalf("paused-only change must not recreate: ops=%v", sc.ops)
		}
	}
}

func TestUpsertSpecChangeRecreates(t *testing.T) {
	sc := newFakeScheduleClient()
	m := newManager(sc)
	d := desired()
	if _, err := m.UpsertTaskCron(context.Background(), d); err != nil {
		t.Fatal(err)
	}

	d.CronExpr = "*/10 * * * *"
	action, err := m.UpsertTaskCron(context.Background(), d)
	if err != nil || action != "update" {
		t.Fatalf("spec upsert = %q, %v", action, err)
	}
	got := sc.store[d.ScheduleID()].Spec.CronExpressions[0]
	if got != "*/10 * * * *" {
		t.Fatalf("cron after update = %q", got)
	}
}

func TestDeleteAndPauseMissingAreNoops(t *testing.T) {
	m := newManager(newFakeScheduleClient())
	if err := m.DeleteTaskCron(context.Background(), "u1", "ghost"); err != nil {
		t.Fatalf("delete missing: %v", err)
	}
	if err := m.PauseTaskCron(context.Background(), "u1", "ghost"); err != nil {
		t.Fatalf("pause missing: %v", err)
	}
}

func TestDescribeMissingAndPresent(t *testing.T) {
	sc := newFakeScheduleClient()
	m := newManager(sc)
	desc, err := m.DescribeTaskCron(context.Background(), "u1", "daily-digest")
	if err != nil || desc.Exists {
		t.Fatalf("missing describe = %+v, %v", desc, err)
	}

	d := desired()
	if _, err := m.UpsertTaskCron(context.Background(), d); err != nil {
		t.Fatal(err)
	}
	desc, err = m.DescribeTaskCron(context.Background(), "u1", "daily-digest")
	if err != nil || !desc.Exists || desc.Paused {
		t.Fatalf("describe = %+v, %v", desc, err)
	}
	if desc.Memo.CronExpr != d.CronExpr || desc.Memo.TaskRevision != d.TaskRevision || desc.Memo.Trigger != "cron" {
		t.Fatalf("memo round-trip = %+v", desc.Memo)
	}
}

func TestListFiltersToRowboatPrefix(t *testing.T) {
	sc := newFakeScheduleClient()
	m := newManager(sc)
	if _, err := m.UpsertTaskCron(context.Background(), desired()); err != nil {
		t.Fatal(err)
	}
	listed, err := m.ListTaskSchedules(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 || listed[0].ID != desired().ScheduleID() {
		t.Fatalf("listed = %+v, want only the rowboat schedule", listed)
	}
}
