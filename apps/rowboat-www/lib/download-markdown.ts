"use client";

import "client-only";

/** Browser-only helper. Kept out of `lib/revenue.ts` so that module can be server-imported. */
export function downloadMarkdown(filename: string, markdown: string) {
  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
