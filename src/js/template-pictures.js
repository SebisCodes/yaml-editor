/**
 * The example pictures a page sends with its template placeholders: checked strictly and kept
 * in memory only, apart from the document's own pictures.
 *
 * checkExamplePicture() runs these steps for one picture:
 *   1. read the data address: an image type (PNG, JPEG, GIF, WebP) and valid base64;
 *   2. read the bytes: the signature has to match the type, and the size from the header has to
 *      stay inside the limits of side length and pixels; animated pictures are refused;
 *   3. decode it (the browser's createImageBitmap, or the decoder given): only a picture that
 *      decodes is kept, at the size its header names.
 * Every editor with template placeholders uses this same file; it works on bytes and strings, so
 * it runs in Node as well when a decoder is given.
 */

/** The image types an example picture may have, by the type of its data address. */
const PICTURE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
/** A data address with base64 content: group 1 the type, group 2 the base64 text. */
const DATA_ADDRESS = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/;
/** The longest side of an example picture, in pixels. */
export const MAX_PICTURE_SIDE = 10000;
/** The most pixels of one example picture. */
export const MAX_PICTURE_PIXELS = 25e6;
/** The extension of a picture's file name by its type. */
const PICTURE_EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
/** The JPEG markers that start a frame and carry the picture's size. */
const JPEG_FRAME_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
/** The JPEG markers that stand alone, without a length. */
const JPEG_STANDALONE_MARKERS = new Set([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8]);

/**
 * The size and type a picture's header names.
 * @typedef {object} PictureHeader
 * @property {string} type - the image type, e.g. "image/png".
 * @property {number} width - the width in pixels.
 * @property {number} height - the height in pixels.
 * @property {boolean} animated - true when the picture holds more than one frame.
 */

/**
 * Decodes the bytes of a picture of a type and returns its size; rejects when they do not decode.
 * @callback PictureDecoder
 * @param {Uint8Array} bytes - the picture's bytes.
 * @param {string} type - its image type.
 * @returns {Promise<PictureSize>} the decoded size.
 */

/**
 * The size of a picture in pixels.
 * @typedef {object} PictureSize
 * @property {number} width - the width.
 * @property {number} height - the height.
 */

/**
 * An example picture that passed every check.
 * @typedef {object} ExamplePicture
 * @property {string} name - its name in the page's `assets`.
 * @property {string} type - the image type.
 * @property {string} extension - the file extension of the type, e.g. "png".
 * @property {string} dataUrl - the data address as the page sent it.
 * @property {Uint8Array} bytes - the picture's bytes.
 * @property {number} width - the width in pixels.
 * @property {number} height - the height in pixels.
 */

/**
 * Checks one example picture (the steps in the header).
 * @param {string} name - the picture's name in the page's `assets`.
 * @param {*} dataUrl - the data address the page sent.
 * @param {PictureDecoder} decodePicture - decodes the bytes of a picture of a type; rejects when they do not decode.
 * @returns {Promise<?ExamplePicture>} the picture, or null when a check fails.
 */
export async function checkExamplePicture(name, dataUrl, decodePicture) {
    const parsed = parsePictureAddress(dataUrl);
    if (!parsed) return null;
    const header = getPictureHeader(parsed.bytes);
    if (!header || header.type !== parsed.type || header.animated || !isPictureSizeAllowed(header)) return null;
    try {
        const decoded = await decodePicture(parsed.bytes, parsed.type);
        if (!decoded || decoded.width !== header.width || decoded.height !== header.height) return null;
    } catch (error) {
        return null;
    }
    return { name, type: parsed.type, extension: PICTURE_EXTENSIONS[parsed.type], dataUrl, bytes: parsed.bytes, width: header.width, height: header.height };
}

/**
 * Reads a data address of an image type into its type and bytes.
 * @param {*} dataUrl - the data address.
 * @returns {?{type: string, bytes: Uint8Array}} the type and bytes, or null for anything else than
 *     valid base64 of PNG, JPEG, GIF or WebP.
 */
export function parsePictureAddress(dataUrl) {
    if (typeof dataUrl !== 'string') return null;
    const match = DATA_ADDRESS.exec(dataUrl);
    if (!match || !PICTURE_TYPES.has(match[1]) || match[2].length % 4 !== 0 || !match[2].length) return null;
    try {
        const binary = atob(match[2]);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
        return { type: match[1], bytes };
    } catch (error) {
        return null;
    }
}

/**
 * Tells whether a picture's size stays inside the limits.
 * @param {PictureHeader} header - the picture's header.
 * @returns {boolean} true when both sides are at least 1 and at most MAX_PICTURE_SIDE and the pixels at most MAX_PICTURE_PIXELS.
 */
function isPictureSizeAllowed(header) {
    const { width, height } = header;
    return width >= 1 && height >= 1 && width <= MAX_PICTURE_SIDE && height <= MAX_PICTURE_SIDE && width * height <= MAX_PICTURE_PIXELS;
}

/**
 * Reads the type, size and frames of a picture from its first bytes.
 * @param {Uint8Array} bytes - the picture's bytes.
 * @returns {?PictureHeader} the header, or null when the bytes start no PNG, JPEG, GIF or WebP.
 */
export function getPictureHeader(bytes) {
    if (hasBytes(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return getPngHeader(bytes);
    if (hasBytes(bytes, 0, [0xff, 0xd8, 0xff])) return getJpegHeader(bytes);
    if (hasText(bytes, 0, 'GIF87a') || hasText(bytes, 0, 'GIF89a')) return getGifHeader(bytes);
    if (hasText(bytes, 0, 'RIFF') && hasText(bytes, 8, 'WEBP')) return getWebpHeader(bytes);
    return null;
}

/**
 * Tells whether bytes hold a sequence at an offset.
 * @param {Uint8Array} bytes - the bytes.
 * @param {number} offset - where the sequence would start.
 * @param {number[]} expected - the sequence.
 * @returns {boolean} true when every byte matches.
 */
function hasBytes(bytes, offset, expected) {
    return bytes.length >= offset + expected.length && expected.every((value, index) => bytes[offset + index] === value);
}

/**
 * Tells whether bytes hold an ASCII text at an offset.
 * @param {Uint8Array} bytes - the bytes.
 * @param {number} offset - where the text would start.
 * @param {string} text - the text.
 * @returns {boolean} true when every character matches.
 */
function hasText(bytes, offset, text) {
    return hasBytes(bytes, offset, Array.from(text, character => character.charCodeAt(0)));
}

/**
 * Reads a big-endian number of two or four bytes.
 * @param {Uint8Array} bytes - the bytes.
 * @param {number} offset - where the number starts.
 * @param {number} length - 2 or 4.
 * @returns {number} the number (0 past the end).
 */
function readBigEndian(bytes, offset, length) {
    let value = 0;
    for (let index = 0; index < length; index++) value = value * 256 + (bytes[offset + index] ?? 0);
    return value;
}

/**
 * Reads a little-endian number of two or three bytes.
 * @param {Uint8Array} bytes - the bytes.
 * @param {number} offset - where the number starts.
 * @param {number} length - 2 or 3.
 * @returns {number} the number (0 past the end).
 */
function readLittleEndian(bytes, offset, length) {
    let value = 0;
    for (let index = length - 1; index >= 0; index--) value = value * 256 + (bytes[offset + index] ?? 0);
    return value;
}

/**
 * Reads the header of a PNG: the size from IHDR; an acTL chunk ahead of the image data marks an
 * animated PNG.
 * @param {Uint8Array} bytes - the bytes.
 * @returns {?PictureHeader} the header, or null without IHDR.
 */
function getPngHeader(bytes) {
    if (!hasText(bytes, 12, 'IHDR')) return null;
    const header = { type: 'image/png', width: readBigEndian(bytes, 16, 4), height: readBigEndian(bytes, 20, 4), animated: false };
    for (let offset = 8; offset + 8 <= bytes.length;) {
        if (hasText(bytes, offset + 4, 'acTL')) { header.animated = true; break; }
        if (hasText(bytes, offset + 4, 'IDAT')) break;
        offset += 12 + readBigEndian(bytes, offset, 4);
    }
    return header;
}

/**
 * Reads the header of a JPEG: the size from the first frame marker.
 * @param {Uint8Array} bytes - the bytes.
 * @returns {?PictureHeader} the header, or null without a frame marker.
 */
function getJpegHeader(bytes) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
        if (bytes[offset] !== 0xff) return null;
        const marker = bytes[offset + 1];
        if (marker === 0xff) { offset++; continue; }
        if (JPEG_STANDALONE_MARKERS.has(marker)) { offset += 2; continue; }
        if (JPEG_FRAME_MARKERS.has(marker)) return { type: 'image/jpeg', width: readBigEndian(bytes, offset + 7, 2), height: readBigEndian(bytes, offset + 5, 2), animated: false };
        offset += 2 + readBigEndian(bytes, offset + 2, 2);
    }
    return null;
}

/**
 * Reads the header of a GIF: the size of its screen, and its blocks to count the frames.
 * @param {Uint8Array} bytes - the bytes.
 * @returns {?PictureHeader} the header, or null when the blocks end early.
 */
function getGifHeader(bytes) {
    const header = { type: 'image/gif', width: readLittleEndian(bytes, 6, 2), height: readLittleEndian(bytes, 8, 2), animated: false };
    let offset = 13 + getGifColorTableLength(bytes[10]);
    let frames = 0;
    while (offset < bytes.length) {
        const block = bytes[offset];
        if (block === 0x3b) return { ...header, animated: frames > 1 };
        if (block === 0x21) offset = findGifBlocksEnd(bytes, offset + 2);
        else if (block === 0x2c) { frames++; offset = findGifBlocksEnd(bytes, offset + 11 + getGifColorTableLength(bytes[offset + 9])); }
        else return null;
        if (offset < 0) return null;
    }
    return { ...header, animated: frames > 1 };
}

/**
 * Returns the length of a GIF color table from the flags that announce it.
 * @param {number} flags - the packed flags of the screen or the image descriptor.
 * @returns {number} the table's length in bytes, 0 without a table.
 */
function getGifColorTableLength(flags) {
    return flags & 0x80 ? 3 * 2 ** ((flags & 0x07) + 1) : 0;
}

/**
 * Moves past a run of GIF sub-blocks up to the empty block that ends it.
 * @param {Uint8Array} bytes - the bytes.
 * @param {number} offset - where the first sub-block's length stands.
 * @returns {number} the offset after the run, -1 when the bytes end inside it.
 */
function findGifBlocksEnd(bytes, offset) {
    while (offset < bytes.length) {
        const length = bytes[offset];
        if (length === 0) return offset + 1;
        offset += length + 1;
    }
    return -1;
}

/**
 * Reads the header of a WebP: the size from its VP8, VP8L or VP8X chunk; VP8X marks animation.
 * @param {Uint8Array} bytes - the bytes.
 * @returns {?PictureHeader} the header, or null for another first chunk.
 */
function getWebpHeader(bytes) {
    if (hasText(bytes, 12, 'VP8 ')) return { type: 'image/webp', width: readLittleEndian(bytes, 26, 2) & 0x3fff, height: readLittleEndian(bytes, 28, 2) & 0x3fff, animated: false };
    if (hasText(bytes, 12, 'VP8L') && bytes[20] === 0x2f) {
        const bits = readLittleEndian(bytes, 21, 2) + bytes[23] * 0x10000 + bytes[24] * 0x1000000;
        return { type: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, animated: false };
    }
    if (hasText(bytes, 12, 'VP8X')) return { type: 'image/webp', width: readLittleEndian(bytes, 24, 3) + 1, height: readLittleEndian(bytes, 27, 3) + 1, animated: Boolean(bytes[20] & 0x02) };
    return null;
}

/**
 * Decodes the bytes of a picture with the browser's createImageBitmap.
 * @param {Uint8Array} bytes - the picture's bytes.
 * @param {string} type - its image type.
 * @returns {Promise<PictureSize>} the decoded size; rejects when the bytes do not decode or the browser
 *     has no createImageBitmap.
 */
export async function readPictureSizeInBrowser(bytes, type) {
    if (typeof createImageBitmap !== 'function') throw new Error('This browser cannot decode pictures');
    const bitmap = await createImageBitmap(new Blob([bytes], { type }));
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
}
