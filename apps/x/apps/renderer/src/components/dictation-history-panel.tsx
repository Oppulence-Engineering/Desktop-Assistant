import { useCallback, useEffect, useMemo, useState } from "react";

import { BarChart3, Copy, Mic, RotateCcw, Search, Trash2, Zap } from "@/lib/icons";
import { Button } from "@oppulence/ui/components/button";
import type {
  DictationHistoryEntry,
  DictationHistoryRetention,
  DictationHistoryStats,
} from "@x/shared/dist/transcription.js";
import { DICTATION_LANGUAGE_LABELS } from "@x/shared/dist/transcription.js";

const EMPTY_STATS: DictationHistoryStats = {
  totalWords: 0,
  todayWords: 0,
  averageWpm: 0,
  streakDays: 0,
  daysUsed: 0,
  totalDictations: 0,
  totalAudioDurationMs: 0,
  automaticallyEditedDictations: 0,
  wordsCleanedUp: 0,
  topApps: [],
};

function dayKey(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (dayKey(iso) === dayKey(today.toISOString())) return "Today";
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return "Yesterday";
  return date.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function durationLabel(durationMs: number): string {
  const seconds = Math.max(1, Math.round(durationMs / 1_000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function DictationHistoryPanel() {
  const [entries, setEntries] = useState<DictationHistoryEntry[]>([]);
  const [stats, setStats] = useState<DictationHistoryStats>(EMPTY_STATS);
  const [retention, setRetention] = useState<DictationHistoryRetention>("forever");
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(30);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await window.ipc.invoke("dictation:getHistory", {
        ...(query.trim() ? { query: query.trim() } : {}),
        limit,
        offset: 0,
      });
      setEntries(result.entries);
      setStats(result.stats);
      setRetention(result.retention);
      setTotal(result.total);
    } catch (error) {
      console.error("Home: failed to load dictation history", error);
    } finally {
      setLoading(false);
    }
  }, [limit, query]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), query ? 120 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  useEffect(
    () =>
      window.ipc.on("dictation:historyChanged", () => {
        void load();
      }),
    [load],
  );

  const groups = useMemo(() => {
    const grouped: Array<{ key: string; label: string; entries: DictationHistoryEntry[] }> = [];
    for (const entry of entries) {
      const key = dayKey(entry.createdAt);
      const current = grouped.at(-1);
      if (current?.key === key) current.entries.push(entry);
      else grouped.push({ key, label: dayLabel(entry.createdAt), entries: [entry] });
    }
    return grouped;
  }, [entries]);

  const copyEntry = useCallback(async (id: string) => {
    const result = await window.ipc.invoke("dictation:copyHistoryEntry", { id });
    setNotice(result.success ? "Transcript copied" : (result.error ?? "Could not copy transcript"));
    setTimeout(() => setNotice(null), 1_800);
  }, []);

  const deleteEntry = useCallback(
    async (id: string) => {
      await window.ipc.invoke("dictation:deleteHistoryEntry", { id });
      await load();
    },
    [load],
  );

  const retryEntry = useCallback(
    async (id: string) => {
      setNotice("Retrying saved audio…");
      const result = await window.ipc.invoke("dictation:retryFailed", { id });
      setNotice(result.success ? "Transcript recovered" : (result.error ?? "Retry failed"));
      await load();
      setTimeout(() => setNotice(null), 2_500);
    },
    [load],
  );

  const toggleFormatting = useCallback(
    async (id: string) => {
      const result = await window.ipc.invoke("dictation:toggleHistoryFormatting", { id });
      setNotice(
        result.success
          ? result.entry?.formattingUndone
            ? "Showing the original transcription"
            : "Smart Formatting restored"
          : (result.error ?? "Original transcription unavailable"),
      );
      await load();
      setTimeout(() => setNotice(null), 2_000);
    },
    [load],
  );

  const clearHistory = useCallback(async () => {
    if (!window.confirm("Delete all local dictation history? This cannot be undone.")) return;
    await window.ipc.invoke("dictation:clearHistory", null);
    await load();
  }, [load]);

  return (
    <section className="rowboat-dev-card overflow-hidden" aria-labelledby="dictation-heading">
      <div className="border-b border-border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Mic className="size-4" />
              <h2 id="dictation-heading" className="text-sm font-medium">
                Dictation
              </h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Your on-device transcript history and speaking pace.
            </p>
          </div>
          <div className="text-right">
            <div className="text-lg font-semibold tabular-nums">
              {stats.totalWords.toLocaleString()} words
            </div>
            <div className="text-[11px] text-muted-foreground">
              {stats.todayWords.toLocaleString()} today
              {stats.wordsCleanedUp > 0
                ? ` · ${stats.wordsCleanedUp.toLocaleString()} cleaned up`
                : ""}
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden border border-border bg-border md:grid-cols-5">
          <Stat
            label="Average speed"
            value={stats.averageWpm ? `${Math.round(stats.averageWpm)} WPM` : "—"}
            icon={<BarChart3 className="size-3.5" />}
          />
          <Stat
            label="Current streak"
            value={`${stats.streakDays} ${stats.streakDays === 1 ? "day" : "days"}`}
            icon={<Zap className="size-3.5" />}
          />
          <Stat label="Dictations" value={stats.totalDictations.toLocaleString()} />
          <Stat
            label="Automatic edits"
            value={stats.automaticallyEditedDictations.toLocaleString()}
          />
          <Stat label="Days used" value={stats.daysUsed.toLocaleString()} />
        </div>

        {stats.topApps.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>Top apps</span>
            {stats.topApps.slice(0, 3).map((app) => (
              <span
                key={app.appName}
                className="border border-border bg-background px-2 py-1 text-foreground"
              >
                {app.appName} · {app.dictations}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="p-4">
        <div className="flex items-center gap-2">
          <label className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setLimit(30);
              }}
              placeholder="Search transcripts or apps"
              aria-label="Search dictation history"
              className="h-9 w-full border border-border bg-background pl-8 pr-3 text-xs outline-none focus:border-foreground/40"
            />
          </label>
          {entries.length > 0 ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => void clearHistory()}>
              Clear
            </Button>
          ) : null}
        </div>

        {notice ? (
          <div className="mt-2 text-[11px] text-muted-foreground" role="status">
            {notice}
          </div>
        ) : null}

        {loading ? (
          <div className="py-8 text-center text-xs text-muted-foreground">Loading history…</div>
        ) : retention === "never" ? (
          <EmptyHistory text="History is off. Change Transcript history in Transcription settings to keep local records and stats." />
        ) : groups.length === 0 ? (
          <EmptyHistory
            text={
              query
                ? "No transcripts match that search."
                : "Your next desktop dictation will appear here."
            }
          />
        ) : (
          <div className="mt-4 space-y-4">
            {groups.map((group) => (
              <div key={group.key}>
                <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </h3>
                <div className="divide-y divide-border border-y border-border">
                  {group.entries.map((entry) => (
                    <HistoryRow
                      key={entry.id}
                      entry={entry}
                      onCopy={copyEntry}
                      onDelete={deleteEntry}
                      onRetry={retryEntry}
                      onToggleFormatting={toggleFormatting}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {entries.length < total ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-4 w-full"
            onClick={() => setLimit((value) => Math.min(200, value + 30))}
          >
            Show more ({total - entries.length} remaining)
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  icon,
}: {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
}) {
  return (
    <div className="bg-background px-3 py-2.5">
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 text-sm font-medium tabular-nums">{value}</div>
    </div>
  );
}

function EmptyHistory({ text }: { text: string }) {
  return <div className="py-8 text-center text-xs leading-5 text-muted-foreground">{text}</div>;
}

function HistoryRow({
  entry,
  onCopy,
  onDelete,
  onRetry,
  onToggleFormatting,
}: {
  entry: DictationHistoryEntry;
  onCopy: (id: string) => void;
  onDelete: (id: string) => void;
  onRetry: (id: string) => void;
  onToggleFormatting: (id: string) => void;
}) {
  const wpm =
    entry.audioDurationMs > 0
      ? Math.round(entry.wordCount / (entry.audioDurationMs / 60_000))
      : null;
  return (
    <div className="group flex items-start gap-3 py-3">
      <button
        type="button"
        disabled={!entry.text}
        onClick={() => onCopy(entry.id)}
        className="min-w-0 flex-1 text-left disabled:cursor-default"
      >
        {entry.status === "failed" ? (
          <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
            Transcription failed
          </span>
        ) : (
          <span className="line-clamp-3 whitespace-pre-wrap text-[12.5px] leading-5 text-foreground">
            {entry.text}
          </span>
        )}
        <span className="mt-1 block text-[10.5px] text-muted-foreground">
          {timeLabel(entry.createdAt)}
          {entry.appName ? ` · ${entry.appName}` : ""}
          {entry.language ? ` · ${DICTATION_LANGUAGE_LABELS[entry.language]}` : ""}
          {entry.audioDurationMs ? ` · ${durationLabel(entry.audioDurationMs)}` : ""}
          {wpm ? ` · ${wpm} WPM` : ""}
          {entry.delivery === "copied" ? " · copied after paste failed" : ""}
        </span>
        {entry.rawText && entry.polishedText ? (
          <span className="mt-1 block text-[10px] text-muted-foreground">
            {entry.formattingUndone
              ? "Original transcription · Smart Formatting undone"
              : `Smart Formatting · ${entry.polishChanges.length} ${entry.polishChanges.length === 1 ? "change" : "changes"}`}
          </span>
        ) : null}
      </button>
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        {entry.status === "failed" && entry.retryAvailable ? (
          <Button type="button" variant="outline" size="sm" onClick={() => onRetry(entry.id)}>
            Retry
          </Button>
        ) : entry.status === "failed" ? (
          <span className="px-1.5 text-[10px] text-muted-foreground">Audio unavailable</span>
        ) : (
          <>
            {entry.rawText && entry.polishedText ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onToggleFormatting(entry.id)}
                title={entry.formattingUndone ? "Redo AI edit" : "Undo AI edit"}
              >
                <RotateCcw className="mr-1 size-3.5" />
                {entry.formattingUndone ? "Redo edit" : "Undo edit"}
              </Button>
            ) : null}
            <button
              type="button"
              onClick={() => onCopy(entry.id)}
              className="p-1.5 text-muted-foreground hover:text-foreground"
              aria-label="Copy transcript"
              title="Copy transcript"
            >
              <Copy className="size-3.5" />
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => onDelete(entry.id)}
          className="p-1.5 text-muted-foreground hover:text-destructive"
          aria-label="Delete transcript"
          title="Delete transcript"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
