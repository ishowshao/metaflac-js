# Changelog

## 2.0.0-alpha.1

First preview of the TypeScript rewrite. Published under `next`; stable `latest`
remains on 1.x. Requires Node.js 22.12+. See MIGRATION.md for breaking API/CLI changes.

- Separate bounded binary codecs, metadata model, async file I/O and CLI.
- Named ESM/CommonJS exports share one implementation and include strict types.
- Explicit ordered multi-value tags: get/getAll, set, append, delete and iteration.
- Preserve untouched metadata bytes, block order, padding and unknown block types;
  no-op edits do not replace files.
- Read only file metadata and copy audio in 1 MiB chunks during edits.
- Support cancellation, optimistic concurrent-change detection, partial writes and
  cleanup after failed transactions, with explicit filesystem limitations.
- Add configurable metadata budgets and structured FlacError codes.
- Add typed pictures, Unicode descriptions, JPEG/PNG depth/palette inspection and
  removal/export of individual pictures. Remove image-size; the only runtime
  dependency is Commander for the CLI.
- Replace legacy CLI flags with info/tags/pictures subcommands and ordered repeated
  mutation options.
- Add official-tool interoperability, seeded round trips, injected I/O failure and
  fresh package/type-resolution tests.

## 1.1.0

Maintenance release retaining the CommonJS entry point, synchronous methods,
append-only `setTag`, full-field `getTag` strings and path/Buffer `save` behavior.

### Compatibility

- Node.js 18+ is now required by the updated image-size dependency. Consumers on
  older Node.js versions must upgrade their runtime before updating this package.
- Malformed/truncated metadata is rejected instead of partially parsed.
- Filename saves now use temporary-file replacement, require writable parent
  directories and reject multiple hard links. See README for filesystem limits.

### Fixed

- Correct channel and bit-depth fields, 36-bit total samples and STREAMINFO's
  last-block flag.
- Save files without PADDING; preserve reserved metadata blocks.
- Match tag names case-insensitively, validate field names and handle CRLF or
  trailing newlines in tag imports.
- Parse multiple pictures once, use UTF-8 byte lengths for descriptions and make
  newly imported pictures immediately available to export.
- Persist all CLI tag mutations once after successful operations; report errors
  on stderr without saving earlier mutations when a later operation fails.
- Check metadata boundaries, duplicate mandatory blocks and comment counts.
- Keep original file contents intact if writing or replacing a temporary file fails.

### Maintenance

- Update image-size to ^2.0.4 and remove file-type; only accepted JPEG/PNG signatures
  are dispatched to the image parser.
- Add generated fixtures and official flac/metaflac interoperability tests.
- Add Linux/macOS CI, package file allowlist and the existing ISC license text.

## 1.0.5 — 2019-06-08

- Add `importPictureFromBuffer`.
