const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Metaflac = require('..');
const formatComments = require('../lib/formatVorbisComment');
const { block, streamInfo, stream, temp } = require('./helpers');

for (const channels of [1, 2, 6, 8]) {
    for (const bps of [8, 16, 24, 32]) {
        test(`STREAMINFO: ${channels} channels / ${bps} bits / 36-bit sample count`, () => {
            for (const samples of [0, 44100, 0x80000000, 0x100000001, 0xfffffffff]) {
                const flac = new Metaflac(stream([], streamInfo(channels, bps, samples)));
                assert.equal(flac.getChannels(), channels);
                assert.equal(flac.getBps(), bps);
                assert.equal(flac.getTotalSamples(), samples);
                assert.equal(flac.getSampleRate(), 44100);
                assert.equal(flac.framesOffset, 42);
            }
        });
    }
}
test('STREAMINFO-only files save without padding and retain their audio bytes', () => {
    const audio = Buffer.from([255, 248, 1, 2, 3]);
    const flac = new Metaflac(Buffer.concat([stream(), audio]));
    flac.setTag('TITLE=你好');
    const output = flac.save();
    assert.ok(Buffer.isBuffer(output));
    const parsed = new Metaflac(output);
    assert.equal(parsed.getTag('title'), 'TITLE=你好');
    assert.deepEqual(output.subarray(parsed.framesOffset), audio);
    assert.deepEqual(flac.save(), output);
});
test('tag API preserves append, full-field string, duplicate order and case-insensitive removal', () => {
    const flac = new Metaflac(stream());
    flac.setTag('ARTIST=one'); flac.setTag('artist=two=three'); flac.setTag('TITLE=中文😀');
    assert.equal(flac.getTag('Artist'), 'ARTIST=one\nartist=two=three');
    flac.removeFirstTag('artist');
    assert.equal(flac.getTag('ARTIST'), 'artist=two=three');
    flac.removeTag('ARTIST');
    assert.deepEqual(new Metaflac(flac.save()).getAllTags(), ['TITLE=中文😀']);
    flac.removeAllTags();
    assert.deepEqual(flac.getAllTags(), []);
    for (const tag of ['bad', '=empty', '非ASCII=x', 'A\nB=x']) assert.throws(() => flac.setTag(tag), /Malformed/);
});
test('imports CRLF/trailing newline tags and preserves vendor', t => {
    const dir = temp(t), file = path.join(dir, 'tags.txt');
    fs.writeFileSync(file, 'TITLE=中文\r\nARTIST=a\r\n\r\n');
    const flac = new Metaflac(stream([[4, formatComments('vendor中文', [])]]));
    flac.importTagsFrom(file);
    assert.deepEqual(flac.tags, ['TITLE=中文', 'ARTIST=a']);
    const out = new Metaflac(flac.save());
    assert.equal(out.getVendorTag(), 'vendor中文');
    assert.deepEqual(out.tags, flac.tags);
    fs.writeFileSync(file, 'TITLE=valid\ninvalid');
    assert.throws(() => flac.importTagsFrom(file));
    assert.deepEqual(flac.tags, out.tags);
});
test('preserves opaque metadata including reserved types', () => {
    const blocks = [2, 3, 5, 7, 126].map(type => [type, Buffer.from([type, 1, 2, 3])]);
    const flac = new Metaflac(stream(blocks));
    assert.deepEqual(new Metaflac(flac.save()).blocks, blocks);
});
test('rejects malformed metadata before any save', () => {
    const comments = formatComments('vendor', ['TITLE=test']);
    const cases = [Buffer.from([0xe6, 0x4c, 0x61, 0x43]), Buffer.alloc(0), Buffer.from('fLaC'), stream().subarray(0, 20),
        Buffer.concat([Buffer.from('fLaC'), block(1, Buffer.alloc(0), true)]),
        stream([[0, streamInfo()]]), stream([], Buffer.alloc(33)), stream([[127, Buffer.alloc(0)]]),
        stream([[4, comments], [4, comments]]), stream([[4, comments.subarray(0, comments.length - 1)]]),
        stream([[4, Buffer.concat([comments, Buffer.from([0])])]]), stream([[6, Buffer.alloc(3)]])];
    for (const data of cases) assert.throws(() => new Metaflac(data));
    const countMismatch = Buffer.from(comments); countMismatch.writeUInt32LE(0, 10);
    assert.throws(() => new Metaflac(stream([[4, countMismatch]])), /trailing/);
    const missingLast = stream(); missingLast[4] = 0;
    assert.throws(() => new Metaflac(missingLast), /header/);
    assert.throws(() => new Metaflac(stream()).buildMetadataBlock(1, Buffer.alloc(0x1000000)), /maximum/);
});
test('multiple pictures, Unicode descriptions and immediate export', t => {
    const dir = temp(t), file = path.join(dir, 'cover.jpg');
    const picture = fs.readFileSync(path.join(__dirname, 'small.jpg'));
    const flac = new Metaflac(stream());
    flac.importPictureFromBuffer(picture);
    flac.exportPictureTo(file);
    assert.deepEqual(fs.readFileSync(file), picture);
    flac.importPictureFrom(file);
    const spec = flac.buildSpecification({ description: '封面😀', width: 32, height: 32 });
    flac.pictures.push(flac.buildPictureBlock(picture, spec));
    const reread = new Metaflac(flac.save());
    assert.equal(reread.getPicturesSpecs().length, 3);
    assert.equal(reread.getPicturesSpecs()[2].description, '封面😀');
    reread.parsePictureBlock();
    assert.equal(reread.picturesDatas.length, 3);
    for (const input of [Buffer.alloc(0), Buffer.from('GIF89a'), Buffer.from([255, 216, 255])]) {
        assert.throws(() => flac.importPictureFromBuffer(input));
    }
});
test('atomic save preserves mode and original data on rename failure', t => {
    const dir = temp(t), file = path.join(dir, 'audio.flac');
    const input = stream(); fs.writeFileSync(file, input, { mode: 0o640 });
    const flac = new Metaflac(file); flac.setTag('TITLE=updated');
    const rename = fs.renameSync;
    fs.renameSync = () => { throw new Error('simulated rename failure'); };
    try { assert.throws(() => flac.save(), /simulated/); } finally { fs.renameSync = rename; }
    assert.deepEqual(fs.readFileSync(file), input);
    assert.deepEqual(fs.readdirSync(dir), ['audio.flac']);
    assert.equal(flac.save(), undefined);
    assert.equal(new Metaflac(file).getTag('TITLE'), 'TITLE=updated');
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o640);
});
test('save follows symlinks and rejects hard links without data loss', { skip: process.platform === 'win32' }, t => {
    const dir = temp(t), file = path.join(dir, 'audio.flac'), link = path.join(dir, 'link.flac');
    fs.writeFileSync(file, stream()); fs.symlinkSync(file, link);
    const flac = new Metaflac(link); flac.setTag('TITLE=link'); flac.save();
    assert.ok(fs.lstatSync(link).isSymbolicLink());
    assert.equal(new Metaflac(file).getTag('TITLE'), 'TITLE=link');
    fs.linkSync(file, path.join(dir, 'hard.flac'));
    const before = fs.readFileSync(file);
    assert.throws(() => flac.save(), /hard links/);
    assert.deepEqual(fs.readFileSync(file), before);
});

test('failed temporary-file writes preserve the original and clean up', t => {
    const dir = temp(t), file = path.join(dir, 'audio.flac');
    const input = stream(); fs.writeFileSync(file, input);
    const flac = new Metaflac(file); flac.setTag('TITLE=updated');
    const write = fs.writeFileSync;
    fs.writeFileSync = (destination, ...args) => {
        if (typeof destination === 'number') throw new Error('simulated disk full');
        return write(destination, ...args);
    };
    try { assert.throws(() => flac.save(), /disk full/); } finally { fs.writeFileSync = write; }
    assert.deepEqual(fs.readFileSync(file), input);
    assert.deepEqual(fs.readdirSync(dir), ['audio.flac']);
});
