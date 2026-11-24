/**
 * Opening files and pasting documents: every file opened with the button, "My documents" or
 * dropped on the page becomes a new document; JSON, JSON Lines, CSV and XML are converted to
 * YAML. A whole YAML document pasted outside the code replaces the open one (one undo step).
 */

import { parse, importYamlLibrary, getModelValue } from './datatree.js?v=13';
import { convertToYaml, convertFromJsonl, convertFromCsv, convertFromXml } from './convert.js?v=14';
import { FORMAT, TYPING_FIELDS, showToast, getElement } from './state.js?v=2';
import { setCode } from './history.js?v=4';
import { createDocument } from './documents.js?v=4';

/** The largest file that is opened, in bytes. */
const MAX_FILE_SIZE = 8 * 1024 * 1024;
/** The file names the editor opens. */
const OPENABLE_NAME = /\.(json|jsonc|json5|geojson|jsonl|ndjson|txt|yaml|yml|csv|tsv|xml)$/i;
/** The media types the editor opens. */
const OPENABLE_TYPE = /json|text|xml|yaml|csv/;
/** The start of a whole YAML document pasted outside the code. */
const PASTED_DOCUMENT = /^\s*(---|%YAML)/;
/** A pasted AI answer with a link; ai.js takes it. */
const PASTED_LINK = /#(b64|z|json|yaml)=/;

/**
 * A file's text as YAML.
 * @typedef {object} ImportedText
 * @property {string} code - the YAML.
 * @property {string} from - the format it was converted from, "" when it is taken as it is.
 */

const fileInput = getElement('#file');
let dragDepth = 0;

/**
 * Opens the browser's file picker.
 * @returns {void}
 */
export function openFilePicker() {
    fileInput.click();
}

/**
 * Connects the Open button, the file picker, dropping files on the page and pasting a whole
 * document.
 * @returns {void}
 */
export function startFileImport() {
    getElement('#btn-open').addEventListener('click', openFilePicker);
    fileInput.addEventListener('change', async () => { await openFiles([...fileInput.files]); fileInput.value = ''; });
    window.addEventListener('dragenter', event => { if (event.dataTransfer.types.includes('Files')) { dragDepth++; document.body.classList.add('drop'); event.preventDefault(); } });
    window.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); });
    window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('drop'); } });
    window.addEventListener('drop', openDroppedFiles);
    window.addEventListener('paste', importPastedDocument);
}

/**
 * Opens the files dropped on the page (a drop handler).
 * @param {DragEvent} event - the drop.
 * @returns {void}
 */
function openDroppedFiles(event) {
    dragDepth = 0;
    document.body.classList.remove('drop');
    const files = [...event.dataTransfer.files];
    if (!files.length) return;
    event.preventDefault();
    openFiles(files);
}

/**
 * Returns the text of a file as YAML, converted from its format.
 * @param {string} text - the file's text.
 * @param {string} fileName - its name; the extension says the format.
 * @returns {Promise<ImportedText>} the YAML and the format it came from.
 * @throws {Error} with a message for the user when the file cannot be read.
 */
async function convertFileText(text, fileName) {
    const extension = (/\.([a-z0-9]+)$/i.exec(fileName) || [])[1]?.toLowerCase() || '';
    await importYamlLibrary();
    if (/^(jsonl|ndjson)$/.test(extension)) return { code: convertToYaml(convertFromJsonl(text)), from: 'JSON Lines' };
    if (/^(json|jsonc|json5|geojson)$/.test(extension)) {
        const model = parse('json', text);
        if (model.broken) throw new Error(model.problems.find(problem => problem.kind === 'error').msg);
        return { code: convertToYaml(getModelValue(model)), from: 'JSON' };
    }
    if (extension === 'csv' || extension === 'tsv') return { code: convertToYaml(convertFromCsv(text)), from: 'CSV' };
    if (extension === 'xml') return { code: convertToYaml(convertFromXml(text)), from: 'XML' };
    return { code: text, from: '' };
}

/**
 * Opens every file as a new document; files of another kind or too large are named in a toast.
 * @param {File[]} files - the files.
 * @returns {Promise<void>} resolves when all are open.
 */
async function openFiles(files) {
    for (const file of files) {
        if (!OPENABLE_NAME.test(file.name) && !OPENABLE_TYPE.test(file.type)) { showToast(`"${file.name}" is not a file the editor can open`); continue; }
        if (file.size > MAX_FILE_SIZE) { showToast('The file is larger than 8 MB'); continue; }
        try {
            const imported = await convertFileText(await file.text(), file.name);
            if (createDocument(file.name.replace(/\.[^.]+$/, '') || 'Document', imported.code)) showToast(imported.from ? `Opened "${file.name}" - converted from ${imported.from}` : `Opened "${file.name}" - it is now in "My documents"`);
        } catch (e) { showToast(`"${file.name}" could not be opened: ${e.message}`); }
    }
}

/**
 * Replaces the open document with a whole YAML document pasted outside the code (a paste
 * handler); text with an AI link, or that cannot be read, is left to others.
 * @param {ClipboardEvent} event - the paste.
 * @returns {void}
 */
function importPastedDocument(event) {
    const active = document.activeElement;
    if (active && active.matches(TYPING_FIELDS)) return;
    const text = event.clipboardData.getData('text');
    if (!PASTED_DOCUMENT.test(text) || PASTED_LINK.test(text)) return;
    if (parse(FORMAT.editor, text).broken) return;
    event.preventDefault();
    setCode(text);
    showToast(`${FORMAT.name} pasted from the clipboard - "Undo" brings the old data back`);
}
