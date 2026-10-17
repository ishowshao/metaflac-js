export type FlacErrorCode =
    | 'INVALID_FLAC'
    | 'TRUNCATED'
    | 'INVALID_METADATA'
    | 'LIMIT_EXCEEDED'
    | 'INVALID_ARGUMENT'
    | 'FILE_CHANGED'
    | 'UNSAFE_FILE';

/** A format/domain error. Filesystem errors retain their native Node.js codes. */
export class FlacError extends Error {
    constructor(
        readonly code: FlacErrorCode,
        message: string,
        readonly offset?: number,
    ) {
        super(message);
        this.name = 'FlacError';
    }
}

export function check(
    condition: unknown,
    code: FlacErrorCode,
    message: string,
    offset?: number,
): asserts condition {
    if (!condition) throw new FlacError(code, message, offset);
}
