import * as React from "react";
import { Plus, Trash2, ShieldCheck, CodeIcon, Loader2 } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SettingsSection, StringListRows } from "./settings-ui";

/**
 * Security settings — a real form over `config/security.json` (was a raw JSON
 * textarea). The file has two accepted shapes (the core parser handles both): a
 * legacy `string[]` of allowed commands, or `{ allowedCommands, allowedFileAccess }`.
 * We read either and always save the richer object form (forward-compatible).
 */

const SECURITY_PATH = "config/security.json";

const FILE_OPS = ["read", "list", "search", "write", "delete"] as const;
type FileAccessOperation = (typeof FILE_OPS)[number];
interface FileAccessGrant {
  operation: FileAccessOperation;
  pathPrefix: string;
}

function parse(raw: string): { commands: string[]; access: FileAccessGrant[] } {
  let data: unknown;
  try {
    data = JSON.parse(raw || "[]");
  } catch {
    return { commands: [], access: [] };
  }
  if (Array.isArray(data)) {
    return { commands: data.filter((c): c is string => typeof c === "string"), access: [] };
  }
  const obj = data as { allowedCommands?: unknown; allowedFileAccess?: unknown };
  const commands = Array.isArray(obj?.allowedCommands)
    ? obj.allowedCommands.filter((c): c is string => typeof c === "string")
    : [];
  const access = Array.isArray(obj?.allowedFileAccess)
    ? (obj.allowedFileAccess as FileAccessGrant[]).filter(
        (g) => g && FILE_OPS.includes(g.operation) && typeof g.pathPrefix === "string",
      )
    : [];
  return { commands, access };
}

function toConfig(commands: string[], access: FileAccessGrant[]) {
  return {
    allowedCommands: commands.map((c) => c.trim()).filter(Boolean),
    allowedFileAccess: access.filter((g) => g.pathPrefix.trim() !== ""),
  };
}

export function SecuritySettings({ dialogOpen }: { dialogOpen: boolean }) {
  const [commands, setCommands] = React.useState<string[]>([]);
  const [access, setAccess] = React.useState<FileAccessGrant[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [jsonOpen, setJsonOpen] = React.useState(false);
  const [rawJson, setRawJson] = React.useState("");

  React.useEffect(() => {
    if (!dialogOpen) return;
    setLoading(true);
    setError(null);
    setSaved(false);
    window.ipc
      .invoke("workspace:readFile", { path: SECURITY_PATH })
      .then((r) => {
        setRawJson(r.data || "");
        const { commands, access } = parse(r.data);
        setCommands(commands);
        setAccess(access);
      })
      .catch(() => {
        setCommands([]);
        setAccess([]);
      })
      .finally(() => setLoading(false));
  }, [dialogOpen]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const config = jsonOpen ? JSON.parse(rawJson || "[]") : toConfig(commands, access);
      const data = JSON.stringify(config, null, 2);
      await window.ipc.invoke("workspace:writeFile", { path: SECURITY_PATH, data });
      if (jsonOpen) {
        const { commands, access } = parse(data);
        setCommands(commands);
        setAccess(access);
      } else {
        setRawJson(data);
      }
      setSaved(true);
    } catch (e) {
      setError(e instanceof SyntaxError ? "Invalid JSON syntax" : "Failed to save security config");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        Loading…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {!jsonOpen && (
        <>
          <div className="flex items-start gap-2.5 rounded-none border bg-muted/40 px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" />
            <p>
              These rules let the assistant act without asking each time. Grant the minimum it needs
              — anything not listed here still prompts for your approval.
            </p>
          </div>
          <SettingsSection
            title="Allowed commands"
            description="Shell commands the assistant may run without asking each time."
          >
            <StringListRows
              values={commands}
              onChange={setCommands}
              placeholder="ls"
              addLabel="Add command"
            />
          </SettingsSection>

          <SettingsSection
            title="File access"
            description="Grant read/write access under specific path prefixes."
            action={
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => setAccess((p) => [...p, { operation: "read", pathPrefix: "" }])}
              >
                <Plus className="size-3.5" />
                Add grant
              </Button>
            }
          >
            {access.length === 0 ? (
              <p className="rounded-none border border-dashed px-3.5 py-6 text-center text-xs text-muted-foreground">
                No file-access grants.
              </p>
            ) : (
              <div className="space-y-2">
                {access.map((grant, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Select
                      value={grant.operation}
                      onValueChange={(operation) =>
                        setAccess((p) =>
                          p.map((g, j) =>
                            j === i ? { ...g, operation: operation as FileAccessOperation } : g,
                          ),
                        )
                      }
                    >
                      <SelectTrigger className="h-8 w-28 shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FILE_OPS.map((op) => (
                          <SelectItem key={op} value={op}>
                            {op}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      value={grant.pathPrefix}
                      placeholder="/path/to/folder"
                      className="h-8 flex-1 font-mono text-xs"
                      onChange={(e) =>
                        setAccess((p) =>
                          p.map((g, j) => (j === i ? { ...g, pathPrefix: e.target.value } : g)),
                        )
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setAccess((p) => p.filter((_, j) => j !== i))}
                      aria-label="Remove grant"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </SettingsSection>
        </>
      )}

      {/* Raw JSON escape hatch */}
      <Collapsible open={jsonOpen} onOpenChange={setJsonOpen}>
        <CollapsibleTrigger asChild>
          <button className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
            <CodeIcon className="size-3.5" />
            {jsonOpen ? "Hide raw JSON" : "Edit as JSON"}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <textarea
            value={jsonOpen ? rawJson : JSON.stringify(toConfig(commands, access), null, 2)}
            onChange={(e) => setRawJson(e.target.value)}
            className="h-64 w-full resize-none rounded-none border bg-muted/40 p-3 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            spellCheck={false}
          />
        </CollapsibleContent>
      </Collapsible>

      <div className="flex items-center justify-between gap-2 border-t pt-3">
        <span className="text-xs">
          {error ? (
            <span className="text-destructive">{error}</span>
          ) : saved ? (
            <span className="text-green-600 dark:text-green-400">Saved</span>
          ) : null}
        </span>
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
