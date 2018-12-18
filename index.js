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
const vendorString = vorbisCommentContent.slice(4, vendorLength + 4).toString('utf8');
console.log('Vendor string: %s', vendorString);
const userCommentListLength = vorbisCommentContent.readUInt32LE(4 + vendorLength);
console.log('user_comment_list_length: %d', userCommentListLength);
const userCommentListBuffer = vorbisCommentContent.slice(4 + vendorLength + 4);
const comments = [];
for (let offset = 0; offset < userCommentListBuffer.length; ) {
    const length = userCommentListBuffer.readUInt32LE(offset);
    offset += 4;
    const comment = userCommentListBuffer.slice(offset, offset += length).toString('utf8');
    console.log('Comment length: %d, content: %s', length, comment);
    comments.push(comment);
}

console.log(vendorString, comments);


const formated = formatVorbisComment(vendorString, comments);
console.log(vorbisCommentContent.equals(formated));

function formatVorbisComment(vendorString, commentList) {
    const bufferArray = [];
    const vendorStringBuffer = Buffer.from(vendorString, 'utf8');
    const vendorLengthBuffer = Buffer.alloc(4);
    vendorLengthBuffer.writeUInt32LE(vendorStringBuffer.length);
    
    const userCommentListLengthBuffer = Buffer.alloc(4);
    userCommentListLengthBuffer.writeUInt32LE(commentList.length);

    bufferArray.push(vendorLengthBuffer, vendorStringBuffer, userCommentListLengthBuffer);

    for (let i = 0; i < commentList.length; i++) {
        const comment = commentList[i];
        const commentBuffer = Buffer.from(comment, 'utf8');
        const lengthBuffer = Buffer.alloc(4);
        lengthBuffer.writeUInt32LE(commentBuffer.length);
        bufferArray.push(lengthBuffer, commentBuffer);
    }

    return Buffer.concat(bufferArray);
}
