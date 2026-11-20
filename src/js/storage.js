/**
 * Storing the open document and the settings. The settings go to yamleditor.v1, the document
 * itself to its entry in "My documents" (files.js). When another tab changed the same document
 * while this tab had edits of its own, both versions are kept.
 */

import { store } from './files.js?v=8';
import { state, areas, showToast, STORAGE_FULL } from './state.js?v=2';
import { setCode } from './history.js?v=3';
import { showFileName } from './documents.js?v=3';

/** The storage key of the settings (the open document and the split). */
const SETTINGS_KEY = 'yamleditor.v1';

/**
 * The stored settings.
 * @typedef {object} Settings
 * @property {string} file - the id of the open document.
 * @property {number} split - the share of the width the code takes.
 */

let storageFullShown = false;

/**
 * Stores the settings and, when it changed, the open document. Another tab that changed the
 * document since this tab read or saved it keeps its version (saveBothVersions()).
 * @returns {void}
 */
export function saveDocument() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ file: state.fileId, split: state.split })); } catch (e) { /* Storage blocked or full: the editor keeps working without a saved draft. */ }
    if (!state.fileId || state.code === state.savedCode) return;
    try {
        const stored = store.code(state.fileId);
        if (stored != null && stored !== state.savedCode && stored !== state.code) { saveBothVersions(); return; }
        store.save(state.fileId, { code: state.code });
        state.savedCode = state.code;
    } catch (e) {
        if (!storageFullShown) showToast(STORAGE_FULL);
        storageFullShown = true;
    }
}

/**
 * Keeps this tab's version of a document that another tab changed meanwhile: it becomes a
 * document of its own (with a free name), the other tab's version stays as it is.
 * @returns {void}
 */
function saveBothVersions() {
    const oldName = state.name;
    let id;
    try { id = store.create(oldName, state.code); } catch (e) { showToast(STORAGE_FULL); return; }
    state.fileId = id;
    state.name = store.getEntry(id)?.name || oldName;
    state.savedCode = state.code;
    showFileName();
    areas.files.render();
    areas.sync?.updateUi();
    saveDocument();
    showToast(`"${oldName}" was changed in another tab - your version here is kept as "${state.name}"`);
}

/**
 * Returns the stored settings.
 * @returns {Settings|null} the settings, null when there are none or the storage is blocked.
 */
export function getSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'); } catch (e) { return null; }
}

/**
 * Follows the open document when another tab saves it: a hidden tab without edits of its own
 * shows that version. What the user is looking at never changes by itself.
 * @returns {void}
 */
export function startStorageSync() {
    addEventListener('storage', showOtherTabVersion);
}

/**
 * Shows the version of the open document another tab saved, in a hidden tab without edits of
 * its own (a storage event handler).
 * @param {StorageEvent} event - the change in the storage.
 * @returns {void}
 */
function showOtherTabVersion(event) {
    if (!state.fileId || !event.key || !event.key.endsWith(state.fileId) || event.newValue == null || store.isInMemory(state.fileId)) return;
    const stored = store.code(state.fileId);
    if (stored == null || stored === state.code || state.code !== state.savedCode || document.visibilityState !== 'hidden') return;
    state.savedCode = stored;
    setCode(stored);
}
