/**
 * The model that "Open in another editor" converts documents through,
 * shared by the readers and writers of Markdown, HTML, LaTeX and Typst
 * (convert-md.js, convert-html.js, convert-latex.js, convert-typst.js):
 *
 * - a document is a list of blocks (`Block`), a block holds inline parts (`InlinePart`);
 * - what a format cannot hold goes into a `Set` of loss texts (`LossSet`) that the
 *   caller hands to every reader and writer. Readers and writers return their result
 *   and add to that set: it is a collecting parameter and the only state they change;
 * - footnotes collected while writing Markdown or HTML are listed at the end of the
 *   document (`resetNotes`, `addNote`, `getNotes`).
 *
 * The loss texts are the English keys of the language packs (`common.js`): they are
 * shown through the editor's translation and must keep their wording.
 */

/**
 * One inline part of a block.
 * @typedef {object} InlinePart
 * @property {'text'|'b'|'i'|'s'|'code'|'math'|'link'|'img'|'br'|'note'} t - the kind of part.
 * @property {string} [v] - the text of a text, code, math or picture (alternative text) part.
 * @property {InlinePart[]} [kids] - the parts inside bold, italic, struck, link and note parts.
 * @property {string} [url] - the address of a link or picture.
 * @property {boolean} [typst] - true when a math part is written in Typst notation.
 */

/**
 * The items of a list: each item is a list of blocks, marked as a task when it has a box.
 * @typedef {Block[] & {task?: 'open'|'done'}} ListItem
 */

/**
 * One block of a document.
 * @typedef {object} Block
 * @property {'heading'|'para'|'list'|'quote'|'code'|'math'|'hr'|'table'|'pagebreak'} t - the kind of block.
 * @property {number} [level] - the level of a heading, 1 to 6.
 * @property {InlinePart[]|Block[]} [kids] - the parts of a heading or paragraph, the blocks of a quote.
 * @property {string} [v] - the text of a code or math block.
 * @property {string} [lang] - the language named on a code block.
 * @property {boolean} [typst] - true when a math block is written in Typst notation.
 * @property {boolean} [ordered] - true for a numbered list.
 * @property {ListItem[]} [items] - the items of a list.
 * @property {InlinePart[][][]} [rows] - the rows of a table, each a list of cells.
 */

/**
 * The texts of what a conversion loses, collected while reading and writing.
 * @typedef {Set<string>} LossSet
 */

/**
 * The result of a conversion.
 * @typedef {object} ConversionResult
 * @property {string} code - the document in the target format.
 * @property {string[]} lost - the loss texts: what the target format cannot hold.
 */

/** The loss texts, also the keys of their translations. */
export const LOSS = {
    formulas: 'Formulas are copied as written: check them',
    formulasAsCode: 'Formulas become plain code',
    scripts: 'Scripts and styles',
    formFields: 'Form fields',
    latexCommands: 'LaTeX commands and environments without an equivalent',
    references: 'Footnotes, labels and references',
    documentSettings: 'Document class, packages and page settings',
    tableOfContents: 'The table of contents',
    typstFunctions: 'Typst functions without an equivalent',
    unsafeLinks: 'Links with an unsafe address',
    comments: 'Comments',
    duplicateColumns: 'Column names that occur twice (numbered)',
    extraFields: 'Fields beyond the header (named Column N)',
    firstListOnly: 'Only the first list goes into the table',
    nestedValues: 'Nested values go into one cell as JSON',
    shlsText: 'Types of values: SHLS holds every value as text',
    invalidXmlNames: 'Keys that are not valid XML names are changed',
    tomlNull: 'Empty values (null): TOML has no null',
    tomlNoTable: 'The data is not a table: it goes under the key "value"',
};

/** Link and picture addresses that are written into a result: web, mail, anchors and plain paths. */
const SAFE_URL = /^(https?:|mailto:|#|[\w./-]+$)/i;

/** The characters that HTML and XML text and attribute values escape. */
const MARKUP_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

/** Footnotes collected while writing Markdown or HTML, listed at the end of the document. */
let collectedNotes = [];

/**
 * Returns an address when it is safe to write into a document, else an empty text.
 * @param {string} url - the address as the document gives it.
 * @returns {string} the trimmed address, or '' when it is not safe.
 */
export function getSafeUrl(url) {
    return SAFE_URL.test(String(url).trim()) ? String(url).trim() : '';
}

/**
 * Returns the safe address of a link or picture part and lists an unsafe one as lost.
 * @param {InlinePart} part - the link or picture part.
 * @param {LossSet} lost - the loss texts of this conversion.
 * @returns {string} the address, or '' when it is not safe.
 */
export function getLinkUrl(part, lost) {
    const url = getSafeUrl(part.url);
    if (!url) lost.add(LOSS.unsafeLinks);
    return url;
}

/**
 * Creates a text part.
 * @param {string} value - the text.
 * @returns {InlinePart} the text part.
 */
export function createTextPart(value) {
    return { t: 'text', v: value };
}

/**
 * Escapes a text for HTML or XML content and attribute values.
 * @param {string} text - the plain text.
 * @returns {string} the escaped text.
 */
export function escapeHtml(text) {
    return String(text).replace(/[&<>"]/g, char => MARKUP_ESCAPES[char]);
}

/**
 * Returns inline parts without white space at their start and end.
 * @param {InlinePart[]} parts - the inline parts of a block.
 * @returns {InlinePart[]} a new list: empty text parts at both ends dropped, the outer texts trimmed.
 */
export function getTrimmedParts(parts) {
    const trimmed = parts.slice();
    while (trimmed.length && trimmed[0].t === 'text' && !trimmed[0].v.trim()) trimmed.shift();
    while (trimmed.length && trimmed[trimmed.length - 1].t === 'text' && !trimmed[trimmed.length - 1].v.trim()) trimmed.pop();
    if (trimmed[0]?.t === 'text') trimmed[0] = createTextPart(trimmed[0].v.replace(/^\s+/, ''));
    const last = trimmed.length - 1;
    if (trimmed[last]?.t === 'text') trimmed[last] = createTextPart(trimmed[last].v.replace(/\s+$/, ''));
    return trimmed;
}

/**
 * Returns a text with every line but the first indented.
 * @param {string} text - the lines.
 * @param {string} indentation - the white space put in front of each following line that is not empty.
 * @returns {string} the indented text.
 */
export function formatIndentedLines(text, indentation) {
    return text.split('\n').map((line, index) => (index && line ? indentation + line : line)).join('\n');
}

/**
 * Starts an empty list of collected footnotes for the next document.
 * @returns {void}
 */
export function resetNotes() {
    collectedNotes = [];
}

/**
 * Adds a written footnote to the list of the document being written.
 * @param {string} note - the footnote in the target format.
 * @returns {void}
 */
export function addNote(note) {
    collectedNotes.push(note);
}

/**
 * Returns the footnotes collected for the document being written.
 * @returns {string[]} the footnotes in order; their number is the position plus one.
 */
export function getNotes() {
    return collectedNotes;
}
