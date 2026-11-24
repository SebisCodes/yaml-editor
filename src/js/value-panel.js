/**
 * The "Value" tab of the side panel: the selected value with its path, key, type and value as
 * fields, where it is in the code, its anchor or alias, and the buttons to add, duplicate, move
 * and remove it. A change in a field is one edit of the code (tree-panel.js).
 */

import { escapeHtml, formatPath, getAliasTarget, TYPES } from './datatree.js?v=13';
import { state, ui, areas, showToast, getElement, formatByteSize, getByteSize, hasData } from './state.js?v=2';
import { getLineIndex, getColumnIndex } from './code-view.js?v=5';
import { editCodeFromTree, runNodeAction, getTypedValue } from './tree-panel.js?v=5';
import { getTreeCodeRange } from './tree-views.js?v=1';

/** The types the type choice above the tree shows for a value. */
const TYPE_LABEL = { string: 'string', number: 'number', boolean: 'boolean', null: 'null', object: 'object', array: 'array', alias: 'alias' };
/** The fewest and the most rows the value field takes. */
const MIN_VALUE_ROWS = 2;
const MAX_VALUE_ROWS = 10;

/**
 * Draws the tab for the selected value and sets the type choice above the tree. What is being
 * typed into a field of the tab stays as it is.
 * @returns {void}
 */
export function renderValuePanel() {
    const info = areas.tree.getSelectedInfo();
    const typeChoice = getElement('#node-type');
    typeChoice.value = info && info.node && TYPE_LABEL[info.node.type] && info.node.type !== 'alias' ? info.node.type : '';
    typeChoice.disabled = !info;
    if (ui.node.contains(document.activeElement) && document.activeElement.matches('input, textarea')) return;
    if (!info || !info.node) {
        ui.node.innerHTML = `<p class="hint">${hasData() ? 'Click a key or a value in the tree.' : 'The document has no data yet.'}</p>`;
        return;
    }
    ui.node.innerHTML = renderValueForm(info);
}

/**
 * Returns the fields and buttons of the selected value.
 * @param {object} info - the selected place: node, entry, path.
 * @returns {string} the form as HTML.
 */
function renderValueForm(info) {
    const { node, entry } = info;
    const target = getAliasTarget(node) || node;
    const isBox = target.type === 'object' || target.type === 'array';
    const hasKey = entry && entry.parent.type === 'object';
    const options = TYPES.map(type => `<option value="${type}"${type === node.type ? ' selected' : ''}>${type}</option>`).join('');
    const value = !isBox && node.type !== 'alias' ? (node.type === 'string' ? node.value : node.raw || String(node.value)) : '';
    return `<div class="node-form">
        <label class="field"><span>Path</span><code data-no-i18n>${escapeHtml(formatPath(info.path))}</code></label>
        ${hasKey ? `<label class="field"><span>Key</span><input id="n-key" value="${escapeHtml(entry.key)}" spellcheck="false" data-no-i18n></label>` : ''}
        <label class="field"><span>Type</span><select id="n-type"${node.type === 'alias' ? ' disabled' : ''}>${node.type === 'alias' ? '<option>alias</option>' : options}</select></label>
        ${!isBox && node.type !== 'alias' ? `<label class="field"><span>Value</span><textarea id="n-value" rows="${Math.min(MAX_VALUE_ROWS, Math.max(MIN_VALUE_ROWS, value.split('\n').length))}" spellcheck="${node.type === 'string'}" data-no-i18n>${escapeHtml(value)}</textarea></label>
        <div class="button-row"><button type="button" class="button primary" id="n-apply">Apply</button></div>` : ''}
        <div class="node-info">${escapeHtml(getNodeInfo(node, entry, target, isBox))}</div>
        ${node.anchor ? `<p class="hint">Anchor: <code data-no-i18n>&amp;${escapeHtml(node.anchor)}</code></p>` : ''}${node.type === 'alias' ? `<p class="hint">Alias of the anchor: <code data-no-i18n>&amp;${escapeHtml(node.value)}</code></p>` : ''}
        <div class="button-row two">
            <button type="button" class="button" data-n="add">${isBox ? 'Add an entry' : 'Add after it'}</button>
            <button type="button" class="button" data-n="dup"${entry ? '' : ' disabled'}>Duplicate</button>
            <button type="button" class="button" data-n="up"${entry && entry.index > 0 ? '' : ' disabled'}>Move up</button>
            <button type="button" class="button" data-n="down"${entry && entry.index < entry.parent.entries.length - 1 ? '' : ' disabled'}>Move down</button>
            <button type="button" class="button danger" data-n="remove"${entry ? '' : ' disabled'}>Remove</button>
        </div></div>`;
}

/**
 * Returns where a value is and how big it is: entries, line, column and size.
 * @param {object} node - the node.
 * @param {object|null} entry - its entry, null for a root.
 * @param {object} target - the node an alias stands for, else the node itself.
 * @param {boolean} isBox - true for an object or array.
 * @returns {string} "2 keys · line 3, column 1 · 40 B".
 */
function getNodeInfo(node, entry, target, isBox) {
    const range = getTreeCodeRange(entry ? entry.start : node.start, node.end);
    const start = getTreeCodeRange(node.start, node.end).start;
    const size = getByteSize(state.code.slice(range.start, range.end));
    const count = target.entries?.length;
    const entries = isBox ? `${count} ${target.type === 'object' ? (count === 1 ? 'key' : 'keys') : count === 1 ? 'entry' : 'entries'} · ` : '';
    return `${entries}line ${getLineIndex(start) + 1}, column ${getColumnIndex(start) + 1} · ${formatByteSize(size)}`;
}

/**
 * Writes the value typed into the field into the code, read as the value's type.
 * @returns {void}
 */
function setValueFromField() {
    const info = areas.tree.getSelectedInfo(), field = getElement('#n-value');
    if (!info || !field) return;
    const typed = getTypedValue(info.node, field.value);
    if (typed.error) { showToast(typed.error); return; }
    if (!typed.same) editCodeFromTree({ kind: 'value', node: info.node, value: typed.value, raw: typed.raw });
}

/**
 * Connects the tab: its buttons, the fields of key, type and value, Ctrl+Enter in the value and
 * Enter in the key; leaving the tab draws it again.
 * @returns {void}
 */
export function startValuePanel() {
    ui.node.addEventListener('click', event => {
        const button = event.target.closest('[data-n]');
        if (button) { runNodeAction(button.dataset.n); return; }
        if (event.target.id === 'n-apply') setValueFromField();
    });
    ui.node.addEventListener('change', editCodeOnChange);
    ui.node.addEventListener('keydown', event => {
        if (event.target.id === 'n-value' && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); setValueFromField(); }
        if (event.target.id === 'n-key' && event.key === 'Enter') { event.preventDefault(); event.target.blur(); }
    });
    ui.node.addEventListener('focusout', () => setTimeout(() => { if (!ui.node.contains(document.activeElement)) renderValuePanel(); }, 0));
}

/**
 * Writes a changed type or key of the tab into the code.
 * @param {Event} event - the change of the type menu or the key field.
 * @returns {void}
 */
function editCodeOnChange(event) {
    const info = areas.tree.getSelectedInfo();
    if (!info) return;
    if (event.target.id === 'n-type') editCodeFromTree({ kind: 'type', node: info.node, type: event.target.value });
    if (event.target.id === 'n-key' && event.target.value !== String(info.entry.key)) editCodeFromTree({ kind: 'key', entry: info.entry, key: event.target.value });
}
