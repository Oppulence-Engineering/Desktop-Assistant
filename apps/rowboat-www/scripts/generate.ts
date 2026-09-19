import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { generateRequestSchema, type GenerateRequest } from "@/config/generate/input-schemas";

import { parseGenerateArguments } from "./generate/flags";
import { resolveGenerateRequest } from "./generate/resolve";
import { generateFiles } from "./generate/write";

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export { parseGenerateArguments } from "./generate/flags";
export { buildPlan } from "./generate/plan";
export { generateFiles } from "./generate/write";
export { materialize } from "./generate/render";

/**
 * Public generator door. Every kind shares one parse → plan → refuse-overwrite
 * → write sequence so the app can only grow one way.
 */
export async function generate(
  request: GenerateRequest,
): Promise<{ path: string; content: string }[]> {
  const resolved = resolveGenerateRequest(generateRequestSchema.parse(request), appRoot);
  return generateFiles(resolved, appRoot);
}

export async function runGenerate(args: string[]): Promise<{ path: string; content: string }[]> {
  const request = parseGenerateArguments(args);
  const files = await generate(request);
  for (const file of files) {
    console.log(
      `${request.dryRun ? "would create" : "created"}: ${path.relative(appRoot, file.path)}`,
    );
  }
  return files;
}

async function main(): Promise<void> {
  await runGenerate(process.argv.slice(2));
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
