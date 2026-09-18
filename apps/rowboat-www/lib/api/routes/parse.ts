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

export async function readJsonBody(
  request: Request,
  maxBytes: number,
): Promise<ParseResult<unknown>> {
  const raw = await request.arrayBuffer();
  if (raw.byteLength > maxBytes) return { success: false };
  if (raw.byteLength === 0) return { success: true, data: {} };

  try {
    return { success: true, data: JSON.parse(new TextDecoder().decode(raw)) };
  } catch {
    return { success: false };
  }
}

export function parseJsonBody<T extends z.ZodType>(
  request: Request,
  schema: T,
  maxBytes: number,
): Promise<ParseResult<z.infer<T>>> {
  return readJsonBody(request, maxBytes).then((body) => {
    if (!body.success) return { success: false };

    const result = schema.safeParse(body.data);
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
