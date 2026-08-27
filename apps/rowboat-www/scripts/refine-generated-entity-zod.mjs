import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const appRoot = path.resolve(import.meta.dirname, "..");
const outputRoot = path.resolve(appRoot, process.env.ORVAL_OUTPUT_ROOT ?? "lib/api/generated");
const target = path.join(outputRoot, "zod/entities/entities.ts");
if (!fs.existsSync(target)) process.exit(0);

let source = fs.readFileSync(target, "utf8");
const marker = "entity-projection-collection-parity";
if (!source.includes(marker)) {
  const nextExport = "\n\nexport const putEntity200ResponseCanonicalEntityIdMin";
  const start = source.indexOf("export const PutEntityBody =");
  const end = source.indexOf(nextExport, start);
  if (start < 0 || end < 0) throw new Error("Could not locate generated PutEntityBody schema");
  const segment = source.slice(start, end);
  const trimmed = segment.trimEnd();
  const schemaExpression = trimmed.endsWith(";") ? trimmed.slice(0, -1) : trimmed;
  if (!schemaExpression.endsWith(")")) {
    throw new Error("Could not refine generated PutEntityBody schema");
  }
  const trailing = segment.slice(trimmed.length);
  const refinement = `.superRefine((value, ctx) => {
    // entity-projection-collection-parity: OpenAPI maxProperties, the documented
    // identifier-key pattern, and uniqueItems are not emitted by Orval's Zod client.
    if (value.identifiers && Object.keys(value.identifiers).length > 32) {
      ctx.addIssue({ code: "custom", path: ["identifiers"], message: "identifiers must have at most 32 keys" });
    }
    for (const [key, fingerprints] of Object.entries(value.identifiers ?? {})) {
      if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key)) {
        ctx.addIssue({ code: "custom", path: ["identifiers", key], message: "invalid identifier key" });
      }
      if (new Set(fingerprints).size !== fingerprints.length) {
        ctx.addIssue({ code: "custom", path: ["identifiers", key], message: "identifier fingerprints must be unique" });
      }
    }
    if (value.resourceRefs && new Set(value.resourceRefs).size !== value.resourceRefs.length) {
      ctx.addIssue({ code: "custom", path: ["resourceRefs"], message: "resourceRefs must be unique" });
    }
  })`;
  source =
    source.slice(0, start) + schemaExpression + refinement + ";" + trailing + source.slice(end);
  fs.writeFileSync(target, source);
  const prettier = path.join(appRoot, "node_modules", ".bin", "prettier");
  const formatted = spawnSync(prettier, ["--write", target], { cwd: appRoot, stdio: "inherit" });
  if (formatted.status !== 0) throw new Error("Could not format refined entity Zod contract");
}
