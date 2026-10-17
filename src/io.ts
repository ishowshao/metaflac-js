import { open, realpath, rename, unlink, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { FlacMetadata, limits, type ParseOptions } from './core/metadata.js';
import { check } from './core/errors.js';
import type { RawBlock } from './core/blocks.js';

export interface FileOptions extends ParseOptions {
    signal?: AbortSignal;
}
export interface EditResult {
    readonly changed: boolean;
    readonly metadata: FlacMetadata;
}

async function readExactly(
    file: FileHandle,
    size: number,
    position: number,
    signal?: AbortSignal,
): Promise<Buffer> {
    const data = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
        signal?.throwIfAborted();
        const { bytesRead } = await file.read(data, offset, size - offset, position + offset);
        check(bytesRead > 0, 'TRUNCATED', 'Unexpected end of FLAC metadata.', position + offset);
        offset += bytesRead;
    }
    return data;
}
async function readHeader(
    file: FileHandle,
    options: FileOptions,
): Promise<{ metadata: FlacMetadata; audioOffset: number }> {
    const budget = limits(options),
        blocks: RawBlock[] = [];
    check(
        (await readExactly(file, 4, 0, options.signal)).equals(Buffer.from('fLaC')),
        'INVALID_FLAC',
        'Expected a native FLAC stream.',
    );
    let position = 4,
        last = false;
    while (!last) {
        check(blocks.length < budget.maxBlocks, 'LIMIT_EXCEEDED', 'Too many metadata blocks.');
        const header = await readExactly(file, 4, position, options.signal),
            length = header.readUIntBE(1, 3);
        position += 4;
        check(
            position + length <= budget.maxMetadataBytes,
            'LIMIT_EXCEEDED',
            'Metadata exceeds byte limit.',
        );
        const data = await readExactly(file, length, position, options.signal);
        blocks.push({ type: header[0]! & 127, data });
        last = (header[0]! & 128) !== 0;
        position += length;
    }
    return { metadata: FlacMetadata.fromBlocks(blocks, budget), audioOffset: position };
}
/** Reads only metadata, never the audio payload. */
export async function readMetadata(
    filename: string,
    options: FileOptions = {},
): Promise<FlacMetadata> {
    options.signal?.throwIfAborted();
    const file = await open(filename, 'r');
    try {
        return (await readHeader(file, options)).metadata;
    } finally {
        await file.close();
    }
}
function unchanged(before: Stats, after: Stats): boolean {
    return (
        before.dev === after.dev &&
        before.ino === after.ino &&
        before.size === after.size &&
        before.mtimeMs === after.mtimeMs &&
        before.ctimeMs === after.ctimeMs
    );
}
async function writeAll(file: FileHandle, data: Buffer): Promise<void> {
    let offset = 0;
    while (offset < data.length) {
        const { bytesWritten } = await file.write(data, offset, data.length - offset);
        check(bytesWritten > 0, 'UNSAFE_FILE', 'Unable to make progress writing the output file.');
        offset += bytesWritten;
    }
}
/** Transactional metadata edit. Audio is copied in 1 MiB chunks into a same-directory temporary file. */
export async function editFlac(
    filename: string,
    edit: (metadata: FlacMetadata) => unknown,
    options: FileOptions = {},
): Promise<EditResult> {
    options.signal?.throwIfAborted();
    const target = await realpath(filename),
        source = await open(target, 'r');
    let temporary: string | undefined, destination: FileHandle | undefined;
    try {
        const before = await source.stat();
        check(before.isFile(), 'UNSAFE_FILE', 'Expected a regular file.');
        const { metadata, audioOffset } = await readHeader(source, options),
            original = metadata.toBuffer();
        await edit(metadata);
        options.signal?.throwIfAborted();
        const encoded = metadata.toBuffer();
        check(
            unchanged(before, await source.stat()) && unchanged(before, await stat(target)),
            'FILE_CHANGED',
            'Source changed while editing.',
        );
        if (encoded.equals(original)) return { changed: false, metadata };
        check(
            before.nlink === 1,
            'UNSAFE_FILE',
            'Cannot atomically replace a file with multiple hard links.',
        );
        const candidate = join(dirname(target), `.metaflac-${randomBytes(12).toString('hex')}.tmp`);
        destination = await open(candidate, 'wx', before.mode & 0o777);
        temporary = candidate;
        await writeAll(destination, encoded);
        const chunk = Buffer.alloc(1024 * 1024);
        let position = audioOffset;
        while (position < before.size) {
            options.signal?.throwIfAborted();
            const { bytesRead } = await source.read(
                chunk,
                0,
                Math.min(chunk.length, before.size - position),
                position,
            );
            check(bytesRead > 0, 'FILE_CHANGED', 'Source was truncated during copy.');
            await writeAll(destination, chunk.subarray(0, bytesRead));
            position += bytesRead;
        }
        if (process.platform !== 'win32') {
            const created = await destination.stat();
            if (created.uid !== before.uid || created.gid !== before.gid)
                await destination.chown(before.uid, before.gid);
            await destination.chmod(before.mode & 0o777);
        }
        await destination.sync();
        await destination.close();
        destination = undefined;
        options.signal?.throwIfAborted();
        check(
            unchanged(before, await source.stat()) && unchanged(before, await stat(target)),
            'FILE_CHANGED',
            'Source changed during copy.',
        );
        await source.close();
        await rename(temporary, target);
        temporary = undefined;
        return { changed: true, metadata };
    } finally {
        await destination?.close();
        await source.close();
        if (temporary)
            await unlink(temporary).catch((error) => {
                if (error.code !== 'ENOENT') throw error;
            });
    }
}
