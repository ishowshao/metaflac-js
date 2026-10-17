# Releasing

1. Update package.json/package-lock.json and CHANGELOG.md together. Document any
   runtime or filesystem compatibility changes explicitly.
2. Run `npm ci`, `npm test`, `npm audit --omit=dev`, and `npm pack --dry-run`.
   Both official `flac` and `metaflac` must be installed; integration tests must
   not be skipped. CI must pass on Linux and macOS for all matrix entries.
3. Create a tarball using `npm pack --pack-destination <temporary-directory>`.
   Install it in a fresh temporary project and exercise the exported constructor,
   tag round trip and installed `metaflac-js` binary. Do not publish test fixtures.
4. Commit the reviewed changes, push and wait for CI on that exact commit.
5. Authenticate as an npm maintainer (`npm whoami`), then publish the validated
   tarball with `npm publish /absolute/path/metaflac-js-X.Y.Z.tgz --access public`.
   Follow npm's interactive authentication/OTP flow; never commit tokens.
6. Verify registry version and tarball integrity. Install `metaflac-js@X.Y.Z`
   into another fresh project and repeat the package smoke test.
7. Create an annotated `vX.Y.Z` tag on the tested commit, push it, and create the
   GitHub Release using that version's changelog. Verify local and remote refs.

If npm authentication is unavailable, keep the validated tarball and report the
version as prepared, not published. Do not create a public release claiming npm
availability before registry verification succeeds.
