const fs = require('fs');
const writeFileAtomic = require('./lib/writeFileAtomic');
const { imageSize } = require('image-size');
const formatVorbisComment = require('./lib/formatVorbisComment');

const STREAMINFO = 0;
const PADDING = 1;
const VORBIS_COMMENT = 4;
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
        typeof this.flac === 'string' ? this.buffer = fs.readFileSync(this.flac) : this.buffer = this.flac;

        let offset = 0;
        offset += 4;
        if (!this.buffer.subarray(0, 4).equals(Buffer.from('fLaC'))) {
            throw new Error('The file does not appear to be a FLAC file.');
        }
        
        let isLastBlock = false;
        while (!isLastBlock) {
            if (offset + 4 > this.buffer.length) {
                throw new Error('Truncated FLAC metadata header.');
            }
            const header = this.buffer.readUInt8(offset++);
            isLastBlock = (header & 0x80) !== 0;
            const blockType = header & 0x7f;
            const blockLength = this.buffer.readUIntBE(offset, 3);
            offset += 3;
            if (blockType === 127 || offset + blockLength > this.buffer.length) {
                throw new Error('Invalid or truncated FLAC metadata block.');
            }
            if (!this.streamInfo && blockType !== STREAMINFO) {
                throw new Error('STREAMINFO must be the first FLAC metadata block.');
            }
            const block = this.buffer.slice(offset, offset + blockLength);
            if (blockType === STREAMINFO) {
                if (this.streamInfo || blockLength !== 34) {
                    throw new Error('FLAC requires exactly one 34-byte STREAMINFO block.');
                }
                this.streamInfo = block;
            } else if (blockType === PADDING) {
                this.padding = block;
            } else if (blockType === VORBIS_COMMENT) {
                if (this.vorbisComment) {
                    throw new Error('Duplicate VORBIS_COMMENT block.');
                }
                this.vorbisComment = block;
                this.parseVorbisComment();
            } else if (blockType === PICTURE) {
                this.pictures.push(block);
            } else {
                // Preserve opaque application, seek, cue and reserved blocks.
                this.blocks.push([blockType, block]);
            }
            offset += blockLength;
        }
        this.parsePictureBlock();
        this.framesOffset = offset;
    }

    parseVorbisComment() {
        const reader = new MetadataReader(this.vorbisComment, 'VORBIS_COMMENT');
        this.vendorString = reader.bytes(reader.uint32(true)).toString('utf8');
        const count = reader.uint32(true);
        this.tags = [];
        for (let i = 0; i < count; i++) {
            this.tags.push(reader.bytes(reader.uint32(true)).toString('utf8'));
        }
        reader.end();
    }

    parsePictureBlock() {
        this.picturesSpecs = [];
        this.picturesDatas = [];
        this.pictures.forEach(picture => {
            const reader = new MetadataReader(picture, 'PICTURE');
            const type = reader.uint32();
            const mime = reader.bytes(reader.uint32()).toString('ascii');
            const description = reader.bytes(reader.uint32()).toString('utf8');
            const width = reader.uint32();
            const height = reader.uint32();
            const depth = reader.uint32();
            const colors = reader.uint32();
            const data = reader.bytes(reader.uint32());
            reader.end();
            this.picturesDatas.push(data);
            this.picturesSpecs.push(this.buildSpecification({
                type, mime, description, width, height, depth, colors
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
        return ((this.streamInfo[12] >> 1) & 7) + 1;
    }

    /**
     * Get the # of bits per sample from the STREAMINFO block.
     */
    getBps() {
        return ((this.streamInfo.readUInt16BE(12) >> 4) & 31) + 1;
    }

    /**
     * Get the total # of samples from the STREAMINFO block.
     */
    getTotalSamples() {
        return (this.streamInfo[13] & 15) * 0x100000000 + this.streamInfo.readUInt32BE(14);
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
            return itemName.toUpperCase() === name.toUpperCase();
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
            return itemName.toUpperCase() !== name.toUpperCase();
        });
    }

    /**
     * Remove first tag whose field name is NAME.
     * 
     * @param {string} name 
     */
    removeFirstTag(name) {
        const found = this.tags.findIndex(item => {
            return item.split('=')[0].toUpperCase() === name.toUpperCase();
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
        validateTag(field);
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
        this.setTag(`${name}=${value}`);
    }

    /**
     * Import tags from a file.
     * Each line should be of the form NAME=VALUE.
     * 
     * @param {string} filename
     */
    importTagsFrom(filename) {
        const tags = fs.readFileSync(filename, 'utf8').split(/\r?\n/).filter(line => line.length > 0);
        tags.forEach(validateTag);
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
        this.importPictureFromBuffer(fs.readFileSync(filename));
    }

    /**
     * Import a picture and store it in a PICTURE metadata block.
     * 
     * @param {Buffer} picture
     */
    importPictureFromBuffer(picture) {
        if (!Buffer.isBuffer(picture)) {
            throw new TypeError('Picture must be a Buffer.');
        }
        // Only inspect formats accepted by this API, before invoking the decoder.
        let mime;
        if (picture.length >= 8 && picture.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
            mime = 'image/png';
        } else if (picture.length >= 3 && picture[0] === 0xff && picture[1] === 0xd8 && picture[2] === 0xff) {
            mime = 'image/jpeg';
        } else {
            throw new Error('Only JPEG and PNG pictures are supported.');
        }
        const dimensions = imageSize(picture);
        const spec = this.buildSpecification({
            mime: mime,
            width: dimensions.width,
            height: dimensions.height,
        });
        this.pictures.push(this.buildPictureBlock(picture, spec));
        this.parsePictureBlock();
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
        mimeLength.writeUInt32BE(mime.length);
        descriptionLength.writeUInt32BE(description.length);
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
        if (!Number.isInteger(type) || type < 0 || type > 126 || !Buffer.isBuffer(block) || block.length > 0xffffff) {
            throw new Error('Invalid FLAC metadata type or length (maximum 16777215 bytes).');
        }
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
        bufferArray.push(this.buildMetadataBlock(PADDING, this.padding || Buffer.alloc(0), true));
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
            writeFileAtomic(this.flac, Buffer.concat(this.buildStream()));
        } else {
            return Buffer.concat(this.buildStream());
        }
    }
}

function validateTag(field) {
    if (typeof field !== 'string' || !/^[\x20-\x3c\x3e-\x7e]+=/.test(field)) {
        throw new Error('Malformed Vorbis comment: expected a printable ASCII NAME=VALUE field.');
    }
}

class MetadataReader {
    constructor(buffer, label) {
        this.buffer = buffer;
        this.label = label;
        this.offset = 0;
    }

    bytes(length) {
        if (length > this.buffer.length - this.offset) {
            throw new Error(`Truncated ${this.label} block.`);
        }
        const bytes = this.buffer.subarray(this.offset, this.offset + length);
        this.offset += length;
        return bytes;
    }

    uint32(littleEndian = false) {
        const bytes = this.bytes(4);
        return littleEndian ? bytes.readUInt32LE(0) : bytes.readUInt32BE(0);
    }

    end() {
        if (this.offset !== this.buffer.length) {
            throw new Error(`Unexpected trailing data in ${this.label} block.`);
        }
    }
}

module.exports = Metaflac;
