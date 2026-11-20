/**
 * The data tree and the edits made in it. The tree is drawn from the code (datatree.js
 * createTree()); every change in the tree is a small edit of the code at that place
 * (editCode()), one undo step, after which the changed value is selected in the tree and in
 * the code.
 */

import { createTree, editCode, getDocIndex, getAliasTarget } from './datatree.js?v=12';
import { state, ui, areas, FORMAT, showToast, translate, getElement } from './state.js?v=2';
import { showCodePosition } from './code-view.js?v=3';
import { setCode, addPendingHistoryStep } from './history.js?v=3';
import { renderValuePanel } from './value-panel.js?v=3';

/** The message when the tree cannot be edited because of a syntax error. */
const BROKEN_CODE = 'The code has a syntax error - fix it first (see above the code), then edit in the tree';
/** The message when an action needs a value selected in the tree. */
export const CHOOSE_VALUE = 'Choose a value in the tree first';
/** The message when an entry is added to a root that holds a single value. */
export const SINGLE_ROOT = 'The root is a single value - change its type to object or array first';
/** The first key of an empty document. */
const FIRST_KEY = 'key: ""\n';
/** What a number typed into the tree looks like. */
const NUMBER_TEXT = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
/** The most characters of a typed text a message quotes. */
const MAX_QUOTED_TEXT = 40;

/**
 * A change of the code made from the tree, as editCode() takes it.
 * @typedef {object} TreeOperation
 * @property {string} kind - "key", "value", "type", "add", "duplicate", "move" or "remove".
 * @property {object} [node] - the node whose value or type changes.
 * @property {object} [entry] - the entry that is renamed, duplicated, moved or removed.
 * @property {object} [box] - the object or array an entry is added to.
 */

/**
 * A value typed into the tree, read as the type of the value it replaces.
 * @typedef {object} TypedValue
 * @property {*} [value] - the value.
 * @property {string} [raw] - how a number is written.
 * @property {string} [error] - why the text does not fit the type.
 * @property {boolean} [same] - true when the value stays as it is.
 */

/**
 * Creates the tree in its element and connects it with the code and the side panel.
 * @returns {object} the tree (createTree()).
 */
export function createTreeArea() {
    return createTree({
        el: ui.tree, pathEl: getElement('#path'), t: translate,
        onPick: showPickedNode,
        onEdit: handleTreeEdit,
        onAction: handleTreeAction,
    });
}

/**
 * Passes an action of a tree row on: "remove" (the row's remove button) removes the node
 * (createTree's onAction).
 * @param {string} name - the action.
 * @param {object} info - the row's place: node, entry, path.
 * @returns {void}
 */
function handleTreeAction(name, info) {
    if (name === 'remove') runNodeAction('remove', info);
}

/**
 * Selects in the code what was picked in the tree (createTree's onPick).
 * @param {object} info - the picked place: node, entry, docStart.
 * @param {string} how - how it was picked ("search", "path" …).
 * @returns {void}
 */
function showPickedNode(info, how) {
    if (!info.node) { if (info.docStart != null) showCodePosition(info.docStart, false); return; }
    const start = info.entry ? info.entry.start : info.node.start;
    showCodePosition(start, false, Math.max(start, info.node.end));
    renderValuePanel();
    if (how === 'search' || how === 'path') ui.tree.focus({ preventScroll: true });
}

/**
 * Starts or ends an edit in the tree (createTree's onEdit, whose shape the tree sets).
 * @param {object} edit - what is edited.
 * @param {string} edit.what - "key" or "value".
 * @param {object} edit.info - the place in the tree.
 * @param {string} edit.text - the typed text.
 * @param {string} edit.phase - "start" before the field opens.
 * @returns {true|string} true when it worked, otherwise the reason.
 */
function handleTreeEdit({ what, info, text, phase }) {
    if (phase === 'start') {
        if (state.model.broken || state.model.docs[info.doc]?.broken) { showToast(BROKEN_CODE); return 'broken'; }
        return true;
    }
    if (what === 'key') return editCodeFromTree({ kind: 'key', entry: info.entry, key: text });
    const typed = getTypedValue(info.node, text);
    if (typed.error) { showToast(typed.error); return typed.error; }
    if (typed.same) return true;
    return editCodeFromTree({ kind: 'value', node: info.node, value: typed.value, raw: typed.raw });
}

/**
 * Returns what was typed into a value as a value of the same type.
 * @param {object} node - the node whose value is replaced.
 * @param {string} text - the typed text.
 * @returns {TypedValue} the value, or why it does not fit.
 */
export function getTypedValue(node, text) {
    const trimmed = text.trim();
    switch (node.type) {
        case 'string': return { value: text };
        case 'number':
            if (NUMBER_TEXT.test(trimmed) && Number.isFinite(Number(trimmed))) return { value: Number(trimmed), raw: trimmed.replace(/^\+/, '') };
            return { error: `"${text.slice(0, MAX_QUOTED_TEXT)}" is not a number - choose another type above the tree to change the type` };
        case 'boolean':
            if (/^(true|false)$/i.test(trimmed)) return { value: trimmed.toLowerCase() === 'true' };
            return { error: 'A boolean is true or false - choose another type above the tree to change the type' };
        case 'null':
            if (!trimmed || trimmed === 'null') return { same: true };
            return { error: 'null has no value - choose another type above the tree to change the type' };
        default: return { error: 'This value is changed in the code' };
    }
}

/**
 * Writes one change from the tree into the code as one undo step and selects the changed
 * value. A command that returns whether it took place, since the tree keeps its field open
 * when it did not.
 * @param {TreeOperation} operation - the change.
 * @param {object} [options] - more about the change.
 * @param {number} [options.doc] - the document of the file it is in, when known.
 * @returns {true|string} true when it worked, otherwise the reason (also shown as a toast).
 */
export function editCodeFromTree(operation, { doc } = {}) {
    const docIndex = doc ?? getOperationDoc(operation);
    if (state.model.broken || state.model.docs[docIndex]?.broken) { showToast(BROKEN_CODE); return 'broken'; }
    let result;
    try { result = editCode(FORMAT.editor, state.code, operation); } catch (e) { showToast(e.message); return e.message; }
    addPendingHistoryStep();
    setCode(result.code);
    areas.tree.select({ doc: docIndex, path: result.path });
    const info = areas.tree.getSelectedInfo();
    if (info) { const start = info.entry ? info.entry.start : info.node.start; showCodePosition(start, false, Math.max(start, info.node.end)); }
    renderValuePanel();
    return true;
}

/**
 * Returns the document of the file a change is in.
 * @param {TreeOperation} operation - the change.
 * @returns {number} the index of the document.
 */
function getOperationDoc(operation) {
    if (operation.node) return getDocIndex(state.model, operation.node);
    if (operation.entry) return getDocIndex(state.model, operation.entry.node);
    if (operation.box) return getDocIndex(state.model, operation.box);
    return 0;
}

/**
 * Runs an action of the buttons above the tree, the side panel or the Delete key on the
 * selected entry: add, duplicate, move up or down, remove.
 * @param {string} name - "add", "dup", "up", "down" or "remove".
 * @param {object} [info] - the place in the tree, the selected one by default.
 * @returns {void}
 */
export function runNodeAction(name, info = areas.tree.getSelectedInfo()) {
    if (name === 'add' && state.model && !state.model.broken && !state.model.docs.some(doc => doc.root)) { addFirstKey(); return; }
    if (!info || !info.node) { showToast(CHOOSE_VALUE); return; }
    const { node, entry } = info;
    if (name === 'add') { addEntryAfter(node, entry); return; }
    if (!entry) { showToast(name === 'remove' ? 'The root cannot be removed - "Start this document over" in the New menu empties it' : 'The root has no place to move to'); return; }
    if (name === 'dup') editCodeFromTree({ kind: 'duplicate', entry });
    else if (name === 'up' || name === 'down') editCodeFromTree({ kind: 'move', entry, by: name === 'up' ? -1 : 1 });
    else if (name === 'remove') editCodeFromTree({ kind: 'remove', entry });
}

/**
 * Gives an empty document its first key and opens the key for typing.
 * @returns {void}
 */
function addFirstKey() {
    setCode(FIRST_KEY);
    areas.tree.select({ doc: 0, path: ['key'] });
    areas.tree.edit('key');
}

/**
 * Adds an empty entry into the selected object or array, or after the selected entry; the key
 * of a new object entry opens for typing.
 * @param {object} node - the selected node.
 * @param {object|null} entry - its entry, null for a root.
 * @returns {void}
 */
function addEntryAfter(node, entry) {
    const box = getAliasTarget(node).type === 'object' || getAliasTarget(node).type === 'array' ? node : entry ? entry.parent : null;
    if (!box || box.type === 'alias') { showToast(SINGLE_ROOT); return; }
    const at = box === node ? box.entries.length : entry.index + 1;
    if (editCodeFromTree({ kind: 'add', box, at, value: '' }) === true && box.type === 'object') areas.tree.edit('key');
}
