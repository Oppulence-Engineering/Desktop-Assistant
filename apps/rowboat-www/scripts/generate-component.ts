import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { componentInputSchema } from "@/config/generate/input-schemas";

import { generate, runGenerate } from "./generate";
import { buildPlan } from "./generate/plan";
import { toAbsolute } from "./generate/paths";
import { materialize } from "./generate/render";

export type ComponentKind = "feature" | "route";

export type ComponentGeneratorOptions = {
  kind: ComponentKind;
  name: string;
  domain?: string;
  route?: string;
  client?: boolean;
  dryRun?: boolean;
  root?: string;
};

export type GeneratedComponentFile = {
  path: string;
  content: string;
};

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function toRequest(options: ComponentGeneratorOptions) {
  return componentInputSchema.parse({
    kind: "component",
    ownership: options.kind,
    name: options.name,
    domain: options.domain,
    route: options.route,
    client: options.client,
    dryRun: options.dryRun,
    root: options.root,
  });
}

export function buildComponentPlan(options: ComponentGeneratorOptions): GeneratedComponentFile[] {
  const root = options.root ?? appRoot;
  return materialize(buildPlan(toRequest(options))).map((file) => ({
    path: toAbsolute(root, file.path),
    content: file.content,
  }));
}

export async function generateComponent(
  options: ComponentGeneratorOptions,
): Promise<GeneratedComponentFile[]> {
  return generate(toRequest(options));
}

function argumentValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

export function parseComponentArguments(args: string[]): ComponentGeneratorOptions {
  const options: Partial<ComponentGeneratorOptions> = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    switch (argument) {
      case "--kind": {
        const kind = argumentValue(args, index, argument);
        if (kind !== "feature" && kind !== "route") {
          throw new Error("--kind must be feature or route");
        }
        options.kind = kind;
        index += 1;
        break;
      }
      case "--name":
        options.name = argumentValue(args, index, argument);
        index += 1;
        break;
      case "--domain":
        options.domain = argumentValue(args, index, argument);
        index += 1;
        break;
      case "--route":
        options.route = argumentValue(args, index, argument);
        index += 1;
        break;
      case "--client":
        options.client = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      default:
        throw new Error(`Unknown component generator argument: ${argument}`);
    }
  }
  const { kind, name } = options;
  if (!kind || !name) throw new Error("--kind and --name are required");
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name)) {
    throw new Error("Component name must be kebab-case, for example `agent-card`");
  }
  if (
    kind === "feature" &&
    (!options.domain || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(options.domain))
  ) {
    throw new Error("Feature components require a kebab-case --domain");
  }
  if (
    kind === "route" &&
    (!options.route ||
      !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*)*$/.test(options.route))
  ) {
    throw new Error("Route components require a safe kebab-case --route path");
  }
  return { ...options, kind, name };
}

async function main(): Promise<void> {
  const options = parseComponentArguments(process.argv.slice(2));
  await runGenerate([
    "component",
    "--kind",
    options.kind,
    "--name",
    options.name,
    ...(options.domain ? ["--domain", options.domain] : []),
    ...(options.route ? ["--route", options.route] : []),
    ...(options.client ? ["--client"] : []),
    ...(options.dryRun ? ["--dry-run"] : []),
  ]);
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
