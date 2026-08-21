import { spawn } from "node:child_process";

import { chromium } from "@playwright/test";
import * as chromeLauncher from "chrome-launcher";
import lighthouse from "lighthouse";

const port = 4318;
const url = `http://127.0.0.1:${port}/`;
// Baseline measured on 2026-08-21: performance 0.79, accessibility 0.96,
// LCP 4,937ms, CLS 0, TBT 0ms. Keep roughly 5-10% variance headroom while
// feature work lowers the baseline; never raise a budget to land a regression.
const budgets = {
  minimumPerformance: 0.75,
  minimumAccessibility: 0.95,
  maximumLcpMs: 5_500,
  maximumCls: 0.1,
  maximumTbtMs: 300,
};
const server = spawn(
  "npm",
  ["run", "start", "--", "--hostname", "127.0.0.1", "--port", String(port)],
  { stdio: "inherit" },
);

async function waitUntilReady() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // The standalone server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Next.js did not become ready for Lighthouse");
}

try {
  await waitUntilReady();
  const chrome = await chromeLauncher.launch({
    chromePath: chromium.executablePath(),
    chromeFlags: ["--headless", "--no-sandbox"],
  });
  try {
    const result = await lighthouse(url, {
      logLevel: "error",
      output: "json",
      port: chrome.port,
      onlyCategories: ["performance", "accessibility"],
    });
    if (!result) throw new Error("Lighthouse returned no result");

    const performance = result.lhr.categories.performance.score ?? 0;
    const accessibility = result.lhr.categories.accessibility.score ?? 0;
    const lcp = result.lhr.audits["largest-contentful-paint"].numericValue ?? Infinity;
    const cls = result.lhr.audits["cumulative-layout-shift"].numericValue ?? Infinity;
    const tbt = result.lhr.audits["total-blocking-time"].numericValue ?? Infinity;

    console.log(
      `Lighthouse: performance=${performance.toFixed(2)} accessibility=${accessibility.toFixed(2)} LCP=${Math.round(lcp)}ms CLS=${cls.toFixed(3)} TBT=${Math.round(tbt)}ms`,
    );
    if (
      performance < budgets.minimumPerformance ||
      accessibility < budgets.minimumAccessibility ||
      lcp > budgets.maximumLcpMs ||
      cls > budgets.maximumCls ||
      tbt > budgets.maximumTbtMs
    ) {
      throw new Error("Lighthouse quality budget exceeded");
    }
  } finally {
    await chrome.kill();
  }
} finally {
  server.kill("SIGTERM");
}
