/**
 * A small ZIP writer. Files are stored uncompressed (the pictures are
 * compressed already) and their names are written in UTF-8.
 *
 * createZip() runs these steps:
 *   1. read every file as bytes: a text or bytes at once, a Blob when its turn comes;
 *   2. write a local header, the name and the bytes of each file;
 *   3. write the central directory, one entry per file;
 *   4. close the archive with the end record.
 *
 * The same file serves every giit editor.
 */

const CRC_POLYNOMIAL = 0xedb88320;
const CRC_START = 0xffffffff;
const BYTE_VALUES = 256;
const BITS_PER_BYTE = 8;
const BYTE_MASK = 255;

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_RECORD_SIGNATURE = 0x06054b50;
const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const END_RECORD_SIZE = 22;
const ZIP_VERSION = 20;                 // version 2.0: stored files, no compression
const UTF8_NAMES_FLAG = 0x0800;         // general purpose bit 11: the names are UTF-8
const DOS_START_YEAR = 1980;
const ZIP_TYPE = 'application/zip';

/** CRC-32 table: the remainder of every byte value. */
const CRC_TABLE = new Uint32Array(BYTE_VALUES).map((_, byteValue) => getCrcTableEntry(byteValue));

/**
 * One file of an archive.
 * @typedef {Object} ZipFile
 * @property {string} name - the path of the file inside the archive.
 * @property {string|Blob|Uint8Array} data - the content; a string is written as UTF-8.
 */

/**
 * Time and date of the archive's entries in MS-DOS format.
 * @typedef {Object} DosTimestamp
 * @property {number} time - hours, minutes and seconds / 2, packed into 16 bits.
 * @property {number} date - years since 1980, month and day, packed into 16 bits.
 */

/**
 * One file as it is written: its encoded name, its bytes, their checksum and where its local header starts.
 * @typedef {Object} ZipEntry
 * @property {Uint8Array} name - the name as UTF-8.
 * @property {Uint8Array} data - the content.
 * @property {number} crc - the CRC-32 of the content.
 * @property {number} offset - the byte position of the local header in the archive.
 */

/**
 * Builds a ZIP archive of the given files, stored uncompressed. Only a Blob is waited for: a
 * file given as text or bytes is taken at once, so the names and texts of the files in front of
 * the first Blob go in as they are when the call starts, whatever the caller changes afterwards.
 * @param {ZipFile[]} files - the files in the order they go into the archive.
 * @returns {Promise<Blob>} the archive as an `application/zip` Blob.
 */
export async function createZip(files) {
    const encoder = new TextEncoder();
    const timestamp = getDosTimestamp(new Date());
    const localParts = [], centralParts = [];
    let offset = 0;
    for (const file of files) {
        const data = file.data instanceof Blob ? await readBlobBytes(file.data) : getFileBytes(file.data, encoder);
        const entry = { name: encoder.encode(file.name), data, crc: getCrc32(data), offset };
        localParts.push(createLocalHeader(entry, timestamp), entry.name, entry.data);
        centralParts.push(createCentralHeader(entry, timestamp), entry.name);
        offset += LOCAL_HEADER_SIZE + entry.name.length + entry.data.length;
    }
    const centralSize = centralParts.reduce((total, part) => total + part.byteLength, 0);
    const endRecord = createEndRecord(files.length, centralSize, offset);
    return new Blob([...localParts, ...centralParts, endRecord], { type: ZIP_TYPE });
}

/**
 * Returns the CRC-32 table entry of one byte value.
 * @param {number} byteValue - the byte value, 0 to 255.
 * @returns {number} the remainder of the byte value as an unsigned 32-bit number.
 */
function getCrcTableEntry(byteValue) {
    let remainder = byteValue;
    for (let bit = 0; bit < BITS_PER_BYTE; bit++) remainder = remainder & 1 ? CRC_POLYNOMIAL ^ (remainder >>> 1) : remainder >>> 1;
    return remainder >>> 0;
}

/**
 * Returns the CRC-32 checksum of some bytes, as ZIP writes it.
 * @param {Uint8Array} bytes - the bytes to check.
 * @returns {number} the checksum as an unsigned 32-bit number.
 */
function getCrc32(bytes) {
    let crc = CRC_START;
    for (let index = 0; index < bytes.length; index++) crc = CRC_TABLE[(crc ^ bytes[index]) & BYTE_MASK] ^ (crc >>> BITS_PER_BYTE);
    return (crc ^ CRC_START) >>> 0;
}

/**
 * Returns a moment in the MS-DOS time and date format of ZIP headers.
 * @param {Date} moment - the moment, in local time.
 * @returns {DosTimestamp} the packed time and date.
 */
function getDosTimestamp(moment) {
    const time = (moment.getHours() << 11) | (moment.getMinutes() << 5) | (moment.getSeconds() >> 1);
    const date = ((moment.getFullYear() - DOS_START_YEAR) << 9) | ((moment.getMonth() + 1) << 5) | moment.getDate();
    return { time, date };
}

/**
 * Returns the content of a file given as text or bytes.
 * @param {string|Uint8Array} data - the content; a string is encoded as UTF-8.
 * @param {TextEncoder} encoder - the UTF-8 encoder.
 * @returns {Uint8Array} the bytes (a Uint8Array is returned as it is).
 */
function getFileBytes(data, encoder) {
    return typeof data === 'string' ? encoder.encode(data) : data;
}

/**
 * Reads the content of a file given as a Blob.
 * @param {Blob} blob - the content.
 * @returns {Promise<Uint8Array>} the bytes.
 */
async function readBlobBytes(blob) {
    return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Builds the local file header that stands in front of a file's name and bytes.
 * @param {ZipEntry} entry - the file.
 * @param {DosTimestamp} timestamp - the time and date of the archive.
 * @returns {DataView} the 30-byte header.
 */
function createLocalHeader(entry, timestamp) {
    const header = new DataView(new ArrayBuffer(LOCAL_HEADER_SIZE));
    header.setUint32(0, LOCAL_HEADER_SIGNATURE, true);
    header.setUint16(4, ZIP_VERSION, true);
    header.setUint16(6, UTF8_NAMES_FLAG, true);
    header.setUint16(10, timestamp.time, true);
    header.setUint16(12, timestamp.date, true);
    header.setUint32(14, entry.crc, true);
    header.setUint32(18, entry.data.length, true);
    header.setUint32(22, entry.data.length, true);
    header.setUint16(26, entry.name.length, true);
    return header;
}

/**
 * Builds the central directory entry of a file, which points to its local header.
 * @param {ZipEntry} entry - the file.
 * @param {DosTimestamp} timestamp - the time and date of the archive.
 * @returns {DataView} the 46-byte header.
 */
function createCentralHeader(entry, timestamp) {
    const header = new DataView(new ArrayBuffer(CENTRAL_HEADER_SIZE));
    header.setUint32(0, CENTRAL_HEADER_SIGNATURE, true);
    header.setUint16(4, ZIP_VERSION, true);
    header.setUint16(6, ZIP_VERSION, true);
    header.setUint16(8, UTF8_NAMES_FLAG, true);
    header.setUint16(12, timestamp.time, true);
    header.setUint16(14, timestamp.date, true);
    header.setUint32(16, entry.crc, true);
    header.setUint32(20, entry.data.length, true);
    header.setUint32(24, entry.data.length, true);
    header.setUint16(28, entry.name.length, true);
    header.setUint32(42, entry.offset, true);
    return header;
}

/**
 * Builds the end record that closes the archive.
 * @param {number} fileCount - the number of files.
 * @param {number} centralSize - the size of the central directory in bytes.
 * @param {number} centralOffset - the byte position where the central directory starts.
 * @returns {DataView} the 22-byte record.
 */
function createEndRecord(fileCount, centralSize, centralOffset) {
    const record = new DataView(new ArrayBuffer(END_RECORD_SIZE));
    record.setUint32(0, END_RECORD_SIGNATURE, true);
    record.setUint16(8, fileCount, true);
    record.setUint16(10, fileCount, true);
    record.setUint32(12, centralSize, true);
    record.setUint32(16, centralOffset, true);
    return record;
}
