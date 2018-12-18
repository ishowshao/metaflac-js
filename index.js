const fs = require('fs');
const formatVorbisComment = require('./lib/formatVorbisComment');

const BLOCK_TYPE = {
    0: 'STREAMINFO',
    1: 'PADDING',
    2: 'APPLICATION',
    3: 'SEEKTABLE',
    4: 'VORBIS_COMMENT', // There may be only one VORBIS_COMMENT block in a stream.
    5: 'CUESHEET',
    6: 'PICTURE',
};

class Metaflac {
    constructor(flac) {
        this.flac = flac;
        if (typeof this.flac !== 'string' && !Buffer.isBuffer(this.flac)) {
            throw new Error('Metaflac(flac) flac must be string or buffer.');
        }
        this.init();
    }

    init() {
        if (typeof this.flac === 'string') {
            this.buffer = fs.readFileSync(this.flac);
        } else {
            this.buffer = flac;
        }

        const content = this.buffer;
        let offset = 0;
        const markerBuffer = content.slice(0, offset += 4);
        const marker = markerBuffer.toString('ascii');
        console.log('Marker: %s', marker);
        
        if (marker !== 'fLaC') {
            throw new Error('Input file/buffer is not flac format.');
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
        
        const vendorLength = vorbisCommentContent.readUInt32LE(0);
        console.log('Vendor length: %d', vendorLength);
        this.vendorString = vorbisCommentContent.slice(4, vendorLength + 4).toString('utf8');
        console.log('Vendor string: %s', this.vendorString);
        const userCommentListLength = vorbisCommentContent.readUInt32LE(4 + vendorLength);
        console.log('user_comment_list_length: %d', userCommentListLength);
        const userCommentListBuffer = vorbisCommentContent.slice(4 + vendorLength + 4);
        this.commentList = [];
        for (let offset = 0; offset < userCommentListBuffer.length; ) {
            const length = userCommentListBuffer.readUInt32LE(offset);
            offset += 4;
            const comment = userCommentListBuffer.slice(offset, offset += length).toString('utf8');
            console.log('Comment length: %d, content: %s', length, comment);
            this.commentList.push(comment);
        }
        
        console.log(this.vendorString, this.commentList);
        
        // const formated = formatVorbisComment(vendorString, comments);
        // console.log(vorbisCommentContent.equals(formated));
    }

    /**
     * Show the vendor string from the VORBIS_COMMENT block.
     */
    getVendorTag() {
        return this.vendorString;
    }

    /**
     * Add a tag.
     * The FIELD must comply with the Vorbis comment spec, of the form NAME=VALUE. If there is currently no tag block, one will be created.
     * 
     * @param {string} field 
     */
    setTag(field) {

    }

    /**
     * Remove all tags, leaving only the vendor string.
     */
    removeAllTags() {

    }

    /**
     * Save change to file or return changed buffer.
     */
    save() {

    }
}

module.exports = Metaflac;