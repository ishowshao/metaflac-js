import { check } from './core/errors.js';
import type { Picture } from './core/blocks.js';

/** Optional JPEG/PNG convenience adapter. Core callers can provide explicit Picture fields. */
export function createPicture(
    input: Uint8Array,
    options: { type?: number; description?: string } = {},
): Picture {
    const data = Buffer.from(input);
    const png = data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
    const jpeg = data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255;
    check(png || jpeg, 'INVALID_ARGUMENT', 'Only JPEG and PNG are supported by createPicture.');
    let depth: number,
        width = 0,
        height = 0,
        colors = 0;
    if (png) {
        check(
            data.length >= 33 &&
                data.readUInt32BE(8) === 13 &&
                data.toString('ascii', 12, 16) === 'IHDR',
            'INVALID_ARGUMENT',
            'Invalid PNG header.',
        );
        width = data.readUInt32BE(16);
        height = data.readUInt32BE(20);
        const channels: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
        const colorType = data[25]!,
            bits = data[24]!;
        const allowedBits: Record<number, number[]> = {
            0: [1, 2, 4, 8, 16],
            2: [8, 16],
            3: [1, 2, 4, 8],
            4: [8, 16],
            6: [8, 16],
        };
        check(
            allowedBits[colorType]?.includes(bits) &&
                data[26] === 0 &&
                data[27] === 0 &&
                data[28]! <= 1,
            'INVALID_ARGUMENT',
            'Invalid PNG color format.',
        );
        depth = bits * channels[colorType]!;
        if (colorType === 3) {
            let offset = 33;
            while (offset + 12 <= data.length) {
                const length = data.readUInt32BE(offset);
                check(
                    offset + 12 + length <= data.length,
                    'INVALID_ARGUMENT',
                    'Truncated PNG chunk.',
                );
                if (data.toString('ascii', offset + 4, offset + 8) === 'PLTE') {
                    check(
                        length > 0 && length % 3 === 0 && length <= 768,
                        'INVALID_ARGUMENT',
                        'Invalid PNG palette.',
                    );
                    colors = length / 3;
                    break;
                }
                offset += length + 12;
            }
            check(colors > 0, 'INVALID_ARGUMENT', 'Indexed PNG is missing its palette.');
        }
    } else {
        // Find the SOF frame carrying precision and component count; never scan entropy data.
        let offset = 2;
        depth = 0;
        while (offset < data.length) {
            check(data[offset++] === 255, 'INVALID_ARGUMENT', 'Invalid JPEG segment.');
            while (data[offset] === 255) offset++;
            const marker = data[offset++];
            check(
                marker !== undefined &&
                    marker !== 0xda &&
                    marker !== 0xd9 &&
                    offset + 2 <= data.length,
                'INVALID_ARGUMENT',
                'JPEG frame header is missing.',
            );
            if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
            const length = data.readUInt16BE(offset);
            check(
                length >= 2 && offset + length <= data.length,
                'INVALID_ARGUMENT',
                'Truncated JPEG segment.',
            );
            if (
                [
                    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
                ].includes(marker)
            ) {
                check(
                    length >= 8 && length === 8 + 3 * data[offset + 7]!,
                    'INVALID_ARGUMENT',
                    'Invalid JPEG frame header.',
                );
                height = data.readUInt16BE(offset + 3);
                width = data.readUInt16BE(offset + 5);
                depth = data[offset + 2]! * data[offset + 7]!;
                break;
            }
            offset += length;
        }
        check(depth > 0, 'INVALID_ARGUMENT', 'JPEG depth could not be determined.');
    }
    check(width > 0 && height > 0, 'INVALID_ARGUMENT', 'Image dimensions must be positive.');
    return {
        type: options.type ?? 3,
        mimeType: png ? 'image/png' : 'image/jpeg',
        description: options.description ?? '',
        width,
        height,
        depth,
        colors,
        data,
    };
}
