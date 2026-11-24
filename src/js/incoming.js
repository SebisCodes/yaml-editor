/**
 * Documents that arrive: from AI links and the WebMCP tools (ai.js, mcp.js), and from the page
 * around the editor, a POST or ?src= (sync.js). A page's document never takes the place of one
 * of the user's own documents.
 */

import { parse, getModelValue, mergeData } from './datatree.js?v=13';
import { VIEWER } from './sync.js?v=24';
import { store } from './files.js?v=8';
import { state, ui, FORMAT, showToast } from './state.js?v=2';
import { setCode } from './history.js?v=4';
import { openDocument, createDocument } from './documents.js?v=4';

/** The name of a document from the AI without one. */
const AI_DOCUMENT = 'AI document';

/**
 * Which document an arriving document goes to.
 * @typedef {object} DocumentTarget
 * @property {string} [file] - "new" for a new document, a name for that document (made when
 *   there is none), empty for the open one.
 * @property {string} [name] - the name of a new document.
 * @property {boolean} [direct] - set by the WebMCP tools; changes nothing here.
 */

/**
 * A document from the page around the editor, a POST or ?src= (sync.js calls load() with it).
 * @typedef {object} ExternalDocument
 * @property {string} name - its name.
 * @property {string} content - its code.
 * @property {string|null} [into] - the id of the document to replace.
 * @property {boolean} [asNew] - true to always make a new document.
 * @property {string} [page] - the origin it came from.
 * @property {boolean} [temp] - true to keep it in memory only, never stored.
 */

/**
 * Takes a document from the AI: it replaces the document the target names (no question; Undo
 * takes the change back), or with mode "add" its data is merged into the root mapping or added
 * to the root sequence of the first document. YAML that cannot be read, or that does not fit,
 * opens as a new document.
 * @param {string} text - the YAML.
 * @param {string} mode - "add" to merge, anything else to replace.
 * @param {DocumentTarget} [target] - which document.
 * @returns {Promise<void>} resolves when the document is in the editor.
 */
export async function receiveDocument(text, mode, target = {}) {
    const wanted = String(target.file || '').trim();
    const isNew = wanted.toLowerCase() === 'new';
    const entry = isNew ? null : wanted ? store.findByName(wanted) : store.getEntry(state.fileId);
    let data = null;
    if (mode === 'add') {
        const model = parse(FORMAT.editor, text);
        if (model.broken) {
            if (createDocument(`${entry ? entry.name : AI_DOCUMENT} (AI)`, text)) showToast(`The addition is not valid ${FORMAT.name} - it is open as a new document "${state.name}"`);
            return;
        }
        data = getModelValue(model);
    }
    if (!entry) { openNewAiDocument(isNew ? target.name || AI_DOCUMENT : wanted || AI_DOCUMENT, text); return; }
    if (entry.id !== state.fileId) openDocument(entry.id);
    if (mode === 'add') {
        try { setCode(mergeData(FORMAT.editor, state.code, data)); } catch (e) {
            if (createDocument(`${entry.name} (AI)`, text)) showToast(`${e.message} - the addition is open as a new document "${state.name}"`);
            return;
        }
    } else setCode(text);
    const errors = state.problems.filter(problem => problem.kind === 'error').length;
    VIEWER || showToast(errors ? `Document received - ${errors} ${errors === 1 ? 'problem' : 'problems'} found, see above the code` : `"${state.name}" changed by the AI - "Undo" takes it back`);
}

/**
 * Makes a new document from the AI and opens it.
 * @param {string} name - the name it should get.
 * @param {string} text - the YAML.
 * @returns {void}
 */
function openNewAiDocument(name, text) {
    const id = store.create(name, text);
    openDocument(id);
    VIEWER || showToast(`New document "${state.name}" from the AI - your other documents are unchanged`);
}

/**
 * Opens a document from the page around the editor or from ?src=: it replaces the document of
 * that name that an earlier load from the same page made (one undo step), or becomes a new
 * document.
 * @param {ExternalDocument} external - the document and where it goes.
 * @returns {Promise<void>} resolves when it is open (a command that returns a Promise, as sync.js
 *   waits for it).
 */
export async function importExternalDocument({ name, content, into, asNew, page, temp }) {
    const entry = asNew ? null : (into && store.getEntry(into)) || store.list().find(item => item.name === name && item.page && item.page === page && !!item.temp === !!temp);
    if (entry) {
        if (entry.id !== state.fileId) openDocument(entry.id);
        if (content !== state.code) setCode(content);
    } else {
        const id = createDocument(name, content, !!temp);
        if (id && page) try { store.setEntryFields(id, { page }); } catch (e) { /* storage full: it just is not recognized next time */ }
    }
    ui.ta.setSelectionRange(0, 0);
    ui.ta.scrollTop = 0;
}
