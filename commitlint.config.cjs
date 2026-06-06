// Conventional Commits, kept in sync with .github/workflows/pr-title-lint.yml.
// Enforced locally via the lefthook `commit-msg` hook; PR titles are enforced
// in CI. If you squash-merge, the PR title becomes the commit — so the CI
// PR-title check is the authoritative gate and this hook is fast local feedback.
module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      ["feat", "fix", "perf", "refactor", "docs", "chore", "build", "ci", "test", "revert"],
    ],
    // Allow longer subject/body lines (we wrap at 100 elsewhere).
    "body-max-line-length": [0, "always", 100],
    "footer-max-line-length": [0, "always", 100],
  },
};
