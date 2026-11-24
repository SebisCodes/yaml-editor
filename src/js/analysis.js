/**
 * Reading the code: the data model, its problems and the JSON Schema check. updateAnalysis()
 * runs these steps:
 *   1. read the code into the model (datatree.js parse());
 *   2. collect the problems of the code and, with a schema chosen, those of the schema check;
 *   3. build the view of a template (tree-views.js: the example view or the template view);
 *   4. draw the tree, the controls of template placeholders, the problems and the side panel
 *      tabs that show the data.
 */

import { parse, getModelValue, getSchemaProblems, TooManyValues } from './datatree.js?v=13';
import { store } from './files.js?v=8';
import { state, ui, areas, FORMAT, getElement } from './state.js?v=2';
import { renderMarks } from './code-view.js?v=5';
import { renderProblems } from './problems.js?v=5';
import { renderValuePanel } from './value-panel.js?v=5';
import { renderSchemaPanel } from './schema-panel.js?v=5';
import { renderConvertResult } from './conversion-panel.js?v=5';
import { updateTreeView, getTreeModel } from './tree-views.js?v=1';
import { renderTemplateControls } from './template-panel.js?v=2';

/**
 * The schema chosen for the open document.
 * @typedef {object} ChosenSchema
 * @property {string} [id] - the id of the schema document.
 * @property {string} [name] - its name.
 * @property {*} [value] - the schema as data, null when it cannot be read.
 * @property {number|null} [error] - the line (1-based) of its syntax error, null without one.
 * @property {boolean} [missing] - true when the chosen document is gone.
 */

/** The schema document as last read; it changes in one step, so a schema that cannot be read never leaves the old one in use. */
const schemaCache = { code: null, value: null, error: null };
let analysisTimer = 0;

/**
 * Returns the schema chosen for the open document, read from its document (cached while its
 * code stays the same).
 * @returns {ChosenSchema|null} the schema, null when none is chosen.
 */
export function getSchema() {
    const id = store.getEntry(state.fileId)?.schema;
    if (!id) return null;
    const entry = store.getEntry(id);
    if (!entry) return { missing: true };
    const code = id === state.fileId ? state.code : store.code(id) || '';
    if (schemaCache.code !== code) Object.assign(schemaCache, readSchema(code));
    return { id, name: entry.name, value: schemaCache.value, error: schemaCache.error };
}

/**
 * Reads a schema document.
 * @param {string} code - the schema's code.
 * @returns {{code: string, value: *, error: number|null}} its data, or the line of its error.
 * @throws {Error} what reading throws, except aliases that expand too far.
 */
function readSchema(code) {
    const model = parse(FORMAT.editor, code);
    const syntaxError = model.problems.find(problem => problem.kind === 'error');
    let value = null, error = syntaxError ? getLineIndexIn(code, syntaxError.pos) + 1 : null;
    if (!syntaxError) {
        try { value = getModelValue(model); } catch (e) {
            if (!(e instanceof TooManyValues)) throw e;
            error = getLineIndexIn(code, Math.max(0, code.indexOf('*'))) + 1;   // aliases that expand too far
        }
    }
    return { code, value, error };
}

/**
 * Returns the line of a position in a text.
 * @param {string} code - the text.
 * @param {number} position - the character offset.
 * @returns {number} the line, 0-based.
 */
function getLineIndexIn(code, position) {
    return code.slice(0, position).split('\n').length - 1;
}

/**
 * Forgets the schema as read, so the next check reads it again.
 * @returns {void}
 */
export function clearSchemaCache() {
    schemaCache.code = null;
}

/**
 * Reads the code, collects its problems and draws everything that shows the data.
 * @returns {void}
 */
export function updateAnalysis() {
    clearTimeout(analysisTimer);
    state.model = parse(FORMAT.editor, state.code);
    showDownloadFormat();
    state.problems = getProblems();
    updateTreeView();
    areas.tree.render(getTreeModel());
    renderTemplateControls();
    renderProblems();
    renderValuePanel();
    if (!ui.schema.hidden) renderSchemaPanel();
    if (!ui.convert.hidden) renderConvertResult();
}

/**
 * Builds the view of a template again and draws the tree, the controls of template placeholders
 * and the value panel: after a switch of the view, and when the page's examples change.
 * @returns {void}
 */
export function renderTreeView() {
    updateTreeView();
    areas.tree.render(getTreeModel());
    renderTemplateControls();
    renderValuePanel();
}

/**
 * Returns the problems of the code and of the schema check, by position.
 * @returns {import('./state.js').Problem[]} the problems.
 */
function getProblems() {
    const problems = [...state.model.problems];
    const schema = getSchema();
    if (schema && schema.error) problems.push({ pos: 0, end: 0, kind: 'warn', msg: `The schema "${schema.name}" has a syntax error in line ${schema.error} - it is not used` });
    else if (schema && schema.value !== null && schema.value !== undefined && !state.model.broken) {
        for (const doc of state.model.docs) if (doc.root) problems.push(...getSchemaProblems(doc.root, schema.value));
    }
    return problems.sort((a, b) => a.pos - b.pos);
}

/**
 * Names the file extension on the download button, once.
 * @returns {void}
 */
function showDownloadFormat() {
    const button = getElement('#btn-download');
    if (button.dataset.ext === FORMAT.ext) return;
    button.dataset.ext = FORMAT.ext;
    button.textContent = `Download .${FORMAT.ext}`;
    button.title = `Save the document as a .${FORMAT.ext} file (Ctrl+S)`;
}

/**
 * Reads the code again after a pause in typing.
 * @param {number} delay - the pause in milliseconds.
 * @returns {void}
 */
export function startAnalysisTimer(delay) {
    clearTimeout(analysisTimer);
    analysisTimer = setTimeout(() => { updateAnalysis(); renderMarks(); }, delay);
}
