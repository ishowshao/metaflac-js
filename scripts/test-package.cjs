const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { fixture, run } = require('../test/helpers.cjs');
const root = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metaflac-v2-package-'));
(async () => {
    try {
        const packed = JSON.parse(
            cp.execFileSync('npm', ['pack', '--json', '--pack-destination', dir], {
                cwd: root,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
            }),
        )[0];
        assert.ok(!packed.files.some((file) => /^(src|test|scripts|\.github)\//.test(file.path)));
        const project = path.join(dir, 'consumer');
        fs.mkdirSync(project);
        fs.writeFileSync(path.join(project, 'package.json'), '{"private":true,"type":"module"}');
        cp.execFileSync(
            'npm',
            [
                'install',
                '--ignore-scripts',
                '--no-audit',
                '--no-fund',
                path.join(dir, packed.filename),
            ],
            { cwd: project, stdio: 'pipe' },
        );
        const file = fixture(dir, 2, 24);
        fs.writeFileSync(
            path.join(project, 'smoke.mjs'),
            `
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { readMetadata, editFlac, FlacMetadata, FlacError, parseFlac } from 'metaflac-js';
import * as core from 'metaflac-js/core';
import { createPicture } from 'metaflac-js/images';
const require = createRequire(import.meta.url);
assert.equal(FlacMetadata, require('metaflac-js').FlacMetadata);
assert.equal(FlacError, require('metaflac-js/core').FlacError);
assert.equal(core.FlacMetadata, FlacMetadata);
assert.equal(createPicture, require('metaflac-js/images').createPicture);
const file = process.argv[2];
const before = parseFlac(await readFile(file)).audio;
await editFlac(file, m => { m.tags.set('TITLE', 'Package 中文😀'); });
assert.equal((await readMetadata(file)).tags.get('title'), 'Package 中文😀');
assert.deepEqual(parseFlac(await readFile(file)).audio, before);
`,
        );
        run(process.execPath, [path.join(project, 'smoke.mjs'), file]);
        const binary = path.join(project, 'node_modules/.bin/metaflac-js');
        assert.equal(run(binary, ['--version']).trim(), require('../package.json').version);
        assert.equal(JSON.parse(run(binary, ['info', file, '--json'])).bitsPerSample, 24);
        run(binary, ['tags', file, '--delete', 'TITLE']);
        assert.equal(run('metaflac', ['--show-tag=TITLE', file]), '');
        run('flac', ['--silent', '--test', file]);
        // Validate published declaration resolution for BOTH module systems with the installed package.
        fs.symlinkSync(
            path.join(root, 'node_modules/@types'),
            path.join(project, 'node_modules/@types'),
            'dir',
        );
        const typeFixture = `import { FlacMetadata, readMetadata, editFlac, type Picture } from 'metaflac-js';
import { Tags, parseFlac, type StreamInfo } from 'metaflac-js/core';
import { createPicture } from 'metaflac-js/images';
const tags = new Tags(); tags.set('TITLE', ['a', 'b']);
const first: string | undefined = tags.get('TITLE');
const metadata: Promise<FlacMetadata> = readMetadata('audio.flac');
const picture: Picture = createPicture(new Uint8Array());
const info: StreamInfo = parseFlac(new Uint8Array()).metadata.streamInfo;
void editFlac('audio.flac', m => m.addPicture(picture));
// @ts-expect-error tag values must be strings
tags.set('TITLE', 123);
// @ts-expect-error stream information is read-only
info.channels = 3;
void first; void metadata;
`;
        fs.writeFileSync(path.join(project, 'types.mts'), typeFixture);
        fs.writeFileSync(path.join(project, 'types.cts'), typeFixture);
        cp.execFileSync(
            process.execPath,
            [
                path.join(root, 'node_modules/typescript/bin/tsc'),
                '--noEmit',
                '--strict',
                '--module',
                'nodenext',
                '--target',
                'es2022',
                '--skipLibCheck',
                'types.mts',
                'types.cts',
            ],
            { cwd: project, stdio: 'pipe' },
        );
        console.log(
            `Fresh ESM/CommonJS, CLI, TypeScript consumer checks passed: ${packed.filename}\n${packed.integrity}`,
        );
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
})().catch((error) => {
    console.error(error.stdout?.toString() || error);
    process.exitCode = 1;
});
