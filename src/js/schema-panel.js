/**
 * The "Schema" tab of the side panel: the JSON Schema the document is checked against is one
 * of the user's documents (never downloaded), chosen here; the tab says whether the data fits,
 * opens the schema, and makes a new schema document from the data.
 */

import { escapeHtml, findKey, getModelValue } from './datatree.js?v=13';
import { convertToYaml, getInferredSchema } from './convert.js?v=14';
import { store } from './files.js?v=8';
import { state, ui, SYNTAX_ERROR, showToast, hasData } from './state.js?v=2';
import { getSchema, clearSchemaCache, updateAnalysis } from './analysis.js?v=4';
import { openDocument, createDocument } from './documents.js?v=4';

/** The most characters of the schema address the tab shows. */
const MAX_ADDRESS_LENGTH = 200;

/**
 * Draws the "Schema" tab: the choice of the schema document, the result of the check and the
 * buttons.
 * @returns {void}
 */
export function renderSchemaPanel() {
    const chosen = store.getEntry(state.fileId)?.schema || '';
    const entries = store.getSortedEntries().filter(entry => entry.id !== state.fileId);
    const schema = getSchema();
    const named = state.model?.docs[0]?.root?.type === 'object' ? findKey(state.model.docs[0].root, '$schema') : null;
    ui.schema.innerHTML = `
        <p class="hint">Check this document against a JSON Schema that is one of your documents (open or paste it as a new document first). The editor never downloads a schema.</p>
        <label class="field"><span>Schema</span><select id="sc-doc"><option value="">No schema</option>${entries.map(entry => `<option value="${escapeHtml(entry.id)}"${entry.id === chosen ? ' selected' : ''} data-no-i18n>${escapeHtml(entry.name)}</option>`).join('')}</select></label>
        ${renderSchemaStatus(schema)}
        ${named && named.node.type === 'string' ? `<p class="hint">The document names the schema <code data-no-i18n>${escapeHtml(named.node.value.slice(0, MAX_ADDRESS_LENGTH))}</code> - it is not loaded from there.</p>` : ''}
        <div class="button-row stack">
            <button type="button" class="button" id="sc-open"${schema && !schema.missing ? '' : ' disabled'}>Open the schema</button>
            <button type="button" class="button" id="sc-make" title="A new document with a schema that this data fits">Make a schema from this data</button>
        </div>`;
}

/**
 * Returns the result of the check: whether the data fits the schema, or why it is not checked.
 * @param {import('./analysis.js').ChosenSchema|null} schema - the chosen schema.
 * @returns {string} the status as HTML, empty without a schema.
 */
function renderSchemaStatus(schema) {
    if (!schema) return '';
    if (schema.missing) return '<div class="schema-status bad">The chosen schema document is not there any more.</div>';
    if (schema.error) return `<div class="schema-status bad">The schema has a syntax error in line ${schema.error} - open it and fix it first.</div>`;
    if (state.model?.broken) return '<div class="schema-status">Checked again once the syntax error is fixed.</div>';
    const count = state.problems.filter(problem => problem.kind === 'schema').length;
    return count ? `<div class="schema-status bad"><b>${count}</b> ${count === 1 ? 'place does' : 'places do'} not fit the schema - see above the code.</div>` : '<div class="schema-status good">The data fits the schema.</div>';
}

/**
 * Connects the tab: choosing a schema checks the document again, the buttons open the schema
 * or make one from the data.
 * @returns {void}
 */
export function startSchemaPanel() {
    ui.schema.addEventListener('change', setSchemaOnChange);
    ui.schema.addEventListener('click', event => {
        if (event.target.id === 'sc-open') openSchema();
        if (event.target.id === 'sc-make') addSchemaDocument();
    });
}

/**
 * Stores the schema chosen in the schema menu for the open document and checks it again.
 * @param {Event} event - the change in the tab.
 * @returns {void}
 */
function setSchemaOnChange(event) {
    if (event.target.id !== 'sc-doc') return;
    try { store.setEntryFields(state.fileId, { schema: event.target.value || null }); } catch (err) { showToast('The browser storage is full'); }
    clearSchemaCache();
    updateAnalysis();
    renderSchemaPanel();
}

/**
 * Opens the schema document of the open document.
 * @returns {void}
 */
function openSchema() {
    const id = store.getEntry(state.fileId)?.schema;
    if (!id || !store.getEntry(id)) return;
    openDocument(id);
    showToast(`"${state.name}" opened`);
}

/**
 * Makes a new document with a schema that the data fits, and checks the document against it.
 * @returns {void}
 */
function addSchemaDocument() {
    if (!state.model || state.model.broken || !hasData()) { showToast(SYNTAX_ERROR); return; }
    const sourceId = state.fileId, sourceName = state.name;
    const code = convertToYaml(getInferredSchema(getModelValue(state.model)));
    const id = createDocument(`${sourceName} schema`, code);
    if (!id) return;
    try { store.setEntryFields(sourceId, { schema: id }); } catch (err) { /* storage full */ }
    showToast(`New document "${state.name}" - "${sourceName}" is checked against it`);
}
