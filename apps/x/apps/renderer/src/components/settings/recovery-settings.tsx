import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RotateCcw } from "@/lib/icons";
import { Button } from "@oppulence/ui/components/button";
import { toast } from "sonner";
import { SettingsSection } from "./settings-ui";

type Diagnostic = {
  id: "knowledge" | "memory" | "capture";
  label: string;
  detail: string;
  status: "ok" | "attention";
};

export function RecoverySettings({ dialogOpen }: { dialogOpen: boolean }) {
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [checking, setChecking] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  const runDiagnostics = useCallback(async () => {
    setChecking(true);
    try {
      const [knowledge, memory, capture] = await Promise.all([
        window.ipc.invoke("workspace:exists", { path: "knowledge" }),
        window.ipc.invoke("memory:status", null),
        window.ipc.invoke("meeting:preflight", { probeSystemAudio: false }),
      ]);
      const captureFailure = capture.problems.find((problem) => problem.status === "fail");
      setDiagnostics([
        {
          id: "knowledge",
          label: "Knowledge storage",
          detail: knowledge.exists
            ? "The local knowledge vault is available."
            : "The knowledge vault is missing and will be recreated when you create a note.",
          status: knowledge.exists ? "ok" : "attention",
        },
        {
          id: "memory",
          label: "Semantic memory",
          detail: memory.enabled
            ? `${memory.chunkCount.toLocaleString()} indexed chunks${
                memory.lastBuiltMs
                  ? ` · last built ${new Date(memory.lastBuiltMs).toLocaleString()}`
                  : " · not built yet"
              }`
            : "Semantic memory is disabled. Plain-text search remains available.",
          status: memory.enabled && memory.chunkCount > 0 ? "ok" : "attention",
        },
        {
          id: "capture",
          label: "Meeting capture",
          detail: captureFailure
            ? `${captureFailure.detail}${
                captureFailure.remediation ? ` ${captureFailure.remediation}` : ""
              }`
            : "Microphone and local capture checks passed.",
          status: captureFailure ? "attention" : "ok",
        },
      ]);
    } catch (cause) {
      toast.error("Diagnostics could not finish", {
        description: cause instanceof Error ? cause.message : "Try again in a moment.",
      });
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (dialogOpen) void runDiagnostics();
  }, [dialogOpen, runDiagnostics]);

  const rebuild = useCallback(async () => {
    setRebuilding(true);
    try {
      const result = await window.ipc.invoke("memory:rebuild", null);
      if (result.disabled) {
        toast.info("Semantic memory is disabled", {
          description: "Enable it under Memory before rebuilding the index.",
        });
      } else {
        toast.success("Semantic memory rebuilt", {
          description: `${result.chunkCount.toLocaleString()} chunks rebuilt from ${result.filesProcessed.toLocaleString()} files.`,
        });
      }
      await runDiagnostics();
    } catch (cause) {
      toast.error("Memory rebuild failed", {
        description: cause instanceof Error ? cause.message : "Your notes were not changed.",
      });
    } finally {
      setRebuilding(false);
    }
  }, [runDiagnostics]);

  return (
    <div className="space-y-7">
      <SettingsSection
        title="Local diagnostics"
        description="Check the local systems that power knowledge recall and meeting capture."
      >
        <div className="divide-y divide-border rounded-[2px] border border-border">
          {diagnostics.length === 0 && checking ? (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Checking local systems…
            </div>
          ) : (
            diagnostics.map((item) => (
              <div key={item.id} className="flex items-start gap-3 p-4">
                {item.status === "ok" ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                ) : (
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{item.label}</p>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{item.detail}</p>
                </div>
              </div>
            ))
          )}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={checking || rebuilding}
          onClick={() => void runDiagnostics()}
        >
          {checking ? <Loader2 className="size-4 animate-spin" /> : null}
          Run diagnostics
        </Button>
      </SettingsSection>

      <SettingsSection
        title="Rebuild semantic memory"
        description="Delete only the derived search index and recreate it from your notes. Notes and settings are never removed."
      >
        <div className="rounded-[2px] border border-border p-4">
          <p className="text-sm font-medium text-foreground">Use this when recall seems stale</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Rebuilding may use your configured embedding provider and can take several minutes for
            a large vault.
          </p>
          <Button
            type="button"
            size="sm"
            className="mt-3"
            disabled={checking || rebuilding}
            onClick={() => void rebuild()}
          >
            {rebuilding ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RotateCcw className="size-4" />
            )}
            {rebuilding ? "Rebuilding…" : "Rebuild memory index"}
          </Button>
        </div>
      </SettingsSection>
    </div>
  );
}
