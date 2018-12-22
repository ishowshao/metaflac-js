const fs = require('fs');
const path = require('path');
const fileType = require('file-type');
const imageSize = require('image-size');
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

const STREAMINFO = 0;
const PADDING = 1;
const APPLICATION = 2;
const SEEKTABLE = 3;
const VORBIS_COMMENT = 4;
const CUESHEET = 5;
const PICTURE = 6;

class Metaflac {
    constructor(flac) {
        if (typeof flac !== 'string' && !Buffer.isBuffer(flac)) {
            throw new Error('Metaflac(flac) flac must be string or buffer.');
        }
        this.flac = flac;
        this.buffer = null;
        this.streamInfo = null;
        this.pictures = [];
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
        // console.log('Marker: %s', marker);
        
        if (marker !== 'fLaC') {
            throw new Error('Input file/buffer is not flac format.');
        }
        
        let vorbisCommentOffset = 0;
        let vorbisCommentContent = null;

        let blockType = 0;
        let isLastBlock = false;
        while (!isLastBlock) {
            blockType = content.readUInt8(offset++);
            isLastBlock = blockType > 128;
            blockType = blockType % 128;
            // console.log('Block Type: %d %s', blockType, BLOCK_TYPE[blockType]);
        
            const blockLength = content.readUIntBE(offset, 3);
            offset += 3;

            if (blockType === STREAMINFO) {
                this.streamInfo = content.slice(offset, offset + blockLength);
                // console.log(this.streamInfo);
            }

            if (blockType === 4) {
                vorbisCommentOffset = offset;
                vorbisCommentContent = Buffer.alloc(blockLength);
                content.copy(vorbisCommentContent, 0, offset, offset + blockLength);
            }
            if (blockType === 6) {
                this.parsePictureBlock(offset, blockLength);
            }
            // console.log('Block Length: %d', blockLength);
            offset += blockLength;
        }
        
        const vendorLength = vorbisCommentContent.readUInt32LE(0);
        // console.log('Vendor length: %d', vendorLength);
        this.vendorString = vorbisCommentContent.slice(4, vendorLength + 4).toString('utf8');
        // console.log('Vendor string: %s', this.vendorString);
        const userCommentListLength = vorbisCommentContent.readUInt32LE(4 + vendorLength);
        // console.log('user_comment_list_length: %d', userCommentListLength);
        const userCommentListBuffer = vorbisCommentContent.slice(4 + vendorLength + 4);
        this.tags = [];
        for (let offset = 0; offset < userCommentListBuffer.length; ) {
            const length = userCommentListBuffer.readUInt32LE(offset);
            offset += 4;
            const comment = userCommentListBuffer.slice(offset, offset += length).toString('utf8');
            // console.log('Comment length: %d, content: %s', length, comment);
            this.tags.push(comment);
        }
        
        // console.log(this.vendorString, this.tags);
        
        // const formated = formatVorbisComment(vendorString, comments);
        // console.log(vorbisCommentContent.equals(formated));
    }

    parsePictureBlock(offset, length) {
        const picture = this.buffer.slice(offset, offset + length);
        // console.log(picture.length);
        offset = 0;
        const pictureType = picture.readUInt32BE(offset);
        // console.log('Picture type: %d', pictureType);
        offset += 4;
        const mimeTypeLength = picture.readUInt32BE(offset);
        // console.log('Mime type length: %d', mimeTypeLength);
        offset += 4;
        const mimeType = picture.slice(offset, offset + mimeTypeLength).toString('ascii');
        // console.log('MIME: %s', mimeType);
        offset += mimeTypeLength;
        const descriptionLength = picture.readUInt32BE(offset);
        offset += 4;
        // console.log('The length of the description string: %d', descriptionLength);
        const description = picture.slice(offset, offset += descriptionLength).toString('utf8');
        // console.log('The description of the picture: %s', description);

        const width = picture.readUInt32BE(offset);
        offset += 4;
        // console.log('The width of the picture in pixels: %d', width);

        const height = picture.readUInt32BE(offset);
        offset += 4;
        // console.log('The height of the picture in pixels: %d', height);
        
        const depth = picture.readUInt32BE(offset);
        offset += 4;
        // console.log('The color depth of the picture in bits-per-pixel: %d', depth);

        const colors = picture.readUInt32BE(offset);
        offset += 4;
        // console.log('Colors: %d', colors);

        const pictureDataLength = picture.readUInt32BE(offset);
        offset += 4;
        // console.log('The length of the picture data in bytes: %d', pictureDataLength);
    }

    /**
     * Get the MD5 signature from the STREAMINFO block.
     */
    getMd5sum() {
        return this.streamInfo.slice(18, 34).toString('hex');
    }

    /**
     * Get the minimum block size from the STREAMINFO block.
     */
    getMinBlocksize() {
        return this.streamInfo.readUInt16BE(0);
    }

    /**
     * Get the maximum block size from the STREAMINFO block.
     */
    getMaxBlocksize() {
        return this.streamInfo.readUInt16BE(2);
    }

    /**
     * Get the minimum frame size from the STREAMINFO block.
     */
    getMinFramesize() {
        return this.streamInfo.readUIntBE(4, 3);
    }

    /**
     * Get the maximum frame size from the STREAMINFO block.
     */
    getMaxFramesize() {
        return this.streamInfo.readUIntBE(7, 3);
    }

    /**
     * Get the sample rate from the STREAMINFO block.
     */
    getSampleRate() {
        // 20 bits number
        return this.streamInfo.readUIntBE(10, 3) >> 4;
    }

    /**
     * Get the number of channels from the STREAMINFO block.
     */
    getChannels() {
        // 3 bits
        return this.streamInfo.readUIntBE(10, 3) & 0x00000f >> 1;
    }

    /**
     * Get the # of bits per sample from the STREAMINFO block.
     */
    getBps() {
        return this.streamInfo.readUIntBE(12, 2) & 0x01f0 >> 4;
    }

    /**
     * Get the total # of samples from the STREAMINFO block.
     */
    getTotalSamples() {
        return this.streamInfo.readUIntBE(13, 5) & 0x0fffffffff;
    }

    /**
     * Show the vendor string from the VORBIS_COMMENT block.
     */
    getVendorTag() {
        return this.vendorString;
    }

    /**
     * Get all tags where the the field name matches NAME.
     * 
     * @param {string} name 
     */
    getTag(name) {
        return this.tags.filter(item => {
            const itemName = item.split('=')[0];
            return itemName === name;
        }).join('\n');
    }

    /**
     * Remove all tags whose field name is NAME.
     * 
     * @param {string} name 
     */
    removeTag(name) {
        this.tags = this.tags.filter(item => {
            const itemName = item.split('=')[0];
            return itemName !== name;
        });
    }

    /**
     * Remove first tag whose field name is NAME.
     * 
     * @param {string} name 
     */
    removeFirstTag(name) {
        const found = this.tags.findIndex(item => {
            return item.split('=')[0] === name;
        });
        if (found !== -1) {
            this.tags.splice(found, 1);
        }
    }

    /**
     * Remove all tags, leaving only the vendor string.
     */
    removeAllTags() {
        this.tags = [];
    }

    /**
     * Add a tag.
     * The FIELD must comply with the Vorbis comment spec, of the form NAME=VALUE. If there is currently no tag block, one will be created.
     * 
     * @param {string} field 
     */
    setTag(field) {
        if (field.indexOf('=') === -1) {
            throw new Error(`malformed vorbis comment field "${field}", field contains no '=' character`);
        }
        this.tags.push(field);
    }

    /**
     * Like setTag, except the VALUE is a filename whose contents will be read verbatim to set the tag value.
     * 
     * @param {string} field 
     */
    setTagFromFile(field) {
        const position = field.indexOf('=');
        if (position === -1) {
            throw new Error(`malformed vorbis comment field "${field}", field contains no '=' character`);
        }
        const name = field.substring(0, position);
        const filename = field.substr(position + 1);
        let value;
        try {
            value = fs.readFileSync(filename, 'utf8');
        } catch (e) {
            throw new Error(`can't open file '${filename}' for '${name}' tag value`);
        }
        this.tags.push(`${name}=${value}`);
    }

    /**
     * Import tags from a file.
     * Each line should be of the form NAME=VALUE.
     * 
     * @param {string} filename
     */
    importTagsFrom(filename) {
        const tags = fs.readFileSync(filename, 'utf8').split('\n');
        tags.forEach(line => {
            if (line.indexOf('=') === -1) {
                throw new Error(`malformed vorbis comment "${line}", contains no '=' character`);
            }
        });
        this.tags = this.tags.concat(tags);
    }

    /**
     * Export tags to a file.
     * Each line will be of the form NAME=VALUE.
     * 
     * @param {string} filename
     */
    exportTagsTo(filename) {
        fs.writeFileSync(filename, this.tags.join('\n'), 'utf8');
    }

    /**
     * Import a picture and store it in a PICTURE metadata block.
     * 
     * @param {string} filename 
     */
    importPictureFrom(filename) {
        const buffer = fs.readFileSync(filename);
        const {mime} = fileType(buffer);
        if (mime !== 'image/jpeg') {
            throw new Error(`only support image/jpeg picture temporarily, current import ${mime}`);
        }
    }

    /**
     * Export PICTURE block to a file.
     * 
     * @param {string} filename 
     */
    exportPictureTo(filename) {

    }

    /**
     * Return all tags.
     */
    getAllTags() {
        return this.tags;
    }

    buildPictureBlock(picture, specification = {}) {
        const pictureType = Buffer.alloc(4);
        const mimeLength = Buffer.alloc(4);
        const mime = Buffer.from(specification.mime, 'ascii');
        const descriptionLength = Buffer.alloc(4);
        const description = Buffer.from(specification.description, 'utf8');
        const width = Buffer.alloc(4);
        const height = Buffer.alloc(4);
        const depth = Buffer.alloc(4);
        const colors = Buffer.alloc(4);
        const pictureLength = Buffer.alloc(4);

        pictureType.writeUInt32BE(specification.type);
        mimeLength.writeUInt32BE(specification.mime.length);
        descriptionLength.writeUInt32BE(specification.description.length);
        width.writeUInt32BE(specification.width);
        height.writeUInt32BE(specification.height);
        depth.writeUInt32BE(specification.depth);
        colors.writeUInt32BE(specification.colors);
        pictureLength.writeUInt32BE(picture.length);

        return Buffer.concat([
            pictureType,
            mimeLength,
            mime,
            descriptionLength,
            description,
            width,
            height,
            depth,
            colors,
            pictureLength,
            picture,
        ]);
    }

    /**
     * Save change to file or return changed buffer.
     */
    save() {

    }
}

module.exports = Metaflac;