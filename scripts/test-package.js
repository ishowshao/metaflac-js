const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { run, fixture } = require('../test/helpers');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metaflac-package-'));
try {
    const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', dir], { cwd: root, encoding: 'utf8' }))[0];
    const archive = path.join(dir, packed.filename);
    assert.ok(!packed.files.some(file => /^(test|scripts|\.github)\//.test(file.path)));
    const project = path.join(dir, 'consumer'); fs.mkdirSync(project);
    fs.writeFileSync(path.join(project, 'package.json'), '{"private":true}');
    execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', archive], { cwd: project, stdio: 'pipe' });
    const Metaflac = require(path.join(project, 'node_modules', 'metaflac-js'));
    const file = fixture(dir, 2, 24);
    const input = new Metaflac(file), audio = input.buffer.subarray(input.framesOffset);
    input.setTag('TITLE=Package 中文'); assert.equal(input.save(), undefined);
    const output = new Metaflac(fs.readFileSync(file));
    assert.equal(output.getBps(), 24); assert.equal(output.getChannels(), 2);
    assert.equal(output.getTag('title'), 'TITLE=Package 中文');
    assert.ok(Buffer.isBuffer(output.save()));
    assert.deepEqual(output.buffer.subarray(output.framesOffset), audio);
    const binary = path.join(project, 'node_modules', '.bin', 'metaflac-js');
    assert.equal(run(binary, ['--version']).trim(), require('../package.json').version);
    run(binary, ['--remove-tag', 'TITLE', file]);
    assert.equal(run('metaflac', ['--show-tag=TITLE', file]), '');
    run('flac', ['--silent', '--test', file]);
    console.log(`Fresh tarball installation passed: ${packed.filename} (${packed.integrity})`);
} finally {
    fs.rmSync(dir, { recursive: true, force: true });
}
