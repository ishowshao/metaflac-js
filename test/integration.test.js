const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Metaflac = require('..');
const { temp, run, fixture } = require('./helpers');
const cli = (...args) => run(process.execPath, [path.join(__dirname, '..', 'cli.js'), ...args]);
const meta = (...args) => run('metaflac', args);
function frames(file) { const m = new Metaflac(file); return m.buffer.subarray(m.framesOffset); }
function valid(file) { run('flac', ['--silent', '--test', file]); }

// Deliberately fail rather than skip when reference tools are missing.
test('official reference tools are installed', () => {
    assert.match(run('flac', ['--version']), /flac/i);
    assert.match(meta('--version'), /metaflac/i);
});
for (const [channels, bps] of [[1, 16], [2, 16], [2, 24], [6, 24]]) {
    test(`matches official STREAMINFO: ${channels} channels, ${bps} bits`, t => {
        const file = fixture(temp(t), channels, bps), flac = new Metaflac(file);
        const fields = { Md5sum: 'md5sum', MinBlocksize: 'min-blocksize', MaxBlocksize: 'max-blocksize',
            MinFramesize: 'min-framesize', MaxFramesize: 'max-framesize', SampleRate: 'sample-rate',
            Channels: 'channels', Bps: 'bps', TotalSamples: 'total-samples', VendorTag: 'vendor-tag' };
        for (const [method, option] of Object.entries(fields)) {
            assert.equal(String(flac[`get${method}`]()), meta(`--show-${option}`, file).trim());
            assert.equal(cli(`--show-${option}`, file), meta(`--show-${option}`, file));
        }
    });
}
test('tag edits agree with metaflac and preserve encoded audio', t => {
    const dir = temp(t), file = fixture(dir), reference = path.join(dir, 'reference.flac');
    fs.copyFileSync(file, reference); const audio = frames(file);
    const flac = new Metaflac(file);
    for (const tag of ['TITLE=中文😀', 'ARTIST=one', 'artist=two=three']) {
        flac.setTag(tag); meta(`--set-tag=${tag}`, reference);
    }
    flac.save();
    assert.equal(meta('--export-tags-to=-', file), meta('--export-tags-to=-', reference));
    assert.equal(flac.getTag('Artist') + '\n', meta('--show-tag=Artist', reference));
    flac.removeFirstTag('artist'); meta('--remove-first-tag=artist', reference); flac.save();
    assert.equal(meta('--export-tags-to=-', file), meta('--export-tags-to=-', reference));
    flac.removeTag('title'); meta('--remove-tag=title', reference); flac.save();
    assert.equal(meta('--export-tags-to=-', file), meta('--export-tags-to=-', reference));
    flac.removeAllTags(); meta('--remove-all-tags', reference); flac.save();
    assert.equal(meta('--export-tags-to=-', file), meta('--export-tags-to=-', reference));
    assert.deepEqual(frames(file), audio); valid(file);
});
test('metaflac accepts edits to files with no padding or only STREAMINFO', t => {
    const dir = temp(t), file = fixture(dir);
    for (const args of [['--remove', '--block-type=PADDING'], ['--remove-all']]) {
        meta(...args, '--dont-use-padding', file);
        const audio = frames(file), flac = new Metaflac(file);
        assert.equal(flac.padding, null);
        flac.setTag('TITLE=no padding'); flac.save();
        assert.equal(meta('--show-tag=TITLE', file).trim(), 'TITLE=no padding');
        assert.deepEqual(frames(file), audio); valid(file);
    }
});
test('CLI persists every tag mutation and matches official results', t => {
    const dir = temp(t), file = fixture(dir), reference = path.join(dir, 'reference.flac');
    fs.copyFileSync(file, reference); const audio = frames(file);
    const value = path.join(dir, 'value.txt'), tags = path.join(dir, 'tags.txt');
    fs.writeFileSync(value, '文字=值'); fs.writeFileSync(tags, 'ARTIST=first\nARTIST=second\n');
    const operations = [['--set-tag', 'TITLE=old'], ['--set-tag-from-file', `TITLE=${value}`],
        ['--import-tags-from', tags], ['--remove-first-tag', 'artist'], ['--remove-tag', 'title'], ['--remove-all-tags']];
    for (const args of operations) {
        cli(...args, file);
        meta(args.length === 2 ? `${args[0]}=${args[1]}` : args[0], reference);
        assert.equal(meta('--export-tags-to=-', file), meta('--export-tags-to=-', reference), args[0]);
        assert.deepEqual(frames(file), audio); valid(file);
    }
    cli('--set-tag', 'TITLE=new', '--import-tags-from', tags, file);
    assert.equal(meta('--show-tag=TITLE', file).trim(), 'TITLE=new');
    assert.equal(meta('--show-tag=ARTIST', file), 'ARTIST=first\nARTIST=second\n');
    const exported = path.join(dir, 'export.txt');
    cli('--export-tags-to', exported, file);
    assert.equal(fs.readFileSync(exported, 'utf8') + '\n', meta('--export-tags-to=-', file));
});
test('CLI read-only and failed operations leave original bytes untouched', t => {
    const dir = temp(t), file = fixture(dir), before = fs.readFileSync(file);
    cli('--show-sample-rate', file);
    assert.deepEqual(fs.readFileSync(file), before);
    assert.throws(() => cli('--set-tag', 'TITLE=unsaved', '--import-picture-from', path.join(dir, 'missing.jpg'), file));
    assert.deepEqual(fs.readFileSync(file), before);
});
test('JPEG/PNG and Unicode picture descriptions interoperate with metaflac', t => {
    const dir = temp(t), file = fixture(dir), audio = frames(file);
    const jpeg = path.join(__dirname, 'small.jpg');
    const png = path.join(dir, 'pixel.png');
    fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64'));
    cli('--import-picture-from', jpeg, file);
    const flac = new Metaflac(file); flac.importPictureFrom(png);
    const description = '封面😀';
    flac.pictures.push(flac.buildPictureBlock(fs.readFileSync(jpeg),
        flac.buildSpecification({ ...flac.getPicturesSpecs()[0], description })));
    flac.save();
    const listing = meta('--list', '--block-type=PICTURE', file);
    assert.match(listing, /image\/jpeg/); assert.match(listing, /image\/png/); assert.ok(listing.includes(description));
    assert.equal(new Metaflac(file).getPicturesSpecs().length, 3);
    const official = path.join(dir, 'official.jpg'), ours = path.join(dir, 'ours.jpg');
    meta(`--export-picture-to=${official}`, file); cli('--export-picture-to', ours, file);
    assert.deepEqual(fs.readFileSync(official), fs.readFileSync(jpeg));
    assert.deepEqual(fs.readFileSync(ours), fs.readFileSync(official));
    assert.deepEqual(frames(file), audio); valid(file);
    // Parse a picture written by the reference tool as well.
    const reference = fixture(dir, 1, 16);
    meta(`--import-picture-from=3|image/jpeg|${description}|32x32x24|${jpeg}`, reference);
    assert.equal(new Metaflac(reference).getPicturesSpecs()[0].description, description);
});

test('36-bit STREAMINFO count agrees with metaflac at integer boundaries', t => {
    const dir = temp(t), file = fixture(dir);
    const buffer = fs.readFileSync(file);
    for (const count of [0x7fffffff, 0x80000000, 0x100000001, 0xfffffffff]) {
        const packed = buffer.readBigUInt64BE(18);
        buffer.writeBigUInt64BE((packed & ~0xfffffffffn) | BigInt(count), 18);
        fs.writeFileSync(file, buffer);
        assert.equal(new Metaflac(file).getTotalSamples(), Number(meta('--show-total-samples', file).trim()));
    }
    // These deliberately patched metadata values do not describe the actual PCM.
    // Audio validity is tested with unmodified STREAMINFO in the other fixtures.
});
