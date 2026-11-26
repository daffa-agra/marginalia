/* Build a minimal but valid EPUB for tests. */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/** Minimal ZIP writer: stored + deflate, with a correct central directory. */
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
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    const centralEntry = Buffer.alloc(46);
    centralEntry.writeUInt32LE(0x02014b50, 0);
    centralEntry.writeUInt16LE(20, 4);
    centralEntry.writeUInt16LE(20, 6);
    centralEntry.writeUInt16LE(0, 8);
    centralEntry.writeUInt16LE(method, 10);
    centralEntry.writeUInt16LE(dosTime, 12);
    centralEntry.writeUInt16LE(dosDate, 14);
    centralEntry.writeUInt32LE(crc, 16);
    centralEntry.writeUInt32LE(data.length, 20);
    centralEntry.writeUInt32LE(raw.length, 24);
    centralEntry.writeUInt16LE(nameBuf.length, 28);
    centralEntry.writeUInt16LE(0, 30);
    centralEntry.writeUInt16LE(0, 32);
    centralEntry.writeUInt16LE(0, 34);
    centralEntry.writeUInt16LE(0, 36);
    centralEntry.writeUInt32LE(0, 38);
    centralEntry.writeUInt32LE(offset, 42);

    chunks.push(local, nameBuf, data);
    central.push(Buffer.concat([centralEntry, nameBuf]));
    offset += local.length + nameBuf.length + data.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

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

const EPUB_FILES = {
  mimetype: 'application/epub+zip',
  'META-INF/container.xml': `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
  'OEBPS/content.opf': `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>The Lighthouse Keeper's Daughter</dc:title>
    <dc:creator>Eleanor Voss</dc:creator>
    <dc:language>en</dc:language>
    <dc:identifier id="bookid">urn:uuid:test-1234</dc:identifier>
    <dc:publisher>Salt &amp; Signal Press</dc:publisher>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="cover-img" href="cover.svg" media-type="image/svg+xml" properties="cover-image"/>
    <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch3" href="chapter3.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
    <itemref idref="ch3"/>
  </spine>
</package>`,
  'OEBPS/toc.ncx': `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap><navPoint id="n1"><navLabel><text>One</text></navLabel><content src="chapter1.xhtml"/></navPoint></navMap></ncx>`,
  'OEBPS/cover.svg': `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450"><rect width="300" height="450" fill="#3f6f71"/><text x="24" y="380" fill="#fffdf8" font-family="Georgia" font-size="22">The Lighthouse</text></svg>`,
  'OEBPS/chapter1.xhtml': `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>One</title></head><body>
<h1>One</h1><p>The sea does not forgive, but it does forget, and that is nearly the same thing.</p>
<p>She counted the ships by their lights. Each one a promise somebody had already broken.</p></body></html>`,
  'OEBPS/chapter2.xhtml': `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Two</title></head><body>
<h1>Two</h1><p>A keeper's daughter learns the weather the way other children learn their letters.</p></body></html>`,
  'OEBPS/chapter3.xhtml': `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Three</title></head><body>
<h1>Three</h1><p>To allow yourself to be known is an act of tremendous courage.</p></body></html>`,
};

const out = process.argv[2] || '.review/fixtures/lighthouse.epub';
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, makeZip(EPUB_FILES));
console.log(`wrote ${out} (${fs.statSync(out).size} bytes)`);

// Also export a broken variant to prove the error path.
const broken = { ...EPUB_FILES };
delete broken['META-INF/container.xml'];
fs.writeFileSync(out.replace('.epub', '-broken.epub'), makeZip(broken));
console.log('wrote broken variant');
