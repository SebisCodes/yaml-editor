/**
 * The open document among "My documents": opening one (each keeps its own undo history while
 * the page is open), making a new one from the New menu or a template, starting one over, and
 * the "My documents" dialog with renaming and deleting.
 */

import { START, TEMPLATES, BLANK } from './samples.js?v=4';
import { openConfirmation } from './dialogs.js?v=5';
import { store } from './files.js?v=8';
import { createFiles } from './files-dialog.js?v=2';
import { state, ui, areas, showToast, getElement, getElements } from './state.js?v=2';
import { setCode, addHistoryStep, updateHistoryUi, undo, redo } from './history.js?v=3';
import { clearSchemaCache } from './analysis.js?v=3';
import { saveDocument } from './storage.js?v=3';
import { renderValuePanel } from './value-panel.js?v=3';
import { renderSchemaPanel } from './schema-panel.js?v=3';
import { renderConvertPanel } from './conversion-panel.js?v=3';
import { openFilePicker } from './file-import.js?v=3';

/** The name of a document without one. */
const DEFAULT_NAME = 'Document';
/** The toast after a new document. */
const NEW_DOCUMENT_NOTE = 'your other documents are under "My documents"';

/**
 * The undo history of a document while another one is open.
 * @typedef {object} DocumentHistory
 * @property {import('./state.js').HistoryStep[]} history - the undo steps.
 * @property {import('./state.js').HistoryStep[]} future - the redo steps.
 * @property {object|null} tree - the place selected in the tree.
 */

/** @type {Map<string, DocumentHistory>} The undo history of each document opened in this session, by id. */
const historyByDocument = new Map();
const newButton = getElement('#btn-new');
const newMenu = getElement('#new-menu');

/**
 * Shows the name of the open document in the bar, the tooltip of "My documents" and the New menu.
 * @returns {void}
 */
export function showFileName() {
    getElement('#file-name').textContent = state.name;
    getElement('#btn-files').title = `"${state.name}" is open. My documents: open, rename, duplicate or delete your documents (Ctrl+O)`;
    getElement('#new-restart b').textContent = `Start "${state.name}" over`;
}

/**
 * Opens a document from "My documents". The document that is closed keeps the edits still
 * waiting for the autosave, and its undo history for this session.
 * @param {string} id - the document's id.
 * @param {string} [code] - its code, when the caller has it already.
 * @returns {void}
 */
export function openDocument(id, code) {
    clearTimeout(state.histTimer);
    if (state.saveTimer) { clearTimeout(state.saveTimer); saveDocument(); }
    if (state.fileId) { addHistoryStep(); historyByDocument.set(state.fileId, { history: state.history, future: state.future, tree: areas.tree.getSelectedPlace() }); }
    code ??= store.code(id) ?? BLANK;
    state.fileId = id;
    state.name = store.getEntry(id)?.name || DEFAULT_NAME;
    state.savedCode = code;
    const kept = historyByDocument.get(id);
    state.history = kept ? kept.history : [];
    state.future = kept ? kept.future : [];
    clearSchemaCache();
    showOpenedCode(code, kept);
    showFileName();
    areas.files.render();
    renderValuePanel();
    if (!ui.schema.hidden) renderSchemaPanel();
    if (!ui.convert.hidden) renderConvertPanel();
    areas.sync?.updateUi();
}

/**
 * Puts the code of a document just opened into the editor, at its start, with the place in
 * the tree it had.
 * @param {string} code - the code.
 * @param {DocumentHistory|undefined} kept - its undo history, when it was open before.
 * @returns {void}
 */
function showOpenedCode(code, kept) {
    ui.ta.value = code;
    ui.ta.scrollTop = 0;
    ui.ta.setSelectionRange(0, 0);
    areas.tree.select(null);
    setCode(code, { history: false });
    areas.tree.select(kept && kept.tree ? kept.tree : { doc: 0, path: [] }, { scroll: false });
    addHistoryStep();
    updateHistoryUi();
}

/**
 * Creates a new document in "My documents" and opens it right away. A command that returns
 * whether it took place, as the new document's id, so the caller can go on with it.
 * @param {string} name - the name it should get (a free one is taken).
 * @param {string} code - its code.
 * @param {boolean} [inMemory] - true to keep it in memory only (a page's document), never stored.
 * @returns {string|null} its id, null when the storage is full (shown as a toast).
 */
export function createDocument(name, code, inMemory = false) {
    let id;
    try { id = store.create(name, code, inMemory); } catch (e) {
        showToast('The browser storage is full - delete or download documents under "My documents" first');
        return null;
    }
    openDocument(id, code);
    return id;
}

/**
 * Empties the open document after asking; Undo brings the data back.
 * @returns {Promise<void>} resolves when it is done.
 */
async function resetDocument() {
    if (state.code === BLANK) { showToast('This document is empty already'); return; }
    const documentId = state.fileId;
    if (!await openConfirmation({ title: `Start "${state.name}" over?`, text: 'All data is removed. "Undo" brings it back as long as the page is open.', ok: 'Start over' })) return;
    if (state.fileId !== documentId) return;   // another document was opened while the question was open
    setCode(BLANK);
    showToast(`"${state.name}" is empty now - "Undo" brings it back`);
}

/**
 * Makes a new document from the New menu: the example, a template or a blank one; "restart"
 * starts the open document over.
 * @param {string} kind - "restart", "example", "blank" or the key of a template.
 * @returns {void}
 */
function addDocumentFromMenu(kind) {
    if (kind === 'restart') { resetDocument(); return; }
    const template = kind === 'example' ? START : TEMPLATES[kind];
    if (createDocument(template ? template.name : DEFAULT_NAME, template ? template.code : BLANK)) showToast(`New document "${state.name}" - ${NEW_DOCUMENT_NOTE}`);
}

/**
 * Sets up the "My documents" dialog with what it needs from the editor.
 * @returns {import('./files-dialog.js').FilesDialog} the dialog.
 */
export function createDocumentsDialog() {
    return createFiles({
        getCurrent: () => ({ id: state.fileId, name: state.name, code: state.code }),
        openDocument: id => { openDocument(id); showToast(`"${state.name}" opened`); },
        addDocument: addDocumentFromMenu,
        renameDocument,
        handleRemoved: handleDocumentRemoved,
        importFile: openFilePicker,
        showToast,
    });
}

/**
 * Gives a document a new name.
 * @param {string} id - the document's id.
 * @param {string} name - the new (free) name.
 * @returns {void}
 */
function renameDocument(id, name) {
    try { store.save(id, { name }); } catch (e) { showToast('The browser storage is full'); return; }
    if (id === state.fileId) { state.name = name; showFileName(); areas.sync?.handleChange(); }
    if (!ui.schema.hidden) renderSchemaPanel();
}

/**
 * Forgets a deleted document; when it was open, the most recent other one opens, or a new
 * empty one.
 * @param {string} id - the deleted document's id.
 * @returns {void}
 */
function handleDocumentRemoved(id) {
    historyByDocument.delete(id);
    if (id !== state.fileId) { if (!ui.schema.hidden) renderSchemaPanel(); return; }
    state.fileId = '';
    const next = store.getSortedEntries()[0];
    if (next) openDocument(next.id);
    else createDocument(DEFAULT_NAME, BLANK);
}

/**
 * Opens or closes the New menu; an opened menu takes the focus.
 * @param {boolean} [open] - true to open, false to close; switches by default.
 * @returns {void}
 */
export function applyNewMenuSwitch(open = newMenu.hidden) {
    newMenu.hidden = !open;
    newButton.setAttribute('aria-expanded', open);
    if (open) newMenu.querySelector('button').focus();
}

/**
 * Tells whether the New menu is open.
 * @returns {boolean} true when it is open.
 */
export function isNewMenuOpen() {
    return !newMenu.hidden;
}

/**
 * Connects the New menu (click, arrows, Escape, a click outside), "My documents", Undo and Redo.
 * @returns {void}
 */
export function startDocumentButtons() {
    newButton.addEventListener('click', () => applyNewMenuSwitch());
    newMenu.addEventListener('click', addDocumentOnClick);
    newMenu.addEventListener('keydown', event => {
        const items = getElements('button', newMenu), index = items.indexOf(document.activeElement);
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus(); }
        if (event.key === 'Escape') { event.stopPropagation(); applyNewMenuSwitch(false); newButton.focus(); }
    });
    document.addEventListener('pointerdown', event => { if (isNewMenuOpen() && !event.target.closest('#new-menu, #btn-new')) applyNewMenuSwitch(false); });
    getElement('#btn-files').addEventListener('click', () => areas.files.open());
    getElement('#btn-undo').addEventListener('click', undo);
    getElement('#btn-redo').addEventListener('click', redo);
}

/**
 * Closes the New menu and adds a document of the kind of the item that was clicked.
 * @param {MouseEvent} event - the click in the New menu.
 * @returns {void}
 */
function addDocumentOnClick(event) {
    const item = event.target.closest('[data-new]');
    if (!item) return;
    applyNewMenuSwitch(false);
    addDocumentFromMenu(item.dataset.new);
}
