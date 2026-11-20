/**
 * The "My documents" dialog: a card for every document with the start of its code, and the
 * buttons to open, rename, duplicate, download and delete it; search by name, a new document,
 * opening a file and all documents as one ZIP.
 *
 * createFiles() runs these steps:
 *   1. connect the cards, the search field and the buttons of the dialog;
 *   2. draw the list again when another editor tab changes it;
 *   3. return { open, render } for the rest of the editor.
 */

import { openDialog, openConfirmation } from './dialogs.js?v=5';
import { createZip } from './zip.js?v=4';
import { saveFile, getSafeName } from './util.js?v=3';
import { store, LIST } from './files.js?v=8';

/** The lines of a document its card shows. */
const SUMMARY_LINES = 14;
/** The characters of a line its card shows. */
const SUMMARY_LINE_LENGTH = 60;
/** Seconds of a minute, an hour, a day and two days. */
const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;
const TWO_DAYS = 172800;
const MILLISECONDS = 1000;
/** Bytes of a kilobyte; below ten kilobytes a size gets one decimal. */
const KILOBYTE = 1024;
const TEN_KILOBYTES = 10240;
const ICONS = {
    rename: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
    download: '<path d="M12 4v11m-5-5 5 5 5-5M5 20h14"/>',
    delete: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
};

/**
 * What the editor hands to createFiles().
 * @typedef {object} FilesEditor
 * @property {function(): {id: string, name: string, code: string}} getCurrent - the open document.
 * @property {function(string): void} openDocument - opens a document by id.
 * @property {function(string): void} addDocument - makes a new document ("blank").
 * @property {function(string, string): void} renameDocument - gives a document a new name.
 * @property {function(string): void} handleRemoved - called after a document was deleted.
 * @property {function(): void} importFile - opens the browser's file picker.
 * @property {function(string): void} showToast - shows a short message.
 */

const dialog = document.getElementById('files');
const grid = document.getElementById('files-grid');
const search = document.getElementById('files-search');
const info = document.getElementById('files-info');
/** @type {FilesEditor|null} What the dialog needs from the editor, set by createFiles(). */
let editor = null;

/**
 * The dialog as the rest of the editor uses it.
 * @typedef {object} FilesDialog
 * @property {function(): void} open - opens the dialog.
 * @property {function(): void} render - draws the list again while the dialog is open.
 */

/**
 * Returns how long ago a time was, in words.
 * @param {number} time - the time in milliseconds since 1970.
 * @returns {string} "just now", "5 min ago" … or the date.
 */
function getAgeText(time) {
    const seconds = (Date.now() - time) / MILLISECONDS;
    if (seconds < MINUTE) return 'just now';
    if (seconds < HOUR) return `${Math.floor(seconds / MINUTE)} min ago`;
    if (seconds < DAY) return `${Math.floor(seconds / HOUR)} h ago`;
    if (seconds < TWO_DAYS) return 'yesterday';
    return new Date(time).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Returns the first lines of a document for its card.
 * @param {string} code - the document's code.
 * @returns {string} the lines, each cut to the card's width.
 */
function getSummary(code) {
    return code.split('\n').slice(0, SUMMARY_LINES).map(line => line.slice(0, SUMMARY_LINE_LENGTH)).join('\n');
}

/**
 * Returns a size as the cards show it.
 * @param {number} bytes - the size.
 * @returns {string} "512 bytes" or "1.5 KB".
 */
function formatSize(bytes) {
    return bytes < KILOBYTE ? `${bytes} bytes` : `${(bytes / KILOBYTE).toFixed(bytes < TEN_KILOBYTES ? 1 : 0)} KB`;
}

/**
 * Returns the markup of a button symbol.
 * @param {string} name - the key in ICONS.
 * @returns {string} the SVG.
 */
function getIcon(name) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
}

/**
 * Creates the card of a document.
 * @param {import("./files.js").FileEntry} entry - the document's entry.
 * @param {string} code - its code.
 * @param {boolean} isCurrent - true for the open document.
 * @returns {HTMLLIElement} the card.
 */
function createCard(entry, code, isCurrent) {
    const card = document.createElement('li');
    card.className = 'file-card' + (isCurrent ? ' current' : '');
    card.dataset.id = entry.id;
    card.innerHTML = `<button type="button" class="file-open"><span class="file-picture doc"><pre class="mini-code" data-no-i18n></pre></span></button>
            <div class="file-text"><span class="file-name" data-no-i18n></span><span class="file-info muted"></span></div>
            <div class="file-buttons">
                <button type="button" class="item-button" data-act="rename" title="Rename" aria-label="Rename">${getIcon('rename')}</button>
                <button type="button" class="item-button" data-act="copy" title="Duplicate" aria-label="Duplicate">${getIcon('copy')}</button>
                <button type="button" class="item-button" data-act="download" title="Download as .yaml" aria-label="Download">${getIcon('download')}</button>
                <button type="button" class="item-button danger" data-act="delete" title="Delete" aria-label="Delete">${getIcon('delete')}</button>
            </div>`;
    card.title = isCurrent ? 'This document is open' : 'Click to open this document';
    card.querySelector('.mini-code').textContent = getSummary(code);
    card.querySelector('.file-name').textContent = entry.name;
    card.querySelector('.file-open').setAttribute('aria-label', isCurrent ? `${entry.name} (open now)` : `Open ${entry.name}`);
    card.querySelector('.file-info').textContent = isCurrent ? `Open now · ${formatSize(entry.size || 0)}` : `${getAgeText(entry.updated)} · ${formatSize(entry.size || 0)}`;
    return card;
}

/**
 * Sets up the "My documents" dialog.
 * @param {FilesEditor} filesEditor - what the dialog needs from the editor.
 * @returns {FilesDialog} the dialog.
 */
export function createFiles(filesEditor) {
    editor = filesEditor;
    grid.addEventListener('click', handleCardClick);
    search.addEventListener('input', render);
    document.getElementById('files-new').addEventListener('click', () => { dialog.close(); editor.addDocument('blank'); });
    document.getElementById('files-import').addEventListener('click', () => { dialog.close(); editor.importFile(); });
    document.getElementById('files-zip').addEventListener('click', saveAllDocuments);
    addEventListener('storage', event => { if (event.key === LIST && dialog.open) render(); });
    return {
        /**
         * Opens the dialog with an empty search and the focus on the open document.
         * @returns {void}
         */
        open() { search.value = ''; render(); openDialog(dialog); grid.querySelector('.current .file-open')?.focus(); },
        /**
         * Draws the list again while the dialog is open.
         * @returns {void}
         */
        render() { if (dialog.open) render(); },
    };
}

/**
 * Draws the cards of the documents that match the search, and the count below them.
 * @returns {void}
 */
function render() {
    const current = editor.getCurrent();
    const all = store.getSortedEntries();
    const query = search.value.trim().toLowerCase();
    const shown = query ? all.filter(entry => entry.name.toLowerCase().includes(query)) : all;
    grid.replaceChildren(...shown.map(entry => createCard(entry, entry.id === current.id ? current.code : store.code(entry.id) || '', entry.id === current.id)));
    if (!shown.length) {
        const empty = document.createElement('p');
        empty.className = 'muted file-empty';
        empty.textContent = query ? `No document named "${search.value.trim()}".` : 'No documents yet.';
        grid.append(empty);
    }
    const total = all.reduce((sum, entry) => sum + (entry.size || 0), 0);
    info.textContent = `${all.length} ${all.length === 1 ? 'document' : 'documents'} · ${formatSize(total)} in this browser`;
}

/**
 * Turns the name of a card into a field; Enter or leaving it renames, Escape keeps the name.
 * @param {HTMLLIElement} card - the card.
 * @returns {void}
 */
function startRename(card) {
    const id = card.dataset.id;
    const input = document.createElement('input');
    input.className = 'file-rename';
    input.value = store.getEntry(id)?.name || '';
    input.setAttribute('aria-label', 'New name');
    card.querySelector('.file-name').replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    /**
     * Ends the rename once.
     * @param {boolean} keep - true to take the typed name.
     * @returns {void}
     */
    const stopRename = keep => {
        if (done) return;
        done = true;
        const name = input.value.trim();
        if (keep && name) editor.renameDocument(id, store.getUniqueName(name, id));
        render();
        grid.querySelector(`[data-id="${id}"] .file-open`)?.focus();
    };
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); stopRename(true); }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); stopRename(false); }
    });
    input.addEventListener('blur', () => stopRename(true));
}

/**
 * Returns the code of a document; the open one as it is in the editor.
 * @param {string} id - the document's id.
 * @returns {string} the code.
 */
function getDocumentCode(id) {
    return id === editor.getCurrent().id ? editor.getCurrent().code : store.code(id) || '';
}

/**
 * Makes a copy of a document next to it.
 * @param {import("./files.js").FileEntry} entry - the document's entry.
 * @returns {void}
 */
function copyDocument(entry) {
    try {
        store.create(store.getUniqueName(entry.name + ' copy'), getDocumentCode(entry.id));
        editor.showToast(`"${entry.name}" duplicated`);
    } catch (err) { editor.showToast('The browser storage is full - delete or download some documents first'); }
    render();
}

/**
 * Deletes a document after asking; the dialog opens again either way.
 * @param {import("./files.js").FileEntry} entry - the document's entry.
 * @returns {Promise<void>} resolves when it is done.
 */
async function removeDocument(entry) {
    const confirmed = await openConfirmation({
        title: `Delete "${entry.name}"?`,
        text: 'The document is removed from this browser for good. Download it first if you want to keep a copy.',
        ok: 'Delete',
    });
    openDialog(dialog);
    if (!confirmed) return;
    store.remove(entry.id);
    editor.handleRemoved(entry.id);
    editor.showToast(`"${entry.name}" deleted`);
    render();
}

/**
 * Opens a document, or runs the action of the button clicked on its card (a click handler).
 * @param {MouseEvent} event - the click.
 * @returns {Promise<void>} resolves when the action is done.
 */
async function handleCardClick(event) {
    const card = event.target.closest('.file-card');
    if (!card) return;
    const entry = store.getEntry(card.dataset.id);
    if (!entry) { render(); return; }
    const action = event.target.closest('[data-act]')?.dataset.act;
    if (!action && !event.target.closest('input')) {
        dialog.close();
        if (entry.id !== editor.getCurrent().id) editor.openDocument(entry.id);
    } else if (action === 'rename') startRename(card);
    else if (action === 'copy') copyDocument(entry);
    else if (action === 'download') saveFile(getDocumentCode(entry.id), `${getSafeName(entry.name)}.yaml`, 'application/yaml');
    else if (action === 'delete') await removeDocument(entry);
}

/**
 * Downloads every document as one ZIP, each name once.
 * @returns {Promise<void>} resolves when the download has started.
 */
async function saveAllDocuments() {
    const used = new Set();
    const files = [];
    const entries = store.getSortedEntries();
    for (const entry of entries) {
        let name = getSafeName(entry.name);
        for (let number = 2; used.has(name.toLowerCase()); number++) name = `${getSafeName(entry.name)}-${number}`;
        used.add(name.toLowerCase());
        files.push({ name: `${name}.yaml`, data: getDocumentCode(entry.id) });
    }
    saveFile(await createZip(files), 'yaml-documents.zip');
    editor.showToast(`ZIP with ${entries.length} ${entries.length === 1 ? 'document' : 'documents'} downloaded`);
}
