"use client";

import "client-only";

import * as React from "react";
import {
  ChipDatePicker,
  ChipDropdown,
  ChipModal,
  ChipModalError,
  ChipModalFooter,
  ChipModalHeader,
  ChipModalPromptBody,
  ChipTextarea,
  Switch,
} from "@sim/emcn";
import { Link, ListChecks, Loader, User } from "@sim/emcn/icons";

import { errMessage } from "@/components/features/revenue/shared/shared";
import { createAction } from "@/lib/revenue/revenue";
import type { RevenueRelationship } from "@/lib/revenue/types";

export type TaskCreateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  relationships: RevenueRelationship[];
  onSaved: () => void;
  onError: (message: string) => void;
};

const todayValue = () => {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const formatShortDate = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

/**
 * Attio-style task composer for the workspace Tasks view. Uses Sim ChipModal
 * chrome so the dialog matches the authenticated product shell instead of the
 * legacy dark shadcn modal pinned to the top of the viewport.
 */
export function TaskCreateDialog({
  open,
  onOpenChange,
  relationships,
  onSaved,
  onError,
}: TaskCreateDialogProps) {
  const todayDefault = React.useMemo(() => todayValue(), []);
  const [title, setTitle] = React.useState("");
  const [relationshipId, setRelationshipId] = React.useState("");
  const [dueDate, setDueDate] = React.useState(todayDefault);
  const [createMore, setCreateMore] = React.useState(false);
  const [recordError, setRecordError] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const relationshipOptions = React.useMemo(
    () =>
      relationships.map((relationship) => ({
        value: relationship.id,
        label: relationship.displayName,
      })),
    [relationships],
  );

  const close = React.useCallback(() => onOpenChange(false), [onOpenChange]);

  const submit = React.useCallback(async () => {
    if (!title.trim()) return;
    if (!relationshipId) {
      setRecordError(true);
      return;
    }

    setBusy(true);
    try {
      await createAction({
        relationshipId,
        actionType: "follow_up_task",
        channel: "task",
        reason: title.trim(),
        dueAt: new Date(`${dueDate}T17:00:00`).toISOString(),
        priorityScore: 30,
      });
      onSaved();
      if (createMore) {
        setTitle("");
        setRecordError(false);
      } else {
        close();
      }
    } catch (error) {
      onError(errMessage(error, "Could not create the task."));
    } finally {
      setBusy(false);
    }
  }, [close, createMore, dueDate, onError, onSaved, relationshipId, title]);

  return (
    <ChipModal
      className="sim-landing-root"
      data-slot="task-create-dialog"
      dismissDisabled={busy}
      open={open}
      size="xl"
      srTitle="Create task"
      onOpenChange={onOpenChange}
    >
      <ChipModalHeader icon={ListChecks} onClose={close}>
        Create task
      </ChipModalHeader>

      <ChipModalPromptBody minHeight={120}>
        <ChipTextarea
          aria-label="Task title"
          autoFocus
          className="min-h-[88px] border-0 bg-transparent px-1 py-1 shadow-none focus-visible:outline-none"
          placeholder="Schedule a demo with @Contact"
          rows={3}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        {recordError ? <ChipModalError>Add a company before saving.</ChipModalError> : null}
      </ChipModalPromptBody>

      <ChipModalFooter
        cancelDisabled={busy}
        onCancel={close}
        primaryAction={{
          disabled: busy || !title.trim() || !dueDate,
          disabledTooltip: !relationshipId ? "Link a company to save" : undefined,
          label: "Save",
          leftAdornment: busy ? (
            <Loader animate className="size-[14px] text-[var(--text-tertiary)]" />
          ) : undefined,
          onClick: () => void submit(),
        }}
        primaryAdjacentAction={{
          custom: (
            <label className="inline-flex cursor-pointer items-center gap-2 px-1 text-[var(--text-secondary)] text-caption">
              <Switch
                aria-label="Create more tasks after saving"
                checked={createMore}
                onCheckedChange={setCreateMore}
              />
              Create more
            </label>
          ),
        }}
        secondaryActions={[
          {
            custom: (
              <ChipDatePicker
                label={dueDate === todayDefault ? "Today" : formatShortDate(dueDate)}
                today={todayDefault}
                value={dueDate}
                variant="ghost"
                onChange={setDueDate}
              />
            ),
          },
          {
            custom: (
              <span className="inline-flex items-center gap-1.5 px-1 text-[var(--text-secondary)] text-caption">
                <User className="size-[14px]" />
                Assigned to you
              </span>
            ),
          },
          {
            custom: (
              <ChipDropdown
                className={recordError ? "text-[var(--text-error)]" : undefined}
                leftIcon={Link}
                options={relationshipOptions}
                placeholder={recordError ? "Add a record to save" : "Add record"}
                value={relationshipId || undefined}
                onChange={(value) => {
                  setRelationshipId(value);
                  setRecordError(false);
                }}
              />
            ),
          },
        ]}
      />
    </ChipModal>
  );
}
