const fs = require('fs');

const BLOCK_TYPE = {
    0: 'STREAMINFO',
    1: 'PADDING',
    2: 'APPLICATION',
    3: 'SEEKTABLE',
    4: 'VORBIS_COMMENT', // There may be only one VORBIS_COMMENT block in a stream.
    5: 'CUESHEET',
    6: 'PICTURE',
};

const content = fs.readFileSync('2.flac');
let offset = 0;
const markerBuffer = Buffer.alloc(4);
content.copy(markerBuffer, 0, 0, offset += 4);
const marker = markerBuffer.toString('ascii');
console.log('Marker: %s', marker);

if (marker !== 'fLaC') {
    process.exit();
}

let vorbisCommentOffset = 0;
let vorbisCommentContent = null;
let blockType = 0;
while (blockType < 128) {
    blockType = content.readUInt8(offset++);
    console.log('Block Type: %s', BLOCK_TYPE[blockType % 128]);

    const blockLength = content.readUIntBE(offset, 3);
    offset += 3;
    if (blockType === 4) {
        vorbisCommentOffset = offset;
        vorbisCommentContent = Buffer.alloc(blockLength);
        content.copy(vorbisCommentContent, 0, offset, offset + blockLength);
    }
    console.log('Block Length: %d', blockLength);
    offset += blockLength;
}

// for (let i = 0; i < vorbisCommentContent.length; i++) {
//     console.log(vorbisCommentContent[i]);
// }
// console.log(vorbisCommentOffset, vorbisCommentContent.toString('ascii'));

const vendorLength = vorbisCommentContent.readUInt32LE(0);
console.log('Vendor length: %d', vendorLength);
const vendorString = vorbisCommentContent.slice(1, vendorLength);
console.log('Vendor string: %s', vendorString.toString('utf8'));
const userCommentListLength = vorbisCommentContent.readUInt32LE(4 + vendorLength);
console.log('user_comment_list_length: %d', userCommentListLength);
const userCommentListBuffer = vorbisCommentContent.slice(4 + vendorLength + 4);
for (let offset = 0; offset < userCommentListBuffer.length; ) {
    const length = userCommentListBuffer.readUInt32LE(offset);
    offset += 4;
    const comment = userCommentListBuffer.slice(offset, offset += length);
    console.log('Comment length: %d, content: %s', length, comment.toString('utf8'));
}
