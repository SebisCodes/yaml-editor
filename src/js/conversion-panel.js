/**
 * The "Convert" tab of the side panel and Format: the document written again with consistent
 * indentation (comments stay), and its data converted to JSON, JSON Lines, CSV, XML or the
 * tree as plain text, to copy, download or open in the JSON Editor. The page around the editor
 * gets its documents tidied with getTidyCode() (?tidy=1, sync.js).
 */

import { parse, importYamlLibrary, getModelValue, getIndentUnit } from './datatree.js?v=12';
import { convertToJson, convertToJsonl, convertToCsv, convertToXml, getTreeText, formatYaml } from './convert.js?v=13';
import { state, ui, areas, FORMAT, SYNTAX_ERROR, showToast, translate, getElement, hasData } from './state.js?v=2';
import { setCode } from './history.js?v=3';
import { saveFile, getSafeName } from './util.js?v=3';

/** The message when there is no data to convert. */
const NO_DATA = 'The document has no data yet';
/** The indentation Format uses when nothing else is chosen. */
export const FORMAT_INDENT = 2;
/** The other number of spaces the indentation choice offers. */
const WIDE_INDENT = 4;
/** The file extension and media type of each result. */
const RESULT_TYPES = {
    json: { ext: 'json', mime: 'application/json' }, jsonl: { ext: 'jsonl', mime: 'application/x-ndjson' },
    csv: { ext: 'csv', mime: 'text/csv' }, xml: { ext: 'xml', mime: 'application/xml' }, txt: { ext: 'txt', mime: 'text/plain' },
};
/** The note below the result, by format. */
const RESULT_NOTES = {
    csv: 'Each object is a row, its keys are the columns. Texts that look like numbers are in quotes.',
    xml: 'The data is inside <root>; the items of an array are <item> elements.',
};
/** The size of the pieces bytes are turned into a string in, for base64. */
const BASE64_CHUNK = 0x8000;

/**
 * The data converted to another format.
 * @typedef {object} ConversionResult
 * @property {string} [text] - the result.
 * @property {string} [note] - a note for the user.
 * @property {string} [error] - why it cannot be converted.
 */

/**
 * Draws the "Convert" tab with the indentation of the document chosen, and its result.
 * @returns {void}
 */
export function renderConvertPanel() {
    ui.convert.innerHTML = `
        <h3>This document</h3>
        <label class="field"><span>Indentation</span><select id="cv-indent"><option value="2">2 spaces</option><option value="4">4 spaces</option><option value="tab">Tabs</option></select></label>
        <div class="button-row">
            <button type="button" class="button" data-cv="format" title="The same indentation everywhere; comments stay">Format</button>
        </div>
        <h3>Convert to</h3>
        <label class="field"><span>Format</span><select id="cv-to"><option value="json">JSON text</option><option value="jsonl">JSON Lines</option><option value="csv">CSV (an array of objects)</option><option value="xml">XML text</option><option value="txt">The tree as plain text</option></select></label>
        <p class="hint" id="cv-note"></p>
        <textarea id="cv-out" readonly spellcheck="false" aria-label="Result"></textarea>
        <div class="button-row two">
            <button type="button" class="button" id="cv-copy">Copy</button>
            <button type="button" class="button" id="cv-dl">Download</button>
            <button type="button" class="button" id="cv-new" title="Opens the result as a new document in this editor">Open as a new document</button>
            <button type="button" class="button" id="cv-other" title="Opens the result as a new document in the ${FORMAT.other.name} (in a new tab)">Open in the ${FORMAT.other.name}</button>
        </div>`;
    const unit = getIndentUnit(state.code);
    getElement('#cv-indent').value = unit === '\t' ? 'tab' : unit.length === WIDE_INDENT ? String(WIDE_INDENT) : String(FORMAT_INDENT);
    renderConvertResult();
}

/**
 * Returns the indentation chosen in the tab.
 * @returns {string|number} "\t" for tabs, else the number of spaces.
 */
function getIndentChoice() {
    const choice = getElement('#cv-indent')?.value || '2';
    return choice === 'tab' ? '\t' : +choice;
}

/**
 * Returns the data of the document converted to another format.
 * @param {string} kind - "json", "jsonl", "csv", "xml" or "txt".
 * @param {string|number} [indent] - the indentation of JSON.
 * @param {boolean} [guard] - true to keep CSV cells from running as spreadsheet formulas.
 * @returns {Promise<ConversionResult>} the result, or why there is none.
 */
export async function convertDocument(kind, indent = FORMAT_INDENT, guard = false) {
    if (!hasData()) return { error: NO_DATA };
    if (state.model.broken) return { error: SYNTAX_ERROR };
    const value = getModelValue(state.model);
    if (kind === 'jsonl') return convertToJsonl(state.model.docs.length > 1 ? value : Array.isArray(value) ? value : [value]);
    if (kind === 'json') return { text: convertToJson(value, indent === '\t' ? '\t' : indent), note: state.model.docs.length > 1 ? 'The file has several documents - they become one JSON array.' : '' };
    if (kind === 'csv') return convertToCsv(value, ',', guard);
    if (kind === 'xml') return { text: convertToXml(value) };
    if (kind === 'txt') return { text: getTreeText(state.model, translate) };
    return { error: 'unknown format' };
}

/**
 * Draws the result of the chosen format in the tab, with its note.
 * @returns {Promise<void>} resolves when it is drawn.
 */
export async function renderConvertResult() {
    const output = getElement('#cv-out');
    if (!output) return;
    const kind = getElement('#cv-to').value;
    const result = await convertDocument(kind, getIndentChoice());
    output.value = result.text ?? '';
    getElement('#cv-note').textContent = result.error || result.note || RESULT_NOTES[kind] || '';
    getElement('#cv-other').hidden = kind !== FORMAT.other.kind;
    getElement('#cv-new').hidden = true;
}

/**
 * Connects the tab: the choices draw the result again, Format writes the document again, and
 * the result is copied, downloaded or opened in the other editor. Connects the Format button
 * of the code too.
 * @returns {void}
 */
export function startConversionPanel() {
    ui.convert.addEventListener('change', event => { if (event.target.id === 'cv-to' || event.target.id === 'cv-indent') renderConvertResult(); });
    ui.convert.addEventListener('click', handleConvertClick);
    getElement('#btn-format').addEventListener('click', () => formatDocument(FORMAT_INDENT));
}

/**
 * Runs the button clicked in the tab (a click handler).
 * @param {MouseEvent} event - the click.
 * @returns {Promise<void>} resolves when the action is done.
 */
async function handleConvertClick(event) {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.cv) { await formatDocument(getIndentChoice()); return; }
    const kind = getElement('#cv-to').value;
    const result = await convertDocument(kind, getIndentChoice());
    if (result.error) { showToast(result.error); return; }
    if (button.id === 'cv-copy') await copyResult(result.text);
    if (button.id === 'cv-dl') { saveFile(result.text, `${getSafeName(state.name)}.${RESULT_TYPES[kind].ext}`, RESULT_TYPES[kind].mime); showToast('Downloaded'); }
    if (button.id === 'cv-other') openInOtherEditor(result.text);
}

/**
 * Copies the result to the clipboard, or with the browser's copy command where the clipboard
 * is not allowed.
 * @param {string} text - the result.
 * @returns {Promise<void>} resolves when it is copied.
 */
async function copyResult(text) {
    try { await navigator.clipboard.writeText(text); } catch (err) { getElement('#cv-out').select(); document.execCommand('copy'); }
    showToast('Copied to the clipboard');
}

/**
 * Opens the result as a new document in the JSON Editor, in a new tab (a link with #b64=).
 * @param {string} text - the result.
 * @returns {void}
 */
function openInOtherEditor(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let index = 0; index < bytes.length; index += BASE64_CHUNK) binary += String.fromCharCode.apply(null, bytes.subarray(index, index + BASE64_CHUNK));
    const base64 = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    window.open(`${FORMAT.other.site}#b64=${base64}&file=new&name=${encodeURIComponent(state.name)}`, '_blank', 'noopener');
}

/**
 * Format: the whole document written again with consistent indentation, comments kept; one
 * undo step, the place in the tree stays selected.
 * @param {string|number} indent - "\t" (written with 2 spaces) or the number of spaces.
 * @returns {Promise<void>} resolves when it is done.
 */
export async function formatDocument(indent) {
    if (!state.model || state.model.broken) { showToast(SYNTAX_ERROR); return; }
    if (!hasData()) { showToast(NO_DATA); return; }
    await importYamlLibrary();
    let code;
    try { code = formatYaml(state.code, typeof indent === 'number' ? indent : indent === '\t' ? FORMAT_INDENT : indent.length || FORMAT_INDENT); } catch (e) { showToast(e.message); return; }
    if (code === state.code) { showToast('The document is formatted already'); return; }
    const place = areas.tree.getSelectedPlace();
    setCode(code);
    if (place) areas.tree.select(place);
    showToast('Formatted');
}

/**
 * Returns a document's code as Format writes it, for a document the page hands over with
 * ?tidy=1 or tidy: true (sync.js); code with a syntax error or without data comes back as it is.
 * @param {string} code - the code.
 * @returns {Promise<string>} the tidied code.
 */
export async function getTidyCode(code) {
    const model = parse(FORMAT.editor, code);
    if (model.broken || !model.docs.some(doc => doc.root)) return code;
    await importYamlLibrary();
    return formatYaml(code, FORMAT_INDENT);
}
