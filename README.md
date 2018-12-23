# metaflac-js

A pure JavaScript implementation of the metaflac (the official FLAC tool written in C++)

Use as module:

```
npm i metaflac-js --save
```

```
const Metaflac = require('metaflac-js');
const flac = new Metaflac('/path/to/flac.flac');
flac.setTag('TITLE=My Music');
flac.save();
```

Use as cli:

Usage is basically consistent with official tools.

```
npm i metaflac-js -g
metaflac-js -h
```

Note: here is the official FLAC tools [doc](https://xiph.org/flac/documentation_tools_metaflac.html) 