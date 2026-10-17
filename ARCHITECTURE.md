# Architecture

2.0 separates format correctness, editing semantics and filesystem effects. It
remains one small package; no framework, container or plugin system is needed.

| Module                 | Responsibility                                                   |
| ---------------------- | ---------------------------------------------------------------- |
| `src/core/binary.ts`   | Bounded reads, exact integer encoding, strict UTF-8              |
| `src/core/blocks.ts`   | STREAMINFO, comments and pictures; raw metadata framing          |
| `src/core/tags.ts`     | Ordered, case-insensitive, multi-value tag semantics             |
| `src/core/metadata.ts` | Metadata ownership, block preservation, limits and memory codecs |
| `src/io.ts`            | Async metadata reads and bounded-memory transactional file edits |
| `src/images.ts`        | Optional JPEG/PNG header inspection; no pixel decoding           |
| `src/cli.ts`           | Argument parsing and presentation using public operations        |

Dependencies point inward: I/O, images and CLI depend on core; core knows nothing
about paths, Commander or persistence. Buffer operations are explicit Node.js APIs.

## Ownership and preservation

FlacMetadata owns copies of the original blocks. Tags are structured entries with
an internal change callback. Untouched comments are serialized from the original
block; edited comments replace their original position. Other raw blocks retain
both data and relative order. Picture access and raw block access return copies.
No-op output is byte-identical, not merely semantically equivalent.

STREAMINFO is read-only. SEEK/CUE/APPLICATION and reserved blocks are preserved
without trying to reinterpret their complete schemas. There is no audio decoder.
An output's correctness is tested against the official tools and against unchanged
audio bytes, independently of parser round trips.

## File transaction

Read metadata from an open source handle under configurable byte/block budgets.
Run the caller's edit callback, encode, and compare with the original metadata.
If unchanged, return without replacing the file. Otherwise, create an exclusive
same-directory temporary file, write metadata, and copy audio through a fixed 1 MiB
buffer. Handle partial writes, aborts and truncated reads. Preserve POSIX ordinary
mode bits/ownership, flush, compare source identity/size/mtime/ctime, close and rename.
Failures remove only a temporary file that this operation successfully created.

This detects ordinary concurrent writes/replacements but is not a filesystem lock.
There remains a race between final verification and rename. Concurrent writers,
network-filesystem semantics and directory crash durability are outside the contract.
A replacement requires write permission to the directory and rejects hard links.
ACLs and extended attributes are not copied. These limits are documented rather
than hidden behind an unconditional safety guarantee.

## Distribution and tests

TypeScript builds a single CommonJS implementation plus declarations. Tiny ESM
wrappers expose named exports from that same implementation, avoiding duplicate
class identities when consumers mix import and require. Source maps embed source.
Builds clean dist first so stale files cannot enter a release.

Core tests cover malformed input, numeric boundaries, Unicode, ownership, budgets
and deterministic generated round trips. I/O tests cover official flac/metaflac,
audio identity, cancellation, concurrency and injected filesystem failures. CLI
tests cover ordered mutations and exports. Package tests install the actual tarball
and compile ESM/CommonJS TypeScript consumers against the published declarations.
