# Migrating from 1.x to 2.0

2.0 is an explicit API redesign, currently available as an alpha through `@next`.
Keep `metaflac-js@^1` if you need the old API. Stable 1.x fixes continue on `1.x`.
Node.js 22.12+ is required for 2.0 (1.1.0 requires Node.js 18+).

## File edits

Before:

```js
const Metaflac = require('metaflac-js');
const flac = new Metaflac('song.flac');
flac.removeTag('TITLE');
flac.setTag('TITLE=New title');
flac.save();
```

After:

```js
const { editFlac } = require('metaflac-js');
await editFlac('song.flac', (metadata) => {
    metadata.tags.set('TITLE', 'New title');
});
```

The new API is async for filesystem operations. CommonJS examples using `await`
belong inside an async function. The callback may also be async. No explicit `save()`
is needed: successful callbacks commit; failures and aborts do not commit library
changes. Reads and in-memory codecs remain separate from persistence.

## Method mapping

| 1.x                               | 2.0                                                                               |
| --------------------------------- | --------------------------------------------------------------------------------- |
| `new Metaflac(path)`              | `await readMetadata(path)` for inspection, `editFlac(path, callback)` for editing |
| `new Metaflac(buffer)` / `save()` | `parseFlac(buffer)` / `encodeFlac(metadata, audio)`                               |
| `setTag('NAME=value')` (append)   | `metadata.tags.append('NAME', 'value')`                                           |
| Remove all matches then add       | `metadata.tags.set('NAME', 'value')`                                              |
| `getTag(name)` (complete lines)   | `metadata.tags.getAll(name)` (values only); `get(name)` returns the first         |
| `getAllTags()` (live strings)     | `metadata.tags.entries()` (detached objects)                                      |
| `removeTag(name)`                 | `metadata.tags.delete(name)`                                                      |
| `removeFirstTag(name)`            | `metadata.tags.delete(name, { firstOnly: true })`                                 |
| `removeAllTags()`                 | `metadata.tags.clear()`                                                           |
| `getVendorTag()`                  | `metadata.vendor`                                                                 |
| `getBps()`, `getChannels()`, etc. | `metadata.streamInfo.bitsPerSample`, `.channels`, etc.                            |
| `importPictureFromBuffer(buffer)` | `metadata.addPicture(createPicture(buffer))`                                      |
| `importPictureFrom(path)`         | Read image bytes with `node:fs/promises`, then use the above                      |
| `getPicturesSpecs()`              | `metadata.pictures` (detached pictures, including data)                           |
| `exportPictureTo(path)`           | Write `metadata.pictures[index].data` with your filesystem API                    |

The default constructor export is removed. Use named imports/exports in both ESM
and CommonJS. Do not deep-import `dist/*`; public entry points are the package root,
`metaflac-js/core`, `metaflac-js/images` and `metaflac-js/package.json`.

`set()` now means replacement; `append()` always means append. This distinction is
intentional. Missing tags return `undefined` from `get()` and `[]` from `getAll()`.
STREAMINFO, raw block snapshots, tag entries and picture snapshots cannot be used as
live mutable references; use the edit methods or construct new metadata explicitly.

The new parser validates UTF-8 and additional metadata structure. Malformed files
that older releases accepted can now throw `FlacError`. Limits are configurable.
Unedited metadata layout is now preserved rather than reordered and padded.

## CLI

| 1.x                                                     | 2.0                                                    |
| ------------------------------------------------------- | ------------------------------------------------------ |
| `metaflac-js --show-sample-rate file.flac`              | `metaflac-js info file.flac --json` (sampleRate field) |
| `metaflac-js --show-tag TITLE file.flac`                | `metaflac-js tags file.flac --get TITLE`               |
| `metaflac-js --set-tag TITLE=x file.flac`               | `metaflac-js tags file.flac --append TITLE=x`          |
| `metaflac-js --remove-tag TITLE file.flac`              | `metaflac-js tags file.flac --delete TITLE`            |
| `metaflac-js --import-picture-from cover.jpg file.flac` | `metaflac-js pictures file.flac --add cover.jpg`       |

The CLI has subcommands, ordered repeatable mutation options and explicit JSON
output. Export and mutation are separate commands. Full official metaflac CLI
compatibility is not a goal; its metadata behavior remains the interoperability
reference.
