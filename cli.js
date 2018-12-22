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
program.option('--show-min-blocksize', 'Show the minimum block size from the STREAMINFO block.');
program.option('--show-max-blocksize', 'Show the maximum block size from the STREAMINFO block.');
program.option('--show-min-framesize', 'Show the minimum frame size from the STREAMINFO block.');
program.option('--show-max-framesize', 'Show the maximum frame size from the STREAMINFO block.');
program.option('--show-sample-rate', 'Show the sample rate from the STREAMINFO block.');
program.option('--show-channels', 'Show the number of channels from the STREAMINFO block.');
program.option('--show-bps', 'Show the # of bits per sample from the STREAMINFO block.');
program.option('--show-total-samples', 'Show the total # of samples from the STREAMINFO block.');
program.option('--show-vendor-tag', 'Show the vendor string from the VORBIS_COMMENT block.');
program.option('--show-tag <NAME>', 'Show all tags where the the field name matches NAME.');
program.option('--remove-tag <NAME>', 'Remove all tags whose field name is NAME.');
program.option('--remove-first-tag <NAME>', 'Remove first tag whose field name is NAME.');
program.option('--remove-all-tags', 'Remove all tags, leaving only the vendor string.');
program.option('--set-tag <FIELD>', 'Add a tag. The FIELD must comply with the Vorbis comment spec, of the form NAME=VALUE. If there is currently no tag block, one will be created.');
program.option('--set-tag-from-file <FIELD>', 'Like --set-tag, except the VALUE is a filename whose contents will be read verbatim to set the tag value.');
program.option('--import-tags-from <FILE>', 'Import tags from a file.');
program.option('--export-tags-to <FILE>', 'Export tags to a file. Use - for stdout. Each line will be of the form NAME=VALUE.');
program.option('--import-picture-from <FILENAME>', 'Import a picture and store it in a PICTURE metadata block.');
program.option('--export-picture-to <FILE>', 'Export PICTURE block to a file.');

program.parse(process.argv);

if (typeof file === 'undefined') {
    console.error('ERROR: you must specify at least one FLAC file;');
    process.exit(1);
}

const flac = new Metaflac(file);
if (program.showMd5sum) {
    console.log(flac.getMd5sum());
}
if (program.showMinBlocksize) {
    console.log(flac.getMinBlocksize());
}
if (program.showMaxBlocksize) {
    console.log(flac.getMaxBlocksize());
}
if (program.showMinFramesize) {
    console.log(flac.getMinFramesize());
}
if (program.showMaxFramesize) {
    console.log(flac.getMaxFramesize());
}
if (program.showSampleRate) {
    console.log(flac.getSampleRate());
}
if (program.showChannels) {
    console.log(flac.getChannels());
}
if (program.showBps) {
    console.log(flac.getBps());
}
if (program.showTotalSamples) {
    console.log(flac.getTotalSamples());
}