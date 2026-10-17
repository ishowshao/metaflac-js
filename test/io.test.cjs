const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { readMetadata, editFlac, parseFlac, FlacError } = require('../dist');
const { createPicture } = require('../dist/images');
const { fixture, temp, run, stream } = require('./helpers.cjs');
const meta = (...args) => run('metaflac', args);
const audio = (file) => parseFlac(fs.readFileSync(file)).audio;
const valid = (file) => run('flac', ['--silent', '--test', file]);
test('official tools are required', () => {
    assert.match(run('flac', ['--version']), /flac/i);
    assert.match(meta('--version'), /metaflac/i);
});
for (const [channels, bits] of [
    [1, 16],
    [2, 16],
    [2, 24],
    [6, 24],
]) {
    test(`official STREAMINFO cross-check: ${channels}/${bits}`, async (t) => {
        const file = fixture(temp(t), channels, bits),
            { streamInfo, vendor } = await readMetadata(file);
        const fields = {
            md5: 'md5sum',
            minBlockSize: 'min-blocksize',
            maxBlockSize: 'max-blocksize',
            minFrameSize: 'min-framesize',
            maxFrameSize: 'max-framesize',
            sampleRate: 'sample-rate',
            channels: 'channels',
            bitsPerSample: 'bps',
            totalSamples: 'total-samples',
        };
        for (const [field, flag] of Object.entries(fields))
            assert.equal(String(streamInfo[field]), meta(`--show-${flag}`, file).trim());
        assert.equal(vendor, meta('--show-vendor-tag', file).trim());
    });
}
test('official tags agree after append, replace, remove-first and clear', async (t) => {
    const dir = temp(t),
        file = fixture(dir),
        reference = path.join(dir, 'reference.flac');
    fs.copyFileSync(file, reference);
    const before = audio(file);
    for (const tag of ['TITLE=中文😀', 'ARTIST=one', 'artist=two=three'])
        meta(`--set-tag=${tag}`, reference);
    await editFlac(file, (m) => {
        m.tags.append('TITLE', '中文😀').append('ARTIST', 'one').append('artist', 'two=three');
    });
    assert.equal(meta('--export-tags-to=-', file), meta('--export-tags-to=-', reference));
    await editFlac(file, (m) => {
        m.tags.delete('artist', { firstOnly: true });
    });
    meta('--remove-first-tag=artist', reference);
    assert.equal(meta('--export-tags-to=-', file), meta('--export-tags-to=-', reference));
    await editFlac(file, (m) => {
        m.tags.set('ARTIST', 'replacement');
    });
    meta('--remove-tag=ARTIST', '--set-tag=ARTIST=replacement', reference);
    // Replacement preserves the first matching position; compare this field's values.
    assert.equal(meta('--show-tag=ARTIST', file), meta('--show-tag=ARTIST', reference));
    await editFlac(file, (m) => m.tags.clear());
    meta('--remove-all-tags', reference);
    assert.equal(meta('--export-tags-to=-', file), meta('--export-tags-to=-', reference));
    assert.deepEqual(audio(file), before);
    valid(file);
});
test('no-op preserves the entire file and does not replace its inode', async (t) => {
    const file = fixture(temp(t)),
        before = fs.readFileSync(file),
        stat = fs.statSync(file);
    const result = await editFlac(file, () => {});
    assert.equal(result.changed, false);
    assert.deepEqual(fs.readFileSync(file), before);
    assert.equal(fs.statSync(file).ino, stat.ino);
});
test('metadata-only FLAC and no padding edit correctly', async (t) => {
    const file = fixture(temp(t)),
        before = audio(file);
    meta('--remove-all', '--dont-use-padding', file);
    await editFlac(file, (m) => {
        m.tags.set('TITLE', 'no padding');
    });
    assert.equal(meta('--show-tag=TITLE', file).trim(), 'TITLE=no padding');
    assert.deepEqual(audio(file), before);
    valid(file);
});
test('official picture import/export and Unicode descriptions', async (t) => {
    const dir = temp(t),
        file = fixture(dir),
        jpeg = path.join(__dirname, 'small.jpg'),
        out = path.join(dir, 'cover.jpg');
    const before = audio(file),
        picture = createPicture(fs.readFileSync(jpeg), { description: '封面😀' });
    await editFlac(file, (m) => {
        m.addPicture(picture).addPicture({ ...picture, type: 4 });
    });
    meta(`--export-picture-to=${out}`, file);
    assert.deepEqual(fs.readFileSync(out), fs.readFileSync(jpeg));
    assert.match(meta('--list', '--block-type=PICTURE', file), /封面😀/);
    assert.equal((await readMetadata(file)).pictures.length, 2);
    valid(file);
    assert.deepEqual(audio(file), before);
    const reference = fixture(dir, 1, 16);
    meta(
        `--import-picture-from=3|image/jpeg|封面😀|${picture.width}x${picture.height}x${picture.depth}|${jpeg}`,
        reference,
    );
    assert.deepEqual((await readMetadata(reference)).pictures[0], picture);
});
test('callback failure and cancellation do not alter files or leave temporary output', async (t) => {
    const dir = temp(t),
        file = fixture(dir),
        before = fs.readFileSync(file),
        names = fs.readdirSync(dir);
    await assert.rejects(
        editFlac(file, async (m) => {
            m.tags.set('TITLE', 'unsaved');
            throw Error('callback failed');
        }),
        /callback failed/,
    );
    const controller = new AbortController();
    await assert.rejects(
        editFlac(
            file,
            (m) => {
                m.tags.set('TITLE', 'unsaved');
                controller.abort();
            },
            { signal: controller.signal },
        ),
        { name: 'AbortError' },
    );
    await assert.rejects(readMetadata(file, { signal: controller.signal }), { name: 'AbortError' });
    assert.deepEqual(fs.readFileSync(file), before);
    assert.deepEqual(fs.readdirSync(dir), names);
});
test('detects concurrent in-place writes and pathname replacements', async (t) => {
    const dir = temp(t),
        file = fixture(dir);
    await assert.rejects(
        editFlac(file, (m) => {
            m.tags.set('TITLE', 'ours');
            fs.appendFileSync(file, 'external');
        }),
        (error) => error.code === 'FILE_CHANGED',
    );
    assert.ok(fs.readFileSync(file).subarray(-8).equals(Buffer.from('external')));
    await assert.rejects(
        editFlac(file, (m) => {
            m.tags.set('TITLE', 'ours');
            const next = path.join(dir, 'next');
            fs.writeFileSync(next, stream());
            fs.renameSync(next, file);
        }),
        (error) => error.code === 'FILE_CHANGED',
    );
    assert.deepEqual(fs.readFileSync(file), stream());
    assert.equal(fs.readdirSync(dir).filter((name) => name.startsWith('.metaflac-')).length, 0);
});
test(
    'mode and symlink targets are preserved; multiple hard links are rejected',
    { skip: process.platform === 'win32' },
    async (t) => {
        const dir = temp(t),
            file = fixture(dir),
            link = path.join(dir, 'link.flac');
        fs.chmodSync(file, 0o640);
        fs.symlinkSync(file, link);
        await editFlac(link, (m) => {
            m.tags.set('TITLE', 'linked');
        });
        assert.ok(fs.lstatSync(link).isSymbolicLink());
        assert.equal(fs.statSync(file).mode & 0o777, 0o640);
        fs.linkSync(file, path.join(dir, 'hard.flac'));
        const before = fs.readFileSync(file);
        await assert.rejects(
            editFlac(file, (m) => {
                m.tags.set('TITLE', 'new');
            }),
            (error) => error.code === 'UNSAFE_FILE',
        );
        assert.deepEqual(fs.readFileSync(file), before);
    },
);
test('read path obeys limits and rejects all truncated metadata prefixes', async (t) => {
    const dir = temp(t),
        file = path.join(dir, 'truncated.flac'),
        input = stream();
    for (let i = 0; i < input.length; i++) {
        fs.writeFileSync(file, input.subarray(0, i));
        await assert.rejects(readMetadata(file), FlacError);
    }
    fs.writeFileSync(
        file,
        Buffer.concat([input.subarray(0, 4), Buffer.from([0x80, 0xff, 0xff, 0xff])]),
    );
    await assert.rejects(
        readMetadata(file, { maxMetadataBytes: 1024 }),
        (error) => error.code === 'LIMIT_EXCEEDED',
    );
});
test('large audio payload is copied in bounded chunks without readFile', async (t) => {
    const dir = temp(t),
        file = path.join(dir, 'large.flac');
    const header = stream(),
        payload = Buffer.alloc(5 * 1024 * 1024 + 7, 0x5a);
    fs.writeFileSync(file, Buffer.concat([header, payload]));
    const readFile = fsp.readFile;
    fsp.readFile = () => {
        throw Error('whole-file read forbidden');
    };
    try {
        await editFlac(file, (m) => {
            m.tags.set('TITLE', 'large');
        });
    } finally {
        fsp.readFile = readFile;
    }
    assert.deepEqual(audio(file), payload);
});
test('rename and write failures clean up temporary output and preserve original', async (t) => {
    const dir = temp(t),
        file = fixture(dir),
        original = fs.readFileSync(file),
        names = fs.readdirSync(dir);
    const rename = fsp.rename;
    fsp.rename = async () => {
        throw Error('rename failed');
    };
    try {
        await assert.rejects(
            editFlac(file, (m) => {
                m.tags.set('TITLE', 'new');
            }),
            /rename failed/,
        );
    } finally {
        fsp.rename = rename;
    }
    assert.deepEqual(fs.readFileSync(file), original);
    assert.deepEqual(fs.readdirSync(dir), names);
    const open = fsp.open;
    fsp.open = async (...args) => {
        const handle = await open(...args);
        if (args[1] === 'wx')
            handle.write = async () => {
                throw Error('disk full');
            };
        return handle;
    };
    try {
        await assert.rejects(
            editFlac(file, (m) => {
                m.tags.set('TITLE', 'new');
            }),
            /disk full/,
        );
    } finally {
        fsp.open = open;
    }
    assert.deepEqual(fs.readFileSync(file), original);
    assert.deepEqual(fs.readdirSync(dir), names);
});
test('cancellation during audio copy removes temporary output', async (t) => {
    const dir = temp(t),
        file = path.join(dir, 'audio.flac');
    fs.writeFileSync(file, Buffer.concat([stream(), Buffer.alloc(2 * 1024 * 1024, 42)]));
    const original = fs.readFileSync(file),
        controller = new AbortController(),
        open = fsp.open;
    fsp.open = async (...args) => {
        const handle = await open(...args);
        if (args[1] === 'wx') {
            const write = handle.write.bind(handle);
            let count = 0;
            handle.write = async (...writeArgs) => {
                const result = await write(...writeArgs);
                if (++count === 2) controller.abort();
                return result;
            };
        }
        return handle;
    };
    try {
        await assert.rejects(
            editFlac(
                file,
                (m) => {
                    m.tags.set('TITLE', 'cancelled');
                },
                { signal: controller.signal },
            ),
            { name: 'AbortError' },
        );
    } finally {
        fsp.open = open;
    }
    assert.deepEqual(fs.readFileSync(file), original);
    assert.deepEqual(fs.readdirSync(dir), ['audio.flac']);
});
test('partial writes are retried until metadata and audio are complete', async (t) => {
    const dir = temp(t),
        file = fixture(dir),
        before = audio(file),
        open = fsp.open;
    fsp.open = async (...args) => {
        const handle = await open(...args);
        if (args[1] === 'wx') {
            const write = handle.write.bind(handle);
            handle.write = (buffer, offset, length) =>
                write(buffer, offset, Math.min(length, 4096));
        }
        return handle;
    };
    try {
        await editFlac(file, (m) => {
            m.tags.set('TITLE', 'partial');
        });
    } finally {
        fsp.open = open;
    }
    assert.equal((await readMetadata(file)).tags.get('TITLE'), 'partial');
    assert.deepEqual(audio(file), before);
    valid(file);
});
test('exclusive temporary-file creation failure never deletes a pre-existing file', async (t) => {
    const dir = temp(t),
        file = fixture(dir),
        before = fs.readFileSync(file),
        open = fsp.open;
    let collision;
    fsp.open = async (...args) => {
        if (args[1] === 'wx') {
            collision = args[0];
            fs.writeFileSync(collision, 'unrelated file');
        }
        return open(...args);
    };
    try {
        await assert.rejects(
            editFlac(file, (m) => {
                m.tags.set('TITLE', 'collision');
            }),
            (error) => error.code === 'EEXIST',
        );
    } finally {
        fsp.open = open;
    }
    assert.equal(fs.readFileSync(collision, 'utf8'), 'unrelated file');
    assert.deepEqual(fs.readFileSync(file), before);
});
test('PNG picture dimensions and depth match official metaflac import', async (t) => {
    const dir = temp(t),
        ours = fixture(dir),
        reference = fixture(dir, 1, 16);
    const png = path.join(dir, 'pixel.png');
    fs.writeFileSync(
        png,
        Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=',
            'base64',
        ),
    );
    const picture = createPicture(fs.readFileSync(png));
    await editFlac(ours, (m) => {
        m.addPicture(picture);
    });
    meta(`--import-picture-from=${png}`, reference);
    assert.deepEqual(
        (await readMetadata(ours)).pictures[0],
        (await readMetadata(reference)).pictures[0],
    );
    valid(ours);
});
test('36-bit sample counts agree with official metaflac above signed and unsigned 32-bit ranges', async (t) => {
    const file = fixture(temp(t)),
        bytes = fs.readFileSync(file);
    for (const count of [0x7fffffff, 0x80000000, 0x100000001, 0xfffffffff]) {
        const packed = bytes.readBigUInt64BE(18);
        bytes.writeBigUInt64BE((packed & ~0xfffffffffn) | BigInt(count), 18);
        fs.writeFileSync(file, bytes);
        assert.equal(
            (await readMetadata(file)).streamInfo.totalSamples,
            Number(meta('--show-total-samples', file)),
        );
    }
    // Deliberately patched counts do not represent these fixtures' actual audio duration.
});
