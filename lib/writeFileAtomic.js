const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Resolve symlinks so saving updates the target rather than replacing the link.
module.exports = (filename, data) => {
    const target = fs.realpathSync(filename);
    const stat = fs.statSync(target);
    // An atomic replacement cannot update every hard link to an inode.
    if (stat.nlink > 1) {
        throw new Error('Cannot safely replace a FLAC file with multiple hard links; save a Buffer to a new file instead.');
    }
    const temporary = path.join(path.dirname(target), `.metaflac-${crypto.randomBytes(12).toString('hex')}.tmp`);
    let fd;
    try {
        fd = fs.openSync(temporary, 'wx', stat.mode & 0o777);
        fs.writeFileSync(fd, data);
        if (process.platform !== 'win32') {
            const created = fs.fstatSync(fd);
            if (created.uid !== stat.uid || created.gid !== stat.gid) {
                fs.fchownSync(fd, stat.uid, stat.gid);
            }
        }
        fs.fchmodSync(fd, stat.mode & 0o777);
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fd = undefined;
        fs.renameSync(temporary, target);
    } finally {
        if (fd !== undefined) fs.closeSync(fd);
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
};
