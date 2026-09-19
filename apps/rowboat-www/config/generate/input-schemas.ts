import { z } from "zod";

/**
 * CLI contracts for `npm run gen`. Validated before any path is planned so a
 * bad name or route cannot mkdir its way into the tree.
 */

export const kebabSegmentSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, "must be kebab-case, for example `agent-card`");

export const routeSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*)*$/,
    "must be a safe kebab-case --route path",
  );

export const generatorKindSchema = z.enum([
  "lit",
  "schema",
  "component",
  "page",
  "lib",
  "hook",
  "mutation",
  "store",
  "story",
  "feature",
]);

export const httpMethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);

export type GeneratorKind = z.infer<typeof generatorKindSchema>;

export const ownerSchema = z.enum([
  "feature",
  "route",
  "lib",
  "hook",
  "store",
  "page",
  "component",
]);

export type Owner = z.infer<typeof ownerSchema>;

export const fieldTypeSchema = z.enum(["string", "number", "boolean", "string[]"]);

export const schemaFieldSchema = z.object({
  name: z.string().regex(/^[a-z][a-zA-Z0-9]*$/, "field names must be camelCase identifiers"),
  type: fieldTypeSchema,
});

export type SchemaFieldInput = z.infer<typeof schemaFieldSchema>;

const reservedStoreName = /(^|-)(session|route|nav|query|user)(-|$)/;

const dryRunAndRoot = {
  dryRun: z.boolean().default(false),
  root: z.string().optional(),
};

export const litInputSchema = z
  .object({
    kind: z.literal("lit"),
    name: kebabSegmentSchema,
    owner: ownerSchema,
    domain: kebabSegmentSchema.optional(),
    route: routeSchema.optional(),
    client: z.boolean().default(false),
    summary: z.string().min(1).optional(),
    schemas: z.array(z.string()).default([]),
    files: z.array(z.string()).default([]),
    artifactKind: generatorKindSchema.exclude(["feature"]).default("component"),
    ...dryRunAndRoot,
  })
  .superRefine(requireOwnerLocation);

export const schemaInputSchema = z
  .object({
    kind: z.literal("schema"),
    name: kebabSegmentSchema,
    owner: ownerSchema,
    domain: kebabSegmentSchema.optional(),
    route: routeSchema.optional(),
    fields: z.array(schemaFieldSchema).default([]),
    ...dryRunAndRoot,
  })
  .superRefine(requireOwnerLocation);

export const componentInputSchema = z
  .object({
    kind: z.literal("component"),
    name: kebabSegmentSchema,
    ownership: z.enum(["feature", "route"]),
    domain: kebabSegmentSchema.optional(),
    route: routeSchema.optional(),
    client: z.boolean().default(false),
    summary: z.string().min(1).optional(),
    fields: z.array(schemaFieldSchema).default([]),
    ...dryRunAndRoot,
  })
  .superRefine((value, ctx) => {
    if (value.ownership === "feature" && !value.domain) {
      ctx.addIssue({
        code: "custom",
        path: ["domain"],
        message: "Feature components require a kebab-case --domain",
      });
    }
    if (value.ownership === "route" && !value.route) {
      ctx.addIssue({
        code: "custom",
        path: ["route"],
        message: "Route components require a safe kebab-case --route path",
      });
    }
  });

const bffPathSchema = z
  .string()
  .regex(/^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/{}/]*$/, "must be a same-origin path under /v1");

const orvalBinding = {
  operation: z.string().min(1).optional(),
  orvalSchema: z.string().min(1).optional(),
  orvalImport: z.string().min(1).optional(),
  orvalQuery: z.string().min(1).optional(),
  path: bffPathSchema.optional(),
  queryParams: z.array(schemaFieldSchema).default([]),
};

export const pageInputSchema = z.object({
  kind: z.literal("page"),
  route: routeSchema,
  name: kebabSegmentSchema.optional(),
  title: z.string().min(1).optional(),
  summary: z.string().min(1).optional(),
  panelName: kebabSegmentSchema.optional(),
  client: z.boolean().default(false),
  fields: z.array(schemaFieldSchema).default([]),
  ...orvalBinding,
  ...dryRunAndRoot,
});

export const libInputSchema = z.object({
  kind: z.literal("lib"),
  name: kebabSegmentSchema,
  domain: kebabSegmentSchema,
  summary: z.string().min(1).optional(),
  fields: z.array(schemaFieldSchema).default([]),
  ...dryRunAndRoot,
});

export const hookInputSchema = z
  .object({
    kind: z.literal("hook"),
    name: kebabSegmentSchema.optional(),
    summary: z.string().min(1).optional(),
    ...orvalBinding,
    ...dryRunAndRoot,
  })
  .superRefine(requireNameOrOperation);

export const mutationInputSchema = z
  .object({
    kind: z.literal("mutation"),
    name: kebabSegmentSchema.optional(),
    summary: z.string().min(1).optional(),
    method: httpMethodSchema.optional(),
    orvalBody: z.string().min(1).optional(),
    invalidate: kebabSegmentSchema.optional(),
    ...orvalBinding,
    ...dryRunAndRoot,
  })
  .superRefine(requireNameOrOperation);

export const storeInputSchema = z
  .object({
    kind: z.literal("store"),
    name: kebabSegmentSchema,
    domain: kebabSegmentSchema.optional(),
    summary: z.string().min(1).optional(),
    fields: z.array(schemaFieldSchema).default([]),
    ...dryRunAndRoot,
  })
  .superRefine((value, ctx) => {
    if (reservedStoreName.test(value.name)) {
      ctx.addIssue({
        code: "custom",
        path: ["name"],
        message:
          "Zustand stores cannot own navigation or server data. Choose a name that is not session, route, nav, query, or user.",
      });
    }
  });

export const storyInputSchema = z
  .object({
    kind: z.literal("story"),
    name: kebabSegmentSchema.optional(),
    ownership: z.enum(["feature", "route"]).optional(),
    domain: kebabSegmentSchema.optional(),
    route: routeSchema.optional(),
    component: z.string().min(1).optional(),
    ...dryRunAndRoot,
  })
  .superRefine((value, ctx) => {
    if (!value.component && !value.name) {
      ctx.addIssue({
        code: "custom",
        path: ["name"],
        message: "Story generation requires --component or --name",
      });
    }
  });

export const featureInputSchema = z.object({
  kind: z.literal("feature"),
  name: kebabSegmentSchema,
  domain: kebabSegmentSchema,
  route: routeSchema,
  title: z.string().min(1).optional(),
  summary: z.string().min(1).optional(),
  client: z.boolean().default(false),
  withLib: z.boolean().default(false),
  storeName: kebabSegmentSchema.optional(),
  fields: z.array(schemaFieldSchema).default([]),
  ...orvalBinding,
  ...dryRunAndRoot,
});

export const generateRequestSchema = z.discriminatedUnion("kind", [
  litInputSchema,
  schemaInputSchema,
  componentInputSchema,
  pageInputSchema,
  libInputSchema,
  hookInputSchema,
  mutationInputSchema,
  storeInputSchema,
  storyInputSchema,
  featureInputSchema,
]);

export type GenerateRequest = z.infer<typeof generateRequestSchema>;

function requireNameOrOperation(
  value: { name?: string; operation?: string },
  ctx: z.RefinementCtx,
): void {
  if (!value.name && !value.operation) {
    ctx.addIssue({
      code: "custom",
      path: ["name"],
      message: "requires --name or --operation",
    });
  }
}

function requireOwnerLocation(
  value: { owner: Owner; domain?: string; route?: string },
  ctx: z.RefinementCtx,
): void {
  const needsDomain =
    value.owner === "feature" || value.owner === "component" || value.owner === "lib";
  const needsRoute = value.owner === "route" || value.owner === "page";
  if (needsDomain && !value.domain) {
    ctx.addIssue({
      code: "custom",
      path: ["domain"],
      message: `${value.owner} units require a kebab-case --domain`,
    });
  }
  if (needsRoute && !value.route) {
    ctx.addIssue({
      code: "custom",
      path: ["route"],
      message: `${value.owner} units require a safe kebab-case --route path`,
    });
  }
}

export function zodTypeExpression(type: z.infer<typeof fieldTypeSchema>): string {
  switch (type) {
    case "string":
      return "z.string().min(1)";
    case "number":
      return "z.number()";
    case "boolean":
      return "z.boolean()";
    case "string[]":
      return "z.array(z.string())";
  }
}
