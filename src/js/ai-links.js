/**
 * Documents in AI links: reading the part after the # of a link, collecting the parts of a
 * long document, and finding the links in a pasted answer.
 *
 * A link carries the YAML after the # (that part never reaches a server):
 *   #b64=<base64url of the UTF-8 text>   #yaml=<URL-encoded text>   #z=<base64url of zlib-compressed text>
 * optional &mode=add (the keys are merged into the root mapping, or the items added to the
 * root sequence, of the first document), &file=new&name=NAME (a new document in "My
 * documents") or &file=NAME (that document), and, for long documents, &part=N&of=M&id=NAME on
 * each of M links; the parts are collected in localStorage until all have arrived. Terminals
 * break long links over several lines, so the AI's whole answer can be pasted: the links are
 * found and joined.
 */

/** The storage key prefix of the collected parts of a long document. */
const PARTS = 'yamleditor.parts.';
/** The kind of a link that carries the text itself (#yaml=), and the fence of the prompt. */
export const TEXT_KIND = 'yaml';
/** A link never carries more than this many characters, also once unpacked. */
const MAX_TEXT = 5e6;
/** Base64 is about a third longer than the text it carries. */
const MAX_ENCODED_TEXT = MAX_TEXT * 1.4;
/** Parts belong together only within this time, in milliseconds. */
const PART_LIFETIME = 30 * 60e3;
/** The most parts a document may have. */
const MAX_PARTS = 200;
const MAX_ID_LENGTH = 60;
const MAX_NAME_LENGTH = 80;
const KINDS = ['b64', 'z', TEXT_KIND];
const INFLATE_FORMATS = ['deflate', 'deflate-raw', 'gzip'];
/** A line that holds only characters of a link continues the link of the line above it. */
const LINK_CHARACTERS = /^[A-Za-z0-9\-_=&%+/.~]+$/;

/**
 * A link read from the part after the #.
 * @typedef {object} HashLink
 * @property {string} kind - "b64", "z" or "yaml".
 * @property {string} data - the encoded document (or this part of it).
 * @property {string} mode - "add" or "set".
 * @property {number} part - the number of this part, 0 for a document in one link.
 * @property {number} of - the number of parts, 0 for a document in one link.
 * @property {string} id - the name that ties the parts together.
 * @property {{file: string, name: string}} target - which document it goes to.
 */

/**
 * What a link holds once read.
 * @typedef {object} LinkResult
 * @property {string} [text] - the document.
 * @property {string} [mode] - "add" or "set".
 * @property {{file: string, name: string}} [target] - which document it goes to.
 * @property {number[]} [missing] - the parts still missing.
 * @property {number} [part] - the number of this part.
 * @property {number} [of] - the number of parts.
 * @property {boolean} [error] - true when the link is incomplete or damaged.
 */

/**
 * Returns the bytes of base64 or base64url text; spaces (a "+" decoded as space) count as "+".
 * @param {string} text - the encoded text.
 * @returns {Uint8Array} the bytes.
 */
function convertFromBase64(text) {
    const base64 = text.replace(/ /g, '+').replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
    const binary = atob(base64 + '='.repeat((4 - base64.length % 4) % 4));
    return Uint8Array.from(binary, character => character.charCodeAt(0));
}

/**
 * Returns the text of compressed bytes, trying zlib, raw deflate and gzip.
 * @param {Uint8Array} bytes - the compressed bytes.
 * @returns {Promise<string>} the text.
 * @throws {Error} when it unpacks to more than MAX_TEXT, or cannot be unpacked.
 */
async function expandText(bytes) {
    for (const format of INFLATE_FORMATS) {
        try { return await expandAs(bytes, format); } catch (e) {
            if (e instanceof RangeError) throw new Error('The link unpacks to more than 5 MB - it is not opened.');
        }
    }
    throw new Error('The compressed document could not be unpacked.');
}

/**
 * Returns the text of bytes compressed in one format; a small link that unpacks to a huge text
 * is no document.
 * @param {Uint8Array} bytes - the compressed bytes.
 * @param {string} format - the DecompressionStream format.
 * @returns {Promise<string>} the text.
 * @throws {RangeError} when it unpacks to more than MAX_TEXT.
 * @throws {TypeError} when the bytes are not in that format.
 */
async function expandAs(bytes, format) {
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format)).getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_TEXT) { reader.cancel(); throw new RangeError('too big'); }
        chunks.push(value);
    }
    return new TextDecoder().decode(await new Blob(chunks).arrayBuffer());
}

/**
 * Reads the part of a link after the #.
 * @param {string} hash - the part after the # (with or without it).
 * @returns {HashLink|null} the link, null when it carries no document.
 */
export function readHash(hash) {
    const parameters = getHashParameters(hash);
    const kind = KINDS.find(name => parameters.has(name));
    if (!kind) return null;
    return {
        kind, data: parameters.get(kind),
        mode: parameters.get('mode') === 'add' ? 'add' : 'set',
        part: +parameters.get('part') || 0, of: +parameters.get('of') || 0, id: (parameters.get('id') || 'document').slice(0, MAX_ID_LENGTH),
        target: { file: (parameters.get('file') || '').slice(0, MAX_NAME_LENGTH), name: (parameters.get('name') || '').replace(/\+/g, ' ').slice(0, MAX_NAME_LENGTH) },
    };
}

/**
 * Returns the parameters after the #, split by hand: URLSearchParams would turn the "+" of
 * normal base64 into spaces.
 * @param {string} hash - the part after the #.
 * @returns {Map<string, string>} the parameters, decoded where they can be.
 */
function getHashParameters(hash) {
    const parameters = new Map();
    for (const pair of hash.replace(/^#/, '').split('&')) {
        const index = pair.indexOf('=');
        if (index < 0) continue;
        let value = pair.slice(index + 1);
        try { value = decodeURIComponent(value); } catch (e) { /* keep it as it is */ }
        parameters.set(pair.slice(0, index), value);
    }
    return parameters;
}

/**
 * Returns the link parts (after the #) in a pasted text. A link that a terminal broke over
 * several lines continues on the following lines as long as they hold link characters only.
 * @param {string} text - the pasted text.
 * @returns {string[]} the links in order, without the #.
 */
export function findLinks(text) {
    const links = [];
    const start = new RegExp(`#((?:b64|z|${TEXT_KIND})=)`, 'g');
    let match;
    while ((match = start.exec(text))) {
        let index = match.index + 1, link = '';
        while (index < text.length && !/\s/.test(text[index])) link += text[index++];
        for (;;) {
            const next = text.slice(index).match(/^[ \t]*\r?\n[ \t]*([^\s]+)[ \t]*(?=\r?\n|$)/);
            if (!next || !LINK_CHARACTERS.test(next[1]) || new RegExp(`#(?:b64|z|${TEXT_KIND})=`).test(next[1])) break;
            link += next[1];
            index += next[0].length;
        }
        links.push(link.replace(/[)>\].,`*'"]+$/, ''));
        start.lastIndex = index;
    }
    return links;
}

/**
 * Returns the document a link carries.
 * @param {string} kind - "b64", "z" or "yaml".
 * @param {string} data - the encoded document.
 * @returns {Promise<string>} the text.
 * @throws {Error} when the link is too long or cannot be decoded.
 */
async function getLinkText(kind, data) {
    if (data.length > MAX_ENCODED_TEXT) throw new Error('The link is too long.');
    if (kind === TEXT_KIND) return data;
    const bytes = convertFromBase64(data);
    return kind === 'z' ? expandText(bytes) : new TextDecoder().decode(bytes);
}

/**
 * Adds one part of a long document to the parts collected in localStorage. A command that
 * returns what it collected: the joined text once every part is there.
 * @param {HashLink} link - the part.
 * @returns {{data?: string, missing?: number[], error?: boolean}} the joined text, the parts
 *   still missing, or error when there are too many or too large parts.
 */
function addLinkPart(link) {
    const key = PARTS + link.kind + '.' + link.id;
    let parts = {};
    try { parts = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { /* storage blocked */ }
    if (parts.of !== link.of || !(Date.now() - (parts.t || 0) < PART_LIFETIME)) parts = { of: link.of, p: {}, t: Date.now() };
    parts.p[link.part] = link.data;
    if (link.of > MAX_PARTS || Object.values(parts.p).reduce((sum, value) => sum + value.length, 0) > MAX_ENCODED_TEXT) {
        try { localStorage.removeItem(key); } catch (e) { /* storage blocked */ }
        return { error: true };
    }
    const missing = [];
    for (let number = 1; number <= link.of; number++) if (!(number in parts.p)) missing.push(number);
    try {
        if (missing.length) localStorage.setItem(key, JSON.stringify(parts));
        else localStorage.removeItem(key);
    } catch (e) { /* storage blocked: parts cannot be collected */ }
    return missing.length ? { missing } : { data: Array.from({ length: link.of }, (_, index) => parts.p[index + 1]).join('') };
}

/**
 * Reads one link: its document, or the parts still missing, or that it is damaged. A part of a
 * long document is collected (see addLinkPart()).
 * @param {string} hash - the part after the #.
 * @returns {Promise<LinkResult|null>} what the link holds, null when it carries no document.
 */
export async function readLink(hash) {
    const link = readHash(hash);
    if (!link) return null;
    let data = link.data;
    if (link.of > 1) {
        const collected = addLinkPart(link);
        if (collected.error) return { error: true };
        if (collected.missing) return { missing: collected.missing, part: link.part, of: link.of };
        data = collected.data;
    }
    try {
        const text = await getLinkText(link.kind, data);
        if (!text.trim() || /\uFFFD/.test(text)) throw new Error('no text');
        return { text, mode: link.mode, target: link.target };
    } catch (e) { return { error: true }; }
}
