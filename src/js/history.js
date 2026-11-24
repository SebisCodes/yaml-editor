/**
 * Setting the code and the undo history. Each document keeps its own history while the page
 * is open (documents.js); typing becomes one undo step after a short pause.
 */

import { state, ui, areas, showToast, getElement } from './state.js?v=2';
import { renderCode } from './code-view.js?v=4';
import { updateAnalysis } from './analysis.js?v=4';
import { saveDocument } from './storage.js?v=4';

/** The most undo steps a document keeps. */
const MAX_STEPS = 300;
/** The most text the undo history of a large file keeps, in characters (about 200 MB). */
const MAX_HISTORY_TEXT = 1e8;

/**
 * Sets the code: reads it, draws it, stores it and tells the page around the editor.
 * @param {string} code - the new code.
 * @param {object} [options] - how the code is set.
 * @param {boolean} [options.history] - false to make no undo step of it.
 * @returns {void}
 */
export function setCode(code, { history = true } = {}) {
    const ta = ui.ta;
    const scrollTop = ta.scrollTop, scrollLeft = ta.scrollLeft, selectionStart = ta.selectionStart, selectionEnd = ta.selectionEnd;
    // Typing still waiting for its undo step gets it first, so Undo after this change goes back to that text.
    if (history && state.histTimer) { clearTimeout(state.histTimer); state.histTimer = 0; addHistoryStep(); }
    state.code = code;
    if (ta.value !== code) {
        ta.value = code;
        ta.scrollTop = scrollTop; ta.scrollLeft = scrollLeft;
        ta.setSelectionRange(Math.min(selectionStart, code.length), Math.min(selectionEnd, code.length));
    }
    updateAnalysis();
    renderCode();
    if (history) addHistoryStep();
    saveDocument();
    areas.sync?.handleChange();
}

/**
 * Turns typing that waits for its undo step into one at once, so an edit made next is a step
 * of its own.
 * @returns {void}
 */
export function addPendingHistoryStep() {
    clearTimeout(state.histTimer);
    if (state.history[state.history.length - 1]?.code !== state.code) addHistoryStep();
}

/**
 * Enables the Undo and Redo buttons when there is something to undo or redo.
 * @returns {void}
 */
export function updateHistoryUi() {
    const last = state.history[state.history.length - 1];
    getElement('#btn-undo').disabled = !(state.history.length > 1 || (last && last.code !== state.code));
    getElement('#btn-redo').disabled = !state.future.length;
}

/**
 * Makes an undo step of the code as it stands; the same code only moves the step's cursor.
 * @returns {void}
 */
export function addHistoryStep() {
    const last = state.history[state.history.length - 1];
    const selection = ui.ta.selectionStart;
    if (last && last.code === state.code) { last.sel = selection; return; }
    state.history.push({ code: state.code, sel: selection, tree: areas.tree.getSelectedPlace() });
    if (state.history.length > MAX_STEPS) state.history.shift();
    removeOldHistoryText();
    state.future = [];
    updateHistoryUi();
}

/**
 * Drops the oldest steps while the history holds more text than its limit (two steps stay).
 * @returns {void}
 */
function removeOldHistoryText() {
    let total = 0;
    for (const step of state.history) total += step.code.length;
    while (total > MAX_HISTORY_TEXT && state.history.length > 2) total -= state.history.shift().code.length;
}

/**
 * Goes back one undo step: the code, the cursor and the place in the tree.
 * @returns {void}
 */
export function undo() {
    clearTimeout(state.histTimer);
    if (state.history[state.history.length - 1]?.code !== state.code) addHistoryStep();
    if (state.history.length < 2) { showToast('Nothing to undo'); return; }
    state.future.push(state.history.pop());
    const step = state.history[state.history.length - 1];
    setCode(step.code, { history: false });
    if (step.sel != null) ui.ta.setSelectionRange(Math.min(step.sel, state.code.length), Math.min(step.sel, state.code.length));
    if (step.tree) areas.tree.select(step.tree);
}

/**
 * Goes forward one step that Undo took back.
 * @returns {void}
 */
export function redo() {
    const step = state.future.pop();
    if (!step) { showToast('Nothing to redo'); return; }
    state.history.push(step);
    setCode(step.code, { history: false });
    if (step.tree) areas.tree.select(step.tree);
}
