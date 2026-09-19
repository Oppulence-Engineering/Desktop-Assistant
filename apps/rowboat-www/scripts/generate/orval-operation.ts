import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import type { SchemaFieldInput } from "@/config/generate/input-schemas";

import { kebabFromCamel } from "./text";

/**
 * Resolve `--operation <operationId>` against the Go OpenAPI document and the
 * Orval Zod tree. Path, method, query params, and schema names are derived so
 * `gen hook` never invents a local stub next to a live contract.
 */

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;
const SUCCESS_STATUSES = ["200", "201"] as const;

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type ResolvedOperation = {
  operationId: string;
  name: string;
  method: HttpMethod;
  fetchPath: string;
  orvalSchema: string;
  orvalImport: string;
  orvalBody?: string;
  orvalQuery?: string;
  queryParams: SchemaFieldInput[];
};

type OpenAPIParameter = {
  name?: string;
  in?: string;
  schema?: {
    type?: string;
    items?: { type?: string };
  };
};

type OpenAPIOperation = {
  operationId?: string;
  tags?: string[];
  requestBody?: unknown;
  responses?: Record<string, unknown>;
  parameters?: OpenAPIParameter[];
};

type OpenAPIPathItem = {
  parameters?: OpenAPIParameter[];
} & Partial<Record<(typeof HTTP_METHODS)[number], OpenAPIOperation>>;

type OpenAPIDocument = {
  paths?: Record<string, OpenAPIPathItem | undefined>;
};

export type OperationCatalog = {
  get(operationId: string): ResolvedOperation | undefined;
  ids(): string[];
  paths(): string[];
};

export function isReadMethod(method: string): boolean {
  return method.toUpperCase() === "GET";
}

export function toBffPath(openApiPath: string): string {
  const withoutVersion = openApiPath.replace(/^\/v1(?=\/|$)/, "");
  const normalized = withoutVersion.length > 0 ? withoutVersion : "/";
  return normalized.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, ":$1");
}

export function tagToKebab(tag: string): string {
  return kebabFromCamel(tag);
}

export function mswImportFromOrval(orvalImport: string): string {
  const match = orvalImport.match(/^@\/lib\/api\/generated\/zod\/(.+)$/);
  if (!match?.[1]) return "";
  return `@/lib/api/generated/client/${match[1]}.msw`;
}

export function mswNamesFromSchema(orvalSchema: string): { handler: string; mock: string } {
  const operationPascal = orvalSchema.replace(/\d{3}Response$/, "");
  return {
    handler: `get${operationPascal}MockHandler`,
    mock: `get${operationPascal}ResponseMock`,
  };
}

function pascalOperationId(operationId: string): string {
  return `${operationId.charAt(0).toUpperCase()}${operationId.slice(1)}`;
}

function fallbackImport(tag: string | undefined): string {
  const slug = tagToKebab(tag ?? "api");
  return `@/lib/api/generated/zod/${slug}/${slug}`;
}

function queryFieldType(schema: OpenAPIParameter["schema"]): SchemaFieldInput["type"] {
  if (schema?.type === "integer" || schema?.type === "number") return "number";
  if (schema?.type === "boolean") return "boolean";
  if (schema?.type === "array") return "string[]";
  return "string";
}

export function queryFieldsFrom(parameters: OpenAPIParameter[] | undefined): SchemaFieldInput[] {
  return (parameters ?? []).flatMap((param) => {
    if (param.in !== "query" || !param.name || !/^[a-z][a-zA-Z0-9]*$/.test(param.name)) {
      return [];
    }
    return [{ name: param.name, type: queryFieldType(param.schema) }];
  });
}

function pickSuccessSchema(
  operationId: string,
  responses: Record<string, unknown> | undefined,
  zodExports: Map<string, string>,
): { schemaName: string; importPath?: string } | undefined {
  const pascal = pascalOperationId(operationId);
  const statuses = new Set(Object.keys(responses ?? {}));
  for (const status of SUCCESS_STATUSES) {
    const schemaName = `${pascal}${status}Response`;
    const importPath = zodExports.get(schemaName);
    if (importPath || statuses.has(status)) {
      return { schemaName, importPath };
    }
  }
  return undefined;
}

/**
 * Pure catalog builder. Tests pass a snippet document plus an export map;
 * `loadOperationCatalog` reads the real OpenAPI + Orval tree.
 */
export function catalogFromOpenAPI(
  document: OpenAPIDocument,
  zodExports: Map<string, string> = new Map(),
): OperationCatalog {
  const byLower = new Map<string, ResolvedOperation>();

  for (const [openApiPath, item] of Object.entries(document.paths ?? {})) {
    if (!item || typeof item !== "object") continue;
    for (const method of HTTP_METHODS) {
      const operation = item[method];
      if (!operation || typeof operation !== "object") continue;
      if (!operation.operationId) continue;

      const success = pickSuccessSchema(operation.operationId, operation.responses, zodExports);
      if (!success) continue;

      const pascal = pascalOperationId(operation.operationId);
      const bodyName = `${pascal}Body`;
      const queryName = `${pascal}QueryParams`;
      const tag = operation.tags?.[0];
      const queryParams = queryFieldsFrom([
        ...(item.parameters ?? []),
        ...(operation.parameters ?? []),
      ]);
      const hasQuerySchema = zodExports.has(queryName) || queryParams.length > 0;
      const resolved: ResolvedOperation = {
        operationId: operation.operationId,
        name: kebabFromCamel(operation.operationId),
        method: method.toUpperCase() as HttpMethod,
        fetchPath: toBffPath(openApiPath),
        orvalSchema: success.schemaName,
        orvalImport: success.importPath ?? zodExports.get(bodyName) ?? fallbackImport(tag),
        orvalBody: operation.requestBody !== undefined ? bodyName : undefined,
        orvalQuery: hasQuerySchema ? queryName : undefined,
        queryParams,
      };
      byLower.set(operation.operationId.toLowerCase(), resolved);
    }
  }

  return {
    get(operationId: string) {
      return byLower.get(operationId.toLowerCase());
    },
    ids() {
      return [...byLower.values()].map((entry) => entry.operationId).sort();
    },
    paths() {
      return [...new Set([...byLower.values()].map((entry) => entry.fetchPath))].sort();
    },
  };
}

export function indexZodExports(zodRoot: string): Map<string, string> {
  const exports = new Map<string, string>();
  if (!existsSync(zodRoot)) return exports;

  for (const filename of listTypeScriptFiles(zodRoot)) {
    const source = readFileSync(filename, "utf8");
    const relative = path
      .relative(zodRoot, filename)
      .replaceAll(path.sep, "/")
      .replace(/\.ts$/, "");
    const importPath = `@/lib/api/generated/zod/${relative}`;
    for (const match of source.matchAll(/export const ([A-Za-z0-9_]+)/g)) {
      const name = match[1];
      if (name) exports.set(name, importPath);
    }
  }
  return exports;
}

function listTypeScriptFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

const catalogCache = new Map<string, OperationCatalog>();

export function loadOperationCatalog(catalogRoot: string): OperationCatalog {
  const cached = catalogCache.get(catalogRoot);
  if (cached) return cached;

  const openApiPath = path.resolve(catalogRoot, "../rowboat-api/api/openapi.json");
  if (!existsSync(openApiPath)) {
    throw new Error(
      `Cannot resolve --operation: OpenAPI document not found at ${openApiPath}. Pass --orval-schema, --orval-import, and --path instead.`,
    );
  }

  const document = JSON.parse(readFileSync(openApiPath, "utf8")) as OpenAPIDocument;
  const zodExports = indexZodExports(path.join(catalogRoot, "lib/api/generated/zod"));
  const catalog = catalogFromOpenAPI(document, zodExports);
  catalogCache.set(catalogRoot, catalog);
  return catalog;
}

export function resolveOperation(operationId: string, catalogRoot: string): ResolvedOperation {
  const catalog = loadOperationCatalog(catalogRoot);
  const resolved = catalog.get(operationId);
  if (!resolved) {
    throw new Error(
      `Unknown OpenAPI operationId "${operationId}". Use an operationId from apps/rowboat-api/api/openapi.json (for example listConnectors).`,
    );
  }
  if (!resolved.orvalSchema) {
    throw new Error(
      `${operationId} has no Orval 200/201 response schema. Generate contracts or pick another operation.`,
    );
  }
  return resolved;
}

/** Normalize a fetcher path (literal or template) onto the catalog pattern. */
export function pathPattern(pathTemplate: string): string {
  const withoutQuery = pathTemplate.split("?")[0] ?? pathTemplate;
  return withoutQuery
    .replace(/\$\{[^}]+\}/g, ":_")
    .replace(/:[A-Za-z0-9_]+/g, ":_")
    .replace(/\{[A-Za-z0-9_]+\}/g, ":_");
}

export function extractFetcherPaths(source: string): string[] {
  const fromTemplates = [...source.matchAll(/`(\/[^`]+)`/g)].flatMap((match) =>
    match[1] ? [match[1]] : [],
  );
  const fromStrings = [...source.matchAll(/['"](\/[^'"]+)['"]/g)].flatMap((match) =>
    match[1] ? [match[1]] : [],
  );
  return [...fromTemplates, ...fromStrings]
    .filter((raw) => !raw.startsWith("/api/"))
    .map((raw) => pathPattern(raw));
}
