import { z } from "zod";

function isTraversalSegment(part: string): boolean {
  if (!part) return true;
  let decoded = part;
  try {
    decoded = decodeURIComponent(part);
  } catch {
    return true;
  }
  for (const piece of decoded.split("/")) {
    if (!piece || piece === "." || piece === "..") return true;
  }
  return decoded === "." || decoded === "..";
}

export const RowboatProxySegmentSchema = z.string().superRefine((part, ctx) => {
  if (isTraversalSegment(part)) {
    ctx.addIssue({ code: "custom", message: "Invalid proxy path segment." });
  }
});

export const RowboatProxyPathSchema = z.array(RowboatProxySegmentSchema);
