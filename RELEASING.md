# Releasing

## Branches and channels

- `master`: 2.x development, currently `2.0.0-alpha.1`.
- `1.x`: stable 1.x maintenance, separate worktree recommended.
- npm `latest`: stable 1.x until a deliberate 2.0 stable launch.
- npm `next`: 2.0 alpha/beta/rc previews.
- Tags use `v<version>` and point to the exact tested commit.

The 2.x package's publishConfig defaults to **next** to prevent accidental stable
promotion. Publishing a prerelease must always use `--tag next`. GitHub prereleases
must use `--prerelease --latest=false`. Do not merge master wholesale into 1.x;
backport regression tests and relevant fixes individually.

## Validation and publication

1. Update package.json, lockfile, changelog and migration notes together.
2. Run `npm ci`, `npm run check` and `npm audit`. Install official flac/metaflac;
   integration tests must not be skipped. Package checks build, pack, install and
   exercise ESM/CommonJS, TypeScript declarations and the CLI in a fresh project.
3. Commit and push. Require green Linux/macOS CI on Node.js 22.12, 22 and 24 for
   that exact commit. Check the worktree is clean.
4. Create an artifact with `npm pack --pack-destination <temporary-directory>`.
   Record its integrity and the commit. Confirm npm login with `npm whoami`.
5. Publish that tarball explicitly:
   `npm publish /absolute/path/metaflac-js-2.0.0-alpha.1.tgz --tag next --access public`.
   Complete npm's browser/2FA flow without storing credentials in the repository.
6. Wait for registry processing; do not republish on a transient E404. Verify the
   published integrity, exact version and `next` tag. Confirm `latest` is unchanged.
7. Install the exact registry version into a fresh project, test API/CLI and verify
   edited FLAC with the official tools. A successful publish response alone is not
   sufficient evidence of availability.
8. Create and push an annotated version tag. Create a GitHub prerelease with
   `--prerelease --latest=false`, release notes and CI evidence.

If authentication is unavailable, report the artifact as prepared, not released.
When 2.0 is ready for general use, deliberately change the stable release procedure
and npm tag to latest. Subsequent 1.x maintenance releases must use `--tag legacy`
so they cannot move latest back to 1.x. Preserve the 1.x branch during migration;
plan at least six months of critical/security fixes after the 2.0 stable launch.
