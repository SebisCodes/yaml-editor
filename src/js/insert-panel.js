/**
 * The "Insert" tab of the side panel: new values added to the selected object or array (one
 * edit of the code through tree-panel.js), and pieces of YAML put in at the code cursor.
 */

import { escapeHtml, getIndentUnit, getAliasTarget } from './datatree.js?v=13';
import { state, ui, areas, showToast } from './state.js?v=2';
import { setCodeRange } from './code-view.js?v=5';
import { addHistoryStep } from './history.js?v=5';
import { editCodeFromTree, CHOOSE_VALUE, SINGLE_ROOT } from './tree-panel.js?v=5';

/** The empty value of each type a button adds. */
const NEW_VALUES = { string: '', number: 0, boolean: true, null: null, object: {}, array: [] };
/** The characters of an ISO date, YYYY-MM-DD. */
const DATE_LENGTH = 10;

/**
 * The pieces of code: the text ("|" marks where the cursor goes, or a function that returns
 * it) and whether it is a block that takes the indentation of the cursor's line.
 * @type {Object<string, [string|function(): string, boolean]>}
 */
const SNIPPETS = {
    map: ['|key: value', true],
    nested: ['|key:\n  child: value', true],
    item: ['- |item', true],
    items: ['|list:\n  - one\n  - two', true],
    block: ['|text: |\n  first line\n  second line', true],
    folded: ['|text: >\n  a long text that is\n  joined into one line', true],
    anchor: ['|defaults: &defaults\n  key: value\nuse:\n  <<: *defaults', true],
    doc: ['---\n|', true],
    comment: ['# |', false],
    date: [() => `${new Date().toISOString().slice(0, DATE_LENGTH)}|`, false],
    null: ['null|', false], true: ['true|', false], false: ['false|', false],
};

/**
 * Returns a button that adds a value of a type.
 * @param {string} type - the key in NEW_VALUES.
 * @param {string} label - the button's text.
 * @param {string} title - its tooltip.
 * @returns {string} the button as HTML.
 */
function renderAddButton(type, label, title) {
    return `<button type="button" class="button" data-add="${type}" title="${escapeHtml(title)}">${label}</button>`;
}

/**
 * Returns a button that puts a piece of code in at the cursor.
 * @param {string} name - the key in SNIPPETS.
 * @param {string} label - the button's text.
 * @param {string} title - its tooltip.
 * @returns {string} the button as HTML.
 */
function renderSnippetButton(name, label, title) {
    return `<button type="button" class="button" data-ins="${name}" title="${escapeHtml(title)}">${label}</button>`;
}

/**
 * Draws the "Insert" tab.
 * @returns {void}
 */
export function renderInsertPanel() {
    const add = renderAddButton, snippet = renderSnippetButton;
    ui.insert.innerHTML = `
        <div class="insert-group"><h3>Add to the selected value</h3>
            <p class="hint">Into the selected object or array, otherwise after the selected entry. One step for Undo.</p>
            <div class="insert-grid">
            ${add('string', 'Text', 'A new string')}${add('number', 'Number', 'A new number')}${add('boolean', 'True / false', 'A new boolean')}${add('null', 'Empty (null)', 'A new null')}
            ${add('object', 'Object { }', 'A new empty object')}${add('array', 'Array [ ]', 'A new empty array')}
        </div></div>
        <div class="insert-group"><h3>At the cursor in the code</h3><div class="insert-grid">
            ${snippet('map', 'Key and value', 'One entry of a mapping')}${snippet('nested', 'Nested mapping', 'A key with keys below it')}
            ${snippet('item', 'List item', 'One item of a sequence')}${snippet('items', 'List', 'A key with a list below it')}
            ${snippet('block', 'Text block (|)', 'Several lines, kept as they are')}${snippet('folded', 'Folded text (>)', 'Several lines, joined into one')}
            ${snippet('anchor', 'Anchor and alias', 'Values defined once (&) and used again (*, <<)')}${snippet('doc', 'Next document (‑‑‑)', 'A further document in the same file')}
            ${snippet('comment', 'Comment (#)', 'A comment')}${snippet('date', 'Today\'s date', 'The date as YYYY-MM-DD')}
            ${snippet('null', 'null', 'An empty value')}${snippet('true', 'true', 'The boolean true')}
        </div></div>`;
}

/**
 * Connects the buttons of the tab; a snippet button keeps the focus in the code.
 * @returns {void}
 */
export function startInsertPanel() {
    ui.insert.addEventListener('mousedown', event => { if (event.target.closest('[data-ins]')) event.preventDefault(); });
    ui.insert.addEventListener('click', addOnClick);
}

/**
 * Adds what the clicked button of the tab stands for: an empty value or a snippet.
 * @param {MouseEvent} event - the click in the tab.
 * @returns {void}
 */
function addOnClick(event) {
    const addButton = event.target.closest('[data-add]');
    if (addButton) { addNewValue(addButton.dataset.add); return; }
    const snippetButton = event.target.closest('[data-ins]');
    if (snippetButton) addSnippet(...SNIPPETS[snippetButton.dataset.ins]);
}

/**
 * Adds an empty value of a type into the selected object or array, or after the selected
 * entry; the key of a new object entry opens for typing.
 * @param {string} type - the key in NEW_VALUES.
 * @returns {void}
 */
function addNewValue(type) {
    const info = areas.tree.getSelectedInfo();
    if (!info) { showToast(CHOOSE_VALUE); return; }
    const target = getAliasTarget(info.node);
    const box = target && (target.type === 'object' || target.type === 'array') ? info.node : info.entry ? info.entry.parent : null;
    if (!box) { showToast(SINGLE_ROOT); return; }
    const at = box === info.node ? box.entries.length : info.entry.index + 1;
    const value = NEW_VALUES[type];
    if (editCodeFromTree({ kind: 'add', box, at, value: value && typeof value === 'object' ? (Array.isArray(value) ? [] : {}) : value }) === true && box.type === 'object') areas.tree.edit('key');
}

/**
 * Puts a piece of code in at the cursor: "|" marks where the cursor goes, and a block takes
 * the indentation of the cursor's line and the document's indentation unit. One undo step.
 * @param {string|function(): string} snippet - the text, or a function that returns it.
 * @param {boolean} isBlock - true to indent the lines after the first.
 * @returns {void}
 */
function addSnippet(snippet, isBlock) {
    const ta = ui.ta;
    const start = ta.selectionStart, end = ta.selectionEnd;
    let text = typeof snippet === 'function' ? snippet() : snippet;
    const lineStart = state.code.lastIndexOf('\n', start - 1) + 1;
    const indent = /^[ \t]*/.exec(state.code.slice(lineStart))[0];
    const unit = getIndentUnit(state.code);
    if (isBlock) text = text.replace(/\n {2}/g, '\n' + unit).split('\n').map((line, index) => (index ? indent + line : line)).join('\n');
    let caret = text.indexOf('|');
    text = text.replace('|', '');
    if (caret < 0) caret = text.length;
    setCodeRange(start, end, text, start + caret);
    addHistoryStep();
}
