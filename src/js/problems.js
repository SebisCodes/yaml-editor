/**
 * The problems above the code: a count by kind (errors, schema problems, notes), a button to
 * show or hide the list, and one row per problem with its line and column. A click on a row
 * selects that place in the code and its value in the tree.
 */

import { escapeHtml } from './datatree.js?v=13';
import { getTreeNodeAtCode } from './tree-views.js?v=1';
import { state, ui, areas, NARROW_SCREEN } from './state.js?v=2';
import { getLineIndex, getColumnIndex, showCodePosition } from './code-view.js?v=5';
import { showPane } from './layout.js?v=5';

/** The most problems the list shows. */
const MAX_SHOWN = 80;
/** The class of a problem's row, by its kind. */
const ROW_CLASS = { error: 'err', schema: 'schema' };
/** The mark in front of a problem, by its kind. */
const ROW_MARK = { error: '✕', schema: '§' };

/**
 * Draws the problems above the code, or hides the box when there are none.
 * @returns {void}
 */
export function renderProblems() {
    const problems = state.problems;
    const box = ui.error;
    if (!problems.length) { box.hidden = true; return; }
    const errors = problems.filter(problem => problem.kind === 'error').length;
    const rows = problems.slice(0, MAX_SHOWN).map(renderProblemRow).join('');
    box.innerHTML = `<div class="pr-header"><span>${getCountText(problems)}</span><button type="button" class="button small" data-toggle-probs>${state.showProblems ? 'Hide' : 'Show'}</button></div>${state.showProblems ? `<ul>${rows}</ul>` : ''}`;
    box.classList.toggle('only-warnings', !errors);
    box.hidden = false;
}

/**
 * Returns the count of the problems by kind.
 * @param {import('./state.js').Problem[]} problems - the problems.
 * @returns {string} the counts as HTML, "<b>2 errors</b> · 1 note".
 */
function getCountText(problems) {
    const errors = problems.filter(problem => problem.kind === 'error').length;
    const schemaProblems = problems.filter(problem => problem.kind === 'schema').length;
    const notes = problems.length - errors - schemaProblems;
    const parts = [];
    if (errors) parts.push(`<b>${errors} ${errors === 1 ? 'error' : 'errors'}</b>`);
    if (schemaProblems) parts.push(`${schemaProblems} ${schemaProblems === 1 ? 'schema problem' : 'schema problems'}`);
    if (notes) parts.push(`${notes} ${notes === 1 ? 'note' : 'notes'}`);
    return parts.join(' · ');
}

/**
 * Returns the row of one problem.
 * @param {import('./state.js').Problem} problem - the problem.
 * @param {number} index - its index in the list of problems.
 * @returns {string} the row as HTML.
 */
function renderProblemRow(problem, index) {
    return `<li class="${ROW_CLASS[problem.kind] || 'warn'}"><div class="pr-row" role="button" tabindex="0" data-prob="${index}"><span class="kind">${ROW_MARK[problem.kind] || '!'}</span><span class="line-number">Line ${getLineIndex(problem.pos) + 1}, column ${getColumnIndex(problem.pos) + 1}</span><span>${escapeHtml(problem.msg)}</span></div></li>`;
}

/**
 * Connects the box of the problems: the keyboard on a row, the clicks on a row and on the
 * button that shows or hides the list.
 * @returns {void}
 */
export function startProblems() {
    ui.error.addEventListener('keydown', event => {
        if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-prob]')) { event.preventDefault(); event.target.click(); }
    });
    ui.error.addEventListener('click', handleProblemClick);
}

/**
 * Shows or hides the list, or selects the place of a clicked problem (a click handler).
 * @param {MouseEvent} event - the click.
 * @returns {void}
 */
function handleProblemClick(event) {
    if (event.target.closest('[data-prob]') && String(getSelection())) return;   // the user selects the text to copy it
    if (event.target.closest('[data-toggle-probs]')) { state.showProblems = !state.showProblems; renderProblems(); return; }
    const row = event.target.closest('[data-prob]');
    if (!row) return;
    const problem = state.problems[+row.dataset.prob];
    if (NARROW_SCREEN.matches) showPane('code');
    showCodePosition(problem.pos, true, Math.max(problem.pos, Math.min(problem.end ?? problem.pos, state.code.length)));
    const node = getTreeNodeAtCode(problem.pos);
    if (node) areas.tree.selectNode(node);
}
