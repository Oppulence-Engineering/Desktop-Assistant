import { useState } from "react";

import { Button } from "@oppulence/ui/components/button";
import { Input } from "@oppulence/ui/components/input";
import { Switch } from "@oppulence/ui/components/switch";
import { Textarea } from "@oppulence/ui/components/textarea";
import type {
  DictationCleanupLevel,
  DictationSettings,
  DictationStyle,
  DictationStyleSettings,
} from "@x/shared/dist/transcription.js";
import { BookOpen, Plus, Sparkles, Trash2 } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

import { SettingsSection } from "./settings-ui";

interface Props {
  value: DictationSettings;
  onChange: (next: DictationSettings) => Promise<void>;
}

const STYLE_OPTIONS: Array<{ value: DictationStyle; label: string }> = [
  { value: "formal", label: "Formal" },
  { value: "casual", label: "Casual" },
  { value: "very-casual", label: "Very casual" },
  { value: "excited", label: "Excited" },
];

const CLEANUP_OPTIONS: Array<{
  value: DictationCleanupLevel;
  label: string;
  hint: string;
}> = [
  { value: "none", label: "None", hint: "Exact transcript" },
  { value: "light", label: "Light", hint: "Fillers + grammar" },
  { value: "medium", label: "Medium", hint: "Clarity + corrections" },
  { value: "high", label: "High", hint: "Brevity + polish" },
];

const STYLE_CATEGORIES: Array<{
  key: keyof DictationStyleSettings;
  label: string;
  hint: string;
}> = [
  { key: "personalMessaging", label: "Personal messages", hint: "Messages, WhatsApp, Signal" },
  { key: "workMessaging", label: "Work messages", hint: "Slack, Teams, Discord" },
  { key: "email", label: "Email", hint: "Mail, Gmail, Outlook" },
  { key: "other", label: "Other", hint: "Docs, notes, AI, editors" },
];

function normalized(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function DictationPersonalizationSettings({ value, onChange }: Props) {
  const [dictionaryTerm, setDictionaryTerm] = useState("");
  const [dictionaryHeardAs, setDictionaryHeardAs] = useState("");
  const [snippetTrigger, setSnippetTrigger] = useState("");
  const [snippetExpansion, setSnippetExpansion] = useState("");
  const [saving, setSaving] = useState(false);

  const persist = async (next: DictationSettings, successMessage?: string) => {
    setSaving(true);
    try {
      await onChange(next);
      if (successMessage) toast.success(successMessage);
      return true;
    } catch {
      toast.error("Could not save dictation personalization");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const addDictionary = async () => {
    const term = dictionaryTerm.trim();
    const replacementFor = dictionaryHeardAs.trim();
    if (!term) return;
    if (term.length > 60 || replacementFor.length > 60) {
      toast.error("Dictionary words and corrections must be 60 characters or fewer.");
      return;
    }
    const identity = normalized(term);
    if (value.dictionary.some((entry) => normalized(entry.term) === identity)) {
      toast.error("That dictionary entry already exists.");
      return;
    }
    if (value.snippets.some((snippet) => normalized(snippet.trigger) === identity)) {
      toast.error("Use a different phrase; this one is already a snippet trigger.");
      return;
    }
    const saved = await persist(
      {
        ...value,
        dictionary: [
          ...value.dictionary,
          { term, ...(replacementFor ? { replacementFor } : {}), starred: false },
        ],
      },
      "Word added",
    );
    if (!saved) return;
    setDictionaryTerm("");
    setDictionaryHeardAs("");
  };

  const addSnippet = async () => {
    const trigger = snippetTrigger.trim();
    if (!trigger || !snippetExpansion) return;
    if (trigger.length > 60 || snippetExpansion.length > 4_000) {
      toast.error("Snippet triggers can use 60 characters and expansions can use 4,000.");
      return;
    }
    const identity = normalized(trigger);
    if (value.snippets.some((snippet) => normalized(snippet.trigger) === identity)) {
      toast.error("That snippet trigger already exists.");
      return;
    }
    if (value.dictionary.some((entry) => normalized(entry.term) === identity)) {
      toast.error("Use a different phrase; this one is already in the dictionary.");
      return;
    }
    const saved = await persist(
      {
        ...value,
        snippets: [...value.snippets, { trigger, expansion: snippetExpansion }],
      },
      "Snippet added",
    );
    if (!saved) return;
    setSnippetTrigger("");
    setSnippetExpansion("");
  };

  return (
    <SettingsSection
      title="Style and personalization"
      description="Control cleanup, match the app you are writing in, and teach dictation your terms and reusable text."
    >
      <div className="space-y-4">
        <div className="rounded-none border bg-muted/20 px-3.5 py-3">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-none border bg-card text-muted-foreground">
              <Sparkles className="size-4" />
            </span>
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-foreground">Auto Cleanup</div>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                Choose how much Oppulence edits after recognition. Processing is instant and local,
                and the original transcript remains available through Undo AI edit.
              </p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {CLEANUP_OPTIONS.map((option) => {
              const selected = value.cleanupLevel === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={saving}
                  aria-pressed={selected}
                  onClick={() => void persist({ ...value, cleanupLevel: option.value })}
                  className={cn(
                    "min-h-16 border px-2.5 py-2 text-left transition-colors",
                    selected
                      ? "border-foreground/40 bg-foreground text-background"
                      : "border-border bg-background/60 hover:bg-accent",
                  )}
                >
                  <span className="block text-xs font-medium">{option.label}</span>
                  <span
                    className={cn(
                      "mt-0.5 block text-[10px] leading-4",
                      selected ? "text-background/70" : "text-muted-foreground",
                    )}
                  >
                    {option.hint}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-start justify-between gap-4 rounded-none border bg-muted/20 px-3.5 py-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-none border bg-card text-muted-foreground">
              <BookOpen className="size-4" />
            </span>
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-foreground">Nearby text context</div>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                Uses at most 256 characters on each side of the cursor for casing, spacing, and
                punctuation. Password fields and screenshots are never read; context stays on this
                Mac. Turning this off still uses the app category for your style.
              </p>
            </div>
          </div>
          <Switch
            checked={value.contextEnabled}
            disabled={saving}
            onCheckedChange={(contextEnabled) => void persist({ ...value, contextEnabled })}
            aria-label="Use nearby text for desktop dictation"
            className="shrink-0"
          />
        </div>

        <div className="rounded-none border bg-muted/20 px-3.5 py-3">
          <div className="text-[13px] font-medium text-foreground">Style by app</div>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            Formatting changes capitalization and punctuation only—not your words or meaning.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {STYLE_CATEGORIES.map((category) => (
              <label
                key={category.key}
                className="flex items-center justify-between gap-3 border bg-background/60 px-3 py-2"
              >
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-foreground">
                    {category.label}
                  </span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {category.hint}
                  </span>
                </span>
                <select
                  className="h-8 shrink-0 border bg-background px-2 text-xs text-foreground"
                  value={value.styles[category.key]}
                  disabled={saving}
                  onChange={(event) =>
                    void persist({
                      ...value,
                      styles: {
                        ...value.styles,
                        [category.key]: event.target.value as DictationStyle,
                      },
                    })
                  }
                  aria-label={`${category.label} dictation style`}
                >
                  {STYLE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </div>

        <div className="rounded-none border bg-muted/20 px-3.5 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[13px] font-medium text-foreground">Personal dictionary</div>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                Preserve exact casing, or correct a spelling the recognizer repeatedly returns.
              </p>
            </div>
            <span className="text-[11px] text-muted-foreground">
              {value.dictionary.length}/1000
            </span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <Input
              value={dictionaryTerm}
              maxLength={60}
              onChange={(event) => setDictionaryTerm(event.target.value)}
              placeholder="Correct word, e.g. Oppulence"
              aria-label="Dictionary word"
            />
            <Input
              value={dictionaryHeardAs}
              maxLength={60}
              onChange={(event) => setDictionaryHeardAs(event.target.value)}
              placeholder="Often heard as (optional)"
              aria-label="Dictionary misspelling"
            />
            <Button
              type="button"
              size="sm"
              disabled={saving || !dictionaryTerm.trim()}
              onClick={() => void addDictionary()}
            >
              <Plus className="mr-1.5 size-3.5" /> Add
            </Button>
          </div>
          {value.dictionary.length ? (
            <div className="mt-3 max-h-52 divide-y overflow-y-auto border bg-background/60">
              {[...value.dictionary]
                .map((entry, originalIndex) => ({ entry, originalIndex }))
                .sort(
                  (left, right) =>
                    Number(right.entry.starred) - Number(left.entry.starred) ||
                    left.entry.term.localeCompare(right.entry.term),
                )
                .map(({ entry, originalIndex }) => (
                  <div
                    key={`${normalized(entry.term)}-${originalIndex}`}
                    className="flex items-center gap-2 px-3 py-2"
                  >
                    <button
                      type="button"
                      className="shrink-0 text-sm text-amber-500 disabled:opacity-50"
                      onClick={() =>
                        void persist({
                          ...value,
                          dictionary: value.dictionary.map((current, index) =>
                            index === originalIndex
                              ? { ...current, starred: !current.starred }
                              : current,
                          ),
                        })
                      }
                      disabled={saving}
                      aria-label={`${entry.starred ? "Remove priority from" : "Prioritize"} ${entry.term}`}
                      title={entry.starred ? "High priority" : "Prioritize this word"}
                    >
                      {entry.starred ? "★" : "☆"}
                    </button>
                    <div className="min-w-0 flex-1 text-xs text-foreground">
                      {entry.replacementFor ? (
                        <>
                          <span className="text-muted-foreground">{entry.replacementFor}</span> →{" "}
                          {entry.term}
                        </>
                      ) : (
                        entry.term
                      )}
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      onClick={() =>
                        void persist({
                          ...value,
                          dictionary: value.dictionary.filter(
                            (_current, index) => index !== originalIndex,
                          ),
                        })
                      }
                      aria-label={`Delete ${entry.term}`}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
            </div>
          ) : null}
        </div>

        <div className="rounded-none border bg-muted/20 px-3.5 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[13px] font-medium text-foreground">Spoken snippets</div>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                Say a unique trigger naturally to insert the exact saved plain-text expansion.
              </p>
            </div>
            <span className="text-[11px] text-muted-foreground">{value.snippets.length}/1000</span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)_auto]">
            <Input
              value={snippetTrigger}
              maxLength={60}
              onChange={(event) => setSnippetTrigger(event.target.value)}
              placeholder="Trigger, e.g. my signature"
              aria-label="Snippet trigger"
            />
            <Textarea
              value={snippetExpansion}
              maxLength={4_000}
              onChange={(event) => setSnippetExpansion(event.target.value)}
              placeholder="Text to insert"
              aria-label="Snippet expansion"
              className="min-h-9"
            />
            <Button
              type="button"
              size="sm"
              disabled={saving || !snippetTrigger.trim() || !snippetExpansion}
              onClick={() => void addSnippet()}
            >
              <Plus className="mr-1.5 size-3.5" /> Add
            </Button>
          </div>
          {value.snippets.length ? (
            <div className="mt-3 max-h-52 divide-y overflow-y-auto border bg-background/60">
              {value.snippets.map((snippet, index) => (
                <div
                  key={`${normalized(snippet.trigger)}-${index}`}
                  className="flex items-center gap-2 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-foreground">“{snippet.trigger}”</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {snippet.expansion}
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    onClick={() =>
                      void persist({
                        ...value,
                        snippets: value.snippets.filter(
                          (_current, currentIndex) => currentIndex !== index,
                        ),
                      })
                    }
                    aria-label={`Delete ${snippet.trigger}`}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </SettingsSection>
  );
}
