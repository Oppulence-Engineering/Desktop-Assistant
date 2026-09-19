import { constants } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { GenerateRequest } from "@/config/generate/input-schemas";

import { buildPlan } from "./plan";
import { toAbsolute } from "./paths";
import { materialize, type GeneratedFile } from "./render";

async function exists(filename: string): Promise<boolean> {
  try {
    await access(filename, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function generateFiles(
  request: GenerateRequest,
  appRoot: string,
): Promise<GeneratedFile[]> {
  const root = request.root ?? appRoot;
  const planned = materialize(buildPlan(request)).map((file) => ({
    ...file,
    path: toAbsolute(root, file.path),
  }));
  const conflicts = (
    await Promise.all(planned.map(async (file) => ((await exists(file.path)) ? file.path : null)))
  ).filter((filename): filename is string => filename !== null);
  if (conflicts.length > 0) {
    throw new Error(`Refusing to overwrite existing files:\n${conflicts.join("\n")}`);
  }
  if (request.dryRun) return planned;

  const directories = new Set(planned.map((file) => path.dirname(file.path)));
  await Promise.all([...directories].map((directory) => mkdir(directory, { recursive: true })));
  await Promise.all(
    planned.map((file) => writeFile(file.path, file.content, { encoding: "utf8", flag: "wx" })),
  );
  return planned;
}
