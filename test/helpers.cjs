const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function block(type, data, last = false) {
    const header = Buffer.alloc(4);
    header[0] = type | (last ? 128 : 0);
    header.writeUIntBE(data.length, 1, 3);
    return Buffer.concat([header, data]);
}
function streamInfo(channels = 2, bps = 16, samples = 44100) {
    const info = Buffer.alloc(34);
    info.writeUInt16BE(4096, 0);
    info.writeUInt16BE(4096, 2);
    info.writeBigUInt64BE(
        (44100n << 44n) |
            (BigInt(channels - 1) << 41n) |
            (BigInt(bps - 1) << 36n) |
            BigInt(samples),
        10,
    );
    return info;
}
function stream(blocks = [], info = streamInfo()) {
    const all = [[0, info], ...blocks];
    return Buffer.concat([
        Buffer.from('fLaC'),
        ...all.map(([type, data], i) => block(type, data, i === all.length - 1)),
    ]);
}
function temp(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metaflac-js-test-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}
function run(command, args) {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function fixture(dir, channels = 2, bps = 16) {
    const raw = path.join(dir, `${channels}-${bps}.raw`);
    const file = raw + '.flac';
    // Deterministic, non-silent PCM rather than a checked-in copyrighted recording.
    const pcm = Buffer.alloc((8192 * channels * bps) / 8);
    for (let i = 0; i < pcm.length; i++) pcm[i] = (i * 17 + (i >>> 8)) & 255;
    fs.writeFileSync(raw, pcm);
    run('flac', [
        '--silent',
        '--force',
        '--force-raw-format',
        '--endian=little',
        '--sign=signed',
        `--channels=${channels}`,
        `--bps=${bps}`,
        '--sample-rate=44100',
        '-o',
        file,
        raw,
    ]);
    return file;
}
module.exports = { block, streamInfo, stream, temp, run, fixture };
