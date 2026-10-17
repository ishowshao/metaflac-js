import { check, FlacError } from './errors.js';

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
export function decodeText(bytes: Uint8Array): string {
    try {
        return decoder.decode(bytes);
    } catch {
        throw new FlacError('INVALID_METADATA', 'Invalid UTF-8 in metadata.');
    }
}
export function encodeText(value: string): Buffer {
    check(value.isWellFormed(), 'INVALID_ARGUMENT', 'Text contains an unpaired surrogate.');
    return Buffer.from(value, 'utf8');
}
export class Reader {
    offset = 0;
    constructor(readonly buffer: Buffer) {}
    bytes(length: number): Buffer {
        check(
            Number.isSafeInteger(length) &&
                length >= 0 &&
                length <= this.buffer.length - this.offset,
            'TRUNCATED',
            'Metadata field exceeds its block boundary.',
            this.offset,
        );
        const result = this.buffer.subarray(this.offset, this.offset + length);
        this.offset += length;
        return result;
    }
    uint32(littleEndian = false): number {
        const bytes = this.bytes(4);
        return littleEndian ? bytes.readUInt32LE() : bytes.readUInt32BE();
    }
    text(littleEndian = false): string {
        return decodeText(this.bytes(this.uint32(littleEndian)));
    }
    end(): void {
        check(
            this.offset === this.buffer.length,
            'INVALID_METADATA',
            'Unexpected trailing metadata bytes.',
            this.offset,
        );
    }
}
export function uint32(value: number, littleEndian = false): Buffer {
    check(
        Number.isInteger(value) && value >= 0 && value <= 0xffffffff,
        'INVALID_ARGUMENT',
        'Expected an unsigned 32-bit integer.',
    );
    const bytes = Buffer.alloc(4);
    if (littleEndian) bytes.writeUInt32LE(value);
    else bytes.writeUInt32BE(value);
    return bytes;
}
export function sized(bytes: Buffer, littleEndian = false): Buffer {
    return Buffer.concat([uint32(bytes.length, littleEndian), bytes]);
}
