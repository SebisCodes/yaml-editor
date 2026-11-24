/**
 * "Open in another editor": turns the document into another format in the
 * browser and opens the result as a new document in that editor. The same file in every
 * editor that takes part, together with its modules:
 *
 * - documents (md, latex, typst, html) go through a small model of blocks and inline
 *   parts (convert-model.js), read and written by convert-md.js, convert-html.js,
 *   convert-latex.js and convert-typst.js, formulas by convert-math.js;
 * - data (json, yaml, toml, shls, xml, csv) goes through plain values (convert-data.js,
 *   convert-data-write.js).
 *
 * What a format cannot hold is collected in `lost`, shown and confirmed first.
 * A document is untrusted: nothing is run, and html is read with DOMParser, which runs nothing.
 *
 * Opening the other editor:
 * 1. the user picks "Open in another editor" in the Export dialog and a target format;
 * 2. the document is converted; what is lost is shown and must be confirmed;
 * 3. the result is compressed into a `#z=` link with `file=new` and the document name;
 * 4. the link opens the other editor in a new tab, on the same language page.
 */

import { openConfirmation } from './dialogs.js?v=5';
import { resetNotes, getNotes } from './convert-model.js?v=2';
import { parseMarkdown, formatMarkdownBlocks, formatMarkdownNotes, formatMarkdownDocument } from './convert-md.js?v=3';
import { parseHtml, formatHtmlBlocks, formatHtmlNotes, formatHtmlDocument } from './convert-html.js?v=2';
import { parseLatex, formatLatexBlocks, formatLatexDocument } from './convert-latex.js?v=3';
import { parseTypst, formatTypstBlocks, formatTypstDocument } from './convert-typst.js?v=3';
import { convertData } from './convert-data.js?v=6';

/** The formats of the document group. */
export const DOCS = ['md', 'latex', 'typst', 'html'];
/** The formats of the data group. */
export const DATA = ['json', 'yaml', 'toml', 'shls', 'xml', 'csv'];
/** The name of each format on its button. */
const NAMES = { md: 'Markdown', latex: 'LaTeX', typst: 'Typst', html: 'HTML', json: 'JSON', yaml: 'YAML', toml: 'TOML', shls: 'SHLS', xml: 'XML', csv: 'CSV' };
/** The local port of each editor, used when the editor runs on this machine. */
const PORTS = { latex: 8094, html: 8095, md: 8192, json: 8101, yaml: 8102, xml: 8103, csv: 8104, typst: 8105, shls: 8106, toml: 8108 };
/** The value of the entry in the format list of Export. */
const CONVERT = 'convert';
/** The longest link that is opened: browsers open addresses up to about 2 MB. */
const MAX_LINK = 1900000;
/** How many bytes go into one call of String.fromCharCode. */
const BYTE_CHUNK = 0x8000;
/** The texts shown to the user, also the keys of their translations. */
const TEXTS = {
    entry: 'Open in another editor',
    filesStay: 'Pictures and other files of the document stay here: add them again in the other editor',
    askTitle: 'Not everything can be converted',
    askOk: 'Open anyway',
    tooLong: 'The document is too long for a link - export it and open the file in the other editor',
    failed: 'It could not be converted',
};

/**
 * How a document format is read into blocks.
 * @type {Object<string, function(string, import('./convert-model.js').LossSet): import('./convert-model.js').Block[]>}
 */
const DOCUMENT_READERS = {
    md: code => parseMarkdown(code),
    html: parseHtml,
    latex: parseLatex,
    typst: parseTypst,
};

/**
 * How blocks are written in a document format.
 * @typedef {object} DocumentWriter
 * @property {function(import('./convert-model.js').Block[], import('./convert-model.js').LossSet): string} formatBlocks - writes the blocks.
 * @property {function(string, string[]): string} formatNotes - appends the collected footnotes to the body.
 * @property {function(string, string): string} formatDocument - returns the whole document around the body, given the name.
 */

/** @type {Object<string, DocumentWriter>} */
const DOCUMENT_WRITERS = {
    md: { formatBlocks: formatMarkdownBlocks, formatNotes: formatMarkdownNotes, formatDocument: formatMarkdownDocument },
    html: { formatBlocks: formatHtmlBlocks, formatNotes: formatHtmlNotes, formatDocument: formatHtmlDocument },
    latex: { formatBlocks: formatLatexBlocks, formatNotes: body => body, formatDocument: formatLatexDocument },
    typst: { formatBlocks: formatTypstBlocks, formatNotes: body => body, formatDocument: formatTypstDocument },
};

/**
 * The editor that the Export row belongs to, as its app.js hands it over.
 * @typedef {object} ConvertEditor
 * @property {string} editor - the editor's format (md, json, ...).
 * @property {function(): string} code - returns the current document.
 * @property {function(): string} name - returns the document name.
 * @property {function(): boolean} [hasFiles] - tells whether the document has pictures or other files.
 * @property {function(string): void} toast - shows a short message.
 * @property {function(string): string} t - translates an English text.
 */

/* ---------- Converting ---------- */

/**
 * Converts a document into another format of its group.
 * @param {string} from - the source format.
 * @param {string} to - the target format.
 * @param {string} code - the source document.
 * @param {string} name - the document name.
 * @returns {Promise<import('./convert-model.js').ConversionResult>} the converted document and what is lost.
 * @throws {Error} when the source cannot be read or the data does not fit the target.
 */
export async function convert(from, to, code, name) {
    return DOCS.includes(from) && DOCS.includes(to) ? convertDocument(from, to, code, name) : convertData(from, to, code, name);
}

/**
 * Converts a document of the document group through the block model.
 * @param {string} from - the source format: md, html, latex or typst.
 * @param {string} to - the target format: md, html, latex or typst.
 * @param {string} code - the source document.
 * @param {string} name - the document name, the title of an HTML document.
 * @returns {import('./convert-model.js').ConversionResult} the converted document and what is lost.
 */
function convertDocument(from, to, code, name) {
    const lost = new Set();
    const read = DOCUMENT_READERS[from];
    const writer = DOCUMENT_WRITERS[to];
    resetNotes();
    const blocks = writer.formatBlocks(read(code, lost), lost);
    const body = writer.formatNotes(blocks, getNotes());
    return { code: writer.formatDocument(body, name), lost: [...lost] };
}

/* ---------- Opening the other editor ---------- */

/**
 * Returns the address of another editor: the local server while this one runs locally.
 * @param {string} editor - the target format.
 * @returns {string} the address of the editor's page, ending with `/`.
 */
function getEditorSite(editor) {
    if (/^(127\.0\.0\.1|localhost)$/.test(location.hostname)) return `http://${location.hostname}:${PORTS[editor]}/`;
    return `https://${editor}.giit.ch/`;
}

/**
 * Compresses a text with deflate.
 * @param {string} text - the text.
 * @returns {Promise<Uint8Array>} the compressed bytes.
 */
async function compressText(text) {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Converts bytes to base64url without padding.
 * @param {Uint8Array} bytes - the bytes.
 * @returns {string} the base64url text.
 */
function convertToBase64Url(bytes) {
    let binary = '';
    for (let start = 0; start < bytes.length; start += BYTE_CHUNK) binary += String.fromCharCode.apply(null, bytes.subarray(start, start + BYTE_CHUNK));
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Returns the link that opens a document as a new document in another editor, on the
 * language page this editor shows.
 * @param {string} editor - the target format.
 * @param {string} code - the document in the target format.
 * @param {string} name - the document name.
 * @returns {Promise<string>} the link with `#z=`, `file=new` and `name=`.
 */
async function getEditorLink(editor, code, name) {
    const compressed = convertToBase64Url(await compressText(code));
    const lang = /^\/([a-z]{2})\//.exec(location.pathname)?.[1];
    return `${getEditorSite(editor)}${lang ? lang + '/' : ''}#z=${compressed}&file=new&name=${encodeURIComponent(name)}`;
}

/* ---------- The row in the Export dialog ---------- */

/**
 * Adds "Open in another editor" to the Export dialog: an entry of the format list and a
 * row of buttons, one per other format of the editor's group. Not in the viewer.
 * @param {ConvertEditor} editor - the editor the dialog belongs to.
 * @returns {void}
 */
export function startConvert(editor) {
    const dialog = document.getElementById('export');
    const foot = dialog?.querySelector('.dialog-footer');
    if (!foot || new URLSearchParams(location.search).get('viewer') === '1') return;
    foot.before(createConvertRow(editor));
    addConvertEntry(dialog);
}

/**
 * Creates the row of buttons, one per other format of the editor's group.
 * @param {ConvertEditor} editor - the editor the dialog belongs to.
 * @returns {HTMLDivElement} the row.
 */
function createConvertRow(editor) {
    const group = DOCS.includes(editor.editor) ? DOCS : DATA;
    const row = document.createElement('div');
    row.className = 'ex-convert';
    for (const to of group) {
        if (to === editor.editor) continue;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'button small';
        button.dataset.to = to;
        button.setAttribute('data-no-i18n', '');
        button.textContent = NAMES[to];
        button.addEventListener('click', () => openConverted(editor, to));
        row.append(button);
    }
    return row;
}

/**
 * Adds the entry of the format list, selected at first: the buttons show only with it.
 * @param {HTMLDialogElement} dialog - the Export dialog.
 * @returns {void}
 */
function addConvertEntry(dialog) {
    const select = document.getElementById('ex-format');
    const entry = document.createElement('option');
    entry.value = CONVERT;
    entry.textContent = TEXTS.entry;
    select.prepend(entry);
    select.value = CONVERT;
    /**
     * Shows the row of buttons while the entry is selected.
     * @returns {void}
     */
    const showConvertRow = () => { dialog.classList.toggle('ex-convert-on', select.value === CONVERT); };
    select.addEventListener('change', showConvertRow);
    showConvertRow();
}

/**
 * Converts the document, lets the user confirm what is lost and opens the result in the
 * other editor; a failure is shown as a message.
 * @param {ConvertEditor} editor - the editor the dialog belongs to.
 * @param {string} to - the target format.
 * @returns {Promise<void>} resolves when the other editor is opened or the user stopped.
 */
async function openConverted(editor, to) {
    const name = document.getElementById('ex-name')?.value.trim() || editor.name();
    try {
        const result = await convert(editor.editor, to, editor.code(), name);
        const lost = [...result.lost];
        if (editor.hasFiles?.()) lost.push(TEXTS.filesStay);
        if (lost.length && !(await openConfirmation({ title: TEXTS.askTitle, text: lost.map(editor.t).join(' · '), ok: TEXTS.askOk }))) return;
        const link = await getEditorLink(to, result.code, name);
        if (link.length > MAX_LINK) { editor.toast(editor.t(TEXTS.tooLong)); return; }
        window.open(link, '_blank', 'noopener');
    } catch (error) {
        editor.toast(`${editor.t(TEXTS.failed)}: ${editor.t(error.message)}`);
    }
}
