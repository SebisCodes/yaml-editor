/**
 * The controls of template placeholders (?template=) in the YAML editor: the switch between the
 * example view and the template view in the tree's bar, the note when the example view could not
 * be made, and the "Placeholders" box at the bottom of the code (template-controls.js).
 * Without a template syntax none of them is there.
 */

import { state, ui, getElement } from './state.js?v=2';
import { getActiveTemplateSyntax } from './datatree.js?v=13';
import { setCodeRange } from './code-view.js?v=5';
import { addHistoryStep, addPendingHistoryStep } from './history.js?v=5';
import { renderTreeView } from './analysis.js?v=5';
import { startViewSwitch, showViewSwitch, showViewNote, createPlaceholderBox } from './template-controls.js?v=2';
import { buildDocumentPlaceholders } from './template-examples.js?v=2';
import { getViewMode, setViewMode, isExampleViewFailed, getTemplateExamples } from './tree-views.js?v=1';

/** The box, once connected. */
let placeholderBox = null;
/** What the box lists: the examples it was drawn for, or the document's tags. */
let listedKey = null;

/**
 * Connects the switch of the views and the box; without a template syntax nothing.
 * @returns {void}
 */
export function startTemplateControls() {
    const syntax = getActiveTemplateSyntax();
    if (!syntax) return;
    startViewSwitch(getElement('#view-switch'), mode => { setViewMode(mode); renderTreeView(); });
    placeholderBox = createPlaceholderBox(getElement('#placeholder-box'), { syntax, textarea: ui.ta, insertText: editCodeAtRange });
}

/**
 * Writes a placeholder's tag over a range of the code as one undo step.
 * @param {number} start - the start of the range.
 * @param {number} end - the end of the range.
 * @param {string} text - the tag, or a section's start tag, selection and end tag.
 * @param {number} selectionStart - the start of the selection afterwards.
 * @param {number} selectionEnd - the end of the selection afterwards.
 * @returns {void}
 */
function editCodeAtRange(start, end, text, selectionStart, selectionEnd) {
    addPendingHistoryStep();
    setCodeRange(start, end, text, selectionStart, selectionEnd);
    clearTimeout(state.histTimer);
    state.histTimer = 0;
    addHistoryStep();
}

/**
 * Shows the view chosen, the note when the example view could not be made, and the
 * placeholders in the box: the page's list, else the tags of the document.
 * @returns {void}
 */
export function renderTemplateControls() {
    if (!placeholderBox) return;
    showViewSwitch(getElement('#view-switch'), getViewMode());
    showViewNote(getElement('#view-note'), isExampleViewFailed());
    const examples = getTemplateExamples();
    const placeholders = examples && examples.placeholders.length ? examples.placeholders : buildDocumentPlaceholders(state.code, getActiveTemplateSyntax());
    const key = examples && examples.placeholders.length ? examples : placeholders.map(placeholder => placeholder.kind + ':' + placeholder.name).join('\n');
    if (key === listedKey) return;
    listedKey = key;
    placeholderBox.render(placeholders);
}
