import { z } from "zod";

export const OpenAPIDocumentSchema = z
  .object({
    info: z.record(z.string(), z.unknown()).optional(),
    servers: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .passthrough();
