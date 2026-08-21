import type { ZodType } from "zod";

export function readValidatedJson<T>(filePath: string, schema: ZodType<T>): Promise<T>;
