/**
 * The tools around the tree: the buttons and the type choice above it, Alt+Up / Alt+Down to
 * move an entry, opening and closing every level, copying the path, the search in keys and
 * values, and the code cursor that marks its value in the tree.
 */

import { formatPath, getNodeAtPosition } from './datatree.js?v=12';
import { state, ui, areas, showToast, getElement } from './state.js?v=2';
import { moveLineBand } from './code-view.js?v=3';
import { editCodeFromTree, runNodeAction, CHOOSE_VALUE } from './tree-panel.js?v=3';
import { renderValuePanel } from './value-panel.js?v=3';

/** The pause after typing in the search before it searches, in milliseconds. */
const SEARCH_DELAY = 160;
/** The pause after the cursor moves before the tree follows it, in milliseconds. */
const CURSOR_DELAY = 120;
/** The buttons above the tree and their actions. */
const NODE_BUTTONS = { '#node-add': 'add', '#node-dup': 'dup', '#node-up': 'up', '#node-down': 'down', '#node-del': 'remove' };

const searchInput = getElement('#tree-search');
const hitsOutput = getElement('#tree-hits');
let searchTimer = 0;
let cursorTimer = 0;

/**
 * Connects the tools around the tree.
 * @returns {void}
 */
export function startTreeTools() {
    connectNodeButtons();
    connectSearch();
    document.addEventListener('selectionchange', syncWithCodeCursor);
}

/**
 * Moves the line band with the cursor in the code and selects its node after a pause (a
 * selectionchange handler).
 * @returns {void}
 */
function syncWithCodeCursor() {
    if (document.activeElement !== ui.ta) return;
    moveLineBand();
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(selectCursorNode, CURSOR_DELAY);
}

/**
 * Connects the buttons and the type choice above the tree, Alt+Up / Alt+Down, opening and
 * closing every level and copying the path.
 * @returns {void}
 */
function connectNodeButtons() {
    for (const [selector, action] of Object.entries(NODE_BUTTONS)) getElement(selector).addEventListener('click', () => runNodeAction(action));
    getElement('#node-type').addEventListener('change', event => {
        const info = areas.tree.getSelectedInfo();
        if (!info) { showToast(CHOOSE_VALUE); return; }
        editCodeFromTree({ kind: 'type', node: info.node, type: event.target.value });
    });
    ui.tree.addEventListener('keydown', event => {
        if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) { event.preventDefault(); event.stopPropagation(); runNodeAction(event.key === 'ArrowUp' ? 'up' : 'down'); }
    }, true);
    getElement('#tree-open').addEventListener('click', () => areas.tree.openAll());
    getElement('#tree-close').addEventListener('click', () => areas.tree.closeAll());
    getElement('#path-copy').addEventListener('click', copyPath);
}

/**
 * Copies the path of the selected value to the clipboard and shows it.
 * @returns {Promise<void>} resolves when it is copied.
 */
async function copyPath() {
    const info = areas.tree.getSelectedInfo();
    const path = formatPath(info ? info.path : []);
    try { await navigator.clipboard.writeText(path); } catch (e) { /* the path is shown anyway */ }
    showToast(`Path copied: ${path}`);
}

/**
 * Connects the search: typing searches after a pause, Enter and the arrows go to the next or
 * previous match, Escape clears it.
 * @returns {void}
 */
function connectSearch() {
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => { areas.tree.find(searchInput.value); showHits(); }, SEARCH_DELAY);
    });
    searchInput.addEventListener('keydown', findOnKey);
    getElement('#tree-next').addEventListener('click', () => { areas.tree.selectNextHit(1); showHits(); });
    getElement('#tree-prev').addEventListener('click', () => { areas.tree.selectNextHit(-1); showHits(); });
}

/**
 * Enter in the search goes to the next match (Shift+Enter the one before) or searches when
 * nothing is found yet; Escape clears the search.
 * @param {KeyboardEvent} event - the key in the search field.
 * @returns {void}
 */
function findOnKey(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        if (areas.tree.getHits().count) areas.tree.selectNextHit(event.shiftKey ? -1 : 1); else areas.tree.find(searchInput.value);
        showHits();
    }
    if (event.key === 'Escape') { searchInput.value = ''; areas.tree.find(''); showHits(); }
}

/**
 * Shows the number of matches of the tree search and which one is selected.
 * @returns {void}
 */
function showHits() {
    const hits = areas.tree.getHits();
    hitsOutput.textContent = searchInput.value.trim() ? (hits.count ? `${hits.index + 1} / ${hits.count}` : '0') : '';
}

/**
 * Focuses the tree search with its text selected (Ctrl+F outside the code).
 * @returns {void}
 */
export function selectSearchField() {
    searchInput.focus();
    searchInput.select();
}

/**
 * Selects in the tree the value at the code cursor.
 * @returns {void}
 */
export function selectCursorNode() {
    if (!state.model || areas.tree.isEditing()) return;
    const node = getNodeAtPosition(state.model, ui.ta.selectionStart);
    if (node) { areas.tree.selectNode(node); renderValuePanel(); }
}
