/** Pure string transforms shared by every generator kind. */

export function pascalCase(value: string): string {
  return value
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");
}

export function camelCase(value: string): string {
  const pascal = pascalCase(value);
  return `${pascal.charAt(0).toLowerCase()}${pascal.slice(1)}`;
}

/** OpenAPI operationIds are camelCase (`listConnectors` → `list-connectors`). */
export function kebabFromCamel(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

export function constantCase(value: string): string {
  return value.split("-").join("_").toUpperCase();
}

export function titleCase(value: string): string {
  const [first = "", ...rest] = value.split("-");
  return [`${first.charAt(0).toUpperCase()}${first.slice(1)}`, ...rest].join(" ");
}

export function lastRouteSegment(route: string): string {
  const segment = route.split("/").at(-1);
  if (!segment) throw new Error("Route path is empty");
  return segment;
}

export function posixJoin(...parts: string[]): string {
  return parts
    .filter((part) => part.length > 0)
    .join("/")
    .replaceAll(/\/{2,}/g, "/");
}
