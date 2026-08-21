import { constants } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
const segmentPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const routePattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*)*$/;

function pascalCase(value: string): string {
  return value
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");
}

function validate(options: ComponentGeneratorOptions): void {
  if (!segmentPattern.test(options.name)) {
    throw new Error("Component name must be kebab-case, for example `agent-card`");
  }
  if (options.kind === "feature" && (!options.domain || !segmentPattern.test(options.domain))) {
    throw new Error("Feature components require a kebab-case --domain");
  }
  if (options.kind === "route" && (!options.route || !routePattern.test(options.route))) {
    throw new Error("Route components require a safe kebab-case --route path");
  }
}

function componentSource(name: string, client: boolean): string {
  const componentName = pascalCase(name);
  const boundary = client ? '"use client";\n\nimport "client-only";\n\n' : "";
  return `${boundary}import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@oppulence/ui/lib/utils";

export type ${componentName}Props = ComponentPropsWithoutRef<"section">;

export function ${componentName}({ className, ...props }: ${componentName}Props) {
  return <section data-slot="${name}" className={cn(className)} {...props} />;
}
`;
}

function testSource(name: string): string {
  const componentName = pascalCase(name);
  return `// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ${componentName} } from "./${name}";

describe("${componentName}", () => {
  it("forwards accessible section props and renders its content", () => {
    render(<${componentName} aria-label="Example ${name}">Content</${componentName}>);

    const component = screen.getByRole("region", { name: "Example ${name}" });
    expect(component).toHaveAttribute("data-slot", "${name}");
    expect(component).toHaveTextContent("Content");
  });
});
`;
}

export function buildComponentPlan(options: ComponentGeneratorOptions): GeneratedComponentFile[] {
  validate(options);
  const root = options.root ?? appRoot;
  let directory: string;
  if (options.kind === "feature") {
    if (!options.domain) throw new Error("Feature components require a kebab-case --domain");
    directory = path.join(root, "components/features", options.domain, options.name);
  } else {
    if (!options.route) throw new Error("Route components require a safe kebab-case --route path");
    directory = path.join(root, "app/(product)/app", options.route, "_components", options.name);
  }

  return [
    {
      path: path.join(directory, `${options.name}.tsx`),
      content: componentSource(options.name, Boolean(options.client)),
    },
    { path: path.join(directory, `${options.name}.test.tsx`), content: testSource(options.name) },
  ];
}

async function exists(filename: string): Promise<boolean> {
  try {
    await access(filename, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function generateComponent(
  options: ComponentGeneratorOptions,
): Promise<GeneratedComponentFile[]> {
  const files = buildComponentPlan(options);
  const conflicts = (
    await Promise.all(files.map(async (file) => ((await exists(file.path)) ? file.path : null)))
  ).filter((filename): filename is string => filename !== null);
  if (conflicts.length > 0) {
    throw new Error(`Refusing to overwrite existing files:\n${conflicts.join("\n")}`);
  }
  if (options.dryRun) return files;

  const firstFile = files.at(0);
  if (!firstFile) throw new Error("Component generator produced no files");
  await mkdir(path.dirname(firstFile.path), { recursive: true });
  await Promise.all(
    files.map((file) => writeFile(file.path, file.content, { encoding: "utf8", flag: "wx" })),
  );
  return files;
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
        if (kind !== "feature" && kind !== "route")
          throw new Error("--kind must be feature or route");
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
  const parsed = { ...options, kind, name };
  validate(parsed);
  return parsed;
}

async function main(): Promise<void> {
  const options = parseComponentArguments(process.argv.slice(2));
  const files = await generateComponent(options);
  for (const file of files)
    console.log(
      `${options.dryRun ? "would create" : "created"}: ${path.relative(appRoot, file.path)}`,
    );
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
