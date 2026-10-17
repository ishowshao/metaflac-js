import { Reader, encodeText, sized, uint32 } from './binary.js';
import { check } from './errors.js';
import { splitTag, type Tag } from './tags.js';

export enum BlockType {
    StreamInfo = 0,
    Padding = 1,
    Application = 2,
    SeekTable = 3,
    VorbisComment = 4,
    CueSheet = 5,
    Picture = 6,
}
export interface RawBlock {
    readonly type: number;
    readonly data: Buffer;
}
export interface StreamInfo {
    readonly minBlockSize: number;
    readonly maxBlockSize: number;
    readonly minFrameSize: number;
    readonly maxFrameSize: number;
    readonly sampleRate: number;
    readonly channels: number;
    readonly bitsPerSample: number;
    readonly totalSamples: number;
    readonly md5: string;
    readonly duration: number | undefined;
}
export interface Picture {
    readonly type: number;
    readonly mimeType: string;
    readonly description: string;
    readonly width: number;
    readonly height: number;
    readonly depth: number;
    readonly colors: number;
    readonly data: Uint8Array;
}
export function streamInfo(data: Buffer): StreamInfo {
    check(data.length === 34, 'INVALID_METADATA', 'STREAMINFO must contain exactly 34 bytes.');
    const sampleRate = data.readUIntBE(10, 3) >>> 4;
    const totalSamples = (data[13]! & 15) * 0x100000000 + data.readUInt32BE(14);
    const bitsPerSample = ((data.readUInt16BE(12) >>> 4) & 31) + 1;
    check(
        data.readUInt16BE(0) >= 16 && data.readUInt16BE(2) >= data.readUInt16BE(0),
        'INVALID_METADATA',
        'Invalid STREAMINFO block sizes.',
    );
    check(bitsPerSample >= 4, 'INVALID_METADATA', 'Invalid STREAMINFO bit depth.');
    return Object.freeze({
        minBlockSize: data.readUInt16BE(0),
        maxBlockSize: data.readUInt16BE(2),
        minFrameSize: data.readUIntBE(4, 3),
        maxFrameSize: data.readUIntBE(7, 3),
        sampleRate,
        channels: ((data[12]! >>> 1) & 7) + 1,
        bitsPerSample,
        totalSamples,
        md5: data.subarray(18).toString('hex'),
        duration: totalSamples && sampleRate ? totalSamples / sampleRate : undefined,
    });
}
export function readComments(data: Buffer): { vendor: string; tags: Tag[] } {
    const reader = new Reader(data);
    const vendor = reader.text(true),
        count = reader.uint32(true),
        tags: Tag[] = [];
    check(
        count <= (data.length - reader.offset) / 4,
        'TRUNCATED',
        'Comment count exceeds the block length.',
    );
    for (let i = 0; i < count; i++) tags.push(splitTag(reader.text(true)));
    reader.end();
    return { vendor, tags };
}
export function writeComments(vendor: string, tags: Iterable<Tag>): Buffer {
    const fields = Array.from(tags, (tag) => sized(encodeText(`${tag.name}=${tag.value}`), true));
    return Buffer.concat([sized(encodeText(vendor), true), uint32(fields.length, true), ...fields]);
}
export function readPicture(data: Buffer): Picture {
    const reader = new Reader(data);
    const type = reader.uint32(),
        mimeType = reader.text(),
        description = reader.text();
    const width = reader.uint32(),
        height = reader.uint32(),
        depth = reader.uint32(),
        colors = reader.uint32();
    const picture = {
        type,
        mimeType,
        description,
        width,
        height,
        depth,
        colors,
        data: Buffer.from(reader.bytes(reader.uint32())),
    };
    reader.end();
    validatePicture(picture);
    return picture;
}
function validatePicture(picture: Picture): void {
    check(
        Number.isInteger(picture.type) && picture.type >= 0 && picture.type <= 20,
        'INVALID_ARGUMENT',
        'Picture type must be 0 through 20.',
    );
    check(
        /^[\x20-\x7e]+$/.test(picture.mimeType),
        'INVALID_ARGUMENT',
        'Picture MIME type must be printable ASCII.',
    );
    for (const value of [picture.width, picture.height, picture.depth, picture.colors])
        uint32(value);
    if (picture.type === 1)
        check(
            picture.mimeType === 'image/png' && picture.width === 32 && picture.height === 32,
            'INVALID_ARGUMENT',
            'Standard file icons must be 32x32 PNG images.',
        );
}
export function writePicture(picture: Picture): Buffer {
    validatePicture(picture);
    return Buffer.concat([
        uint32(picture.type),
        sized(encodeText(picture.mimeType)),
        sized(encodeText(picture.description)),
        ...[picture.width, picture.height, picture.depth, picture.colors].map((value) =>
            uint32(value),
        ),
        sized(Buffer.from(picture.data)),
    ]);
}
export function encodeBlock(block: RawBlock, last: boolean): Buffer {
    check(
        Number.isInteger(block.type) && block.type >= 0 && block.type <= 126,
        'INVALID_METADATA',
        'Invalid metadata block type.',
    );
    check(
        block.data.length <= 0xffffff,
        'LIMIT_EXCEEDED',
        'A metadata block cannot exceed 16777215 bytes.',
    );
    const header = Buffer.alloc(4);
    header[0] = block.type | (last ? 128 : 0);
    header.writeUIntBE(block.data.length, 1, 3);
    return Buffer.concat([header, block.data]);
}
