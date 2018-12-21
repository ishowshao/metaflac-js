#!/usr/bin/env node

const program = require('commander');
const info = require('./package.json');
const Metaflac = require('./index');

let file;

program.version(info.version, '-v, --version');

program.arguments('<FLACfile>').action((FLACfile) => {
    file = FLACfile;
});
program.option('--show-md5sum', 'Show the MD5 signature from the STREAMINFO block.');

program.parse(process.argv);

if (typeof file === 'undefined') {
    console.error('ERROR: you must specify at least one FLAC file;');
    process.exit(1);
}

const flac = new Metaflac(file);
if (program.showMd5sum) {
    console.log(flac.getMd5sum());
}