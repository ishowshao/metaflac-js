const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    FlacError,
    Tags,
    FlacMetadata,
    parseFlac,
    parseMetadata,
    encodeFlac,
} = require('../dist/core');
const { createPicture } = require('../dist/images');
const { streamInfo, stream, block } = require('./helpers.cjs');
function comments(vendor, fields) {
    const size = (n) => {
        const b = Buffer.alloc(4);
        b.writeUInt32LE(n);
        return b;
    };
    const text = (s) => {
        const b = Buffer.from(s);
        return Buffer.concat([size(b.length), b]);
    };
    return Buffer.concat([text(vendor), size(fields.length), ...fields.map(text)]);
}
const errorCode = (code) => (error) => error instanceof FlacError && error.code === code;
for (const channels of [1, 2, 6, 8])
    for (const bits of [8, 16, 24, 32]) {
        test(`STREAMINFO ${channels} channels, ${bits} bits, full 36-bit counts`, () => {
            for (const count of [0, 44100, 0x80000000, 0x100000001, 0xfffffffff]) {
                const input = stream([], streamInfo(channels, bits, count));
                const { metadata, audioOffset } = parseMetadata(input);
                assert.equal(audioOffset, 42);
                assert.equal(metadata.streamInfo.channels, channels);
                assert.equal(metadata.streamInfo.bitsPerSample, bits);
                assert.equal(metadata.streamInfo.totalSamples, count);
                assert.equal(metadata.streamInfo.duration, count ? count / 44100 : undefined);
                assert.deepEqual(metadata.toBuffer(), input);
            }
        });
    }
test('no-op preserves block bytes, order, multiple padding and reserved types', () => {
    const blocks = [
        [1, Buffer.alloc(7)],
        [4, comments('中文 vendor', ['TITLE=a', 'artist=b', 'ARTIST=c'])],
        [2, Buffer.from('TESTpayload')],
        [3, Buffer.alloc(0)],
        [5, Buffer.alloc(396)],
        [7, Buffer.from('future')],
        [126, Buffer.from('opaque')],
        [1, Buffer.alloc(3)],
    ];
    const audio = Buffer.from([255, 248, 1, 2, 3]);
    const input = Buffer.concat([stream(blocks), audio]);
    const parsed = parseFlac(input);
    assert.deepEqual(encodeFlac(parsed.metadata, parsed.audio), input);
    parsed.metadata.tags.set('TITLE', '你好');
    const edited = parseFlac(encodeFlac(parsed.metadata, parsed.audio));
    assert.deepEqual(edited.audio, audio);
    assert.deepEqual(
        edited.metadata.blocks.filter((b) => b.type !== 4),
        blocks.length ? parsed.metadata.blocks.filter((b) => b.type !== 4) : [],
    );
    assert.deepEqual(
        edited.metadata.blocks.map((b) => b.type),
        [0, ...blocks.map((b) => b[0])],
    );
    assert.equal(edited.metadata.vendor, '中文 vendor');
});
test('tags explicitly distinguish replacement, append and deletion, preserving duplicate order', () => {
    const tags = new Tags([
        { name: 'A', value: 'one' },
        { name: 'B', value: 'other' },
        { name: 'a', value: 'two=three' },
    ]);
    assert.equal(tags.get('a'), 'one');
    assert.deepEqual(tags.getAll('A'), ['one', 'two=three']);
    tags.set('a', ['new', 'second']);
    assert.deepEqual(
        [...tags],
        [
            { name: 'a', value: 'new' },
            { name: 'a', value: 'second' },
            { name: 'B', value: 'other' },
        ],
    );
    tags.append('A', 'third');
    assert.equal(tags.size, 4);
    assert.equal(tags.delete('A', { firstOnly: true }), 1);
    assert.deepEqual(tags.getAll('a'), ['second', 'third']);
    assert.equal(tags.delete('a'), 2);
    assert.equal(tags.delete('a'), 0);
    tags.set('B', []);
    assert.equal(tags.size, 0);
    assert.equal(tags.get('B'), undefined);
    tags.clear();
    assert.equal(tags.has('B'), false);
});
test('tags and raw blocks cannot be modified through snapshots or caller-owned input', () => {
    const input = stream([[4, comments('vendor', ['TITLE=old'])]]);
    const { metadata } = parseFlac(input);
    input.fill(0);
    metadata.tags.entries()[0].value = 'oops';
    metadata.blocks[0].data.fill(0);
    assert.equal(metadata.tags.get('TITLE'), 'old');
    assert.equal(metadata.streamInfo.sampleRate, 44100);
    assert.equal(parseFlac(metadata.toBuffer()).metadata.tags.get('TITLE'), 'old');
});
test('no padding or comments required; creates one comment block only when edited', () => {
    const input = stream();
    const { metadata } = parseFlac(input);
    metadata.tags.clear();
    metadata.tags.delete('MISSING');
    assert.deepEqual(metadata.toBuffer(), input);
    metadata.tags.append('TITLE', '中文😀=value');
    metadata.tags.append('TITLE', 'two');
    metadata.vendor = 'writer';
    const reread = parseFlac(metadata.toBuffer()).metadata;
    assert.equal(reread.vendor, 'writer');
    assert.deepEqual(reread.tags.getAll('title'), ['中文😀=value', 'two']);
    assert.deepEqual(
        reread.blocks.map((b) => b.type),
        [0, 4],
    );
});
test('rejects invalid names, Unicode encodings, truncated blocks and singleton duplicates', () => {
    for (const name of ['', 'A=B', '中文', 'a\nb', '\x7f'])
        assert.throws(() => new Tags().append(name, 'value'), errorCode('INVALID_ARGUMENT'));
    assert.throws(() => new Tags().append('TITLE', '\ud800'), errorCode('INVALID_ARGUMENT'));
    const invalid = [
        Buffer.alloc(0),
        Buffer.from('fLaC'),
        stream().subarray(0, 30),
        Buffer.concat([Buffer.from('fLaC'), block(1, Buffer.alloc(0), true)]),
        stream([[0, streamInfo()]]),
        stream([[127, Buffer.alloc(0)]]),
        stream([], Buffer.alloc(33)),
        stream([
            [4, comments('', [])],
            [4, comments('', [])],
        ]),
        stream([[3, Buffer.alloc(1)]]),
        stream([[2, Buffer.alloc(3)]]),
        stream([[6, Buffer.alloc(3)]]),
        stream([[4, comments('', ['not-a-field'])]]),
    ];
    for (const input of invalid) assert.throws(() => parseFlac(input), FlacError);
    const text = comments('', ['A=value']);
    text[text.length - 1] = 255;
    assert.throws(() => parseFlac(stream([[4, text]])), errorCode('INVALID_METADATA'));
    const badCount = comments('', []);
    badCount.writeUInt32LE(0xffffffff, 4);
    assert.throws(() => parseFlac(stream([[4, badCount]])), errorCode('TRUNCATED'));
});
test('bounds parsing by configured byte and block budgets before allocating payloads', () => {
    const input = stream([[1, Buffer.alloc(20)]]);
    assert.throws(() => parseFlac(input, { maxMetadataBytes: 42 }), errorCode('LIMIT_EXCEEDED'));
    assert.throws(() => parseFlac(input, { maxBlocks: 1 }), errorCode('LIMIT_EXCEEDED'));
    assert.throws(() => parseFlac(input, { maxMetadataBytes: -1 }), errorCode('INVALID_ARGUMENT'));
    const { metadata } = parseFlac(stream(), { maxMetadataBytes: 42 });
    metadata.tags.append('TITLE', 'a');
    assert.throws(() => metadata.toBuffer(), errorCode('LIMIT_EXCEEDED'));
    assert.throws(
        () =>
            FlacMetadata.fromBlocks([
                { type: 0, data: streamInfo() },
                { type: 1, data: Buffer.alloc(0x1000000) },
            ]),
        FlacError,
    );
});
test('pictures support Unicode, multiple images, detached bytes and explicit removal', () => {
    const jpeg = fs.readFileSync(path.join(__dirname, 'small.jpg'));
    const picture = createPicture(jpeg, { description: '封面😀' });
    const { metadata } = parseFlac(stream([[1, Buffer.alloc(8)]]));
    metadata.addPicture(picture).addPicture({ ...picture, type: 4 });
    picture.data.fill(0);
    const reread = parseFlac(metadata.toBuffer()).metadata;
    assert.equal(reread.pictures.length, 2);
    assert.equal(reread.pictures[0].description, '封面😀');
    assert.equal(reread.pictures[0].depth, 24);
    assert.deepEqual(Buffer.from(reread.pictures[0].data), jpeg);
    reread.pictures[0].data.fill(0);
    assert.deepEqual(Buffer.from(reread.pictures[0].data), jpeg);
    assert.deepEqual(
        reread.blocks.map((b) => b.type),
        [0, 6, 6, 1],
    );
    reread.removePicture(0);
    assert.equal(reread.pictures[0].type, 4);
    assert.throws(() => reread.removePicture(5), FlacError);
    reread.clearPictures();
    assert.equal(reread.pictures.length, 0);
});
test('picture icon rules and unsupported image input fail explicitly', () => {
    const { metadata } = parseFlac(stream());
    const picture = createPicture(fs.readFileSync(path.join(__dirname, 'small.jpg')));
    assert.throws(() => metadata.addPicture({ ...picture, type: 1 }), FlacError);
    metadata.addPicture({ ...picture, type: 2 });
    assert.throws(() => metadata.addPicture({ ...picture, type: 2 }), FlacError);
    assert.throws(() => metadata.addPicture({ ...picture, type: 21 }), FlacError);
    for (const input of [Buffer.alloc(0), Buffer.from('GIF89a'), Buffer.from([255, 216, 255])])
        assert.throws(() => createPicture(input));
});
test('PNG image depth reflects its channels and precision', () => {
    const data = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=',
        'base64',
    );
    const picture = createPicture(data);
    assert.equal(picture.mimeType, 'image/png');
    assert.equal(picture.depth, 16);
    assert.equal(picture.width, 1);
});
test('seeded round trips preserve arbitrary opaque blocks and audio', () => {
    let seed = 1234567;
    const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed;
    };
    for (let i = 0; i < 200; i++) {
        const blocks = Array.from({ length: random() % 10 }, () => [
            7 + (random() % 120),
            Buffer.alloc(random() % 80, random() & 255),
        ]);
        const input = Buffer.concat([stream(blocks), Buffer.alloc(random() % 256, random() & 255)]);
        const parsed = parseFlac(input);
        assert.deepEqual(encodeFlac(parsed.metadata, parsed.audio), input);
        parsed.metadata.tags.append('SEED', String(seed));
        const edited = parseFlac(encodeFlac(parsed.metadata, parsed.audio));
        assert.deepEqual(edited.audio, parsed.audio);
        assert.deepEqual(
            edited.metadata.blocks.filter((b) => b.type !== 4),
            parsed.metadata.blocks.filter((b) => b.type !== 4),
        );
    }
});
test('every truncated prefix of metadata is rejected with a domain error', () => {
    const input = stream([
        [4, comments('vendor', ['TITLE=中文😀'])],
        [1, Buffer.alloc(7)],
    ]);
    for (let length = 0; length < input.length; length++)
        assert.throws(() => parseFlac(input.subarray(0, length)), FlacError);
});
test('non-audio STREAMINFO may have sample rate zero, with no defined duration', () => {
    const info = streamInfo();
    info[10] = 0;
    info[11] = 0;
    info[12] &= 15;
    const input = stream([], info),
        metadata = parseFlac(input).metadata;
    assert.equal(metadata.streamInfo.sampleRate, 0);
    assert.equal(metadata.streamInfo.duration, undefined);
    assert.deepEqual(metadata.toBuffer(), input);
});
test('indexed PNG palette count and grayscale JPEG precision are derived from headers', () => {
    const png = Buffer.alloc(33 + 12 + 6);
    Buffer.from('89504e470d0a1a0a', 'hex').copy(png);
    png.writeUInt32BE(13, 8);
    png.write('IHDR', 12);
    png.writeUInt32BE(1, 16);
    png.writeUInt32BE(1, 20);
    png[24] = 1;
    png[25] = 3;
    png.writeUInt32BE(6, 33);
    png.write('PLTE', 37);
    const picture = createPicture(png);
    assert.equal(picture.depth, 1);
    assert.equal(picture.colors, 2);
    assert.throws(() => createPicture(png.subarray(0, 33)), FlacError);
    png[24] = 16;
    assert.throws(() => createPicture(png), FlacError);
    // Header-only dimension fixtures exercise the adapter, not full image decoding.
    const jpeg = Buffer.from([255, 216, 255, 192, 0, 11, 8, 0, 1, 0, 1, 1, 1, 17, 0, 255, 217]);
    assert.equal(createPicture(jpeg).depth, 8);
});
