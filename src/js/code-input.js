/**
 * Typing in the code: each keystroke draws the code, reads it after a pause, makes an undo
 * step after a longer pause and stores it. Typing help: Tab and Shift+Tab indent, Enter keeps
 * the indentation (one level deeper after "key:", "- " again in a list), Ctrl+/ comments lines
 * in and out, quotes and brackets go around a selection, "{" and "[" get their partner.
 */

import { getIndentUnit } from './datatree.js?v=13';
import { state, ui, areas } from './state.js?v=2';
import { renderCode, syncScroll, setCodeRange } from './code-view.js?v=4';
import { addHistoryStep, undo, redo } from './history.js?v=4';
import { startAnalysisTimer } from './analysis.js?v=4';
import { saveDocument } from './storage.js?v=4';

/** Code longer than this is read after a longer pause. */
const LONG_CODE = 200000;
/** The pause before long code is read, in milliseconds. */
const LONG_CODE_DELAY = 600;
/** The pause before code is read, in milliseconds. */
const CODE_DELAY = 220;
/** The pause before typing becomes an undo step, in milliseconds. */
const HISTORY_DELAY = 600;
/** The pause before typing is stored, in milliseconds. */
const SAVE_DELAY = 400;
/** The characters that go around a selection, and the partner each gets. */
const PAIRS = { '{': '}', '[': ']', '"': '"', "'": "'" };
/** The keys of undo (both cases, Shift turns it into redo) and redo with Ctrl or Cmd. */
const UNDO_KEYS = ['z', 'Z'], REDO_KEY = 'y';

/**
 * Connects the code's textarea: typing, scrolling and the keys of the typing help.
 * @returns {void}
 */
export function startCodeInput() {
    ui.ta.addEventListener('input', handleCodeInput);
    ui.ta.addEventListener('scroll', syncScroll);
    ui.ta.addEventListener('keydown', handleCodeKey);
}

/**
 * Takes what was typed: draws the code and schedules reading, the undo step and storing it.
 * @returns {void}
 */
function handleCodeInput() {
    state.code = ui.ta.value;
    renderCode();
    startAnalysisTimer(state.code.length > LONG_CODE ? LONG_CODE_DELAY : CODE_DELAY);
    clearTimeout(state.histTimer);
    state.histTimer = setTimeout(addHistoryStep, HISTORY_DELAY);
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(saveDocument, SAVE_DELAY);
    areas.sync?.handleChange();
}

/**
 * Handles a key in the code: undo and redo, Escape, Ctrl+/, Tab, Enter, quotes and brackets
 * (a keydown handler).
 * @param {KeyboardEvent} event - the key.
 * @returns {void}
 */
function handleCodeKey(event) {
    const ta = ui.ta;
    const withModifier = event.ctrlKey || event.metaKey;
    if (withModifier && !event.altKey && UNDO_KEYS.includes(event.key)) { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
    if (withModifier && event.key === REDO_KEY) { event.preventDefault(); redo(); return; }
    if (event.key === 'Escape') { ta.blur(); return; }
    if (withModifier && event.key === '/') { event.preventDefault(); applyLineCommentSwitch(); return; }
    if (event.key === 'Tab') { event.preventDefault(); setLineIndent(event.shiftKey); return; }
    if (event.key === 'Enter' && !withModifier && !event.isComposing) { event.preventDefault(); addLineBreak(); return; }
    if (PAIRS[event.key] && !event.isComposing && !withModifier) { addPair(event); return; }
    const start = ta.selectionStart;
    if ((event.key === '}' || event.key === ']') && start === ta.selectionEnd && ta.value[start] === event.key && !withModifier) { event.preventDefault(); ta.setSelectionRange(start + 1, start + 1); }
}

/**
 * Returns the indentation unit for typing: the document's, with a tab written as two spaces
 * (YAML does not indent with tabs).
 * @param {string} code - the code.
 * @returns {string} the unit.
 */
function getTypingIndent(code) {
    return getIndentUnit(code).replace('\t', '  ');
}

/**
 * Returns the start of the first and the end of the last line a selection touches; a selection
 * that ends at the start of a line does not take that line.
 * @param {string} code - the code.
 * @param {number} start - where the selection starts.
 * @param {number} end - where it ends.
 * @returns {{lineStart: number, lineEnd: number}} the range of the lines.
 */
function getSelectedLines(code, start, end) {
    const lineStart = code.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = code.indexOf('\n', end - (end > start && code[end - 1] === '\n' ? 1 : 0));
    return { lineStart, lineEnd: lineEnd < 0 ? code.length : lineEnd };
}

/**
 * Tab puts in one indentation unit at the cursor; with a selection or Shift, every selected
 * line is indented or unindented.
 * @param {boolean} outdent - true for Shift+Tab.
 * @returns {void}
 */
function setLineIndent(outdent) {
    const ta = ui.ta, code = ta.value, start = ta.selectionStart, end = ta.selectionEnd;
    const unit = getTypingIndent(code);
    if (start === end && !outdent) { setCodeRange(start, end, unit); return; }
    const { lineStart, lineEnd } = getSelectedLines(code, start, end);
    const strip = new RegExp('^(?:' + (unit === '\t' ? '\\t' : ' {1,' + unit.length + '}') + ')');
    const text = code.slice(lineStart, lineEnd).split('\n').map(line => (outdent ? line.replace(strip, '') : unit + line)).join('\n');
    setCodeRange(lineStart, lineEnd, text, lineStart, lineStart + text.length);
}

/**
 * Enter: a new line with the indentation of the cursor's line; one level deeper after "key:",
 * "- " again in a list (an empty "- " is removed), and between "{}" or "[]" the brackets go on
 * lines of their own.
 * @returns {void}
 */
function addLineBreak() {
    const ta = ui.ta, code = ta.value, start = ta.selectionStart, end = ta.selectionEnd;
    const unit = getTypingIndent(code);
    const lineStart = code.lastIndexOf('\n', start - 1) + 1;
    const indent = /^[ \t]*/.exec(code.slice(lineStart))[0];
    const before = code.slice(lineStart, start).trimEnd(), after = code.slice(end).trimStart();
    if (/:$/.test(before) && !/^\s*#/.test(before)) { setCodeRange(start, end, '\n' + indent + unit); return; }
    if (/^\s*- /.test(code.slice(lineStart, start)) && before.trim() !== '-') { const dash = /^\s*- /.exec(code.slice(lineStart, start))[0]; setCodeRange(start, end, '\n' + dash); return; }
    if (before.trim() === '-') { setCodeRange(lineStart, end, ''); return; }
    if (/[{[]$/.test(before)) {
        if ((before.endsWith('{') && after.startsWith('}')) || (before.endsWith('[') && after.startsWith(']'))) {
            setCodeRange(start, end, '\n' + indent + unit + '\n' + indent, start + 1 + indent.length + unit.length);
            return;
        }
        setCodeRange(start, end, '\n' + indent + unit);
        return;
    }
    setCodeRange(start, end, '\n' + indent);
}

/**
 * Quotes and brackets around a selection; "{" and "[" get their partner when nothing follows
 * them on the line but a closing bracket or a comma.
 * @param {KeyboardEvent} event - the key; its default is prevented when the pair is written.
 * @returns {void}
 */
function addPair(event) {
    const ta = ui.ta, code = ta.value, start = ta.selectionStart, end = ta.selectionEnd;
    if (start !== end) { event.preventDefault(); setCodeRange(start, end, event.key + code.slice(start, end) + PAIRS[event.key], start + 1, end + 1); return; }
    if ((event.key === '{' || event.key === '[') && /^(\s|$|[,\]}])/.test(code.slice(start, start + 1))) { event.preventDefault(); setCodeRange(start, end, event.key + PAIRS[event.key], start + 1); }
}

/**
 * Ctrl+/: the selected lines become comments (#), or stop being comments when they all are.
 * @returns {void}
 */
function applyLineCommentSwitch() {
    const ta = ui.ta, code = ta.value;
    const { lineStart, lineEnd } = getSelectedLines(code, ta.selectionStart, ta.selectionEnd);
    const lines = code.slice(lineStart, lineEnd).split('\n');
    const allComments = lines.every(line => !line.trim() || /^\s*#/.test(line));
    const text = lines.map(line => (!line.trim() ? line : allComments ? line.replace(/^(\s*)# ?/, '$1') : line.replace(/^(\s*)/, '$1# '))).join('\n');
    setCodeRange(lineStart, lineEnd, text, lineStart, lineStart + text.length);
}
