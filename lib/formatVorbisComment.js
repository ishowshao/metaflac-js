module.exports = (vendorString, commentList) => {
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