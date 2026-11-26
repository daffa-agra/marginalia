/**
 * Minimal ZIP reader.
 *
 * An EPUB is a ZIP. We only need to pull a few small text entries out of it
 * (container.xml, the OPF, a cover image), so rather than adding a zip
 * dependency we read the central directory ourselves and decompress with the
 * platform's DecompressionStream('deflate-raw').
 *
 * Supports the two methods that matter in practice: stored (0) and
 * deflate (8). Rejects anything else with a named error instead of guessing.
 */

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const EOCD_MIN = 22;
const MAX_COMMENT = 0xffff;

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  /** Offset of the local file header. */
  localOffset: number;
}

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

function readU16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

/** Reads the central directory, giving us every entry's name and offset. */
export function listEntries(buffer: ArrayBuffer): ZipEntry[] {
  const view = new DataView(buffer);
  if (buffer.byteLength < EOCD_MIN) throw new ZipError('File is too small to be a ZIP archive.');

  // The EOCD sits at the end, followed by a variable-length comment.
  const searchStart = Math.max(0, buffer.byteLength - EOCD_MIN - MAX_COMMENT);
  let eocd = -1;
  for (let i = buffer.byteLength - EOCD_MIN; i >= searchStart; i--) {
    if (readU32(view, i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('Not a ZIP archive (no end-of-central-directory record).');

  const totalEntries = readU16(view, eocd + 10);
  const centralOffset = readU32(view, eocd + 16);
  if (centralOffset > buffer.byteLength) throw new ZipError('Corrupt ZIP: central directory is out of bounds.');

  const entries: ZipEntry[] = [];
  let cursor = centralOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (cursor + 46 > buffer.byteLength) throw new ZipError('Corrupt ZIP: truncated central directory.');
    if (readU32(view, cursor) !== SIG_CENTRAL) throw new ZipError('Corrupt ZIP: bad central directory signature.');

    const method = readU16(view, cursor + 10);
    const compressedSize = readU32(view, cursor + 20);
    const uncompressedSize = readU32(view, cursor + 24);
    const nameLen = readU16(view, cursor + 28);
    const extraLen = readU16(view, cursor + 30);
    const commentLen = readU16(view, cursor + 32);
    const localOffset = readU32(view, cursor + 42);
    const nameBytes = new Uint8Array(buffer, cursor + 46, nameLen);
    const name = new TextDecoder('utf-8').decode(nameBytes);

    entries.push({ name, method, compressedSize, uncompressedSize, localOffset });
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Extracts one entry's bytes. */
export async function readEntry(buffer: ArrayBuffer, entry: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(buffer);
  const local = entry.localOffset;
  if (local + 30 > buffer.byteLength) throw new ZipError(`Corrupt ZIP: entry "${entry.name}" is out of bounds.`);
  if (readU32(view, local) !== SIG_LOCAL) throw new ZipError(`Corrupt ZIP: bad local header for "${entry.name}".`);

  const nameLen = readU16(view, local + 26);
  const extraLen = readU16(view, local + 28);
  const dataStart = local + 30 + nameLen + extraLen;
  if (dataStart + entry.compressedSize > buffer.byteLength) {
    throw new ZipError(`Corrupt ZIP: data for "${entry.name}" is out of bounds.`);
  }
  const raw = new Uint8Array(buffer, dataStart, entry.compressedSize);

  if (entry.method === 0) return raw.slice();

  if (entry.method === 8) {
    if (typeof DecompressionStream === 'undefined') {
      throw new ZipError('This browser cannot decompress ZIP entries (DecompressionStream missing).');
    }
    // Copy: DecompressionStream cannot read from a view into a larger buffer.
    const input = raw.slice();
    const stream = new Blob([input]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const decompressed = new Uint8Array(await new Response(stream).arrayBuffer());
    return decompressed;
  }

  throw new ZipError(`Unsupported ZIP compression method ${entry.method} for "${entry.name}".`);
}

/** Reads one entry as UTF-8 text, or returns null when it is absent. */
export async function readTextEntry(buffer: ArrayBuffer, name: string): Promise<string | null> {
  const entries = listEntries(buffer);
  const entry = entries.find((e) => e.name === name);
  if (!entry) return null;
  return new TextDecoder('utf-8').decode(await readEntry(buffer, entry));
}
