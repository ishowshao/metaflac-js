# Changelog

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
