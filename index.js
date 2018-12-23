const fs = require('fs');
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
        this.marker = '';
        this.streamInfo = null;
        this.blocks = [];
        this.padding = null;
        this.vorbisComment = null;
        this.vendorString = '';
        this.tags = [];
        this.pictures = [];
        this.picturesSpecs = [];
        this.picturesDatas = [];
        this.framesOffset = 0;
        this.init();
    }

    init() {
        typeof this.flac === 'string' ? this.buffer = fs.readFileSync(this.flac) : this.buffer = flac;

        let offset = 0;
        const marker = this.buffer.slice(0, offset += 4).toString('ascii');
        if (marker !== 'fLaC') {
            throw new Error('The file does not appear to be a FLAC file.');
        }
        
        let blockType = 0;
        let isLastBlock = false;
        while (!isLastBlock) {
            blockType = this.buffer.readUInt8(offset++);
            isLastBlock = blockType > 128;
            blockType = blockType % 128;
            // console.log('Block Type: %d %s', blockType, BLOCK_TYPE[blockType]);
        
            const blockLength = this.buffer.readUIntBE(offset, 3);
            offset += 3;

            if (blockType === STREAMINFO) {
                this.streamInfo = this.buffer.slice(offset, offset + blockLength);
            }

            if (blockType === PADDING) {
                this.padding = this.buffer.slice(offset, offset + blockLength);
            }

            if (blockType === VORBIS_COMMENT) {
                this.vorbisComment = this.buffer.slice(offset, offset + blockLength);
                this.parseVorbisComment();
            }

            if (blockType === PICTURE) {
                this.pictures.push(this.buffer.slice(offset, offset + blockLength));
                this.parsePictureBlock();
            }

            if ([APPLICATION, SEEKTABLE, CUESHEET].includes(blockType)) {
                this.blocks.push([blockType, this.buffer.slice(offset, offset + blockLength)]);
            }
            // console.log('Block Length: %d', blockLength);
            offset += blockLength;
        }
        this.framesOffset = offset;
    }

    parseVorbisComment() {
        const vendorLength = this.vorbisComment.readUInt32LE(0);
        // console.log('Vendor length: %d', vendorLength);
        this.vendorString = this.vorbisComment.slice(4, vendorLength + 4).toString('utf8');
        // console.log('Vendor string: %s', this.vendorString);
        const userCommentListLength = this.vorbisComment.readUInt32LE(4 + vendorLength);
        // console.log('user_comment_list_length: %d', userCommentListLength);
        const userCommentListBuffer = this.vorbisComment.slice(4 + vendorLength + 4);
        for (let offset = 0; offset < userCommentListBuffer.length; ) {
            const length = userCommentListBuffer.readUInt32LE(offset);
            offset += 4;
            const comment = userCommentListBuffer.slice(offset, offset += length).toString('utf8');
            // console.log('Comment length: %d, this.buffer: %s', length, comment);
            this.tags.push(comment);
        }
    }

    parsePictureBlock() {
        this.pictures.forEach(picture => {
            let offset = 0;
            const type = picture.readUInt32BE(offset);
            offset += 4;
            const mimeTypeLength = picture.readUInt32BE(offset);
            offset += 4;
            const mime = picture.slice(offset, offset + mimeTypeLength).toString('ascii');
            offset += mimeTypeLength;
            const descriptionLength = picture.readUInt32BE(offset);
            offset += 4;
            const description = picture.slice(offset, offset += descriptionLength).toString('utf8');
            const width = picture.readUInt32BE(offset);
            offset += 4;
            const height = picture.readUInt32BE(offset);
            offset += 4;
            const depth = picture.readUInt32BE(offset);
            offset += 4;
            const colors = picture.readUInt32BE(offset);
            offset += 4;
            const pictureDataLength = picture.readUInt32BE(offset);
            offset += 4;
            this.picturesDatas.push(picture.slice(offset, offset + pictureDataLength));
            this.picturesSpecs.push(this.buildSpecification({
                type,
                mime,
                description,
                width,
                height,
                depth,
                colors
            }));
        });
    }

    getPicturesSpecs() {
        return this.picturesSpecs;
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
        const picture = fs.readFileSync(filename);
        const {mime} = fileType(picture);
        if (mime !== 'image/jpeg') {
            throw new Error(`only support image/jpeg picture temporarily, current import ${mime}`);
        }
        const dimensions = imageSize(filename);
        const spec = this.buildSpecification({
            mime: mime,
            width: dimensions.width,
            height: dimensions.height,
        });
        this.pictures.push(this.buildPictureBlock(picture, spec));
        this.picturesSpecs.push(spec);
    }

    /**
     * Export PICTURE block to a file.
     * 
     * @param {string} filename 
     */
    exportPictureTo(filename) {
        if (this.picturesDatas.length > 0) {
            fs.writeFileSync(filename, this.picturesDatas[0]);
        }
    }

    /**
     * Return all tags.
     */
    getAllTags() {
        return this.tags;
    }

    buildSpecification(spec = {}) {
        const defaults = {
            type: 3,
            mime: 'image/jpeg',
            description: '',
            width: 0,
            height: 0,
            depth: 24,
            colors: 0,
        };
        return Object.assign(defaults, spec);
    }

    /**
     * Build a picture block.
     * 
     * @param {Buffer} picture
     * @param {Object} specification
     * @returns {Buffer}
     */
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

    buildMetadataBlock(type, block, isLast = false) {
        const header = Buffer.alloc(4);
        if (isLast) {
            type += 128;
        }
        header.writeUIntBE(type, 0, 1);
        header.writeUIntBE(block.length, 1, 3);
        return Buffer.concat([header, block]);
    }

    buildMetadata() {
        const bufferArray = [];
        bufferArray.push(this.buildMetadataBlock(STREAMINFO, this.streamInfo));
        this.blocks.forEach(block => {
            bufferArray.push(this.buildMetadataBlock(...block));
        });
        bufferArray.push(this.buildMetadataBlock(VORBIS_COMMENT, formatVorbisComment(this.vendorString, this.tags)));
        this.pictures.forEach(block => {
            bufferArray.push(this.buildMetadataBlock(PICTURE, block));
        });
        bufferArray.push(this.buildMetadataBlock(PADDING, this.padding, true));
        return bufferArray;
    }

    buildStream() {
        const metadata = this.buildMetadata();
        return [this.buffer.slice(0, 4), ...metadata, this.buffer.slice(this.framesOffset)];
    }

    /**
     * Save change to file or return changed buffer.
     */
    save() {
        if (typeof this.flac === 'string') {
            fs.writeFileSync(this.flac, Buffer.concat(this.buildStream()));
        } else {
            return Buffer.concat(this.buildStream());
        }
    }
}

module.exports = Metaflac;