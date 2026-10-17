const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readMetadata } = require('../dist');
const { fixture, temp, run } = require('./helpers.cjs');
const cli = (...args) => run(process.execPath, [path.join(__dirname, '../dist/cli.js'), ...args]);
test('CLI info reports correct structured metadata', (t) => {
    const file = fixture(temp(t), 2, 24),
        json = JSON.parse(cli('info', file, '--json'));
    assert.equal(json.channels, 2);
    assert.equal(json.bitsPerSample, 24);
    assert.equal(json.totalSamples, Number(run('metaflac', ['--show-total-samples', file])));
    assert.match(cli('--help'), /tags/);
    assert.equal(cli('--version').trim(), require('../package.json').version);
});
test('CLI mutations run in argument order and persist together', async (t) => {
    const dir = temp(t),
        file = fixture(dir);
    cli(
        'tags',
        file,
        '--set',
        'TITLE=old',
        '--append',
        'title=second',
        '--set',
        'TITLE=new',
        '--append',
        'TITLE=third',
        '--delete-first',
        'title',
    );
    assert.deepEqual((await readMetadata(file)).tags.getAll('TITLE'), ['third']);
    const tags = path.join(dir, 'tags.txt'),
        value = path.join(dir, 'value.txt');
    fs.writeFileSync(tags, 'ARTIST=a\r\nARTIST=b\r\n');
    fs.writeFileSync(value, '中文😀');
    cli('tags', file, '--import', tags, '--set-from-file', `TITLE=${value}`, '--delete', 'artist');
    assert.equal(cli('tags', file, '--get', 'title'), 'TITLE=中文😀\n');
    assert.deepEqual(JSON.parse(cli('tags', file, '--json')), [{ name: 'TITLE', value: '中文😀' }]);
    const exported = path.join(dir, 'out.txt');
    cli('tags', file, '--export', exported);
    assert.equal(fs.readFileSync(exported, 'utf8'), run('metaflac', ['--export-tags-to=-', file]));
    cli('tags', file, '--clear');
    assert.equal(cli('tags', file), '');
});
test('invalid late mutation and dangerous exports never overwrite source', (t) => {
    const dir = temp(t),
        file = fixture(dir),
        original = fs.readFileSync(file);
    assert.throws(() =>
        cli('tags', file, '--set', 'TITLE=unsaved', '--import', path.join(dir, 'missing')),
    );
    assert.deepEqual(fs.readFileSync(file), original);
    assert.throws(() => cli('tags', file, '--export', file));
    assert.throws(() => cli('tags', file, '--set', 'TITLE=unsaved', '--export', file));
    const hard = path.join(dir, 'hard');
    fs.linkSync(file, hard);
    assert.throws(() => cli('tags', file, '--export', hard));
    assert.deepEqual(fs.readFileSync(file), original);
});
test('CLI pictures append, list, export and remove', async (t) => {
    const dir = temp(t),
        file = fixture(dir),
        jpeg = path.join(__dirname, 'small.jpg'),
        output = path.join(dir, 'output.jpg');
    const listed = JSON.parse(cli('pictures', file, '--add', jpeg, '--description', '封面😀'));
    assert.equal(listed[0].description, '封面😀');
    cli('pictures', file, '--export', output);
    assert.deepEqual(fs.readFileSync(output), fs.readFileSync(jpeg));
    cli('pictures', file, '--add', jpeg, '--remove', '0');
    assert.equal((await readMetadata(file)).pictures.length, 1);
    cli('pictures', file, '--clear');
    assert.equal((await readMetadata(file)).pictures.length, 0);
    assert.throws(() => cli('pictures', file, '--remove', 'nope'));
    run('flac', ['--silent', '--test', file]);
});
