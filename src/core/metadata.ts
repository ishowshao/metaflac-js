import {
    BlockType,
    type Picture,
    type RawBlock,
    type StreamInfo,
    encodeBlock,
    readComments,
    readPicture,
    streamInfo,
    writeComments,
    writePicture,
} from './blocks.js';
import { encodeText } from './binary.js';
import { check } from './errors.js';
import { Tags } from './tags.js';

export interface ParseOptions {
    maxMetadataBytes?: number;
    maxBlocks?: number;
}
export const DEFAULT_LIMITS = Object.freeze({
    maxMetadataBytes: 64 * 1024 * 1024,
    maxBlocks: 4096,
});
export function limits(options: ParseOptions = {}): Required<ParseOptions> {
    const result = { ...DEFAULT_LIMITS, ...options };
    check(
        Number.isSafeInteger(result.maxMetadataBytes) &&
            result.maxMetadataBytes >= 42 &&
            Number.isSafeInteger(result.maxBlocks) &&
            result.maxBlocks > 0,
        'INVALID_ARGUMENT',
        'Invalid metadata limits.',
    );
    return result;
}

/** Editable metadata. Unknown blocks and unedited known blocks retain their original bytes. */
export class FlacMetadata {
    #blocks: RawBlock[];
    #vendor = '';
    #commentsChanged = false;
    #limits: Required<ParseOptions>;
    readonly tags: Tags;
    readonly streamInfo: StreamInfo;

    private constructor(blocks: readonly RawBlock[], options: ParseOptions) {
        this.#limits = limits(options);
        check(
            blocks.length > 0 && blocks[0]?.type === BlockType.StreamInfo,
            'INVALID_METADATA',
            'STREAMINFO must be the first block.',
        );
        check(
            blocks.length <= this.#limits.maxBlocks,
            'LIMIT_EXCEEDED',
            'Too many metadata blocks.',
        );
        check(
            4 + blocks.reduce((size, block) => size + 4 + block.data.length, 0) <=
                this.#limits.maxMetadataBytes,
            'LIMIT_EXCEEDED',
            'Metadata exceeds the configured byte limit.',
        );
        this.#blocks = blocks.map((block) => ({ type: block.type, data: Buffer.from(block.data) }));
        const seen = new Set<number>(),
            icons = new Set<number>();
        let comments: ReturnType<typeof readComments> = { vendor: '', tags: [] };
        for (const block of this.#blocks) {
            check(
                Number.isInteger(block.type) &&
                    block.type >= 0 &&
                    block.type < 127 &&
                    block.data.length <= 0xffffff,
                'INVALID_METADATA',
                'Invalid metadata block type or length.',
            );
            if ([0, 3, 4, 5].includes(block.type)) {
                check(
                    !seen.has(block.type),
                    'INVALID_METADATA',
                    `Duplicate singleton metadata block ${block.type}.`,
                );
                seen.add(block.type);
            }
            if (block.type === BlockType.VorbisComment) comments = readComments(block.data);
            if (block.type === BlockType.Picture) {
                const picture = readPicture(block.data);
                if (picture.type === 1 || picture.type === 2) {
                    check(
                        !icons.has(picture.type),
                        'INVALID_METADATA',
                        'Duplicate picture icon type.',
                    );
                    icons.add(picture.type);
                }
            }
            if (block.type === BlockType.Application)
                check(
                    block.data.length >= 4,
                    'INVALID_METADATA',
                    'APPLICATION requires a four-byte identifier.',
                );
            if (block.type === BlockType.SeekTable)
                check(
                    block.data.length % 18 === 0,
                    'INVALID_METADATA',
                    'SEEKTABLE length must be a multiple of 18.',
                );
        }
        this.streamInfo = streamInfo(this.#blocks[0]!.data);
        this.#vendor = comments.vendor;
        this.tags = new Tags(comments.tags, () => {
            this.#commentsChanged = true;
        });
    }
    static fromBlocks(blocks: readonly RawBlock[], options: ParseOptions = {}): FlacMetadata {
        return new FlacMetadata(blocks, options);
    }
    get vendor(): string {
        return this.#vendor;
    }
    set vendor(value: string) {
        encodeText(value);
        if (value !== this.#vendor) {
            this.#vendor = value;
            this.#commentsChanged = true;
        }
    }
    /** Detached copies of the current blocks, including pending tag changes. */
    get blocks(): RawBlock[] {
        return this.#currentBlocks().map((block) => ({
            type: block.type,
            data: Buffer.from(block.data),
        }));
    }
    get pictures(): Picture[] {
        return this.#blocks
            .filter((block) => block.type === BlockType.Picture)
            .map((block) => readPicture(block.data));
    }
    addPicture(picture: Picture): this {
        const data = writePicture(picture);
        check(data.length <= 0xffffff, 'LIMIT_EXCEEDED', 'Picture exceeds FLAC block size.');
        if (picture.type === 1 || picture.type === 2)
            check(
                !this.pictures.some((item) => item.type === picture.type),
                'INVALID_ARGUMENT',
                'Only one picture of each icon type is allowed.',
            );
        // Keep existing order; insert before trailing padding if present.
        let index = this.#blocks.length;
        while (index > 0 && this.#blocks[index - 1]!.type === BlockType.Padding) index--;
        this.#blocks.splice(index, 0, { type: BlockType.Picture, data });
        return this;
    }
    removePicture(index: number): void {
        const positions = this.#blocks.flatMap((block, i) =>
            block.type === BlockType.Picture ? [i] : [],
        );
        check(
            Number.isInteger(index) && index >= 0 && index < positions.length,
            'INVALID_ARGUMENT',
            'Picture index is out of range.',
        );
        this.#blocks.splice(positions[index]!, 1);
    }
    clearPictures(): void {
        this.#blocks = this.#blocks.filter((block) => block.type !== BlockType.Picture);
    }
    #currentBlocks(): RawBlock[] {
        const blocks = [...this.#blocks];
        if (this.#commentsChanged) {
            const replacement = {
                type: BlockType.VorbisComment,
                data: writeComments(this.#vendor, this.tags),
            };
            const index = blocks.findIndex((block) => block.type === BlockType.VorbisComment);
            if (index < 0) blocks.splice(1, 0, replacement);
            else blocks[index] = replacement;
        }
        return blocks;
    }
    /** Includes the fLaC marker and last-block flags, but no audio frames. */
    toBuffer(): Buffer {
        const blocks = this.#currentBlocks();
        check(
            blocks.length <= this.#limits.maxBlocks &&
                4 + blocks.reduce((n, block) => n + 4 + block.data.length, 0) <=
                    this.#limits.maxMetadataBytes,
            'LIMIT_EXCEEDED',
            'Encoded metadata exceeds configured limits.',
        );
        return Buffer.concat([
            Buffer.from('fLaC'),
            ...blocks.map((block, i) => encodeBlock(block, i === blocks.length - 1)),
        ]);
    }
}

export function parseMetadata(
    input: Uint8Array,
    options: ParseOptions = {},
): { metadata: FlacMetadata; audioOffset: number } {
    const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength),
        budget = limits(options);
    check(
        bytes.subarray(0, 4).equals(Buffer.from('fLaC')),
        'INVALID_FLAC',
        'Expected a native FLAC stream.',
    );
    const blocks: RawBlock[] = [];
    let offset = 4,
        last = false;
    while (!last) {
        check(offset + 4 <= bytes.length, 'TRUNCATED', 'Truncated metadata header.', offset);
        check(
            blocks.length < budget.maxBlocks,
            'LIMIT_EXCEEDED',
            'Too many metadata blocks.',
            offset,
        );
        const header = bytes[offset]!,
            length = bytes.readUIntBE(offset + 1, 3);
        last = (header & 128) !== 0;
        offset += 4;
        check(
            offset + length <= budget.maxMetadataBytes,
            'LIMIT_EXCEEDED',
            'Metadata exceeds byte limit.',
            offset,
        );
        check(offset + length <= bytes.length, 'TRUNCATED', 'Truncated metadata block.', offset);
        blocks.push({ type: header & 127, data: bytes.subarray(offset, offset + length) });
        offset += length;
    }
    return { metadata: FlacMetadata.fromBlocks(blocks, budget), audioOffset: offset };
}
export function parseFlac(
    input: Uint8Array,
    options: ParseOptions = {},
): { metadata: FlacMetadata; audio: Buffer } {
    const { metadata, audioOffset } = parseMetadata(input, options);
    return { metadata, audio: Buffer.from(input.subarray(audioOffset)) };
}
export function encodeFlac(metadata: FlacMetadata, audio: Uint8Array): Buffer {
    return Buffer.concat([metadata.toBuffer(), audio]);
}
