/**
 * The placeholders, examples and example pictures a page sends for its template (the message
 * "<P>:template" or the field `template` of "<P>:load"), checked once and kept in memory only.
 *
 * createTemplateExamples() runs these steps:
 *   1. take the placeholders: the first 200, each with a valid name and kind (a value without
 *      one), its texts as plain text without control characters and cut at their limits, names
 *      as literal keys;
 *   2. take the example pictures: at most 20 under plain names and 40 MB, each checked by
 *      template-pictures.js (type by signature, size, decoding);
 *   3. hand back the examples with their placeholders by name; close() lets go of the pictures'
 *      object addresses.
 * Without a list from the page, buildDocumentPlaceholders() lists the tags of the document.
 * Every editor with template placeholders uses this same file; it works on plain data, so it
 * runs in Node as well.
 */

import { getTemplateTags } from './template-tags.js?v=2';
import { checkExamplePicture, readPictureSizeInBrowser } from './template-pictures.js?v=1';

/** The most placeholders of one message, and the most fields of one list. */
const MAX_PLACEHOLDERS = 200;
const MAX_FIELDS = 50;
/** The most example rows of one list. */
const MAX_ROWS = 50;
/** How deep lists may hold lists in their fields. */
const MAX_FIELD_DEPTH = 3;
/** The limits of the texts, in characters. */
export const NAME_LIMIT = 60;
const LABEL_LIMIT = 80;
const DESCRIPTION_LIMIT = 300;
const EXAMPLE_LIMIT = 2000;
/** The most example pictures, and the most characters of their data addresses together. */
const MAX_PICTURES = 20;
const MAX_PICTURE_CHARACTERS = 40e6;
/** A placeholder's name: a letter or _, then letters, digits, _, . or -. */
const NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
/** A plain name of an example picture. */
const PICTURE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$/;
/** The kinds a placeholder may have. */
const KINDS = new Set(['value', 'image', 'section', 'list']);
/** Control characters and the characters that turn the direction of text. */
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;
/** A UTF-16 surrogate without its partner. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * One placeholder as the editor keeps it.
 * @typedef {object} TemplatePlaceholder
 * @property {string} name - the tag's name without delimiters.
 * @property {string} kind - value, image, section or list.
 * @property {string} label - what a person reads; the name when the page sent none.
 * @property {string} description - an explanation, empty without one.
 * @property {?string} example - value: the example text, null without one.
 * @property {?string} image - image: the name of its example picture, null without one.
 * @property {?boolean} shown - section: the example state, null without one.
 * @property {TemplatePlaceholder[]} fields - list: the placeholders of one entry.
 * @property {Map<string, TemplatePlaceholder>} fieldsByName - list: the fields by name.
 * @property {?Array<Map<string, (string|boolean)>>} rows - list: the example entries, null when the page sent none.
 */

/**
 * The checked examples of one message.
 * @typedef {object} TemplateExamples
 * @property {TemplatePlaceholder[]} placeholders - the placeholders in the page's order.
 * @property {Map<string, TemplatePlaceholder>} byName - the placeholders by name (the first of a name counts).
 * @property {Map<string, import('./template-pictures.js').ExamplePicture>} pictures - the example pictures by name.
 * @property {function(string): ?string} getPictureAddress - the object address of an example picture by name (made once, kept until close), null for an unknown name.
 * @property {function(): void} close - lets go of the object addresses of the pictures.
 */

/**
 * Tells whether a message ends the page's placeholders ({ clear: true }).
 * @param {*} message - the message or the `template` field.
 * @returns {boolean} true for a clear.
 */
export function isTemplateClear(message) {
    return !message || typeof message !== 'object' || message.clear === true;
}

/**
 * Creates the examples of a message (the steps in the header).
 * @param {object} message - the message or the `template` field of a load.
 * @param {object} [options] - how pictures are decoded.
 * @param {import('./template-pictures.js').PictureDecoder} [options.decodePicture] - the decoder; the browser's
 *     createImageBitmap by default.
 * @returns {Promise<TemplateExamples>} the examples.
 */
export async function createTemplateExamples(message, { decodePicture = readPictureSizeInBrowser } = {}) {
    const placeholders = getPlaceholderList(message.placeholders, 0, MAX_PLACEHOLDERS);
    const pictures = await collectExamplePictures(message.assets, decodePicture);
    return createExamplesObject(placeholders, pictures);
}

/**
 * Creates the examples object around checked placeholders and pictures.
 * @param {TemplatePlaceholder[]} placeholders - the placeholders.
 * @param {Map<string, import('./template-pictures.js').ExamplePicture>} pictures - the pictures by name.
 * @returns {TemplateExamples} the examples.
 */
function createExamplesObject(placeholders, pictures) {
    const addresses = new Map();
    return {
        placeholders, byName: buildNameMap(placeholders), pictures,
        getPictureAddress: name => getPictureObjectAddress(pictures, addresses, name),
        close: () => { for (const address of addresses.values()) URL.revokeObjectURL(address); addresses.clear(); },
    };
}

/**
 * Returns the object address of an example picture, made once and kept until close(). A query
 * that fills a cache.
 * @param {Map<string, import('./template-pictures.js').ExamplePicture>} pictures - the pictures by name.
 * @param {Map<string, string>} addresses - the addresses made so far; changed in place.
 * @param {string} name - the picture's name.
 * @returns {?string} the blob: address, null for an unknown name.
 */
function getPictureObjectAddress(pictures, addresses, name) {
    const picture = pictures.get(name);
    if (!picture) return null;
    if (!addresses.has(name)) addresses.set(name, URL.createObjectURL(new Blob([picture.bytes], { type: picture.type })));
    return addresses.get(name);
}

/**
 * Returns the placeholders of a list sent by the page: entries with a valid name and kind, in
 * order, at most a limit.
 * @param {*} list - the page's list.
 * @param {number} depth - how deep in list fields the list stands (0 for the top).
 * @param {number} limit - the most entries taken.
 * @returns {TemplatePlaceholder[]} the placeholders.
 */
function getPlaceholderList(list, depth, limit) {
    if (!Array.isArray(list)) return [];
    const placeholders = [];
    for (const entry of list.slice(0, limit)) {
        const placeholder = getPlaceholder(entry, depth);
        if (placeholder) placeholders.push(placeholder);
    }
    return placeholders;
}

/**
 * Returns one checked placeholder; an entry without a kind is a value.
 * @param {*} entry - the page's entry.
 * @param {number} depth - how deep in list fields the entry stands.
 * @returns {?TemplatePlaceholder} the placeholder, or null without a valid name and kind.
 */
function getPlaceholder(entry, depth) {
    if (!entry || typeof entry !== 'object' || !isPlaceholderName(entry.name)) return null;
    const kind = entry.kind === undefined ? 'value' : KINDS.has(entry.kind) ? entry.kind : null;
    if (!kind || (kind === 'list' && depth >= MAX_FIELD_DEPTH)) return null;
    const fields = kind === 'list' ? getPlaceholderList(entry.fields, depth + 1, MAX_FIELDS) : [];
    return {
        name: entry.name, kind,
        label: getPlainText(entry.label, LABEL_LIMIT, true) || entry.name,
        description: getPlainText(entry.description, DESCRIPTION_LIMIT, true),
        example: kind === 'value' && isTextValue(entry.example) ? getPlainText(entry.example, EXAMPLE_LIMIT, false) : null,
        image: kind === 'image' && typeof entry.image === 'string' && PICTURE_NAME.test(entry.image) ? entry.image : null,
        shown: kind === 'section' && typeof entry.shown === 'boolean' ? entry.shown : null,
        fields, fieldsByName: buildNameMap(fields),
        rows: kind === 'list' && Array.isArray(entry.rows) ? entry.rows.slice(0, MAX_ROWS).map(getRow) : null,
    };
}

/**
 * Tells whether a value is a placeholder's name.
 * @param {*} name - the value.
 * @returns {boolean} true for a string of at most 60 characters in the name's form.
 */
export function isPlaceholderName(name) {
    return typeof name === 'string' && name.length <= NAME_LIMIT && NAME.test(name);
}

/**
 * Tells whether a value can be an example text: a string, a finite number or a boolean.
 * @param {*} value - the value.
 * @returns {boolean} true when it reads as a text.
 */
function isTextValue(value) {
    return typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
}

/**
 * Returns one example row of a list: its fields by name as texts, or true / false for the state
 * of a section field.
 * @param {*} row - the page's row.
 * @returns {Map<string, (string|boolean)>} the row's values by field name.
 */
function getRow(row) {
    const values = new Map();
    if (!row || typeof row !== 'object' || Array.isArray(row)) return values;
    for (const name of Object.keys(row).slice(0, MAX_FIELDS)) {
        const value = row[name];
        if (!isPlaceholderName(name) || !isTextValue(value)) continue;
        values.set(name, typeof value === 'boolean' ? value : getPlainText(value, EXAMPLE_LIMIT, false));
    }
    return values;
}

/**
 * Returns placeholders by name; the first of a name counts.
 * @param {TemplatePlaceholder[]} placeholders - the placeholders.
 * @returns {Map<string, TemplatePlaceholder>} the map.
 */
function buildNameMap(placeholders) {
    const byName = new Map();
    for (const placeholder of placeholders) if (!byName.has(placeholder.name)) byName.set(placeholder.name, placeholder);
    return byName;
}

/**
 * Returns a text as plain text: control characters and direction marks removed, line breaks as
 * \n (on one line where asked), cut at a limit of characters.
 * @param {*} value - the value; a number or boolean counts as its text, anything else as empty.
 * @param {number} limit - the most characters (code points) kept.
 * @param {boolean} oneLine - true to turn line breaks and tabs into spaces.
 * @returns {string} the plain text.
 */
export function getPlainText(value, limit, oneLine) {
    if (!isTextValue(value)) return '';
    let text = String(value).replace(/\r\n?/g, '\n').replace(CONTROL_CHARACTERS, '').replace(LONE_SURROGATE, '�');
    if (oneLine) text = text.replace(/[\n\t]+/g, ' ').trim();
    const characters = Array.from(text);
    return characters.length > limit ? characters.slice(0, limit).join('') : text;
}

/**
 * Collects the example pictures of a message: plain names, at most 20 and 40 MB of data
 * addresses together, each one checked.
 * @param {*} assets - the page's `assets`.
 * @param {import('./template-pictures.js').PictureDecoder} decodePicture - the decoder.
 * @returns {Promise<Map<string, import('./template-pictures.js').ExamplePicture>>} the pictures by name.
 */
async function collectExamplePictures(assets, decodePicture) {
    const pictures = new Map();
    if (!assets || typeof assets !== 'object' || Array.isArray(assets)) return pictures;
    let characters = 0;
    const entries = [];
    for (const name of Object.keys(assets)) {
        const dataUrl = assets[name];
        if (entries.length >= MAX_PICTURES || !PICTURE_NAME.test(name) || typeof dataUrl !== 'string') continue;
        characters += dataUrl.length;
        if (characters > MAX_PICTURE_CHARACTERS) break;
        entries.push([name, dataUrl]);
    }
    const checked = await Promise.all(entries.map(([name, dataUrl]) => checkExamplePicture(name, dataUrl, decodePicture)));
    for (const picture of checked) if (picture) pictures.set(picture.name, picture);
    return pictures;
}

/**
 * Lists the placeholders the tags of a document name, for a page that sent no list: a name
 * with a section tag is a section, any other a value; in the order of their first tag.
 * @param {string} code - the document's code.
 * @param {import('./template-tags.js').TemplateSyntax} syntax - the syntax.
 * @returns {TemplatePlaceholder[]} the placeholders, without examples.
 */
export function buildDocumentPlaceholders(code, syntax) {
    const byName = new Map();
    for (const tag of getTemplateTags(code, syntax)) {
        if (tag.kind === 'unknown') continue;
        const isSection = tag.kind !== 'value';
        const known = byName.get(tag.name);
        if (known) { if (isSection) known.kind = 'section'; continue; }
        byName.set(tag.name, { name: tag.name, kind: isSection ? 'section' : 'value', label: tag.name, description: '', example: null, image: null, shown: null, fields: [], fieldsByName: new Map(), rows: null });
    }
    return [...byName.values()];
}

/**
 * Returns the tag a placeholder is written with: the value tag, or the start and end tag of a
 * section.
 * @param {TemplatePlaceholder} placeholder - the placeholder.
 * @param {import('./template-tags.js').TemplateSyntax} syntax - the syntax.
 * @returns {{start: string, end: string}} the start tag and the end tag (empty for a value or picture).
 */
export function buildPlaceholderTags(placeholder, syntax) {
    if (placeholder.kind === 'value' || placeholder.kind === 'image') return { start: syntax.formatTag('', placeholder.name), end: '' };
    return { start: syntax.formatTag(syntax.openSign, placeholder.name), end: syntax.formatTag(syntax.closeSign, placeholder.name) };
}
