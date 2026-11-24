/**
 * The code view: a textarea with the highlighted code, the marked lines with problems and the
 * gutter as layers behind it, the band on the line with the cursor, and the status below it.
 * Positions in the code are character offsets; lines and columns are 0-based here.
 */

import { highlight, escapeHtml } from './datatree.js?v=13';
import { state, ui, areas, FORMAT, NARROW_SCREEN, formatByteSize, getByteSize } from './state.js?v=2';
import { updateHistoryUi } from './history.js?v=4';

/** The height of a code line in pixels. */
const LINE_HEIGHT = 20;
/** Longer code is shown without colors, so typing stays fast. */
const HIGHLIGHT_LIMIT = 600000;
/** The padding above the first line of the code, in pixels. */
const CODE_PADDING = 10;
/** The scroll margin left of the cursor when the code scrolls sideways, in pixels. */
const SIDE_MARGIN = 40;
/** The room right of the cursor before the code scrolls sideways, in pixels. */
const SIDE_ROOM = 60;
/** The lines kept below the cursor before the code scrolls down to it. */
const SCROLL_MARGIN_LINES = 2;
/** Where a line the code scrolls to lands: this share of the height from the top. */
const SCROLL_TARGET_SHARE = 1 / 3;
/** The class of a marked line, by the kind of its problem. */
const MARK_CLASS = { error: 'err', schema: 'schema', warn: 'warn' };
/** The characters the width of the code font is measured over. */
const PROBE_CHARACTERS = 100;

let lineBand = null;
let characterWidth = 0;

/**
 * Sets up the code view: the band on the line with the cursor.
 * @returns {void}
 */
export function startCodeView() {
    lineBand = document.createElement('div');
    lineBand.className = 'line-band';
    lineBand.setAttribute('aria-hidden', 'true');
    ui.marks.before(lineBand);
}

/**
 * Returns the line of a position in the code.
 * @param {number} position - the character offset.
 * @returns {number} the line, 0-based.
 */
export function getLineIndex(position) {
    let line = 0;
    for (let index = state.code.indexOf('\n'); index >= 0 && index < position; index = state.code.indexOf('\n', index + 1)) line++;
    return line;
}

/**
 * Returns the column of a position in the code.
 * @param {number} position - the character offset.
 * @returns {number} the column, 0-based.
 */
export function getColumnIndex(position) {
    return position - (state.code.lastIndexOf('\n', position - 1) + 1);
}

/**
 * Returns where a line starts in the code; past the last line (also for a huge or endless
 * number) the end of the code.
 * @param {number} line - the line, 1-based.
 * @returns {number} the character offset.
 */
export function getLineStart(line) {
    let position = 0;
    for (let current = 1; current < line; current++) {
        const lineEnd = state.code.indexOf('\n', position);
        if (lineEnd < 0) return state.code.length;
        position = lineEnd + 1;
    }
    return position;
}

/**
 * Draws the code: highlighting, marked lines, line wrap, the status and the undo buttons.
 * @returns {void}
 */
export function renderCode() {
    const code = state.code;
    ui.hl.innerHTML = code.length < HIGHLIGHT_LIMIT ? highlight(FORMAT.editor, code) + '\n' : escapeHtml(code) + '\n';
    renderMarks();
    const lines = code.split('\n').length;
    areas.lineWrap.update(code);
    ui.status.textContent = `${lines} ${lines === 1 ? 'line' : 'lines'} · ${formatByteSize(getByteSize(code))}`;
    updateHistoryUi();
}

/**
 * Draws the lines with problems with a colored background.
 * @returns {void}
 */
export function renderMarks() {
    const code = state.code;
    let html = '', last = 0;
    for (const [start, end, className] of getMarkRanges(code)) {
        if (start < last) continue;
        html += escapeHtml(code.slice(last, start)) + `<mark class="${className}">` + escapeHtml(code.slice(start, end) || ' ') + '</mark>';
        last = end;
    }
    ui.marks.innerHTML = html + escapeHtml(code.slice(last)) + '\n';
}

/**
 * Returns the lines to mark: one range per line with a problem, the first problem's kind.
 * @param {string} code - the code.
 * @returns {Array<[number, number, string]>} start, end and class of each line, by position.
 */
function getMarkRanges(code) {
    const ranges = [];
    const seen = new Set();
    for (const problem of state.problems) {
        const lineStart = code.lastIndexOf('\n', problem.pos - 1) + 1;
        if (seen.has(lineStart)) continue;
        seen.add(lineStart);
        let lineEnd = code.indexOf('\n', lineStart);
        if (lineEnd < 0) lineEnd = code.length;
        ranges.push([lineStart, Math.max(lineEnd, lineStart + 1), MARK_CLASS[problem.kind] || MARK_CLASS.warn]);
    }
    return ranges.sort((a, b) => a[0] - b[0]);
}

/**
 * Moves the layers behind the textarea and the gutter with its scroll position.
 * @returns {void}
 */
export function syncScroll() {
    const transform = `translate(${-ui.ta.scrollLeft}px, ${-ui.ta.scrollTop}px)`;
    ui.hl.style.transform = transform;
    ui.marks.style.transform = transform;
    ui.gutter.style.transform = `translateY(${-ui.ta.scrollTop}px)`;
    moveLineBand();
}

/**
 * Moves the band to the line with the cursor, so the cursor is easy to find; it is hidden
 * while text is selected in the code.
 * @returns {void}
 */
export function moveLineBand() {
    const ta = ui.ta;
    lineBand.hidden = ta.selectionStart !== ta.selectionEnd && document.activeElement === ta;
    const line = getLineIndex(ta.selectionStart);
    lineBand.style.transform = `translateY(${CODE_PADDING + areas.lineWrap.getLineTop(line) - ta.scrollTop}px)`;
    lineBand.style.height = areas.lineWrap.getLineHeight(line) + 'px';
}

/**
 * Returns the width of one character of the code font, measured once.
 * @returns {number} the width in pixels.
 */
function getCharacterWidth() {
    if (characterWidth) return characterWidth;
    const probe = document.createElement('span');
    probe.textContent = 'x'.repeat(PROBE_CHARACTERS);
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
    probe.style.font = getComputedStyle(ui.ta).font;
    document.body.appendChild(probe);
    characterWidth = probe.getBoundingClientRect().width / PROBE_CHARACTERS;
    probe.remove();
    return characterWidth;
}

/**
 * Puts the cursor (or a selection) at a position and scrolls the code there.
 * @param {number} position - where the selection starts.
 * @param {boolean} [focus] - false to leave the focus where it is.
 * @param {number} [selectionEnd] - where the selection ends.
 * @returns {void}
 */
export function showCodePosition(position, focus = true, selectionEnd = position) {
    const ta = ui.ta;
    if (focus && !NARROW_SCREEN.matches) ta.focus({ preventScroll: true });
    ta.setSelectionRange(position, selectionEnd);
    const line = getLineIndex(position);
    const top = areas.lineWrap.getLineTop(line), height = ta.clientHeight;
    if (top < ta.scrollTop + LINE_HEIGHT || top > ta.scrollTop + height - LINE_HEIGHT * SCROLL_MARGIN_LINES) ta.scrollTop = Math.max(0, top - height * SCROLL_TARGET_SHARE);
    const left = getColumnIndex(position) * getCharacterWidth();
    if (left < ta.scrollLeft || left > ta.scrollLeft + ta.clientWidth - SIDE_ROOM) ta.scrollLeft = Math.max(0, left - SIDE_MARGIN);
    syncScroll();
}

/**
 * Replaces a range of the code as typing would, so the browser's own undo and assistive
 * technology see it; where the browser cannot, the text is set directly.
 * @param {number} start - where the range starts.
 * @param {number} end - where it ends.
 * @param {string} text - the new text.
 * @param {number} [selectionStart] - where the cursor goes afterwards.
 * @param {number} [selectionEnd] - where the selection ends afterwards.
 * @returns {void}
 */
export function setCodeRange(start, end, text, selectionStart, selectionEnd) {
    const ta = ui.ta;
    if (document.activeElement !== ta) ta.focus({ preventScroll: true });
    ta.setSelectionRange(start, end);
    if (!document.execCommand || !document.execCommand('insertText', false, text)) {
        ta.setRangeText(text, start, end, 'end');
        ta.dispatchEvent(new Event('input'));
    }
    if (selectionStart != null) ta.setSelectionRange(selectionStart, selectionEnd ?? selectionStart);
}
