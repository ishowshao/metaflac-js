# metaflac-js

Typed FLAC metadata editing for Node.js: tags, cover art and stream information,
without decoding or re-encoding audio.

**This branch develops 2.0.** The stable 1.x implementation is maintained on
[`1.x`](https://github.com/ishowshao/metaflac-js/tree/1.x). Install the preview explicitly:

```sh
npm install metaflac-js@next
```

Requires **Node.js 22.12+**. ESM, CommonJS and TypeScript declarations are included.
The API is being validated during the alpha series; see [MIGRATION.md](MIGRATION.md)
for the deliberate differences from 1.x.

## Edit a file

```js
import { readMetadata, editFlac } from 'metaflac-js';

const metadata = await readMetadata('song.flac');
console.log(metadata.streamInfo.sampleRate);
console.log(metadata.tags.get('TITLE'));

await editFlac('song.flac', (metadata) => {
    metadata.tags.set('TITLE', 'New title');
    metadata.tags.set('ARTIST', ['Artist A', 'Artist B']);
    metadata.tags.append('GENRE', 'Jazz');
});
```

`readMetadata()` reads only the metadata. `editFlac()` loads the metadata, runs your
callback, then copies the audio in **1 MiB chunks** to a same-directory temporary
file and replaces the original after successful writing and flushing. A callback
that throws, an aborted operation or a detected concurrent modification leaves
this editor's changes uncommitted. Callback side effects outside the library are
not rolled back.

If the encoded metadata is unchanged, the original file is left untouched, including
its inode and timestamps. The return value is `{ changed, metadata }`.

CommonJS uses the same implementation and class identities:

```js
const { readMetadata, editFlac } = require('metaflac-js');
```

## Work with bytes

```js
import { parseFlac, encodeFlac } from 'metaflac-js/core';

const { metadata, audio } = parseFlac(inputBytes);
metadata.tags.set('TITLE', 'New title');
const outputBuffer = encodeFlac(metadata, audio);
```

`parseFlac()` accepts a `Uint8Array` or `Buffer`, copies its audio bytes and owns its
metadata. `parseMetadata()` returns `{ metadata, audioOffset }` without copying audio.
`metadata.toBuffer()` emits the FLAC marker and metadata only. These APIs use memory
proportional to their input/output; use the file API for large audio files.

The core entry point uses Node's `Buffer`, has no filesystem operations or third-party
runtime dependencies, and does not promise browser support.

## Tags

Tags preserve order, spelling and duplicate values. Lookup and removal are case-insensitive.

| Operation                                | Behavior                                           |
| ---------------------------------------- | -------------------------------------------------- |
| `tags.get(name)`                         | First value, or `undefined`                        |
| `tags.getAll(name)`                      | All matching values as a new array                 |
| `tags.has(name)`                         | Whether at least one value exists                  |
| `tags.set(name, valueOrValues)`          | Replace all matches at the first matching position |
| `tags.append(name, value)`               | Add a value at the end                             |
| `tags.delete(name)`                      | Remove all matches and return the removed count    |
| `tags.delete(name, { firstOnly: true })` | Remove only the first match                        |
| `tags.clear()`                           | Remove all fields, retaining the vendor            |
| `tags.entries()` / iteration             | Detached `{ name, value }` entries                 |
| `tags.size`                              | Number of fields, including duplicates             |

`metadata.vendor` can be read and assigned. An empty value is valid. Unicode field
values are encoded as UTF-8; field names must be nonempty printable ASCII excluding
`=`. Invalid UTF-8 and unpaired JavaScript surrogates are rejected.

## Stream information and metadata preservation

`metadata.streamInfo` is read-only and exposes `sampleRate`, `channels`,
`bitsPerSample`, `totalSamples`, `duration`, `md5`, `minBlockSize`, `maxBlockSize`,
`minFrameSize` and `maxFrameSize`. The 36-bit sample count is an exact JavaScript
number. `duration` is seconds, or `undefined` when samples or sample rate are unknown.
The MD5 is the stored signature, not a newly calculated checksum.

Unedited blocks retain their bytes and order, including multiple padding blocks,
APPLICATION, SEEKTABLE, CUESHEET and reserved block types. A no-op parse/encode round
trip is byte-identical. Editing comments replaces only that block (or inserts it
immediately after STREAMINFO when absent). New pictures are inserted before trailing
padding. `metadata.blocks` returns detached raw block snapshots; modifying them does
not edit the instance. `FlacMetadata.fromBlocks()` constructs metadata from explicit
raw blocks when low-level access is needed.

This is a metadata editor, not an audio or complete CUESHEET/SEEKTABLE validator.
Native `fLaC` streams are supported; Ogg FLAC and leading ID3 tags are not.

## Pictures

```js
import { readFile } from 'node:fs/promises';
import { editFlac } from 'metaflac-js';
import { createPicture } from 'metaflac-js/images';

const picture = createPicture(await readFile('cover.png'), {
    type: 3,
    description: 'Front cover',
});
await editFlac('song.flac', (metadata) => {
    metadata.clearPictures();
    metadata.addPicture(picture);
});
```

`createPicture()` inspects JPEG/PNG headers for dimensions, bit depth and palette
count; it does not decode pixels or validate complete image integrity/CRCs. Core
users can pass an explicit `Picture` with `type`, `mimeType`, `description`, `width`,
`height`, `depth`, `colors` and `data`, including other MIME formats or URL pictures.

`metadata.pictures` returns detached snapshots. `removePicture(index)` uses a
zero-based index; `clearPictures()` removes all. Icon types 1 and 2 are unique;
type 1 requires a 32×32 PNG. Picture descriptions support UTF-8.

## Limits, cancellation and errors

```js
await editFlac(
    'song.flac',
    (metadata) => {
        metadata.tags.set('TITLE', 'New title');
    },
    {
        maxMetadataBytes: 64 * 1024 * 1024,
        maxBlocks: 4096,
        signal: AbortSignal.timeout(30_000),
    },
);
```

The shown limits are defaults, including the FLAC marker and block headers. They also
apply when serializing edited metadata. A single block cannot exceed 16,777,215 bytes.
Memory use scales with metadata (including covers), not audio length, for file edits.
Multiple metadata snapshots can coexist internally, so the byte limit is not a strict
process-memory cap.

Format/domain failures use `FlacError` with a stable `code`: `INVALID_FLAC`, `TRUNCATED`,
`INVALID_METADATA`, `LIMIT_EXCEEDED`, `INVALID_ARGUMENT`, `FILE_CHANGED` or `UNSAFE_FILE`.
Some parsing errors include a local byte `offset`. Filesystem errors retain Node's
native codes; aborts use the signal's reason.

File edits preserve ordinary POSIX mode bits and ownership, follow symlinks to the
resolved target and reject multiple hard links when changes are needed. The parent
directory must be writable. Replacement does not preserve ACLs, extended attributes
or original timestamps. Change detection is optimistic, not a file lock: avoid
concurrent writers. Atomic replacement and crash behavior depend on the filesystem;
directory-level crash durability is not promised.

## CLI

```sh
npx metaflac-js@next info song.flac --json
npx metaflac-js@next tags song.flac --get TITLE
npx metaflac-js@next tags song.flac --set 'TITLE=New title' --append 'ARTIST=Another artist'
npx metaflac-js@next tags song.flac --delete GENRE
npx metaflac-js@next pictures song.flac --add cover.png --description 'Front cover'
npx metaflac-js@next pictures song.flac --export cover.png --index 0
```

`info`, `tags` and `pictures` have their own `--help`. Repeated mutation options run
in argument order and commit together. `tags --set-from-file NAME=PATH` reads UTF-8
verbatim; `tags --import PATH` appends `NAME=VALUE` lines (CRLF/blank lines supported).
Line-based import/export cannot round-trip values containing embedded newlines.

Exports must be separate from mutation commands; `--export -` writes to stdout.
Exports to the source FLAC file (including symlink/hard-link aliases) are rejected.
Tag listing uses complete `NAME=VALUE` lines, or `--json` entries. Picture listing is
JSON and omits image bytes. Errors go to stderr with a nonzero exit status.

## Development

```sh
brew install flac                 # macOS; Debian/Ubuntu: sudo apt-get install flac
npm ci
npm run check
npm audit
```

`check` verifies formatting, strict types, unit/integration tests and a fresh tarball
installation in both ESM and CommonJS consumers, including TypeScript declaration
resolution and the installed CLI. Integration tests require official `flac` and
`metaflac`; missing tools fail rather than silently skip. CI covers Linux/macOS,
Node.js 22.12 (minimum), current 22 and 24.

Tests use generated deterministic PCM, malformed metadata, seeded opaque-block round
trips and injected filesystem failures. Edited audio is compared byte-for-byte and
validated with `flac --test`. See [ARCHITECTURE.md](ARCHITECTURE.md),
[MIGRATION.md](MIGRATION.md) and [RELEASING.md](RELEASING.md).

Format reference: [RFC 9639, section 8](https://www.rfc-editor.org/rfc/rfc9639.html#section-8).
Licensed under [ISC](LICENSE).
