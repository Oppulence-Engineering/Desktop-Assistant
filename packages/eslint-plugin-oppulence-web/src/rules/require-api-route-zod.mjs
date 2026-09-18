import {
  createRule,
  matchesAnyPath,
  normalizedFilename,
  pathOptionsSchema,
} from "../rule-utils.mjs";

const API_ROUTE_PATTERN = /(?:^|\/)app\/api\/.+\/route\.ts$/;

const VALIDATION_MODULE_PREFIXES = [
  "@/lib/api/routes/parse",
  "@/lib/api/routes/schemas/",
  "@/lib/auth/proxy",
];

const VALIDATION_IMPORT_NAMES = new Set([
  "parseSearchParams",
  "parseJsonBody",
  "parseRouteParams",
  "proxyRowboatAPI",
]);

function isApiRouteFile(filename) {
  return API_ROUTE_PATTERN.test(filename) && !/\.(?:test|spec)\./.test(filename);
}

function importedBindingNames(specifiers) {
  return specifiers.flatMap((specifier) => {
    if (specifier.type === "ImportSpecifier") {
      return [specifier.imported.type === "Identifier" ? specifier.imported.name : undefined];
    }
    if (specifier.type === "ImportDefaultSpecifier") return ["default"];
    if (specifier.type === "ImportNamespaceSpecifier") return [specifier.local.name];
    return [];
  });
}

function isValidationImport(source, importedNames) {
  if (VALIDATION_MODULE_PREFIXES.some((prefix) => source === prefix || source.startsWith(prefix))) {
    return true;
  }
  if (source.includes("/schemas") || source.endsWith("-schema") || source.endsWith("-schema.ts")) {
    return true;
  }
  if (importedNames.some((name) => name?.endsWith("Schema"))) return true;
  if (importedNames.some((name) => VALIDATION_IMPORT_NAMES.has(name))) return true;
  return false;
}

function isReExportFromApiRoute(body) {
  const hasApiReExport = body.some(
    (statement) =>
      statement.type === "ExportNamedDeclaration" &&
      typeof statement.source?.value === "string" &&
      statement.source.value.includes("/app/api/"),
  );
  const onlyImportsOrReExports = body.every((statement) => {
    if (statement.type === "ImportDeclaration") return true;
    if (
      statement.type === "ExportNamedDeclaration" &&
      typeof statement.source?.value === "string"
    ) {
      return statement.source.value.includes("/app/api/");
    }
    return false;
  });
  return hasApiReExport && onlyImportsOrReExports;
}

function isRuntimeSchemaCall(node) {
  return (
    node.callee.type === "MemberExpression" &&
    node.callee.property.type === "Identifier" &&
    (node.callee.property.name === "parse" || node.callee.property.name === "safeParse")
  );
}

export default createRule({
  name: "require-api-route-zod",
  meta: {
    type: "problem",
    docs: {
      description:
        "WEB022: app/api route handlers must validate inputs or outputs with Zod schemas",
    },
    schema: pathOptionsSchema,
    messages: {
      missing:
        "WEB022 API route handlers must use Zod validation: import a *Schema, @/lib/api/routes/parse, or delegate to a validated BFF helper such as proxyRowboatAPI.",
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const filename = normalizedFilename(context);
    if (!isApiRouteFile(filename) || matchesAnyPath(filename, options.allowFiles)) return {};

    let validated = false;

    return {
      Program(node) {
        if (isReExportFromApiRoute(node.body)) validated = true;
      },
      ImportDeclaration(node) {
        const source = node.source.value;
        if (typeof source !== "string") return;
        const importedNames = importedBindingNames(node.specifiers);
        if (isValidationImport(source, importedNames)) validated = true;
      },
      CallExpression(node) {
        if (isRuntimeSchemaCall(node)) validated = true;
      },
      "Program:exit"(node) {
        if (!validated) context.report({ node, messageId: "missing" });
      },
    };
  },
});
