# Changelog

This project uses [release-please](https://github.com/googleapis/release-please)
to generate per-package changelogs from [Conventional Commits](https://www.conventionalcommits.org/).

## Per-package changelogs

The canonical changelog for the Electron desktop application lives at
[apps/x/CHANGELOG.md](./apps/x/CHANGELOG.md). It is updated automatically by
release-please when a release pull request is merged.

## Releases

For binary installers and full release notes, see the
[Releases page](https://github.com/Oppulence-Engineering/rowboat/releases).

## How to add to the changelog

Land a PR whose title follows Conventional Commits and touches files under
`apps/x/`. release-please will pick the change up automatically on the next
run and add it to `apps/x/CHANGELOG.md` under the appropriate version.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for full details on the release flow.
