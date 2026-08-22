import { useEffect, useState } from "react";

import { Button } from "@oppulence/ui/components/button";
import { Input } from "@oppulence/ui/components/input";
import { Switch } from "@oppulence/ui/components/switch";
import { Textarea } from "@oppulence/ui/components/textarea";
import {
  DICTATION_TRANSFORM_SHORTCUT_OPTIONS,
  type DictationSettings,
  type DictationTransform,
  type DictationTransformShortcut,
} from "@x/shared/transcription";
import { Plus, Sparkles, Trash2 } from "@/lib/icons";
import { toast } from "sonner";

interface Props {
  value: DictationSettings;
  onChange: (next: DictationSettings) => Promise<void>;
  shortcutsReady: boolean;
  shortcutError?: string;
}

interface TransformRowProps {
  transform: DictationTransform;
  usedShortcuts: Set<DictationTransformShortcut>;
  disabled: boolean;
  onUpdate: (next: DictationTransform) => Promise<void>;
  onDelete: () => Promise<void>;
}

function TransformRow({
  transform,
  usedShortcuts,
  disabled,
  onUpdate,
  onDelete,
}: TransformRowProps) {
  const [name, setName] = useState(transform.name);
  const [instruction, setInstruction] = useState(transform.instruction);
  const [shortcut, setShortcut] = useState(transform.shortcut);

  useEffect(() => setName(transform.name), [transform.name]);
  useEffect(() => setInstruction(transform.instruction), [transform.instruction]);
  useEffect(() => setShortcut(transform.shortcut), [transform.shortcut]);

  const commit = async () => {
    const nextName = name.trim();
    const nextInstruction = instruction.trim();
    if (!nextName || !nextInstruction) {
      setName(transform.name);
      setInstruction(transform.instruction);
      toast.error("Each Quick Transform needs a name and an instruction.");
      return;
    }
    try {
      await onUpdate({
        ...transform,
        name: nextName,
        instruction: nextInstruction,
        shortcut,
      });
    } catch {
      setName(transform.name);
      setInstruction(transform.instruction);
      setShortcut(transform.shortcut);
      toast.error("Could not save that Quick Transform.");
    }
  };

  const dirty =
    name.trim() !== transform.name ||
    instruction.trim() !== transform.instruction ||
    shortcut !== transform.shortcut;

  return (
    <div className="grid gap-2 border-t px-3 py-3 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_8rem_auto]">
      <Input
        value={name}
        maxLength={60}
        disabled={disabled}
        onChange={(event) => setName(event.target.value)}
        aria-label={`${transform.name} transform name`}
        className="h-8 rounded-none text-xs"
      />
      <select
        value={shortcut}
        disabled={disabled}
        onChange={(event) => setShortcut(event.target.value as DictationTransformShortcut)}
        aria-label={`${transform.name} transform shortcut`}
        className="h-8 border bg-background px-2 text-xs text-foreground"
      >
        {DICTATION_TRANSFORM_SHORTCUT_OPTIONS.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={option.value !== shortcut && usedShortcuts.has(option.value)}
          >
            {option.label}
          </option>
        ))}
      </select>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        disabled={disabled}
        onClick={() => void onDelete().catch(() => toast.error("Could not delete that transform."))}
        aria-label={`Delete ${transform.name} transform`}
        className="size-8 justify-self-end text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="size-3.5" />
      </Button>
      <Textarea
        value={instruction}
        maxLength={2_000}
        disabled={disabled}
        onChange={(event) => setInstruction(event.target.value)}
        aria-label={`${transform.name} transform instruction`}
        className="min-h-16 resize-y rounded-none text-xs leading-5 sm:col-span-3"
      />
      <div className="flex justify-end sm:col-span-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || !dirty || !name.trim() || !instruction.trim()}
          onClick={() => void commit()}
          className="h-7 rounded-none px-2 text-[11px]"
        >
          Save changes
        </Button>
      </div>
    </div>
  );
}

export function DictationTransformSettings({
  value,
  onChange,
  shortcutsReady,
  shortcutError,
}: Props) {
  const [saving, setSaving] = useState(false);
  const usedShortcuts = new Set(value.transforms.map((transform) => transform.shortcut));

  const persist = async (next: DictationSettings) => {
    setSaving(true);
    try {
      await onChange(next);
    } finally {
      setSaving(false);
    }
  };

  const updateTransform = async (nextTransform: DictationTransform) => {
    if (
      value.transforms.some(
        (transform) =>
          transform.id !== nextTransform.id && transform.shortcut === nextTransform.shortcut,
      )
    ) {
      throw new Error("That shortcut is already assigned.");
    }
    await persist({
      ...value,
      transforms: value.transforms.map((transform) =>
        transform.id === nextTransform.id ? nextTransform : transform,
      ),
    });
  };

  const addTransform = async () => {
    const shortcut = DICTATION_TRANSFORM_SHORTCUT_OPTIONS.find(
      (option) => !usedShortcuts.has(option.value),
    )?.value;
    if (!shortcut || value.transforms.length >= 9) {
      toast.error("Quick Transforms support up to nine shortcut slots.");
      return;
    }
    const id =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `transform-${Date.now().toString(36)}`;
    try {
      await persist({
        ...value,
        transforms: [
          ...value.transforms,
          {
            id,
            name: "Custom transform",
            instruction: "Rewrite this text while preserving its meaning and concrete details.",
            shortcut,
          },
        ],
      });
    } catch {
      toast.error("Could not add a Quick Transform.");
    }
  };

  return (
    <div className="border border-border bg-background/60">
      <div className="flex items-start justify-between gap-4 px-3 py-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center border bg-card text-muted-foreground">
            <Sparkles className="size-3.5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-foreground">
              Quick Transforms
              {value.transformsEnabled ? (
                <span className="border px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                  {shortcutsReady ? "Shortcuts ready" : "Needs attention"}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              Select up to 1,000 words, then press an assigned shortcut to rewrite and replace the
              exact selection. If focus moves or a transform fails, your original stays untouched.
            </p>
            <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
              Explicit opt-in: assigned Option-number keys are intercepted system-wide only while
              this is enabled. Open-ended rewrites use your configured model; Local only blocks
              cloud transforms.
            </p>
          </div>
        </div>
        <Switch
          checked={value.transformsEnabled}
          disabled={saving}
          onCheckedChange={(transformsEnabled) =>
            void persist({ ...value, transformsEnabled }).catch(() =>
              toast.error("Could not update Quick Transforms."),
            )
          }
          aria-label="Enable Quick Transforms"
          className="shrink-0"
        />
      </div>

      {shortcutError ? (
        <p className="mx-3 mb-3 border border-amber-500/20 bg-amber-500/5 px-2.5 py-2 text-[11px] leading-5 text-amber-700 dark:text-amber-300">
          {shortcutError}
        </p>
      ) : null}

      <div className="border-t">
        {value.transforms.map((transform) => (
          <TransformRow
            key={transform.id}
            transform={transform}
            usedShortcuts={usedShortcuts}
            disabled={saving}
            onUpdate={updateTransform}
            onDelete={() =>
              persist({
                ...value,
                transforms: value.transforms.filter((candidate) => candidate.id !== transform.id),
              })
            }
          />
        ))}
        <div className="border-t px-3 py-2.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={saving || value.transforms.length >= 9}
            onClick={() => void addTransform()}
            className="h-8 rounded-none text-xs"
          >
            <Plus className="mr-1.5 size-3.5" /> Add transform
          </Button>
        </div>
      </div>
    </div>
  );
}
