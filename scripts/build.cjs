const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
fs.rmSync('dist', { recursive: true, force: true });
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc')], { stdio: 'inherit' });
for (const [entry, names] of Object.entries({
    index: [
        'FlacError',
        'BlockType',
        'Tags',
        'FlacMetadata',
        'parseMetadata',
        'parseFlac',
        'encodeFlac',
        'DEFAULT_LIMITS',
        'readMetadata',
        'editFlac',
    ],
    'core/index': [
        'FlacError',
        'BlockType',
        'Tags',
        'FlacMetadata',
        'parseMetadata',
        'parseFlac',
        'encodeFlac',
        'DEFAULT_LIMITS',
    ],
    images: ['createPicture'],
})) {
    const base = entry.split('/').at(-1);
    fs.writeFileSync(
        `dist/${entry}.mjs`,
        `import api from './${base}.js';\nexport const { ${names.join(', ')} } = api;\n`,
    );
}
fs.chmodSync('dist/cli.js', 0o755);
