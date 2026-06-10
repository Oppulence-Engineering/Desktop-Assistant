import * as React from "react";
import { Plus, Trash2, Server, Terminal, Globe, CodeIcon, Loader2 } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { McpServerConfig } from "@x/shared/dist/mcp.js";
import { SettingsSection, SettingsField, KeyValueRows, StringListRows } from "./settings-ui";

/**
 * MCP Servers settings — a real form over `config/mcp.json` (was a raw JSON
 * textarea). Each server is stdio (command + args + env) or http (url + headers);
 * the shape is validated against the shared {@link McpServerConfig} zod schema on
 * save. An "Edit as JSON" escape hatch remains for anything the form can't express.
 */

const MCP_PATH = "config/mcp.json";

type ServerKind = "stdio" | "http";

interface EditorServer {
  /** Stable React key independent of the (editable) name. */
  id: string;
  name: string;
  kind: ServerKind;
  command: string;
  args: string[];
  env: Record<string, string>;
  url: string;
  headers: Record<string, string>;
}

let idSeq = 0;
const newId = () => `mcp-${++idSeq}`;

function blankServer(): EditorServer {
  return {
    id: newId(),
    name: "",
    kind: "stdio",
    command: "",
    args: [],
    env: {},
    url: "",
    headers: {},
  };
}

/** Parse the on-disk `{ mcpServers }` map into editor rows. */
function toEditor(raw: string): EditorServer[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "{}");
  } catch {
    return [];
  }
  const servers = (parsed as { mcpServers?: Record<string, Record<string, unknown>> })?.mcpServers;
  if (!servers || typeof servers !== "object") return [];
  return Object.entries(servers).map(([name, def]) => {
    const isHttp = def?.type === "http" || (typeof def?.url === "string" && !def?.command);
    return {
      id: newId(),
      name,
      kind: isHttp ? "http" : "stdio",
      command: typeof def?.command === "string" ? def.command : "",
      args: Array.isArray(def?.args) ? (def.args as string[]) : [],
      env: (def?.env as Record<string, string>) ?? {},
      url: typeof def?.url === "string" ? def.url : "",
      headers: (def?.headers as Record<string, string>) ?? {},
    };
  });
}

/** Serialize editor rows back to the `{ mcpServers }` shape, dropping empties. */
function toConfig(servers: EditorServer[]) {
  const mcpServers: Record<string, Record<string, unknown>> = {};
  for (const s of servers) {
    const name = s.name.trim();
    if (!name) continue;
    if (s.kind === "stdio") {
      const args = s.args.filter((a) => a.trim() !== "");
      const env = Object.fromEntries(Object.entries(s.env).filter(([k]) => k.trim() !== ""));
      mcpServers[name] = {
        type: "stdio",
        command: s.command,
        ...(args.length ? { args } : {}),
        ...(Object.keys(env).length ? { env } : {}),
      };
    } else {
      const headers = Object.fromEntries(
        Object.entries(s.headers).filter(([k]) => k.trim() !== ""),
      );
      mcpServers[name] = {
        type: "http",
        url: s.url,
        ...(Object.keys(headers).length ? { headers } : {}),
      };
    }
  }
  return { mcpServers };
}

export function McpSettings({ dialogOpen }: { dialogOpen: boolean }) {
  const [servers, setServers] = React.useState<EditorServer[]>([]);
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
      .invoke("workspace:readFile", { path: MCP_PATH })
      .then((r) => {
        setRawJson(r.data || "");
        setServers(toEditor(r.data));
      })
      .catch(() => setServers([]))
      .finally(() => setLoading(false));
  }, [dialogOpen]);

  const update = (id: string, patch: Partial<EditorServer>) =>
    setServers((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const config = jsonOpen ? JSON.parse(rawJson || "{}") : toConfig(servers);
      // Validate against the shared schema before persisting.
      McpServerConfig.parse(config);
      const data = JSON.stringify(config, null, 2);
      await window.ipc.invoke("workspace:writeFile", { path: MCP_PATH, data });
      if (jsonOpen) setServers(toEditor(data));
      else setRawJson(data);
      setSaved(true);
    } catch (e) {
      setError(
        e instanceof SyntaxError
          ? "Invalid JSON syntax"
          : "Invalid MCP configuration — check the fields",
      );
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
    <div className="space-y-4">
      {!jsonOpen && (
        <SettingsSection
          title="Servers"
          description="Connect Model Context Protocol servers to give the assistant more tools."
          action={
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setServers((prev) => [...prev, blankServer()])}
            >
              <Plus className="size-3.5" />
              Add server
            </Button>
          }
        >
          {servers.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 rounded-none border border-dashed py-10 text-center">
              <Server className="size-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No MCP servers configured yet.</p>
            </div>
          )}

          {servers.map((s) => (
            <div key={s.id} className="space-y-3 rounded-none border bg-card p-3.5">
              <div className="flex items-center gap-2">
                <span
                  className="flex size-8 shrink-0 items-center justify-center rounded-none border bg-muted/40 text-muted-foreground"
                  title={s.kind === "stdio" ? "Local command" : "Remote URL"}
                >
                  {s.kind === "stdio" ? (
                    <Terminal className="size-4" />
                  ) : (
                    <Globe className="size-4" />
                  )}
                </span>
                <Input
                  value={s.name}
                  placeholder="server-name"
                  className="h-8 flex-1 font-medium"
                  onChange={(e) => update(s.id, { name: e.target.value })}
                />
                {/* stdio | http segmented toggle */}
                <div className="flex rounded-none border bg-muted/40 p-0.5">
                  {(["stdio", "http"] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => update(s.id, { kind: k })}
                      className={cn(
                        "rounded-none px-2.5 py-1 text-xs font-medium transition-colors",
                        s.kind === k
                          ? "bg-background text-foreground shadow-[0_1px_2px_rgb(16_24_40_/_0.06)] ring-1 ring-border"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {k}
                    </button>
                  ))}
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setServers((prev) => prev.filter((x) => x.id !== s.id))}
                  aria-label="Remove server"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>

              {s.kind === "stdio" ? (
                <div className="space-y-3">
                  <SettingsField label="Command">
                    <Input
                      value={s.command}
                      placeholder="npx"
                      className="h-8 font-mono text-xs"
                      onChange={(e) => update(s.id, { command: e.target.value })}
                    />
                  </SettingsField>
                  <SettingsField label="Arguments">
                    <StringListRows
                      values={s.args}
                      onChange={(args) => update(s.id, { args })}
                      placeholder="-y, @modelcontextprotocol/server-…"
                      addLabel="Add argument"
                    />
                  </SettingsField>
                  <SettingsField label="Environment variables">
                    <KeyValueRows
                      entries={s.env}
                      onChange={(env) => update(s.id, { env })}
                      addLabel="Add variable"
                    />
                  </SettingsField>
                </div>
              ) : (
                <div className="space-y-3">
                  <SettingsField label="URL">
                    <Input
                      value={s.url}
                      placeholder="https://example.com/mcp"
                      className="h-8 font-mono text-xs"
                      onChange={(e) => update(s.id, { url: e.target.value })}
                    />
                  </SettingsField>
                  <SettingsField label="Headers">
                    <KeyValueRows
                      entries={s.headers}
                      onChange={(headers) => update(s.id, { headers })}
                      keyPlaceholder="Authorization"
                      valuePlaceholder="Bearer …"
                      addLabel="Add header"
                    />
                  </SettingsField>
                </div>
              )}
            </div>
          ))}
        </SettingsSection>
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
            value={jsonOpen ? rawJson : JSON.stringify(toConfig(servers), null, 2)}
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
