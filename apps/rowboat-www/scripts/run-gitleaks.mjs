// Scans repository history for secrets with gitleaks.
//
// Scanning every reachable commit made this stage flaky in CI: the set of
// refs present in a runner checkout varies, so the commit range (and the
// findings) differed between runs even for identical trees. Full history is
// already covered by the repo-wide `secret-scan` job, so this stage scans a
// deterministic range instead: the commits this branch adds on top of the
// merge base with the default branch, or HEAD when that base is unavailable.
import { execFileSync, spawnSync } from "node:child_process";

const GITLEAKS = "github.com/zricethezav/gitleaks/v8@v8.30.1";
const pullRequestBase = process.env.GITHUB_BASE_REF;
const BASE_CANDIDATES = [
  pullRequestBase && `origin/${pullRequestBase}`,
  pullRequestBase,
  "origin/main",
  "main",
].filter(Boolean);

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function resolveRange() {
  for (const base of BASE_CANDIDATES) {
    try {
      const mergeBase = git(["merge-base", base, "HEAD"]);
      if (git(["rev-parse", "HEAD"]) === mergeBase) return "HEAD";
      return `${mergeBase}..HEAD`;
    } catch {
      // Base ref not present in this checkout; try the next candidate.
    }
  }
  return "HEAD";
}

const range = resolveRange();
console.log(`[gitleaks] scanning range: ${range}`);

const result = spawnSync(
  "go",
  [
    "run",
    GITLEAKS,
    "git",
    "--config",
    "../../.gitleaks.toml",
    "--gitleaks-ignore-path",
    "../../.gitleaksignore",
    "--redact",
    "--no-banner",
    `--log-opts=--no-merges ${range}`,
    "../..",
  ],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
