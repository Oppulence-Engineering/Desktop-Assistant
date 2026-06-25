// rowboat agent — declarative agent authoring CLI (RFC 028 P2).
//
// validate | diff | push | pull over an agent directory (agent.yaml +
// instructions.md). `validate` runs the structural check offline (the same
// shape the published JSON Schema and the server enforce) and, with --remote,
// the authoritative server-side semantic check (POST /v1/agents/validate).
//
// Self-contained: node builtins + the `yaml` dependency + global fetch. The
// cloud API base URL comes from ROWBOAT_API_URL and the bearer from
// ROWBOAT_API_TOKEN.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";

const API_VERSION = "agent.rowboat.dev/v1";
const KIND = "Agent";

interface AgentDoc {
  apiVersion?: string;
  kind?: string;
  metadata?: { slug?: string; name?: string };
  spec?: Record<string, unknown> & { instructions?: string; instructionsFile?: string };
}

interface ApiOpts {
  baseUrl: string;
  token: string;
}

function apiOpts(): ApiOpts {
  return {
    baseUrl: process.env.ROWBOAT_API_URL ?? "http://127.0.0.1:8080",
    token: process.env.ROWBOAT_API_TOKEN ?? "",
  };
}

// readAgentDir loads agent.yaml and inlines instructions.md when the doc uses
// spec.instructionsFile — so the body sent to the server is self-contained.
async function readAgentDir(dir: string): Promise<{ doc: AgentDoc; yaml: string }> {
  const yamlPath = path.join(dir, "agent.yaml");
  const raw = await readFile(yamlPath, "utf8");
  const doc = parseYaml(raw) as AgentDoc;
  if (doc?.spec?.instructionsFile && !doc.spec.instructions) {
    const ref = String(doc.spec.instructionsFile);
    const instructions = await readFile(path.resolve(dir, ref), "utf8");
    doc.spec.instructions = instructions.trim();
    delete doc.spec.instructionsFile;
  }
  return { doc, yaml: raw };
}

// structuralErrors mirrors the published JSON Schema's required-shape checks so
// `validate` (offline) rejects the same structural problems the server does.
function structuralErrors(doc: AgentDoc): string[] {
  const errs: string[] = [];
  if (doc.apiVersion !== API_VERSION) errs.push(`apiVersion must be "${API_VERSION}"`);
  if (doc.kind !== KIND) errs.push(`kind must be "${KIND}"`);
  if (!doc.metadata?.slug) errs.push("metadata.slug is required");
  if (!doc.metadata?.name) errs.push("metadata.name is required");
  const tools = doc.spec?.tools;
  if (tools !== undefined && !Array.isArray(tools)) errs.push("spec.tools must be an array");
  return errs;
}

async function postJSON(
  opts: ApiOpts,
  pathname: string,
  body: unknown,
): Promise<{ status: number; json: any }> {
  const res = await fetch(new URL(pathname, opts.baseUrl), {
    method: "POST",
    headers: authHeaders(opts, "application/json"),
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

function authHeaders(opts: ApiOpts, contentType: string): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": contentType, Accept: "application/json" };
  if (opts.token) h.Authorization = `Bearer ${opts.token}`;
  return h;
}

export async function validate(dir: string, remote: boolean): Promise<boolean> {
  const { doc, yaml } = await readAgentDir(dir);
  const errs = structuralErrors(doc);
  if (errs.length) {
    for (const e of errs) console.error(`  ✗ ${e}`);
    console.error("structural validation failed");
    return false;
  }
  console.log("  ✓ structural validation passed (offline)");
  if (!remote) return true;
  const { status, json } = await postJSON(
    apiOpts(),
    "/v1/agents/validate",
    JSON.parse(JSON.stringify(doc)),
  );
  if (status === 200 && json?.valid) {
    console.log(
      `  ✓ server validation passed (contentHash ${String(json.contentHash).slice(0, 12)})`,
    );
    return true;
  }
  console.error("  ✗ server validation failed:", JSON.stringify(json?.errors ?? json));
  void yaml;
  return false;
}

export async function push(dir: string): Promise<boolean> {
  const { doc } = await readAgentDir(dir);
  const slug = doc.metadata?.slug;
  if (!slug) {
    console.error("metadata.slug is required");
    return false;
  }
  const opts = apiOpts();
  const res = await fetch(new URL(`/v1/agents/${slug}`, opts.baseUrl), {
    method: "PUT",
    headers: authHeaders(opts, "application/json"),
    body: JSON.stringify(doc),
  });
  const json = (await res.json().catch(() => ({}))) as { revision?: unknown };
  if (res.status === 200 || res.status === 201) {
    console.log(`  ✓ applied ${slug} (revision ${json?.revision ?? "?"})`);
    return true;
  }
  console.error(`  ✗ apply failed (${res.status}):`, JSON.stringify(json));
  return false;
}

export async function pull(slug: string): Promise<boolean> {
  const opts = apiOpts();
  const res = await fetch(new URL(`/v1/agents/${slug}?format=yaml`, opts.baseUrl), {
    headers: {
      Accept: "application/yaml",
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
  });
  if (res.status !== 200) {
    console.error(`  ✗ pull failed (${res.status})`);
    return false;
  }
  process.stdout.write(await res.text());
  return true;
}

export async function diff(dir: string): Promise<boolean> {
  const { doc, yaml } = await readAgentDir(dir);
  const slug = doc.metadata?.slug ?? "";
  const opts = apiOpts();
  const res = await fetch(new URL(`/v1/agents/${slug}?format=yaml`, opts.baseUrl), {
    headers: {
      Accept: "application/yaml",
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
  });
  if (res.status === 404) {
    console.log(`  + ${slug} is new (not yet deployed)`);
    return true;
  }
  const remote = await res.text();
  if (remote.trim() === yaml.trim()) {
    console.log(`  = ${slug} is in sync`);
    return true;
  }
  console.log(`  ~ ${slug} differs from the deployed revision`);
  return false;
}

// runAgentCli is a minimal subcommand dispatcher (no extra deps). Wire it into
// the host CLI's command table, or run this module directly.
export async function runAgentCli(argv: string[]): Promise<number> {
  const [cmd, arg] = argv;
  const remote = argv.includes("--remote");
  try {
    switch (cmd) {
      case "validate":
        return (await validate(arg ?? ".", remote)) ? 0 : 1;
      case "push":
        return (await push(arg ?? ".")) ? 0 : 1;
      case "pull":
        return (await pull(arg ?? "")) ? 0 : 1;
      case "diff":
        return (await diff(arg ?? ".")) ? 0 : 1;
      default:
        console.error("usage: rowboat agent <validate|diff|push|pull> [dir|slug] [--remote]");
        return 2;
    }
  } catch (err) {
    console.error("error:", err instanceof Error ? err.message : String(err));
    return 1;
  }
}

// Direct invocation: `node dist/agents/yaml-cli.js <cmd> ...` (module-system
// agnostic, so it works under the CLI's tsc output without import.meta).
if (process.argv[1] && process.argv[1].endsWith("yaml-cli.js")) {
  runAgentCli(process.argv.slice(2)).then((code) => process.exit(code));
}
