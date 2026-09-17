import "server-only";

import { z } from "zod";

export type ParseResult<T> = { success: true; data: T } | { success: false };

export function parseSearchParams<T extends z.ZodType>(
  searchParams: URLSearchParams,
  schema: T,
): ParseResult<z.infer<T>> {
  const result = schema.safeParse(Object.fromEntries(searchParams.entries()));
  return result.success ? { success: true, data: result.data } : { success: false };
}

export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown | null> {
  const raw = await request.arrayBuffer();
  if (raw.byteLength > maxBytes) return null;
  if (raw.byteLength === 0) return {};

  try {
    return JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return null;
  }
}

export function parseJsonBody<T extends z.ZodType>(
  request: Request,
  schema: T,
  maxBytes: number,
): Promise<ParseResult<z.infer<T>>> {
  return readJsonBody(request, maxBytes).then((value) => {
    if (value === null) return { success: false };

    const result = schema.safeParse(value);
    return result.success ? { success: true, data: result.data } : { success: false };
  });
}

export function parseRouteParams<T extends z.ZodType>(
  params: unknown,
  schema: T,
): ParseResult<z.infer<T>> {
  const result = schema.safeParse(params);
  return result.success ? { success: true, data: result.data } : { success: false };
}
