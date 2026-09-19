import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Handlebars from "handlebars";

import type { PlannedFile } from "./plan";
import type { TemplateData } from "./template-data";

const templatesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../config/generate/templates",
);

Handlebars.registerHelper("eq", (left: unknown, right: unknown) => left === right);

/**
 * Render a Handlebars template with no HTML escaping. Generated output is
 * TypeScript, so quotes and generics must stay literal.
 */
export function renderTemplate(templateName: string, data: TemplateData): string {
  const filename = path.join(templatesRoot, templateName);
  const source = readFileSync(filename, "utf8");
  return Handlebars.compile(source, { noEscape: true })(data);
}

export type GeneratedFile = {
  path: string;
  content: string;
};

export function materialize(plan: PlannedFile[]): GeneratedFile[] {
  return plan.map((file) => ({
    path: file.path,
    content: renderTemplate(file.template, file.data),
  }));
}
