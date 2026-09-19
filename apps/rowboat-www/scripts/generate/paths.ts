import path from "node:path";

import type { Owner } from "@/config/generate/input-schemas";

import { lastRouteSegment, posixJoin } from "./text";

/** Destination roots for each ownership class. Paths are POSIX in plans. */

export function featureDirectory(domain: string, name: string): string {
  return posixJoin("components/features", domain, name);
}

export function routeDirectory(route: string, name: string): string {
  return posixJoin("app/(product)/app", route, "_components", name);
}

export function pageDirectory(route: string): string {
  return posixJoin("app/(product)/app", route);
}

export function libDirectory(domain: string): string {
  return posixJoin("lib", domain);
}

export function hookDirectory(): string {
  return "hooks/queries";
}

export function hookUtilsDirectory(): string {
  return "hooks/queries/utils";
}

export function storeDirectory(name: string): string {
  return posixJoin("stores", name);
}

export function unitDirectory(options: {
  owner: Owner;
  name: string;
  domain?: string;
  route?: string;
}): string {
  switch (options.owner) {
    case "feature":
    case "component":
      if (!options.domain) throw new Error("Feature components require a kebab-case --domain");
      return featureDirectory(options.domain, options.name);
    case "route":
      if (!options.route)
        throw new Error("Route components require a safe kebab-case --route path");
      return routeDirectory(options.route, options.name);
    case "page":
      if (!options.route) throw new Error("Pages require a safe kebab-case --route path");
      return pageDirectory(options.route);
    case "lib":
      if (!options.domain) throw new Error("Lib modules require a kebab-case --domain");
      return libDirectory(options.domain);
    case "hook":
      return hookDirectory();
    case "store":
      return storeDirectory(options.name);
  }
}

export function resolveRoot(root: string | undefined, appRoot: string): string {
  return root ?? appRoot;
}

export function toAbsolute(root: string, relative: string): string {
  return path.join(root, ...relative.split("/"));
}

export function pageNameFromRoute(route: string, name?: string): string {
  return name ?? lastRouteSegment(route);
}
