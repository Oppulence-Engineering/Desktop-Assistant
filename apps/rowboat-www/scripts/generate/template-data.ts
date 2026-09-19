import {
  zodTypeExpression,
  type GenerateRequest,
  type SchemaFieldInput,
} from "@/config/generate/input-schemas";

import { mswImportFromOrval, mswNamesFromSchema } from "./orval-operation";
import { pageNameFromRoute } from "./paths";
import { camelCase, constantCase, pascalCase, posixJoin, titleCase } from "./text";

export type RenderField = {
  name: string;
  zod: string;
  sample: string;
  storeInitial: string;
  nuqsParser: string;
};

export type TemplateData = {
  name: string;
  pascalName: string;
  camelName: string;
  constantName: string;
  title: string;
  summary: string;
  summaryLiteral: string;
  client: boolean;
  domain: string;
  route: string;
  owner: string;
  artifactKind: string;
  schemaName: string;
  typeName: string;
  fieldsTypeName: string;
  fields: RenderField[];
  hasFields: boolean;
  files: string[];
  schemas: string[];
  storyTitle: string;
  orvalSchema: string;
  orvalImport: string;
  orvalBody: string;
  orvalQuery: string;
  hasOrval: boolean;
  hasQuery: boolean;
  hasBody: boolean;
  queryTypeName: string;
  mswImport: string;
  mswMock: string;
  mswHandler: string;
  hasMsw: boolean;
  pathParamsSamples: string;
  usesParseAsString: boolean;
  usesParseAsInteger: boolean;
  usesParseAsBoolean: boolean;
  usesParseAsArray: boolean;
  httpMethod: string;
  isMutation: boolean;
  invalidateKeysName: string;
  invalidateName: string;
  hasInvalidate: boolean;
  fetchPath: string;
  fetchPathExpression: string;
  pathParams: string[];
  pathParamsSignature: string;
  pathParamsCall: string;
  hasPathParams: boolean;
  hasPrefetch: boolean;
  prefetchName: string;
  hookNameForRoute: string;
  hookName: string;
  keysName: string;
  fetchName: string;
  loadName: string;
  staleName: string;
  schemaModuleName: string;
  panelName: string;
  panelPascal: string;
  searchCacheName: string;
  parsersName: string;
  urlKeysName: string;
  searchSchemaName: string;
  storeHookName: string;
  litExportName: string;
  litSchemaName: string;
  functionName: string;
};

function fieldsFrom(
  input: SchemaFieldInput[] | undefined,
  fallback: SchemaFieldInput[],
): RenderField[] {
  const source = input && input.length > 0 ? input : fallback;
  return source.map((field) => ({
    name: field.name,
    zod: zodTypeExpression(field.type),
    sample:
      field.type === "string"
        ? '"example"'
        : field.type === "number"
          ? "1"
          : field.type === "boolean"
            ? "true"
            : '["example"]',
    storeInitial:
      field.type === "string"
        ? '"unset"'
        : field.type === "number"
          ? "0"
          : field.type === "boolean"
            ? "false"
            : "[]",
    nuqsParser:
      field.type === "number"
        ? "parseAsInteger"
        : field.type === "boolean"
          ? "parseAsBoolean"
          : field.type === "string[]"
            ? "parseAsArrayOf(parseAsString)"
            : "parseAsString",
  }));
}

function normalizeFetchPath(pathTemplate: string): string {
  return pathTemplate.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, ":$1");
}

function pathParams(pathTemplate: string): string[] {
  return [...normalizeFetchPath(pathTemplate).matchAll(/:([A-Za-z][A-Za-z0-9]*)/g)].flatMap(
    (match) => (match[1] ? [match[1]] : []),
  );
}

function fetchPathExpression(pathTemplate: string): string {
  const normalized = normalizeFetchPath(pathTemplate);
  if (!normalized.includes(":")) return JSON.stringify(normalized);
  const rewritten = normalized.replace(/:([A-Za-z][A-Za-z0-9]*)/g, "${encodeURIComponent($1)}");
  return `\`${rewritten}\``;
}

export function namesFor(name: string) {
  const pascalName = pascalCase(name);
  const camelName = camelCase(name);
  return {
    name,
    pascalName,
    camelName,
    constantName: constantCase(name),
    title: titleCase(name),
    hookName: `use${pascalName}`,
    keysName: `${camelName}Keys`,
    fetchName: `fetch${pascalName}`,
    loadName: `load${pascalName}`,
    prefetchName: `prefetch${pascalName}`,
    staleName: `${constantCase(name)}_STALE_TIME`,
    schemaModuleName: `${pascalName}Schema`,
    storeHookName: `use${pascalName}Store`,
    litExportName: `${pascalName}Lit`,
    litSchemaName: `${pascalName}LitSchema`,
    functionName: camelName,
    searchCacheName: `${camelName}SearchParamsCache`,
    parsersName: `${camelName}Parsers`,
    urlKeysName: `${camelName}UrlKeys`,
    searchSchemaName: `${pascalName}SearchParamsSchema`,
  };
}

export function baseData(options: {
  name: string;
  owner: string;
  artifactKind: string;
  domain?: string;
  route?: string;
  client?: boolean;
  summary?: string;
  title?: string;
  fields?: SchemaFieldInput[];
  fallbackFields?: SchemaFieldInput[];
  files?: string[];
  schemas?: string[];
  storyTitle?: string;
  orvalSchema?: string;
  orvalImport?: string;
  orvalBody?: string;
  orvalQuery?: string;
  path?: string;
  method?: string;
  invalidate?: string;
  isMutation?: boolean;
  hasPrefetch?: boolean;
  hookName?: string;
  panelName?: string;
}): TemplateData {
  const named = namesFor(options.name);
  const fields = fieldsFrom(options.fields, options.fallbackFields ?? []);
  const fetchPath = normalizeFetchPath(options.path ?? `/${options.name}`);
  const params = pathParams(fetchPath);
  const panelName = options.panelName ?? `${options.name}-panel`;
  const invalidate = options.invalidate ?? "";
  const hookNameForRoute = options.hookName ?? options.name;
  const msw = mswNamesFromSchema(options.orvalSchema ?? "");
  return {
    ...named,
    title: options.title ?? named.title,
    summary:
      options.summary ??
      `${named.title} is generated from the rowboat-www growth standard. Replace this summary in the lit.`,
    summaryLiteral: JSON.stringify(
      options.summary ??
        `${named.title} is generated from the rowboat-www growth standard. Replace this summary in the lit.`,
    ),
    client: Boolean(options.client),
    domain: options.domain ?? "",
    route: options.route ?? "",
    owner: options.owner,
    artifactKind: options.artifactKind,
    schemaName: `${named.pascalName}Schema`,
    typeName: named.pascalName,
    fieldsTypeName: `${named.pascalName}Fields`,
    fields,
    hasFields: fields.length > 0,
    files: options.files ?? [],
    schemas: options.schemas ?? [],
    storyTitle:
      options.storyTitle ??
      storyTitleFor(options.owner, options.domain, options.route, named.pascalName),
    orvalSchema: options.orvalSchema ?? "",
    orvalImport: options.orvalImport ?? "",
    orvalBody: options.orvalBody ?? "",
    orvalQuery: options.orvalQuery ?? "",
    hasOrval: Boolean(options.orvalSchema && options.orvalImport),
    hasQuery: Boolean(options.orvalQuery),
    hasBody: Boolean(options.orvalBody),
    queryTypeName: `${named.pascalName}Query`,
    mswImport: mswImportFromOrval(options.orvalImport ?? ""),
    mswMock: msw.mock,
    mswHandler: msw.handler,
    hasMsw: Boolean(options.orvalSchema && options.orvalImport),
    pathParamsSamples: params.map(() => '"example"').join(", "),
    usesParseAsString: fields.some((field) => field.nuqsParser.includes("parseAsString")),
    usesParseAsInteger: fields.some((field) => field.nuqsParser === "parseAsInteger"),
    usesParseAsBoolean: fields.some((field) => field.nuqsParser === "parseAsBoolean"),
    usesParseAsArray: fields.some((field) => field.nuqsParser.includes("parseAsArrayOf")),
    httpMethod: (options.method ?? "GET").toUpperCase(),
    isMutation: Boolean(options.isMutation),
    invalidateName: invalidate,
    invalidateKeysName: invalidate ? `${camelCase(invalidate)}Keys` : "",
    hasInvalidate: Boolean(invalidate),
    hasPrefetch: Boolean(options.hasPrefetch),
    hookNameForRoute,
    fetchPath,
    fetchPathExpression: fetchPathExpression(fetchPath),
    pathParams: params,
    pathParamsSignature: params.map((param) => `${param}: string`).join(", "),
    pathParamsCall: params.join(", "),
    hasPathParams: params.length > 0,
    panelName,
    panelPascal: pascalCase(panelName),
  };
}

export function storyTitleFor(
  owner: string,
  domain: string | undefined,
  route: string | undefined,
  pascalName: string,
): string {
  if (owner === "route" && route) return `routes/${route}/${pascalName}`;
  if (domain) return `features/${domain}/${pascalName}`;
  return `generated/${pascalName}`;
}

export function componentTypeNames(
  name: string,
): Pick<TemplateData, "schemaName" | "typeName" | "fieldsTypeName"> {
  const pascalName = pascalCase(name);
  return {
    schemaName: `${pascalName}PropsSchema`,
    typeName: `${pascalName}Props`,
    fieldsTypeName: `${pascalName}PropsFields`,
  };
}

export function requestName(request: GenerateRequest): string {
  if (request.kind === "page") return pageNameFromRoute(request.route, request.name);
  if (request.kind === "story") {
    if (request.name) return request.name;
    const basename = request.component
      ?.split("/")
      .pop()
      ?.replace(/\.tsx$/, "");
    if (!basename) throw new Error("Story generation requires --component or --name");
    return basename;
  }
  if (!request.name) {
    throw new Error(`${request.kind} generation requires --name or --operation`);
  }
  return request.name;
}

export function posixFile(directory: string, filename: string): string {
  return posixJoin(directory, filename);
}
