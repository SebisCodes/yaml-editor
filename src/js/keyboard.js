/**
 * The keyboard shortcuts of the page: Ctrl+S save, Ctrl+E export, Ctrl+O "My documents",
 * Ctrl+Shift+F format, Ctrl+F the tree search (outside the code), Escape closes the New menu,
 * Ctrl+Z / Ctrl+Y undo and redo, and "?" the help. Undo, redo and "?" pause while typing
 * into a field or with a dialog open.
 */

import { openDialog } from './dialogs.js?v=5';
import { ui, areas, NARROW_SCREEN, TYPING_FIELDS, getElement } from './state.js?v=2';
import { undo, redo } from './history.js?v=5';
import { formatDocument, FORMAT_INDENT } from './conversion-panel.js?v=5';
import { selectSearchField } from './tree-tools.js?v=5';
import { applyNewMenuSwitch, isNewMenuOpen } from './documents.js?v=5';
import { showPane } from './layout.js?v=5';
import { openExport, saveFromShortcut } from './export-dialog.js?v=5';

/** The keys of the shortcuts with Ctrl or Cmd, as KeyboardEvent.key gives them. */
const SAVE_KEY = 's', EXPORT_KEY = 'e', OPEN_KEY = 'o', SEARCH_KEY = 'f', REDO_KEY = 'y';
/** Keys that count in both cases, since Shift is part of the shortcut or changes the letter. */
const FORMAT_KEYS = ['F', 'f'], UNDO_KEYS = ['z', 'Z'];
/** The key that opens the help. */
const HELP_KEY = '?';

/**
 * Connects the shortcuts of the page.
 * @returns {void}
 */
export function startKeyboard() {
    window.addEventListener('keydown', handleShortcut);
}

/**
 * Runs the shortcut of a key (a keydown handler).
 * @param {KeyboardEvent} event - the key.
 * @returns {void}
 */
function handleShortcut(event) {
    const active = document.activeElement;
    const withModifier = event.ctrlKey || event.metaKey;
    if (withModifier && runGlobalShortcut(event, active)) return;
    if (event.key === 'Escape' && isNewMenuOpen()) { applyNewMenuSwitch(false); return; }
    if ((active && active.matches(TYPING_FIELDS)) || getElement('dialog[open]')) return;
    if (withModifier && UNDO_KEYS.includes(event.key)) { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
    if (withModifier && event.key === REDO_KEY) { event.preventDefault(); redo(); return; }
    if (withModifier) return;
    if (event.key === HELP_KEY) openDialog(getElement('#help'));
}

/**
 * Runs a shortcut with Ctrl (or Cmd) that works everywhere, also while typing; the browser's
 * own action of the key is stopped first. A command that returns whether it took place, so the
 * handler stops there.
 * @param {KeyboardEvent} event - the key.
 * @param {Element|null} active - the element with the focus.
 * @returns {boolean} true when the key was such a shortcut.
 */
function runGlobalShortcut(event, active) {
    const action = getCommandShortcut(event, active);
    if (!action) return false;
    event.preventDefault();
    action();
    return true;
}

/**
 * Returns the action of a shortcut with Ctrl (or Cmd) that works everywhere.
 * @param {KeyboardEvent} event - the key.
 * @param {Element|null} active - the element with the focus.
 * @returns {function(): void|null} the action, null when the key is no such shortcut.
 */
function getCommandShortcut(event, active) {
    if (event.key === SAVE_KEY) return saveFromShortcut;
    if (event.key === EXPORT_KEY) return openExport;
    if (event.key === OPEN_KEY) return () => areas.files.open();
    if (event.shiftKey && FORMAT_KEYS.includes(event.key)) return () => formatDocument(FORMAT_INDENT);
    if (!event.shiftKey && event.key === SEARCH_KEY && active !== ui.ta) return selectTreeSearch;
    return null;
}

/**
 * Selects the tree search, on narrow screens with the tree in view.
 * @returns {void}
 */
function selectTreeSearch() {
    if (NARROW_SCREEN.matches) showPane('draw');
    selectSearchField();
}
