import * as React from "react";
import { Plus, Trash2, Server, Terminal, Globe, CodeIcon, Loader2 } from "@/lib/icons";
import { Button } from "@oppulence/ui/components/button";
import { Input } from "@oppulence/ui/components/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@oppulence/ui/components/collapsible";
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

  // ... (ERRORS.md E45) Seed the raw-JSON view from the current (possibly
  // unsaved) form state when opening it, so it reflects in-progress edits
  // instead of the last loaded/saved snapshot.
  const handleJsonOpenChange = (open: boolean) => {
    if (open) setRawJson(JSON.stringify(toConfig(servers), null, 2));
    setJsonOpen(open);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      // ... (ERRORS.md E46) Require command (stdio) / url (http) for named
      // servers in form mode — the schema accepts "", which would otherwise
      // save and only fail later at connect with a cryptic transport error.
      if (!jsonOpen) {
        const invalid = servers.find(
          (s) => s.name.trim() && (s.kind === "stdio" ? !s.command.trim() : !s.url.trim()),
        );
        if (invalid) {
          setError(
            `Server "${invalid.name.trim()}" needs a ${
              invalid.kind === "stdio" ? "command" : "URL"
            }`,
          );
          return;
        }
      }
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
                  aria-label="MCP server name"
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

              <ServerToolList serverName={s.name} />

              {s.kind === "stdio" ? (
                <div className="space-y-3">
                  <SettingsField label="Command">
                    <Input
                      value={s.command}
                      placeholder="npx"
                      className="h-8 font-mono text-xs"
                      aria-label="MCP server command"
                      onChange={(e) => update(s.id, { command: e.target.value })}
                    />
                  </SettingsField>
                  <SettingsField label="Arguments">
                    <StringListRows
                      values={s.args}
                      onChange={(args) => update(s.id, { args })}
                      placeholder="-y, @modelcontextprotocol/server-…"
                      addLabel="Add argument"
                      itemLabel="Argument"
                    />
                  </SettingsField>
                  <SettingsField label="Environment variables">
                    <KeyValueRows
                      entries={s.env}
                      onChange={(env) => update(s.id, { env })}
                      addLabel="Add variable"
                      keyLabel="Environment variable name"
                      valueLabel="Environment variable value"
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
                      aria-label="MCP server URL"
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
                      keyLabel="Header name"
                      valueLabel="Header value"
                    />
                  </SettingsField>
                </div>
              )}
            </div>
          ))}
        </SettingsSection>
      )}

      {/* Raw JSON escape hatch */}
      <Collapsible open={jsonOpen} onOpenChange={handleJsonOpenChange}>
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
            aria-label="MCP configuration JSON"
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

/**
 * Show what a configured MCP server actually exposes.
 *
 * `mcp:listTools` had a handler, a schema and no caller: you could add a server,
 * edit its command and save it, with no way to confirm it started or see what it
 * offered. A typo in a command and a server with no tools looked identical —
 * both were silence.
 *
 * Deliberately on demand rather than on render. Listing tools starts the server
 * process, so doing it for every row whenever the pane opens would launch every
 * configured MCP server just for visiting settings.
 */
function ServerToolList({ serverName }: { serverName: string }) {
  const [tools, setTools] = React.useState<Array<{ name: string; description?: string }> | null>(
    null,
  );
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  const load = async () => {
    if (busy || !serverName.trim()) return;
    setBusy(true);
    setFailure(null);
    try {
      const res = await window.ipc.invoke("mcp:listTools", { serverName });
      setTools(res.tools.map((t) => ({ name: t.name, description: t.description })));
    } catch (err) {
      // Surfaced inline rather than as a toast: it belongs to this server row,
      // and it is usually a wrong command or a server that failed to start.
      setFailure(err instanceof Error ? err.message : "Could not reach that server.");
      setTools(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3">
      <Button variant="outline" size="sm" onClick={() => void load()} disabled={busy || !serverName.trim()}>
        {busy ? "Connecting…" : tools ? "Refresh tools" : "Show tools"}
      </Button>

      {failure && <p className="mt-2 text-xs text-destructive">{failure}</p>}

      {tools !== null && tools.length === 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          Connected, but this server exposes no tools.
        </p>
      )}

      {tools !== null && tools.length > 0 && (
        <ul className="mt-2 space-y-1">
          {tools.map((tool) => (
            <ToolRow key={tool.name} serverName={serverName} tool={tool} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One tool, with an opt-in way to run it.
 *
 * `mcp:executeTool` had a handler and no caller. Surfacing it needs more care
 * than the other channels in this pane: an MCP tool is arbitrary third-party
 * code with real side effects — it can write files, call APIs, spend money. The
 * point of running one from here is to check a server works before trusting it
 * with an agent, and that has to be an explicit act rather than a stray click.
 *
 * So the runner stays collapsed until asked for, the arguments are typed by
 * hand rather than guessed, and the button says what it does. No confirmation
 * dialog on top: a dialog after a deliberate expand-type-run sequence is noise,
 * and noise is what teaches people to click through warnings.
 */
function ToolRow({
  serverName,
  tool,
}: {
  serverName: string;
  tool: { name: string; description?: string };
}) {
  const [open, setOpen] = React.useState(false);
  const [input, setInput] = React.useState("{}");
  const [busy, setBusy] = React.useState(false);
  const [output, setOutput] = React.useState<string | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);

  const run = async () => {
    let parsed: Record<string, unknown>;
    try {
      const value: unknown = JSON.parse(input || "{}");
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("Arguments must be a JSON object");
      }
      parsed = value as Record<string, unknown>;
    } catch (err) {
      // Caught here rather than at the server: a JSON typo should not start a
      // tool call.
      setFailure(err instanceof Error ? err.message : "Arguments must be valid JSON");
      setOutput(null);
      return;
    }

    setBusy(true);
    setFailure(null);
    try {
      const res = await window.ipc.invoke("mcp:executeTool", {
        serverName,
        toolName: tool.name,
        input: parsed,
      });
      setOutput(JSON.stringify(res.result, null, 2));
    } catch (err) {
      setFailure(err instanceof Error ? err.message : "The tool call failed.");
      setOutput(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-none border border-border/60 px-2.5 py-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-xs">{tool.name}</p>
          {tool.description && (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{tool.description}</p>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 text-xs"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Cancel" : "Test"}
        </Button>
      </div>

      {open && (
        <div className="mt-2 space-y-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={3}
            spellCheck={false}
            className="w-full rounded-none border border-border bg-background p-2 font-mono text-xs"
            aria-label={`Arguments for ${tool.name}`}
          />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => void run()} disabled={busy}>
              {busy ? "Running…" : `Run ${tool.name}`}
            </Button>
            <span className="text-xs text-muted-foreground">
              Runs for real — this tool can have side effects.
            </span>
          </div>
          {failure && <p className="text-xs text-destructive">{failure}</p>}
          {output !== null && (
            <pre className="max-h-48 overflow-auto rounded-none border border-border/60 bg-muted/40 p-2 font-mono text-[11px]">
              {output}
            </pre>
          )}
        </div>
      )}
    </li>
  );
}
