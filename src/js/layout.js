/**
 * The layout of the work area and the dialogs: the splitter between code and tree (dragged or
 * moved with the arrow keys, stored with the settings), the views of narrow screens (code,
 * tree, edit), and the close buttons, the backdrop and the help button of the dialogs.
 */

import { openDialog } from './dialogs.js?v=5';
import { state, ui, getElement, getElements, getClamped } from './state.js?v=2';
import { syncScroll } from './code-view.js?v=3';
import { saveDocument } from './storage.js?v=3';

/** The smallest and largest share of the width the code takes. */
const MIN_SPLIT = 0.15;
const MAX_SPLIT = 0.85;
/** How far an arrow key moves the splitter, as a share of the width. */
const SPLIT_STEP = 0.03;

const splitter = getElement('#splitter');

/**
 * Shows the split between code and tree as it is in the state.
 * @returns {void}
 */
export function showSplit() {
    ui.work.style.setProperty('--code-fr', state.split.toFixed(4) + 'fr');
    ui.work.style.setProperty('--view-fr', (1 - state.split).toFixed(4) + 'fr');
}

/**
 * Shows one view on narrow screens and marks its tab.
 * @param {string} pane - "code", "draw" (the tree) or "properties" (the side panel).
 * @returns {void}
 */
export function showPane(pane) {
    ui.work.dataset.show = pane;
    getElements('[data-pane]').forEach(tab => tab.setAttribute('aria-selected', String(tab.dataset.pane === pane)));
    requestAnimationFrame(() => { if (pane === 'code') syncScroll(); });
}

/**
 * Connects the splitter and the view tabs of narrow screens.
 * @returns {void}
 */
export function startLayout() {
    splitter.addEventListener('pointerdown', startSplitterDrag);
    splitter.addEventListener('keydown', moveSplitterOnKey);
    getElements('[data-pane]').forEach(tab => tab.addEventListener('click', () => showPane(tab.dataset.pane)));
}

/**
 * Moves the splitter one step with the left and right arrow keys and stores the split.
 * @param {KeyboardEvent} event - the key on the splitter.
 * @returns {void}
 */
function moveSplitterOnKey(event) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    state.split = getClamped(state.split + (event.key === 'ArrowLeft' ? -SPLIT_STEP : SPLIT_STEP), MIN_SPLIT, MAX_SPLIT);
    showSplit();
    saveDocument();
}

/**
 * Follows the pointer while the splitter is dragged; the split is stored when it is let go
 * (a pointerdown handler).
 * @param {PointerEvent} event - the pointer that grabbed the splitter.
 * @returns {void}
 */
function startSplitterDrag(event) {
    splitter.setPointerCapture(event.pointerId);
    const area = ui.work.getBoundingClientRect();
    const width = area.width - getElement('.inspector').offsetWidth - splitter.offsetWidth;
    /**
     * Moves the split with the pointer.
     * @param {PointerEvent} moveEvent - the pointer's move.
     * @returns {void}
     */
    const moveSplit = moveEvent => { state.split = getClamped((moveEvent.clientX - area.left) / width, MIN_SPLIT, MAX_SPLIT); showSplit(); };
    /**
     * Ends the drag and stores the split.
     * @returns {void}
     */
    const stopDrag = () => { splitter.removeEventListener('pointermove', moveSplit); splitter.removeEventListener('pointerup', stopDrag); saveDocument(); };
    splitter.addEventListener('pointermove', moveSplit);
    splitter.addEventListener('pointerup', stopDrag);
}

/**
 * Connects the dialogs: their close buttons, a click on the backdrop and the help button.
 * @returns {void}
 */
export function startDialogs() {
    getElements('dialog [data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
    getElements('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); }));
    getElement('#btn-help').addEventListener('click', () => openDialog(getElement('#help')));
}
