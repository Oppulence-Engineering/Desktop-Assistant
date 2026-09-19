import {
  generateRequestSchema,
  generatorKindSchema,
  schemaFieldSchema,
  type GenerateRequest,
  type GeneratorKind,
  type SchemaFieldInput,
} from "@/config/generate/input-schemas";

const BOOLEAN_FLAGS = new Set(["--dry-run", "--client", "--lib"]);

const VALUE_FLAGS = new Set([
  "--name",
  "--domain",
  "--route",
  "--kind",
  "--owner",
  "--summary",
  "--title",
  "--fields",
  "--schemas",
  "--files",
  "--operation",
  "--orval-schema",
  "--orval-import",
  "--orval-query",
  "--orval-body",
  "--path",
  "--method",
  "--invalidate",
  "--component",
  "--panel-name",
  "--store-name",
  "--artifact-kind",
]);

function flagValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function parseFields(value: string): SchemaFieldInput[] {
  if (value.trim() === "") return [];
  return value.split(",").map((part) => {
    const [name, type] = part.split(":").map((piece) => piece.trim());
    return schemaFieldSchema.parse({ name, type });
  });
}

function parseList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export type RawFlags = {
  name?: string;
  domain?: string;
  route?: string;
  ownership?: "feature" | "route";
  owner?: string;
  summary?: string;
  title?: string;
  fields?: SchemaFieldInput[];
  schemas?: string[];
  files?: string[];
  operation?: string;
  orvalSchema?: string;
  orvalImport?: string;
  orvalQuery?: string;
  orvalBody?: string;
  path?: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  invalidate?: string;
  component?: string;
  panelName?: string;
  storeName?: string;
  artifactKind?: string;
  client?: boolean;
  withLib?: boolean;
  dryRun?: boolean;
};

export function parseFlags(args: string[]): RawFlags {
  const flags: RawFlags = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument) continue;
    if (BOOLEAN_FLAGS.has(argument)) {
      if (argument === "--dry-run") flags.dryRun = true;
      if (argument === "--client") flags.client = true;
      if (argument === "--lib") flags.withLib = true;
      continue;
    }
    if (VALUE_FLAGS.has(argument)) {
      const value = flagValue(args, index, argument);
      switch (argument) {
        case "--name":
          flags.name = value;
          break;
        case "--domain":
          flags.domain = value;
          break;
        case "--route":
          flags.route = value;
          break;
        case "--kind":
          if (value !== "feature" && value !== "route") {
            throw new Error("--kind must be feature or route");
          }
          flags.ownership = value;
          break;
        case "--owner":
          flags.owner = value;
          break;
        case "--summary":
          flags.summary = value;
          break;
        case "--title":
          flags.title = value;
          break;
        case "--fields":
          flags.fields = parseFields(value);
          break;
        case "--schemas":
          flags.schemas = parseList(value);
          break;
        case "--files":
          flags.files = parseList(value);
          break;
        case "--operation":
          flags.operation = value;
          break;
        case "--orval-schema":
          flags.orvalSchema = value;
          break;
        case "--orval-import":
          flags.orvalImport = value;
          break;
        case "--orval-query":
          flags.orvalQuery = value;
          break;
        case "--orval-body":
          flags.orvalBody = value;
          break;
        case "--path":
          flags.path = value;
          break;
        case "--method":
          flags.method = value.toUpperCase() as RawFlags["method"];
          break;
        case "--invalidate":
          flags.invalidate = value;
          break;
        case "--component":
          flags.component = value;
          break;
        case "--panel-name":
          flags.panelName = value;
          break;
        case "--store-name":
          flags.storeName = value;
          break;
        case "--artifact-kind":
          flags.artifactKind = value;
          break;
      }
      index += 1;
      continue;
    }
    throw new Error(`Unknown generator argument: ${argument}`);
  }
  return flags;
}

function firstZodMessage(error: unknown): string {
  if (error && typeof error === "object" && "issues" in error) {
    const issues = (error as { issues: { message: string }[] }).issues;
    const message = issues[0]?.message;
    if (message) return message;
  }
  return error instanceof Error ? error.message : String(error);
}

export function parseGenerateArguments(args: string[]): GenerateRequest {
  const [kindRaw, ...rest] = args;
  if (!kindRaw || kindRaw.startsWith("--")) {
    throw new Error(
      "Usage: npm run gen -- <lit|schema|component|page|lib|hook|mutation|store|story|feature> [flags]",
    );
  }
  const kind = generatorKindSchema.parse(kindRaw) satisfies GeneratorKind;
  const flags = parseFlags(rest);
  try {
    return generateRequestSchema.parse({ kind, ...requestFromFlags(kind, flags) });
  } catch (error) {
    throw new Error(firstZodMessage(error));
  }
}

function requestFromFlags(kind: GeneratorKind, flags: RawFlags): Record<string, unknown> {
  switch (kind) {
    case "lit":
      return {
        name: flags.name,
        owner: flags.owner,
        domain: flags.domain,
        route: flags.route,
        client: flags.client,
        summary: flags.summary,
        schemas: flags.schemas,
        files: flags.files,
        artifactKind: flags.artifactKind,
        dryRun: flags.dryRun,
      };
    case "schema":
      return {
        name: flags.name,
        owner: flags.owner,
        domain: flags.domain,
        route: flags.route,
        fields: flags.fields,
        dryRun: flags.dryRun,
      };
    case "component":
      return {
        name: flags.name,
        ownership: flags.ownership,
        domain: flags.domain,
        route: flags.route,
        client: flags.client,
        summary: flags.summary,
        fields: flags.fields,
        dryRun: flags.dryRun,
      };
    case "page":
      return {
        name: flags.name,
        route: flags.route,
        title: flags.title,
        summary: flags.summary,
        panelName: flags.panelName,
        client: flags.client,
        operation: flags.operation,
        orvalSchema: flags.orvalSchema,
        orvalImport: flags.orvalImport,
        orvalQuery: flags.orvalQuery,
        path: flags.path,
        fields: flags.fields,
        dryRun: flags.dryRun,
      };
    case "lib":
      return {
        name: flags.name,
        domain: flags.domain,
        summary: flags.summary,
        fields: flags.fields,
        dryRun: flags.dryRun,
      };
    case "hook":
      return {
        name: flags.name,
        summary: flags.summary,
        operation: flags.operation,
        orvalSchema: flags.orvalSchema,
        orvalImport: flags.orvalImport,
        orvalQuery: flags.orvalQuery,
        path: flags.path,
        dryRun: flags.dryRun,
      };
    case "mutation":
      return {
        name: flags.name,
        summary: flags.summary,
        operation: flags.operation,
        orvalSchema: flags.orvalSchema,
        orvalImport: flags.orvalImport,
        orvalBody: flags.orvalBody,
        path: flags.path,
        method: flags.method,
        invalidate: flags.invalidate,
        dryRun: flags.dryRun,
      };
    case "store":
      return {
        name: flags.name,
        domain: flags.domain,
        summary: flags.summary,
        fields: flags.fields,
        dryRun: flags.dryRun,
      };
    case "story":
      return {
        name: flags.name,
        ownership: flags.ownership,
        domain: flags.domain,
        route: flags.route,
        component: flags.component,
        dryRun: flags.dryRun,
      };
    case "feature":
      return {
        name: flags.name,
        domain: flags.domain,
        route: flags.route,
        title: flags.title,
        summary: flags.summary,
        client: flags.client,
        withLib: flags.withLib,
        storeName: flags.storeName,
        operation: flags.operation,
        orvalSchema: flags.orvalSchema,
        orvalImport: flags.orvalImport,
        orvalQuery: flags.orvalQuery,
        path: flags.path,
        fields: flags.fields,
        dryRun: flags.dryRun,
      };
  }
}
