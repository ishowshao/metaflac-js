# metaflac-js

A pure JavaScript library and CLI for reading and editing native FLAC metadata.
Audio frames are copied unchanged; no audio decoding or encoding is performed.

## Requirements

Node.js **18 or newer** for version 1.1.0 and later. The public CommonJS and
synchronous APIs remain compatible with 1.0.5. The runtime minimum is new because
the updated image parser requires Node.js 18. Prefer a currently supported Node.js release.
The official FLAC tools are needed only for development tests, not to use this package.

## Library

```sh
npm install metaflac-js
```

```js
const Metaflac = require('metaflac-js');
const flac = new Metaflac('/path/to/audio.flac');
flac.setTag('TITLE=My Music');
flac.save();
```

The constructor accepts a filename or a `Buffer`. With a filename, `save()` writes
the file and returns `undefined`. With a Buffer, it returns a new FLAC Buffer.

```js
const flac = new Metaflac(inputBuffer);
flac.removeTag('TITLE');
flac.setTag('TITLE=Replacement title');
const outputBuffer = flac.save();
```

### Tags

- `setTag('NAME=VALUE')` **appends** a field; it does not replace existing fields.
- `getTag('NAME')` returns matching complete `NAME=VALUE` fields joined by `\n`,
  or an empty string when absent. Field names are matched case-insensitively.
- `getAllTags()` returns the tag array, preserving order and duplicates.
- `removeTag(name)`, `removeFirstTag(name)` and `removeAllTags()` edit tags in memory.
- `getVendorTag()` returns the vendor string, which tag edits preserve.
- `setTagFromFile('NAME=/path/to/text')` reads a UTF-8 value verbatim.
- `importTagsFrom(filename)` reads one `NAME=VALUE` per line; CRLF and blank lines
  are supported. `exportTagsTo(filename)` writes fields joined by `\n`.

Call `save()` to persist mutations.

### Stream information

`getMd5sum()`, `getMinBlocksize()`, `getMaxBlocksize()`, `getMinFramesize()`,
`getMaxFramesize()`, `getSampleRate()`, `getChannels()`, `getBps()` and
`getTotalSamples()` read STREAMINFO. The 36-bit sample count is returned as a
JavaScript number without truncation. The MD5 is the stored signature, not a
newly calculated checksum.

### Pictures

`importPictureFrom(filename)` and `importPictureFromBuffer(buffer)` append JPEG
or PNG cover art. `getPicturesSpecs()` returns picture descriptions and dimensions.
`exportPictureTo(filename)` exports the first picture, including one just imported.

## CLI

```sh
npm install --global metaflac-js
metaflac-js --help
metaflac-js --show-tag TITLE audio.flac
metaflac-js --set-tag 'ARTIST=Someone' audio.flac
metaflac-js --remove-tag TITLE audio.flac
metaflac-js --import-picture-from cover.jpg audio.flac
```

The CLI implements a subset of [official metaflac options](https://xiph.org/flac/documentation_tools_metaflac.html),
for one FLAC file at a time. Mutations are saved once after all requested operations
succeed. Options execute in the CLI's fixed order, not argument order; repeated
options are not a batch interface. Use the library for more elaborate editing.

## File handling and limits

- Only native `fLaC` streams are supported, not Ogg FLAC or files with a leading ID3 tag.
- Metadata lengths and required block structure are checked. This is not an audio validator.
- Audio frames and opaque APPLICATION, SEEKTABLE, CUESHEET and reserved blocks
  retain their bytes. Metadata block order and padding layout may change.
- Parsing and saving are synchronous and hold the file in memory. Large files can
  require several times their size in memory; streaming I/O is future work.
- Filename saves write and flush a temporary file in the same directory before
  renaming it over the target. File mode and ownership are preserved on POSIX;
  symbolic links resolve to their targets. The parent directory must be writable.
- Files with multiple hard links are rejected rather than silently detaching a link.
  Use Buffer input/output to choose your own write strategy. Extended attributes,
  ACLs and original timestamps are not preserved by replacement; directory-level
  crash durability and concurrent-writer coordination are not guaranteed.
- Picture imports default to front cover, 24-bit depth and no palette count.
  Detailed image color-depth inference is not provided in this maintenance version.

## Development

Install the official reference tools first:

```sh
brew install flac                   # macOS
sudo apt-get install flac           # Debian/Ubuntu
npm ci
npm test
npm run test:package                # fresh tarball install and CLI smoke test
```

`npm run test:unit` runs without external tools. `npm run test:integration` requires
both `flac` and `metaflac` and fails if either is missing. Tests generate deterministic
PCM/FLAC fixtures in temporary directories and compare STREAMINFO, tag operations,
pictures and CLI persistence against the official implementation. They also compare
encoded audio bytes before/after edits and run `flac --test` on edited files.

The bit-level reference is [RFC 9639, section 8](https://www.rfc-editor.org/rfc/rfc9639.html#section-8).
CI tests Linux and macOS on Node.js 18, 22 and 24.

See [CHANGELOG.md](CHANGELOG.md) for compatibility notes and [RELEASING.md](RELEASING.md)
for release validation. Licensed under [ISC](LICENSE).
