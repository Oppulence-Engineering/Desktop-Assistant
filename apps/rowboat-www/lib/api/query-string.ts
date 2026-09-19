function queryParamValue(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

/**
 * Append a parsed Orval query object to a BFF path. Shared so generated
 * fetchers do not each invent URLSearchParams. Skip empty values so defaulted
 * list hooks stay cache-key stable.
 */
export function withQueryString(path: string, query: Record<string, unknown> | undefined): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        const serialized = queryParamValue(item);
        if (serialized === undefined) continue;
        params.append(key, serialized);
      }
      continue;
    }
    const serialized = queryParamValue(value);
    if (serialized === undefined) continue;
    params.set(key, serialized);
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}
