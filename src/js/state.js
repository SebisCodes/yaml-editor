/**
 * The editor's state and the parts every module shares: what makes this the YAML editor, the
 * open document as code and as read data, the undo history, the page elements, the areas set
 * up at start (tree, line wrap, sync …) and the toast.
 *
 * The code is the single source of truth: the tree is made from it (datatree.js), and every
 * change in the tree is a small edit of the code that keeps the rest of its formatting and its
 * comments. The field names of the state are read by the tests through window.yamlEditor.state.
 */

/**
 * What makes this the YAML editor: the prefix of its storage keys and messages, its format and
 * the sister editor that "Open in the JSON Editor" leads to.
 */
export const FORMAT = {
    prefix: 'yamleditor', editor: 'yaml', name: 'YAML', ext: 'yaml', mime: 'application/yaml',
    other: { name: 'JSON Editor', site: 'https://json.giit.ch/', kind: 'json' },
};
/** The width below which the editor shows one view at a time. */
export const NARROW_SCREEN = matchMedia('(max-width: 860px)');
/** The message when the browser storage takes nothing more. */
export const STORAGE_FULL = 'The browser storage is full - download and delete documents under "My documents"';
/** The message when an edit needs data without a syntax error. */
export const SYNTAX_ERROR = 'The code has a syntax error - fix it first (see above the code)';
/** The fields the user types into; shortcuts and pasting a whole document leave them alone. */
export const TYPING_FIELDS = 'textarea, select, [contenteditable], input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=button])';
/** Bytes of a kilobyte. */
const KILOBYTE = 1024;
/** How long a toast stays, in milliseconds. */
const TOAST_TIME = 2600;

/**
 * A problem listed above the code.
 * @typedef {object} Problem
 * @property {number} pos - where it starts in the code.
 * @property {number} [end] - where it ends in the code.
 * @property {string} kind - "error", "warn" or "schema".
 * @property {string} msg - the message.
 */

/**
 * A step of the undo history.
 * @typedef {object} HistoryStep
 * @property {string} code - the code.
 * @property {number} sel - the cursor in the code.
 * @property {object|null} tree - the place selected in the tree (createTree's getSelectedPlace()).
 */

/**
 * The editor's state.
 * @typedef {object} EditorState
 * @property {string} code - the document's code.
 * @property {import('./datatree.js').DataModel|null} model - the code as read.
 * @property {Problem[]} problems - the problems, sorted by position.
 * @property {number} split - the share of the width the code takes.
 * @property {string} name - the document's name.
 * @property {string} fileId - the document's id in "My documents", "" for none.
 * @property {HistoryStep[]} history - the undo steps; the last one is the current code.
 * @property {HistoryStep[]} future - the redo steps.
 * @property {number} histTimer - the timer that makes an undo step of typing.
 * @property {boolean} showProblems - true when the list of problems is open.
 * @property {string|null} savedCode - the code as last stored or read from storage.
 * @property {number} saveTimer - the timer that stores the code after typing.
 */

/** @type {EditorState} */
export const state = {
    code: '', model: null, problems: [],
    split: 0.45,
    name: 'Document', fileId: '',
    history: [], future: [], histTimer: 0,
    showProblems: true,
    savedCode: null, saveTimer: 0,
};

/**
 * The areas set up at start by app.js; null until then.
 * @typedef {object} EditorAreas
 * @property {object|null} i18n - the interface language (i18n.js).
 * @property {object|null} lineWrap - the line wrap of the code view (wrap.js).
 * @property {object|null} tree - the data tree (datatree.js createTree()).
 * @property {import('./files-dialog.js').FilesDialog|null} files - the "My documents" dialog.
 * @property {object|null} sync - webhook and embedding (sync.js).
 * @property {{updateRemote: function(): void}|null} ai - the AI Assistant.
 * @property {object|null} aiStatus - the AI status at the button (aistatus.js).
 */

/** @type {EditorAreas} */
export const areas = { i18n: null, lineWrap: null, tree: null, files: null, sync: null, ai: null, aiStatus: null };

/**
 * Returns the first element that matches a selector.
 * @param {string} selector - the CSS selector.
 * @param {ParentNode} [root] - where to look.
 * @returns {HTMLElement|null} the element.
 */
export function getElement(selector, root = document) {
    return root.querySelector(selector);
}

/**
 * Returns every element that matches a selector.
 * @param {string} selector - the CSS selector.
 * @param {ParentNode} [root] - where to look.
 * @returns {HTMLElement[]} the elements.
 */
export function getElements(selector, root = document) {
    return [...root.querySelectorAll(selector)];
}

/** The elements the modules use. */
export const ui = {
    ta: getElement('#code'), hl: getElement('#hl'), marks: getElement('#marks'), gutter: getElement('#gutter'),
    status: getElement('#code-status'), error: getElement('#code-error'),
    tree: getElement('#tree'), node: getElement('#node-wrap'), insert: getElement('#insert-wrap'),
    convert: getElement('#convert-wrap'), schema: getElement('#schema-wrap'),
    work: getElement('#work'), toast: getElement('#toast'),
};

let toastTimer = 0;

/**
 * Translates an interface text into the page's language.
 * @param {string} text - the English text.
 * @returns {string} the translation, or the text as it is.
 */
export function translate(text) {
    return areas.i18n.translate(text);
}

/**
 * Shows a short message at the bottom of the page.
 * @param {string} message - the message.
 * @returns {void}
 */
export function showToast(message) {
    ui.toast.textContent = message;
    ui.toast.classList.add('shown');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('shown'), TOAST_TIME);
}

/**
 * Returns a number kept between two limits.
 * @param {number} value - the number.
 * @param {number} min - the lower limit.
 * @param {number} max - the upper limit.
 * @returns {number} the number inside the limits.
 */
export function getClamped(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

/**
 * Returns a size in bytes as the editor shows it.
 * @param {number} bytes - the size.
 * @returns {string} "512 B" or "1.5 KB".
 */
export function formatByteSize(bytes) {
    return bytes < KILOBYTE ? bytes + ' B' : (bytes / KILOBYTE).toFixed(1) + ' KB';
}

/**
 * Returns the size of a text in bytes (UTF-8).
 * @param {string} text - the text.
 * @returns {number} its size.
 */
export function getByteSize(text) {
    return new Blob([text]).size;
}

/**
 * Tells whether the document has data (at least one document of the file has a root).
 * @returns {boolean} true when there is data.
 */
export function hasData() {
    return !!state.model && state.model.docs.some(doc => doc.root);
}
