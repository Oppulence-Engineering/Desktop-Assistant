import assert from "node:assert/strict";
import test from "node:test";

import { previewText } from "../apps/renderer/src/lib/preview-text.ts";

/**
 * Every fixture below is a real body prefix taken from the dogfood inbox on
 * 2026-08-07, where 23 of 109 visible rows led with markup instead of prose.
 */

test("drops a tracking pixel that would otherwise be the whole preview", () => {
  const body =
    "![](https://eotrx.substackcdn.com/o/1c6dc27213d8fc68/p.gif?token=eyJtIjoiPDIwMjYwODA3MTg1NDUwLjMu) Charitable investing, explained.";

  assert.equal(previewText(body), "Charitable investing, explained.");
});

test("strips the invisible padding newsletters use to stuff the preheader", () => {
  const body =
    "Because we combine data and human expertise͏ ‌ ­͏ ‌ ­͏ ‌ ­ to get you the highest price";

  assert.equal(
    previewText(body),
    "Because we combine data and human expertise to get you the highest price",
  );
});

test("keeps link text and discards the click-tracker behind it", () => {
  const body = "[ Better Stack ](https://u21574820.ct.sendgrid.net/ls/click?upn=abc) is reporting";

  assert.equal(previewText(body), "Better Stack is reporting");
});

test("removes a bare URL rather than spending the row on it", () => {
  const body =
    "Metric has returned to an acceptable level View cluster: https://cloud.digitalocean.com/databases/7653e504-0f95-410d-ab69-dd50985fc55a?i=c3064e";

  assert.equal(previewText(body), "Metric has returned to an acceptable level View cluster:");
});

test("clears the table scaffolding left behind by the HTML conversion", () => {
  const body = "| [ ![Logo](https://x.test/l.png) ](https://x.test/go) | Quarterly update |";

  assert.equal(previewText(body), "Quarterly update");
});

test("decodes the entities that survive conversion", () => {
  assert.equal(previewText("Profit &amp; loss&nbsp;review"), "Profit & loss review");
});

test("truncates on a word boundary and marks the cut", () => {
  const out = previewText("alpha bravo charlie delta echo foxtrot golf hotel", 20);

  assert.ok(out.length <= 21, `too long: ${out}`);
  assert.ok(out.endsWith("…"), `no ellipsis: ${out}`);
  assert.ok(!out.includes("brav "), `cut mid-word: ${out}`);
});

test("does not add an ellipsis to something that already fits", () => {
  assert.equal(previewText("Short and complete."), "Short and complete.");
});

test("leaves ordinary prose untouched", () => {
  assert.equal(
    previewText("Hi Yoan, following up on the invoice we discussed."),
    "Hi Yoan, following up on the invoice we discussed.",
  );
});

test("survives an empty or missing body", () => {
  assert.equal(previewText(undefined), "");
  assert.equal(previewText(""), "");
  assert.equal(previewText("![](https://x.test/p.gif)"), "");
});
