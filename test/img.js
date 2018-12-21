const jimp = require('jimp');

jimp.read('pic.jpg', (err, image) => {
    console.log(err, image.getMIME());
    image.getBuffer(jimp.MIME_BMP, (err, buffer) => {
        console.log('jpg', buffer[28]);
    });
});

jimp.read('11111.tiff', (err, image) => {
    console.log(err, image.getMIME());
    image.getBuffer(jimp.MIME_BMP, (err, buffer) => {
        console.log('png', buffer[28]);
        console.log(buffer.readUInt32LE(18));
        console.log(buffer.readUInt32LE(22));
    });
    image.write('1.bmp', () => {});
});