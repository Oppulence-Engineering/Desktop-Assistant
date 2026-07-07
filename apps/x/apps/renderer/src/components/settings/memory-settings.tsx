import { useState, useEffect, useCallback } from "react";
import { BrainIcon, Loader2 } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { SettingsSection, SettingsRow } from "./settings-ui";

// Renderer-side mirror of core `MemoryConfig` defaults (config/index.json holds only
// overrides; missing keys fall back to these, matching memory/config.ts).
interface MemoryCfg {
  enabled: boolean;
  model: string;
  dims: number;
  batchSize: number;
  maxMonthlyEmbedTokens: number;
  maxPerNote: number;
  recencyWeight: number;
  snippetChars: number;
  embedDimensions: number;
  queryExpansion: boolean;
}

const DEFAULTS: MemoryCfg = {
  enabled: true,
  model: "text-embedding-3-small",
  dims: 0,
  batchSize: 64,
  maxMonthlyEmbedTokens: 0,
  maxPerNote: 2,
  recencyWeight: 0,
  snippetChars: 600,
  embedDimensions: 0,
  queryExpansion: false,
};

/**
 * Settings ▸ Memory — control + observe the local semantic memory index (RFC 021).
 * Reads/writes `config/index.json`; live index status comes from `memory:status` +
 * the `memory:indexProgress` event emitted by the background indexer.
 */
export function MemorySettings({ dialogOpen }: { dialogOpen: boolean }) {
  const [cfg, setCfg] = useState<MemoryCfg | null>(null);
  const [original, setOriginal] = useState<MemoryCfg | null>(null);
  const [status, setStatus] = useState<{
    enabled: boolean;
    model: string | null;
    dims: number;
    chunkCount: number;
    lastBuiltMs: number | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await window.ipc.invoke("memory:status", null));
    } catch {
      // status is best-effort
    }
  }, []);

  useEffect(() => {
    if (!dialogOpen) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      let loaded: MemoryCfg = { ...DEFAULTS };
      try {
        const res = await window.ipc.invoke("workspace:readFile", { path: "config/index.json" });
        loaded = { ...DEFAULTS, ...(JSON.parse(res.data) as Partial<MemoryCfg>) };
      } catch {
        // no config file yet → defaults
      }
      if (!cancelled) {
        setCfg(loaded);
        setOriginal(loaded);
      }
      await loadStatus();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [dialogOpen, loadStatus]);

  // Refresh status whenever a background indexing pass reports progress.
  useEffect(() => {
    const cleanup = window.ipc.on("memory:indexProgress", () => {
      void loadStatus();
    });
    return cleanup;
  }, [loadStatus]);

  const update = useCallback(<K extends keyof MemoryCfg>(key: K, value: MemoryCfg[K]) => {
    setCfg((c) => (c ? { ...c, [key]: value } : c));
  }, []);

  const hasChanges = !!cfg && !!original && JSON.stringify(cfg) !== JSON.stringify(original);

  const handleSave = useCallback(async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      await window.ipc.invoke("workspace:writeFile", {
        path: "config/index.json",
        data: JSON.stringify(cfg, null, 2),
      });
      setOriginal({ ...cfg });
      toast.success("Memory settings saved");
    } catch {
      toast.error("Failed to save memory settings");
    } finally {
      setSaving(false);
    }
  }, [cfg]);

  if (loading || !cfg) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        Loading…
      </div>
    );
  }

  const lastBuilt = status?.lastBuiltMs ? new Date(status.lastBuiltMs).toLocaleString() : "never";

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Index status"
        description="A local semantic index over your knowledge vault powers ⌘K search, related notes, and the copilot's memory-search tool."
      >
        <div className="rounded-none border bg-card px-3.5 py-3 text-[13px]">
          <div className="flex items-center gap-2 pb-2 text-muted-foreground">
            <BrainIcon className="size-4" />
            <span>Semantic memory</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Indexed chunks</span>
            <span className="font-medium tabular-nums">{status?.chunkCount ?? 0}</span>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-muted-foreground">Model</span>
            <span className="font-medium">
              {status?.model ?? cfg.model}
              {status?.dims ? ` · ${status.dims}d` : ""}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-muted-foreground">Last indexed</span>
            <span className="font-medium">{lastBuilt}</span>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="Retrieval" description="How memory search and recall behave.">
        <SettingsRow
          label="Enable semantic memory"
          description="When off, search and recall fall back to plain text matching."
        >
          <Switch
            checked={cfg.enabled}
            onCheckedChange={(v) => update("enabled", v)}
            aria-label="Enable semantic memory"
          />
        </SettingsRow>
        <SettingsRow
          label="Query expansion (HyDE)"
          description="Use the LLM to broaden recall on conceptual queries. Adds a small cost per search."
        >
          <Switch
            checked={cfg.queryExpansion}
            onCheckedChange={(v) => update("queryExpansion", v)}
            aria-label="Query expansion"
          />
        </SettingsRow>
        <SettingsRow
          label="Recency weight"
          description={`Bias results toward recently-edited notes (${cfg.recencyWeight.toFixed(2)}). 0 = off.`}
          stacked
        >
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={cfg.recencyWeight}
            onChange={(e) => update("recencyWeight", parseFloat(e.target.value))}
            className="w-full accent-foreground"
            aria-label="Recency weight"
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title="Advanced"
        description="Changing the model or dimensions rebuilds the index."
      >
        <SettingsRow label="Embedding model" description="Defaults to text-embedding-3-small.">
          <Input
            value={cfg.model}
            onChange={(e) => update("model", e.target.value)}
            className="h-8 w-56"
            aria-label="Embedding model"
          />
        </SettingsRow>
        <SettingsRow
          label="Embedding dimensions"
          description="0 = provider default (Matryoshka). Smaller = faster + smaller index."
        >
          <Input
            type="number"
            min={0}
            value={cfg.embedDimensions}
            onChange={(e) =>
              update("embedDimensions", Math.max(0, parseInt(e.target.value || "0", 10)))
            }
            className="h-8 w-24"
            aria-label="Embedding dimensions"
          />
        </SettingsRow>
      </SettingsSection>

      <div className="flex justify-end">
        <Button size="sm" onClick={handleSave} disabled={saving || !hasChanges}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
