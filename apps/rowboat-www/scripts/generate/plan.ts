import type { GenerateRequest, Owner, SchemaFieldInput } from "@/config/generate/input-schemas";

import {
  featureDirectory,
  hookDirectory,
  hookUtilsDirectory,
  libDirectory,
  pageDirectory,
  pageNameFromRoute,
  routeDirectory,
  storeDirectory,
  unitDirectory,
} from "./paths";
import {
  baseData,
  componentTypeNames,
  namesFor,
  posixFile,
  requestName,
  storyTitleFor,
  type TemplateData,
} from "./template-data";
import { kebabFromCamel, lastRouteSegment } from "./text";

export type PlannedFile = {
  path: string;
  template: string;
  data: TemplateData;
};

function file(
  directory: string,
  filename: string,
  template: string,
  data: TemplateData,
): PlannedFile {
  return { path: posixFile(directory, filename), template, data };
}

function withInventory(data: TemplateData, files: PlannedFile[]): TemplateData {
  const relative = files.map((entry) => entry.path);
  const schemas = relative.filter(
    (path) => path.endsWith(".schema.ts") || path.endsWith("search-params.ts"),
  );
  return { ...data, files: relative, schemas };
}

function applyInventory(files: PlannedFile[]): PlannedFile[] {
  return files.map((entry) => ({ ...entry, data: withInventory(entry.data, files) }));
}

function componentFiles(options: {
  ownership: "feature" | "route";
  name: string;
  domain?: string;
  route?: string;
  client?: boolean;
  summary?: string;
  fields?: SchemaFieldInput[];
}): PlannedFile[] {
  const directory =
    options.ownership === "feature"
      ? featureDirectory(options.domain ?? "", options.name)
      : routeDirectory(options.route ?? "", options.name);
  const data = {
    ...baseData({
      name: options.name,
      owner: options.ownership,
      artifactKind: "component",
      domain: options.domain,
      route: options.route,
      client: options.client,
      summary: options.summary,
      fields: options.fields,
      storyTitle: storyTitleFor(options.ownership, options.domain, options.route, ""),
    }),
    ...componentTypeNames(options.name),
    storyTitle: storyTitleFor(
      options.ownership,
      options.domain,
      options.route,
      componentTypeNames(options.name).typeName.replace(/Props$/, ""),
    ),
  };
  return applyInventory([
    file(directory, `${options.name}.tsx`, "component/component.tsx.hbs", data),
    file(directory, `${options.name}.test.tsx`, "component/component.test.tsx.hbs", data),
    file(directory, `${options.name}.schema.ts`, "schema/schema.ts.hbs", data),
    file(directory, `${options.name}.schema.test.ts`, "schema/schema.test.ts.hbs", data),
    file(directory, `${options.name}.lit.ts`, "lit/lit.ts.hbs", data),
    file(directory, `${options.name}.stories.tsx`, "story/story.tsx.hbs", data),
  ]);
}

function litFiles(request: Extract<GenerateRequest, { kind: "lit" }>): PlannedFile[] {
  const owner: Owner = request.owner === "component" ? "feature" : request.owner;
  const directory = unitDirectory({
    owner,
    name: request.name,
    domain: request.domain,
    route: request.route,
  });
  const filename = owner === "hook" ? `use-${request.name}.lit.ts` : `${request.name}.lit.ts`;
  const data = baseData({
    name: request.name,
    owner,
    artifactKind: request.artifactKind,
    domain: request.domain,
    route: request.route,
    client: request.client,
    summary: request.summary,
    files: request.files,
    schemas: request.schemas,
  });
  const planned = [
    file(directory, filename, "lit/lit.ts.hbs", {
      ...data,
      files: request.files,
      schemas: request.schemas,
    }),
  ];
  return request.files.length > 0 || request.schemas.length > 0 ? planned : applyInventory(planned);
}

function schemaFiles(request: Extract<GenerateRequest, { kind: "schema" }>): PlannedFile[] {
  const owner: Owner = request.owner === "component" ? "feature" : request.owner;
  const directory =
    owner === "hook"
      ? hookUtilsDirectory()
      : unitDirectory({ owner, name: request.name, domain: request.domain, route: request.route });
  const names = owner === "feature" || owner === "route" ? componentTypeNames(request.name) : {};
  const data = {
    ...baseData({
      name: request.name,
      owner,
      artifactKind: "schema",
      domain: request.domain,
      route: request.route,
      fields: request.fields,
      fallbackFields: [{ name: "id", type: "string" }],
    }),
    ...names,
  };
  return applyInventory([
    file(directory, `${request.name}.schema.ts`, "schema/schema.ts.hbs", data),
    file(directory, `${request.name}.schema.test.ts`, "schema/schema.test.ts.hbs", data),
    file(
      owner === "hook" ? hookDirectory() : directory,
      owner === "hook" ? `use-${request.name}.lit.ts` : `${request.name}.lit.ts`,
      "lit/lit.ts.hbs",
      data,
    ),
  ]);
}

function composerHookName(
  request: Extract<GenerateRequest, { kind: "page" | "feature" }>,
): string | undefined {
  if (request.operation) return kebabFromCamel(request.operation);
  if (request.orvalSchema && request.orvalImport && request.path) {
    return request.kind === "feature"
      ? request.name
      : pageNameFromRoute(request.route, request.name);
  }
  return undefined;
}

function pageFiles(
  request: Extract<GenerateRequest, { kind: "page" | "feature" }>,
  prefetchHookName?: string,
): PlannedFile[] {
  const name = pageNameFromRoute(request.route, request.name);
  const directory = pageDirectory(request.route);
  const panelName = ("panelName" in request && request.panelName) || `${name}-panel`;
  const searchFields = request.fields.length > 0 ? request.fields : request.queryParams;
  const data = baseData({
    name,
    owner: "page",
    artifactKind: "page",
    domain: "domain" in request ? request.domain : lastRouteSegment(request.route),
    route: request.route,
    client: request.client,
    summary: request.summary,
    title: request.title,
    panelName,
    fields: searchFields,
    fallbackFields: [],
    hasPrefetch: Boolean(prefetchHookName),
    hookName: prefetchHookName,
  });
  const prefetchData = prefetchHookName
    ? {
        ...data,
        prefetchName: namesFor(prefetchHookName).prefetchName,
        hookNameForRoute: prefetchHookName,
        hasPrefetch: true,
      }
    : data;
  const panel = componentFiles({
    ownership: "route",
    name: panelName,
    route: request.route,
    client: request.client,
    summary: `${data.title} route-private panel. Presentation only.`,
  });
  const page = applyInventory([
    file(directory, `${name}.lit.ts`, "lit/lit.ts.hbs", prefetchData),
    file(directory, "page.tsx", "page/page.tsx.hbs", prefetchData),
    file(directory, "loading.tsx", "page/loading.tsx.hbs", data),
    file(directory, "error.tsx", "page/error.tsx.hbs", data),
    file(directory, "search-params.ts", "page/search-params.ts.hbs", data),
    ...(prefetchHookName
      ? [file(directory, "prefetch.ts", "page/prefetch.ts.hbs", prefetchData)]
      : []),
  ]);
  return [...page, ...panel];
}

function libFiles(request: Extract<GenerateRequest, { kind: "lib" }>): PlannedFile[] {
  const directory = libDirectory(request.domain);
  const data = {
    ...baseData({
      name: request.name,
      owner: "lib",
      artifactKind: "lib",
      domain: request.domain,
      summary: request.summary,
      fields: request.fields,
      fallbackFields: [
        { name: "amount", type: "number" as const },
        { name: "currency", type: "string" as const },
      ],
    }),
    schemaName: `${pascalFrom(request.name)}InputSchema`,
    typeName: `${pascalFrom(request.name)}Input`,
    fieldsTypeName: `${pascalFrom(request.name)}Input`,
  };
  return applyInventory([
    file(directory, `${request.name}.ts`, "lib/lib.ts.hbs", data),
    file(directory, `${request.name}.schema.ts`, "schema/schema.ts.hbs", data),
    file(directory, `${request.name}.schema.test.ts`, "schema/schema.test.ts.hbs", data),
    file(directory, `${request.name}.test.ts`, "lib/lib.test.ts.hbs", data),
    file(directory, `${request.name}.lit.ts`, "lit/lit.ts.hbs", data),
  ]);
}

function pascalFrom(name: string): string {
  return name
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");
}

function requireHookName(name: string | undefined): string {
  if (!name) throw new Error("Query units require --name or --operation");
  return name;
}

function hookFiles(request: Extract<GenerateRequest, { kind: "hook" }>): PlannedFile[] {
  const name = requireHookName(request.name);
  const data = baseData({
    name,
    owner: "hook",
    artifactKind: "hook",
    summary: request.summary,
    orvalSchema: request.orvalSchema,
    orvalImport: request.orvalImport,
    orvalQuery: request.orvalQuery,
    path: request.path,
    hasPrefetch: true,
    fallbackFields: [{ name: "id", type: "string" }],
  });
  if (!data.hasOrval) {
    throw new Error(
      "gen hook requires --operation or --orval-schema + --orval-import + --path. Local Zod stubs are not generated.",
    );
  }
  return applyInventory([
    file(hookDirectory(), `use-${name}.ts`, "hook/use-hook.ts.hbs", data),
    file(hookUtilsDirectory(), `fetch-${name}.ts`, "hook/fetch.ts.hbs", data),
    file(hookUtilsDirectory(), `fetch-${name}.test.ts`, "hook/fetch.test.ts.hbs", data),
    file(hookUtilsDirectory(), `prefetch-${name}.ts`, "hook/prefetch.ts.hbs", data),
    file(hookUtilsDirectory(), `${name}-keys.ts`, "hook/keys.ts.hbs", data),
    file(hookUtilsDirectory(), `${name}-keys.test.ts`, "hook/keys.test.ts.hbs", data),
    file(hookDirectory(), `use-${name}.lit.ts`, "lit/lit.ts.hbs", data),
  ]);
}

function mutationFiles(request: Extract<GenerateRequest, { kind: "mutation" }>): PlannedFile[] {
  const name = requireHookName(request.name);
  const data = baseData({
    name,
    owner: "hook",
    artifactKind: "mutation",
    summary: request.summary,
    orvalSchema: request.orvalSchema,
    orvalImport: request.orvalImport,
    orvalBody: request.orvalBody,
    path: request.path,
    method: request.method ?? "POST",
    invalidate: request.invalidate,
    isMutation: true,
    fallbackFields: [{ name: "id", type: "string" }],
  });
  if (!data.hasOrval) {
    throw new Error(
      "gen mutation requires --operation or --orval-schema + --orval-import + --path. Local Zod stubs are not generated.",
    );
  }
  return applyInventory([
    file(hookDirectory(), `use-${name}.ts`, "mutation/use-mutation.ts.hbs", data),
    file(hookUtilsDirectory(), `mutate-${name}.ts`, "mutation/mutate.ts.hbs", data),
    file(hookUtilsDirectory(), `${name}-keys.ts`, "hook/keys.ts.hbs", data),
    file(hookUtilsDirectory(), `${name}-keys.test.ts`, "hook/keys.test.ts.hbs", data),
    file(hookDirectory(), `use-${name}.lit.ts`, "lit/lit.ts.hbs", data),
  ]);
}

function composerHookFiles(
  request: Extract<GenerateRequest, { kind: "page" | "feature" }>,
  hookName: string,
): PlannedFile[] {
  return hookFiles({
    kind: "hook",
    name: hookName,
    summary: request.summary,
    operation: request.operation,
    orvalSchema: request.orvalSchema,
    orvalImport: request.orvalImport,
    orvalQuery: request.orvalQuery,
    queryParams: request.queryParams,
    path: request.path,
    dryRun: request.dryRun,
    root: request.root,
  });
}

function storeFiles(request: Extract<GenerateRequest, { kind: "store" }>): PlannedFile[] {
  const directory = storeDirectory(request.name);
  const data = {
    ...baseData({
      name: request.name,
      owner: "store",
      artifactKind: "store",
      domain: request.domain,
      summary: request.summary,
      fields: request.fields,
      fallbackFields: [
        { name: "x", type: "number" as const },
        { name: "y", type: "number" as const },
        { name: "zoom", type: "number" as const },
      ],
    }),
    schemaName: `${pascalFrom(request.name)}StateSchema`,
    typeName: `${pascalFrom(request.name)}State`,
    fieldsTypeName: `${pascalFrom(request.name)}State`,
  };
  return applyInventory([
    file(directory, "store.ts", "store/store.ts.hbs", data),
    file(directory, `${request.name}.schema.ts`, "schema/schema.ts.hbs", data),
    file(directory, `${request.name}.schema.test.ts`, "schema/schema.test.ts.hbs", data),
    file(directory, "store.test.ts", "store/store.test.ts.hbs", data),
    file(directory, `${request.name}.lit.ts`, "lit/lit.ts.hbs", data),
  ]);
}

function storyFiles(request: Extract<GenerateRequest, { kind: "story" }>): PlannedFile[] {
  const name = requestName(request);
  let directory: string;
  if (request.component) {
    const posix = request.component.replaceAll("\\", "/");
    directory = posix.split("/").slice(0, -1).join("/");
  } else if (request.ownership === "route") {
    directory = routeDirectory(request.route ?? "", name);
  } else {
    directory = featureDirectory(request.domain ?? "", name);
  }
  const data = {
    ...baseData({
      name,
      owner: request.ownership ?? "feature",
      artifactKind: "story",
      domain: request.domain,
      route: request.route,
    }),
    ...componentTypeNames(name),
  };
  return [file(directory, `${name}.stories.tsx`, "story/story.tsx.hbs", data)];
}

function featureFiles(request: Extract<GenerateRequest, { kind: "feature" }>): PlannedFile[] {
  const hookName = composerHookName(request);
  const files = pageFiles(request, hookName);
  if (hookName) {
    files.push(...composerHookFiles(request, hookName));
  }
  if (request.withLib) {
    files.push(
      ...libFiles({
        kind: "lib",
        name: request.name,
        domain: request.domain,
        summary: request.summary,
        fields: [],
        dryRun: request.dryRun,
        root: request.root,
      }),
    );
  }
  if (request.storeName) {
    files.push(
      ...storeFiles({
        kind: "store",
        name: request.storeName,
        domain: request.domain,
        summary: request.summary,
        fields: [],
        dryRun: request.dryRun,
        root: request.root,
      }),
    );
  }
  return dedupePaths(files);
}

function dedupePaths(files: PlannedFile[]): PlannedFile[] {
  const seen = new Set<string>();
  return files.filter((file) => {
    if (seen.has(file.path)) return false;
    seen.add(file.path);
    return true;
  });
}

export function buildPlan(request: GenerateRequest): PlannedFile[] {
  switch (request.kind) {
    case "lit":
      return litFiles(request);
    case "schema":
      return schemaFiles(request);
    case "component":
      return componentFiles({
        ownership: request.ownership,
        name: request.name,
        domain: request.domain,
        route: request.route,
        client: request.client,
        summary: request.summary,
        fields: request.fields,
      });
    case "page": {
      const hookName = composerHookName(request);
      const files = pageFiles(request, hookName);
      if (hookName) files.push(...composerHookFiles(request, hookName));
      return dedupePaths(files);
    }
    case "lib":
      return libFiles(request);
    case "hook":
      return hookFiles(request);
    case "mutation":
      return mutationFiles(request);
    case "store":
      return storeFiles(request);
    case "story":
      return storyFiles(request);
    case "feature":
      return featureFiles(request);
  }
}

export function generatedRelativePaths(request: GenerateRequest): string[] {
  return buildPlan(request).map((file) => file.path);
}
