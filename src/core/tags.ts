import { check } from './errors.js';
import { encodeText } from './binary.js';

export interface Tag {
    readonly name: string;
    readonly value: string;
}
export function validateName(name: string): void {
    check(
        typeof name === 'string' && /^[\x20-\x3c\x3e-\x7e]+$/.test(name),
        'INVALID_ARGUMENT',
        'Tag names must be nonempty printable ASCII excluding =.',
    );
}
export function splitTag(field: string): Tag {
    const separator = field.indexOf('=');
    check(separator > 0, 'INVALID_METADATA', 'Expected a NAME=VALUE comment.');
    const name = field.slice(0, separator);
    validateName(name);
    return { name, value: field.slice(separator + 1) };
}

/** Ordered, case-insensitive multi-value tags. All returned entries are copies. */
export class Tags implements Iterable<Tag> {
    #entries: Tag[];
    #changed: () => void;
    constructor(entries: Iterable<Tag> = [], onChange: () => void = () => {}) {
        this.#entries = Array.from(entries, ({ name, value }) => {
            validateName(name);
            encodeText(value);
            return { name, value };
        });
        this.#changed = onChange;
    }
    get size(): number {
        return this.#entries.length;
    }
    get(name: string): string | undefined {
        return this.getAll(name)[0];
    }
    getAll(name: string): string[] {
        validateName(name);
        return this.#entries
            .filter((tag) => tag.name.toUpperCase() === name.toUpperCase())
            .map((tag) => tag.value);
    }
    has(name: string): boolean {
        return this.getAll(name).length > 0;
    }
    append(name: string, value: string): this {
        validateName(name);
        encodeText(value);
        this.#entries.push({ name, value });
        this.#changed();
        return this;
    }
    /** Replace every matching value at the first matching position, or append if absent. */
    set(name: string, value: string | readonly string[]): this {
        validateName(name);
        const values = typeof value === 'string' ? [value] : [...value];
        values.forEach(encodeText);
        const index = this.#entries.findIndex(
            (tag) => tag.name.toUpperCase() === name.toUpperCase(),
        );
        const entries = this.#entries.filter(
            (tag) => tag.name.toUpperCase() !== name.toUpperCase(),
        );
        entries.splice(
            index < 0 ? entries.length : index,
            0,
            ...values.map((value) => ({ name, value })),
        );
        if (JSON.stringify(entries) !== JSON.stringify(this.#entries)) {
            this.#entries = entries;
            this.#changed();
        }
        return this;
    }
    delete(name: string, options: { firstOnly?: boolean } = {}): number {
        validateName(name);
        let removed = 0;
        this.#entries = this.#entries.filter((tag) => {
            if (tag.name.toUpperCase() !== name.toUpperCase() || (options.firstOnly && removed))
                return true;
            removed++;
            return false;
        });
        if (removed) this.#changed();
        return removed;
    }
    clear(): void {
        if (this.size) {
            this.#entries = [];
            this.#changed();
        }
    }
    entries(): Tag[] {
        return this.#entries.map((tag) => ({ ...tag }));
    }
    [Symbol.iterator](): Iterator<Tag> {
        return this.entries()[Symbol.iterator]();
    }
}
