/* Build a richer EPUB for reader tests: nav TOC, images, CSS, multi-chapter. */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function makeZip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const dosTime =
    ((now.getHours() & 0x1f) << 11) | ((now.getMinutes() & 0x3f) << 5) | ((now.getSeconds() / 2) & 0x1f);
  const dosDate =
    (((now.getFullYear() - 1980) & 0x7f) << 9) | (((now.getMonth() + 1) & 0xf) << 5) | (now.getDate() & 0x1f);

  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const raw = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const deflated = zlib.deflateRawSync(raw);
    const useDeflate = deflated.length < raw.length;
    const data = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);

    const centralEntry = Buffer.alloc(46);
    centralEntry.writeUInt32LE(0x02014b50, 0);
    centralEntry.writeUInt16LE(20, 4);
    centralEntry.writeUInt16LE(20, 6);
    centralEntry.writeUInt16LE(method, 10);
    centralEntry.writeUInt16LE(dosTime, 12);
    centralEntry.writeUInt16LE(dosDate, 14);
    centralEntry.writeUInt32LE(crc, 16);
    centralEntry.writeUInt32LE(data.length, 20);
    centralEntry.writeUInt32LE(raw.length, 24);
    centralEntry.writeUInt16LE(nameBuf.length, 28);
    centralEntry.writeUInt32LE(offset, 42);

    chunks.push(local, nameBuf, data);
    central.push(Buffer.concat([centralEntry, nameBuf]));
    offset += local.length + nameBuf.length + data.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralBuf, eocd]);
}

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[i] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

// A tiny valid PNG (1x1 red pixel) so image extraction can be tested.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

const chapters = Array.from({ length: 6 }, (_, i) => {
  const n = i + 1;
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter ${n}</title>`,
    `<link rel="stylesheet" href="styles/book.css"/></head><body>`,
    `<h1>Chapter ${n}</h1>`,
    n === 3 ? `<img src="images/plate.png" alt="A plate"/>` : '',
    `<p>${'This is paragraph text for chapter ' + n + '. '.repeat(40)}</p>`,
    `<p>The sea does not forgive, but it does forget.</p>`,
    `<a href="ch${Math.min(6, n + 1)}.xhtml">Next chapter</a>`,
    `</body></html>`,
  ].join('\n');
});

const FILES = {
  mimetype: 'application/epub+zip',
  'META-INF/container.xml': `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
  'OEBPS/content.opf': `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Six Chapters of Sea</dc:title>
    <dc:creator>Marina Voss</dc:creator>
    <dc:language>en</dc:language>
    <dc:identifier id="bookid">urn:uuid:reader-test</dc:identifier>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="styles/book.css" media-type="text/css"/>
    <item id="plate" href="images/plate.png" media-type="image/png"/>
    ${chapters.map((_, i) => `<item id="ch${i + 1}" href="ch${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join('\n    ')}
  </manifest>
  <spine>
    ${chapters.map((_, i) => `<itemref idref="ch${i + 1}"/>`).join('\n    ')}
  </spine>
</package>`,
  'OEBPS/nav.xhtml': `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head><body>
<nav epub:type="toc"><ol>
  <li><a href="ch1.xhtml">One: The Lighthouse</a></li>
  <li><a href="ch2.xhtml">Two: The Crossing</a></li>
  <li><a href="ch3.xhtml">Three: The Plate</a></li>
  <li><a href="ch4.xhtml">Four: The Return</a></li>
  <li><a href="ch5.xhtml">Five: The Storm</a></li>
  <li><a href="ch6.xhtml">Six: After</a></li>
</ol></nav></body></html>`,
  'OEBPS/styles/book.css': `body { font-family: Georgia, serif; } h1 { font-size: 1.6em; letter-spacing: 0.01em; } p { margin: 0 0 1em; } .hidden-marker { color: #8b3616; }`,
  'OEBPS/images/plate.png': PNG,
  ...Object.fromEntries(chapters.map((html, i) => [`OEBPS/ch${i + 1}.xhtml`, html])),
  // A malicious chapter proving scripts are neutralised by the renderer.
  'OEBPS/hostile.xhtml': `<html><body><h1>Hostile</h1><script>window.__pwned = true;</script><p onclick="window.__pwned=true">Click</p><a href="javascript:window.__pwned=true">Bad link</a><img src="images/plate.png" onerror="window.__pwned=true"/></body></html>`,
};

const out = process.argv[2] || '.review/fixtures/reader-test.epub';
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, makeZip(FILES));
console.log(`wrote ${out} (${fs.statSync(out).size} bytes, ${chapters.length} chapters + nav + image + css)`);
