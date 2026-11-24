/**
 * What the AI Assistant (ai.js) and the WebMCP tools (mcp.js) read from and do in the editor:
 * the open document for the prompt, its problems with line and column, values by path, the
 * user's other documents, and replacing text in the code.
 */

import { formatPath, getNodeAtPath, getPlainValue, parsePath, getAliasTarget } from './datatree.js?v=13';
import { store } from './files.js?v=8';
import { state, ui, areas } from './state.js?v=2';
import { getLineIndex, getColumnIndex, getLineStart, showCodePosition } from './code-view.js?v=5';
import { setCode } from './history.js?v=5';
import { getSchema } from './analysis.js?v=5';
import { editCodeFromTree } from './tree-panel.js?v=5';
import { selectCursorNode } from './tree-tools.js?v=5';
import { openDocument } from './documents.js?v=5';
import { BLANK } from './samples.js?v=4';
import { getTemplatePath } from './tree-views.js?v=1';

/** The message when the data tools find no data. */
const NO_DATA = 'The document has no data yet.';
/** The name of a new document from an agent without one. */
const AI_DOCUMENT = 'AI document';

/**
 * The open document as the prompt and the tools describe it.
 * @typedef {object} PromptState
 * @property {string} code - the code.
 * @property {string} name - the document's name.
 * @property {string[]} files - the names of all documents, the most recent first.
 * @property {string} sel - the text selected in the code.
 * @property {string} path - the path of the value selected in the tree, "" for the root.
 * @property {string} schema - the name of the chosen schema, "" for none.
 * @property {string[]} problems - the problems, "line 3, column 1: …".
 * @property {object|null} context - what the page around the editor says about itself (sync.js).
 */

/**
 * A problem with its line and column.
 * @typedef {object} ListedProblem
 * @property {number} pos - where it starts in the code.
 * @property {string} kind - "error", "warn" or "schema".
 * @property {string} msg - the message.
 * @property {number} line - its line, 1-based.
 * @property {number} col - its column, 1-based.
 */

/**
 * A place in the data found by its path.
 * @typedef {object} PathPlace
 * @property {Array<string|number>} [segs] - the path's keys and indexes.
 * @property {number} [docIndex] - the document of the file.
 * @property {object} [doc] - that document of the model.
 * @property {object|null} [node] - the node at the path, null when there is none.
 * @property {string} [error] - why the path cannot be used.
 */

/**
 * Returns the open document as the prompt and get_document describe it.
 * @returns {PromptState} the document, its selection and problems.
 */
export function getPromptState() {
    const selected = getTemplatePath(areas.tree.getSelectedInfo());
    const schema = getSchema();
    return {
        code: state.code, name: state.name, files: store.getSortedEntries().map(entry => entry.name),
        sel: state.code.slice(ui.ta.selectionStart, ui.ta.selectionEnd),
        path: selected.length ? formatPath(selected) : '',
        schema: schema && schema.name ? schema.name : '',
        problems: getProblemList().map(problem => `line ${problem.line}, column ${problem.col}: ${problem.msg}`),
        context: areas.sync?.getContext() || null,
    };
}

/**
 * Returns the problems with their line and column.
 * @returns {ListedProblem[]} the problems, by position.
 */
export function getProblemList() {
    return state.problems.map(problem => ({ ...problem, line: getLineIndex(problem.pos) + 1, col: getColumnIndex(problem.pos) + 1 }));
}

/**
 * Returns the place in the data a path leads to.
 * @param {string} path - "$.a.b[0]", "a.b[0]" or a JSON Pointer "/a/b/0".
 * @param {number} [doc] - the document of the file, 1 = the first.
 * @returns {PathPlace} the place, or why there is none.
 */
function getPathPlace(path, doc) {
    const segs = parsePath(path);
    if (!segs) return { error: `"${path}" is not a path - write it like $.items[0].name` };
    const docIndex = Math.max(0, (Number(doc) || 1) - 1);
    const dataDoc = state.model.docs[docIndex];
    if (!dataDoc || !dataDoc.root) return { error: NO_DATA };
    return { segs, docIndex, doc: dataDoc, node: getNodeAtPath(dataDoc.root, segs) };
}

/**
 * Returns the value at a path for get_value.
 * @param {string} path - the path.
 * @param {number} [doc] - the document of the file, 1 = the first.
 * @returns {{path?: string, type?: string, line?: number, value?: *, error?: string}} the value
 *   as plain data with its type and line, or why there is none.
 */
export function getAgentValue(path, doc) {
    const place = getPathPlace(path, doc);
    if (place.error) return place;
    if (!place.node) return { error: `There is no value at ${formatPath(place.segs)} - call get_document to see the data.` };
    return { path: formatPath(place.segs), type: place.node.type, line: getLineIndex(place.node.start) + 1, value: getPlainValue(place.node) };
}

/**
 * Sets the value at a path for set_value; a new key of an existing mapping or the next index of
 * a sequence adds an entry. A command that returns whether it took place, as the result the
 * tool reports to the agent (the changed path, or why not).
 * @param {string} path - the path.
 * @param {*} value - the new value (any JSON value).
 * @param {number} [doc] - the document of the file, 1 = the first.
 * @returns {{path?: string, added?: boolean, error?: string}} the path changed, or why not.
 */
export function setAgentValue(path, value, doc) {
    if (state.model.broken) return { error: 'The code has a syntax error - fix it first (get_problems).' };
    const place = getPathPlace(path, doc);
    if (place.error) return place;
    if (value === undefined) return { error: 'A value is needed.' };
    if (place.node) {
        const result = editCodeFromTree({ kind: 'value', node: place.node, value }, { doc: place.docIndex });
        return result === true ? { path: formatPath(place.segs) } : { error: result };
    }
    return addAgentValue(place, value);
}

/**
 * Adds a value at a path that does not exist yet: a key of a mapping or the next index of a
 * sequence. A command that returns whether it took place, as the result the tool reports to the
 * agent (the added path, or why not).
 * @param {PathPlace} place - the place the path leads to (without a node).
 * @param {*} value - the new value.
 * @returns {{path?: string, added?: boolean, error?: string}} the path added, or why not.
 */
function addAgentValue(place, value) {
    if (!place.segs.length) return { error: NO_DATA };
    const parent = getNodeAtPath(place.doc.root, place.segs.slice(0, -1));
    const last = place.segs[place.segs.length - 1];
    const box = getAliasTarget(parent);
    if (!box || (box.type !== 'object' && box.type !== 'array')) return { error: `There is no object or array at ${formatPath(place.segs.slice(0, -1))}.` };
    if (parent.type === 'alias') return { error: 'This place is an alias - change the anchor it points to.' };
    if (box.type === 'array' && !(Number(last) === box.entries.length)) return { error: `The array has ${box.entries.length} entries - only index ${box.entries.length} can be added.` };
    const result = editCodeFromTree({ kind: 'add', box, key: box.type === 'object' ? String(last) : undefined, value }, { doc: place.docIndex });
    return result === true ? { path: formatPath(place.segs), added: true } : { error: result };
}

/**
 * Returns the user's documents for list_files.
 * @returns {Array<{name: string, updated: number, open: boolean}>} the documents, the most recent first.
 */
export function getFileList() {
    return store.getSortedEntries().map(entry => ({ name: entry.name, updated: entry.updated, open: entry.id === state.fileId }));
}

/**
 * Opens a document by name for open_file. A command that returns whether it took place.
 * @param {string} name - the name.
 * @returns {boolean} true when there is such a document.
 */
export function openFileByName(name) {
    const entry = store.findByName(name);
    if (entry && entry.id !== state.fileId) openDocument(entry.id);
    return !!entry;
}

/**
 * Makes a new document for new_file and opens it. A command that returns whether it took
 * place, as the name the document got, which the tool reports.
 * @param {string} name - the name it should get.
 * @param {string} [code] - its YAML; empty without.
 * @returns {string} the name it got.
 * @throws {DOMException} when the storage is full.
 */
export function createFile(name, code) {
    const id = store.create(name || AI_DOCUMENT, code || BLANK);
    openDocument(id);
    return state.name;
}

/**
 * Replaces an exact piece of the code for replace_text, as one undo step. A command that
 * returns whether (and how often) it took place, which the tool reports; 0 when it did not.
 * @param {string} find - the text to find.
 * @param {string} replacement - the new text.
 * @param {boolean} all - true to replace every match, false for the first.
 * @returns {number} the number of replacements, 0 when the text is not there.
 */
export function updateCodeText(find, replacement, all) {
    if (!find) return 0;
    const count = state.code.split(find).length - 1;
    if (!count) return 0;
    setCode(all ? state.code.split(find).join(replacement) : state.code.replace(find, () => replacement));
    return all ? count : 1;
}

/**
 * Shows a line of the code for show_line, and its value in the tree.
 * @param {number} line - the line, 1-based.
 * @returns {void}
 */
export function showLine(line) {
    showCodePosition(getLineStart(line));
    selectCursorNode();
}
