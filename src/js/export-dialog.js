/**
 * Export and saving: the Export dialog (the document as .yaml, JSON, CSV or the tree as text,
 * each to download or copy, or all as one ZIP), the Copy and Download buttons of the code, and
 * Ctrl+S, which saves to the server or the page around the editor when one is set up and
 * downloads the document otherwise. "Open in another editor" in the dialog is export-menu.js.
 */

import { openDialog } from './dialogs.js?v=5';
import { createZip } from './zip.js?v=4';
import { saveFile, getSafeName } from './util.js?v=3';
import { state, ui, areas, FORMAT, showToast, getElement, getByteSize } from './state.js?v=2';
import { updateAnalysis } from './analysis.js?v=4';
import { convertDocument, FORMAT_INDENT } from './conversion-panel.js?v=4';

/** The formats of the dialog, with their file extension and media type. */
const EXPORT_FORMATS = {
    yaml: { ext: 'yaml', mime: 'application/yaml' }, json: { ext: 'json', mime: 'application/json' },
    csv: { ext: 'csv', mime: 'text/csv' }, txt: { ext: 'txt', mime: 'text/plain' },
};
/** The choice of the dialog that export-menu.js handles. */
const OTHER_EDITOR_CHOICE = 'convert';

const dialog = getElement('#export');
const nameInput = getElement('#ex-name');
const formatChoice = getElement('#ex-format');
const preview = getElement('#ex-text');
const info = getElement('#ex-info');
const formulaGuard = getElement('#ex-guard');

/**
 * Returns the document in a format of the dialog.
 * @param {string} format - a key of EXPORT_FORMATS.
 * @returns {Promise<import('./conversion-panel.js').ConversionResult>} the text, or why there is none.
 */
function getExportText(format) {
    if (format === FORMAT.editor) return Promise.resolve({ text: state.code });
    return convertDocument(format, FORMAT_INDENT, format === 'csv' && formulaGuard.checked);
}

/**
 * Opens the Export dialog with the document read anew.
 * @returns {void}
 */
export function openExport() {
    updateAnalysis();
    nameInput.value = state.name;
    updateExport();
    openDialog(dialog);
}

/**
 * Returns the file name the dialog gives the files.
 * @returns {string} the name without extension.
 */
function getFileName() {
    return getSafeName(nameInput.value || state.name);
}

/**
 * Shows the chosen format in the dialog: the text, its size, and the buttons enabled when it
 * can be exported. The formula guard stays in place for every format; only CSV uses it.
 * @returns {Promise<void>} resolves when it is shown.
 */
async function updateExport() {
    if (formatChoice.value === OTHER_EDITOR_CHOICE) return;
    formulaGuard.disabled = formatChoice.value !== 'csv';
    const result = await getExportText(formatChoice.value);
    preview.value = result.text ?? '';
    info.textContent = result.error ? result.error : `${getByteSize(result.text).toLocaleString('en')} bytes`;
    getElement('#ex-download').disabled = !!result.error;
    getElement('#ex-copy').disabled = !!result.error;
}

/**
 * Connects the Export dialog and the Export, Copy and Download buttons of the code.
 * @returns {void}
 */
export function startExportDialog() {
    formulaGuard.addEventListener('change', updateExport);
    formatChoice.addEventListener('change', updateExport);
    nameInput.addEventListener('input', updateExport);
    getElement('#ex-download').addEventListener('click', saveExport);
    getElement('#ex-zip').addEventListener('click', saveAllFormats);
    getElement('#ex-copy').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(preview.value); } catch (err) { preview.select(); document.execCommand('copy'); }
        showToast('Copied to the clipboard');
    });
    getElement('#btn-export').addEventListener('click', openExport);
    getElement('#btn-copy').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(state.code); } catch (e) { ui.ta.select(); document.execCommand('copy'); }
        showToast('Code copied');
    });
    getElement('#btn-download').addEventListener('click', saveDocumentFile);
}

/**
 * Downloads the document in the format chosen in the dialog.
 * @returns {Promise<void>} resolves when the download has started.
 */
async function saveExport() {
    const format = formatChoice.value;
    const result = await getExportText(format);
    if (result.error) { showToast(result.error); return; }
    saveFile(result.text, `${getFileName()}.${EXPORT_FORMATS[format].ext}`, EXPORT_FORMATS[format].mime);
    showToast('Downloaded');
}

/**
 * Downloads the document in every format of the dialog that fits its data, as one ZIP.
 * @returns {Promise<void>} resolves when the download has started.
 */
async function saveAllFormats() {
    const name = getFileName();
    const files = [];
    for (const format of Object.keys(EXPORT_FORMATS)) {
        const result = await getExportText(format);
        if (!result.error) files.push({ name: `${name}.${EXPORT_FORMATS[format].ext}`, data: result.text });
    }
    saveFile(await createZip(files), `${name}-all.zip`);
    showToast(`ZIP downloaded with ${files.length} files`);
}

/**
 * Downloads the document as a .yaml file.
 * @returns {void}
 */
function saveDocumentFile() {
    saveFile(state.code, `${getSafeName(state.name)}.${FORMAT.ext}`, FORMAT.mime);
    showToast(`.${FORMAT.ext} downloaded`);
}

/**
 * Ctrl+S: ends an edit in the tree, then saves to the server or the page around the editor
 * when one is set up, and downloads the document otherwise.
 * @returns {void}
 */
export function saveFromShortcut() {
    if (areas.tree.isEditing()) areas.tree.stopEdit();
    if (areas.sync && areas.sync.isActive()) { areas.sync.save(); return; }
    saveDocumentFile();
}
