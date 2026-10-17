#!/usr/bin/env node
import { Command, InvalidArgumentError } from 'commander';
import { readFile, writeFile, realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { editFlac, readMetadata } from './io.js';
import { FlacMetadata } from './core/metadata.js';
import { check } from './core/errors.js';
import { splitTag } from './core/tags.js';
import { createPicture } from './images.js';

type Operation = (metadata: FlacMetadata) => void | Promise<void>;
const program = new Command()
    .name('metaflac-js')
    .description('Read and edit native FLAC metadata without re-encoding audio.')
    .version(require('../package.json').version);
const number = (value: string): number => {
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
        throw new InvalidArgumentError('Expected a nonnegative integer.');
    return Number(value);
};
async function exportTo(filename: string, input: string, data: Uint8Array | string): Promise<void> {
    if (filename === '-') {
        process.stdout.write(data);
        return;
    }
    const source = await realpath(input);
    const output = await realpath(filename).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        return resolve(filename);
    });
    const sourceStat = await stat(source);
    const outputStat = await stat(output).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        return undefined;
    });
    check(
        source !== output &&
            !(outputStat && sourceStat.dev === outputStat.dev && sourceStat.ino === outputStat.ino),
        'INVALID_ARGUMENT',
        'Export destination must not be the source FLAC file.',
    );
    await writeFile(filename, data);
}
program
    .command('info <file>')
    .description('Show STREAMINFO and metadata summary.')
    .option('--json', 'Print JSON')
    .action(async (file: string, options: { json?: boolean }) => {
        const metadata = await readMetadata(file);
        const info = {
            ...metadata.streamInfo,
            vendor: metadata.vendor,
            tags: metadata.tags.entries(),
            pictures: metadata.pictures.map(({ data, ...picture }) => ({
                ...picture,
                size: data.byteLength,
            })),
        };
        if (options.json) console.log(JSON.stringify(info, null, 2));
        else
            for (const [key, value] of Object.entries(metadata.streamInfo))
                console.log(`${key}: ${value ?? 'unknown'}`);
    });
const tagOperations: Operation[] = [];
const tags = program
    .command('tags <file>')
    .description('List or edit tags; repeated mutation options run in argument order.')
    .option('--get <name>', 'List values for this field (complete NAME=VALUE lines)')
    .option('--set <field>', 'Replace all values: NAME=VALUE')
    .option('--append <field>', 'Append a value: NAME=VALUE')
    .option('--delete <name>', 'Delete all matching values')
    .option('--delete-first <name>', 'Delete the first matching value')
    .option('--clear', 'Remove all tags')
    .option('--set-from-file <field>', 'Replace with UTF-8 contents of NAME=PATH')
    .option('--import <path>', 'Append UTF-8 NAME=VALUE lines')
    .option('--export <path>', 'Export resulting tags; - means stdout')
    .option('--json', 'List tag entries as JSON');
tags.on('option:set', (field: string) => {
    const { name, value } = splitTag(field);
    tagOperations.push((m) => {
        m.tags.set(name, value);
    });
});
tags.on('option:append', (field: string) => {
    const { name, value } = splitTag(field);
    tagOperations.push((m) => {
        m.tags.append(name, value);
    });
});
tags.on('option:delete', (name: string) =>
    tagOperations.push((m) => {
        m.tags.delete(name);
    }),
);
tags.on('option:delete-first', (name: string) =>
    tagOperations.push((m) => {
        m.tags.delete(name, { firstOnly: true });
    }),
);
tags.on('option:clear', () => tagOperations.push((m) => m.tags.clear()));
tags.on('option:set-from-file', (field: string) => {
    const { name, value } = splitTag(field);
    tagOperations.push(async (m) => {
        m.tags.set(name, await readFile(value, 'utf8'));
    });
});
tags.on('option:import', (filename: string) =>
    tagOperations.push(async (m) => {
        const entries = (await readFile(filename, 'utf8'))
            .split(/\r?\n/)
            .filter(Boolean)
            .map(splitTag);
        for (const { name, value } of entries) m.tags.append(name, value);
    }),
);
tags.action(async (file: string, options: { get?: string; export?: string; json?: boolean }) => {
    check(
        !(tagOperations.length && options.export),
        'INVALID_ARGUMENT',
        'Export and mutation must be separate commands.',
    );
    const result = tagOperations.length
        ? (
              await editFlac(file, async (metadata) => {
                  for (const edit of tagOperations) await edit(metadata);
              })
          ).metadata
        : await readMetadata(file);
    const entries = result.tags
        .entries()
        .filter((tag) => !options.get || tag.name.toUpperCase() === options.get.toUpperCase());
    const text =
        entries.map((tag) => `${tag.name}=${tag.value}`).join('\n') + (entries.length ? '\n' : '');
    if (options.export) await exportTo(options.export, file, text);
    else if (options.json) console.log(JSON.stringify(entries, null, 2));
    else process.stdout.write(text);
});
const pictureOperations: ((
    m: FlacMetadata,
    type: number,
    description: string,
) => void | Promise<void>)[] = [];
const pictures = program
    .command('pictures <file>')
    .description('List, add, remove or export pictures; indexes start at zero.')
    .option('--add <path>', 'Append a JPEG or PNG picture')
    .option('--type <number>', 'Type for added pictures (3 = front cover)', number, 3)
    .option('--description <text>', 'Description for added pictures', '')
    .option('--remove <index>', 'Remove picture at current index', number)
    .option('--clear', 'Remove all pictures')
    .option('--export <path>', 'Export picture bytes; - means stdout')
    .option('--index <number>', 'Index to export', number, 0);
pictures.on('option:add', (filename: string) =>
    pictureOperations.push(async (m, type, description) => {
        m.addPicture(createPicture(await readFile(filename), { type, description }));
    }),
);
pictures.on('option:remove', (index: string) => {
    const parsed = number(index);
    pictureOperations.push((m) => m.removePicture(parsed));
});
pictures.on('option:clear', () => pictureOperations.push((m) => m.clearPictures()));
pictures.action(
    async (
        file: string,
        options: { type: number; description: string; export?: string; index: number },
    ) => {
        check(
            !(pictureOperations.length && options.export),
            'INVALID_ARGUMENT',
            'Export and mutation must be separate commands.',
        );
        const result = pictureOperations.length
            ? (
                  await editFlac(file, async (metadata) => {
                      for (const edit of pictureOperations)
                          await edit(metadata, options.type, options.description);
                  })
              ).metadata
            : await readMetadata(file);
        if (options.export) {
            const picture = result.pictures[options.index];
            check(picture, 'INVALID_ARGUMENT', 'Picture index is out of range.');
            await exportTo(options.export, file, picture.data);
        } else
            console.log(
                JSON.stringify(
                    result.pictures.map(({ data, ...picture }, index) => ({
                        index,
                        ...picture,
                        size: data.byteLength,
                    })),
                    null,
                    2,
                ),
            );
    },
);
program.parseAsync().catch((error: Error & { code?: string }) => {
    console.error(`${error.code ?? 'ERROR'}: ${error.message}`);
    process.exitCode = 1;
});
