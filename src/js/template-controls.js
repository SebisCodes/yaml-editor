/**
 * The controls of template placeholders (?template=) in an editor: the switch in the preview's
 * bar between the example view and the template view, the note when the example view could not
 * be made, and the "Placeholders" box at the bottom of the code.
 *
 * The markup is the editor's (its template); the root element carries data-template from the
 * start, so the controls are there from the first paint and nothing moves when they work:
 *   - the switch is a group of two radio buttons of one width ([data-view-set]);
 *   - the note floats over the preview;
 *   - the box has a header of a fixed height, and its list opens over the code.
 * A click on a placeholder in the box puts its tag at the code's cursor (a section's start and end
 * tag around the selection) as one undo step; the code keeps its selection and focus.
 * Every editor with template placeholders uses this same file.
 */

import { buildPlaceholderTags, buildDocumentPlaceholders } from './template-examples.js?v=2';

/** The view that shows the template filled with the examples. */
const EXAMPLE_VIEW = 'example';
/** The text of a section's example state in the box. */
const SHOWN_TEXT = 'Shown';
const HIDDEN_TEXT = 'Hidden';

/**
 * What the box needs from the editor.
 * @typedef {object} PlaceholderBoxEditor
 * @property {import('./template-tags.js').TemplateSyntax} syntax - the syntax of the tags.
 * @property {HTMLTextAreaElement} textarea - the code.
 * @property {function(number, number, string, number, number): void} insertText - replaces a range of the code as one undo
 *     step and selects a range afterwards: (start, end, text, selectionStart, selectionEnd).
 */

/**
 * Connects the switch between the views.
 * @param {HTMLElement} group - the group with the two buttons ([data-view-set="example"], [data-view-set="template"]).
 * @param {function(string): void} onChange - called with the view chosen ("example" or "template").
 * @returns {void}
 */
export function startViewSwitch(group, onChange) {
    const buttons = [...group.querySelectorAll('[data-view-set]')];
    buttons.forEach(button => button.addEventListener('click', () => { showViewSwitch(group, button.dataset.viewSet); onChange(button.dataset.viewSet); }));
    group.addEventListener('keydown', event => moveViewSwitchOnKey(group, buttons, event, onChange));
}

/**
 * Moves the choice of the switch with the arrow keys, as a group of radio buttons does.
 * @param {HTMLElement} group - the group.
 * @param {HTMLElement[]} buttons - its two buttons.
 * @param {KeyboardEvent} event - the key.
 * @param {function(string): void} onChange - called with the view chosen.
 * @returns {void}
 */
function moveViewSwitchOnKey(group, buttons, event, onChange) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const current = buttons.findIndex(button => button.getAttribute('aria-checked') === 'true');
    const next = buttons[(current + 1) % buttons.length];
    showViewSwitch(group, next.dataset.viewSet);
    next.focus();
    onChange(next.dataset.viewSet);
}

/**
 * Shows which view the switch has chosen.
 * @param {HTMLElement} group - the group.
 * @param {string} mode - "example" or "template".
 * @returns {void}
 */
export function showViewSwitch(group, mode) {
    for (const button of group.querySelectorAll('[data-view-set]')) {
        const isChosen = button.dataset.viewSet === mode;
        button.setAttribute('aria-checked', String(isChosen));
        button.tabIndex = isChosen ? 0 : -1;
    }
}

/**
 * Shows or hides the note that the example view could not be made.
 * @param {HTMLElement} note - the note.
 * @param {boolean} isShown - true to show it.
 * @returns {void}
 */
export function showViewNote(note, isShown) {
    note.hidden = !isShown;
}

/**
 * Returns the title a print or PDF gets: the document's name and the view it shows.
 * @param {string} name - the document's name.
 * @param {string} mode - the view shown: "example" or "template".
 * @param {function(string): string} translate - translates an interface text.
 * @returns {string} e.g. "Letter (example view)".
 */
export function buildViewTitle(name, mode, translate) {
    return `${name} (${translate(mode === EXAMPLE_VIEW ? 'example view' : 'template view')})`;
}

/**
 * Connects the "Placeholders" box: its header opens and closes the list; a click on an entry
 * puts its tag into the code.
 * @param {HTMLElement} box - the box (#placeholder-box) with its header button and list.
 * @param {PlaceholderBoxEditor} editor - what the box needs from the editor.
 * @returns {{render: function(import('./template-examples.js').TemplatePlaceholder[]): void}} draws the list.
 */
export function createPlaceholderBox(box, editor) {
    const header = box.querySelector('[data-placeholder-toggle]'), list = box.querySelector('[data-placeholder-list]');
    let placeholders = [];
    header.addEventListener('click', () => showPlaceholderList(header, list, list.hidden));
    box.addEventListener('keydown', event => { if (event.key === 'Escape' && !list.hidden) { showPlaceholderList(header, list, false); header.focus(); } });
    list.addEventListener('mousedown', event => { if (event.target.closest('[data-placeholder]')) event.preventDefault(); });
    list.addEventListener('click', event => {
        const entry = event.target.closest('[data-placeholder]');
        if (entry && placeholders[+entry.dataset.placeholder]) addPlaceholderTag(editor, placeholders[+entry.dataset.placeholder]);
    });
    return {
        render: next => { placeholders = next; renderPlaceholderList(list, header, next, editor.syntax); },
    };
}

/**
 * Returns what the "Placeholders" box lists: the page's placeholders, else the tags of the
 * document, with a key that changes only when the list does.
 * @param {?import('./template-examples.js').TemplateExamples} examples - the page's examples, or null.
 * @param {string} code - the document's code.
 * @param {import('./template-tags.js').TemplateSyntax} syntax - the syntax.
 * @returns {{placeholders: import('./template-examples.js').TemplatePlaceholder[], key: (object|string)}} the placeholders and
 *     the key: the page's examples, or the kinds and names of the document's tags.
 */
export function getListedPlaceholders(examples, code, syntax) {
    if (examples && examples.placeholders.length) return { placeholders: examples.placeholders, key: examples };
    const placeholders = buildDocumentPlaceholders(code, syntax);
    return { placeholders, key: placeholders.map(placeholder => placeholder.kind + ':' + placeholder.name).join('\n') };
}

/**
 * Opens or closes the list of the box.
 * @param {HTMLElement} header - the header button.
 * @param {HTMLElement} list - the list.
 * @param {boolean} isOpen - true to open it.
 * @returns {void}
 */
function showPlaceholderList(header, list, isOpen) {
    list.hidden = !isOpen;
    header.setAttribute('aria-expanded', String(isOpen));
}

/**
 * Draws the entries of the box: label, tag and example of each placeholder.
 * @param {HTMLElement} list - the list.
 * @param {HTMLElement} header - the header button, whose count shows the number of entries.
 * @param {import('./template-examples.js').TemplatePlaceholder[]} placeholders - the placeholders.
 * @param {import('./template-tags.js').TemplateSyntax} syntax - the syntax.
 * @returns {void}
 */
function renderPlaceholderList(list, header, placeholders, syntax) {
    const count = header.querySelector('[data-placeholder-count]');
    if (count) count.textContent = String(placeholders.length);
    const ownerDocument = list.ownerDocument;
    list.replaceChildren(...placeholders.map((placeholder, index) => {
        const entry = ownerDocument.createElement('button');
        entry.type = 'button';
        entry.className = 'placeholder-entry';
        entry.dataset.placeholder = String(index);
        const tags = buildPlaceholderTags(placeholder, syntax);
        entry.append(
            createTextPart(ownerDocument, 'placeholder-label', placeholder.label, true),
            createTextPart(ownerDocument, 'placeholder-tag', tags.end ? `${tags.start} … ${tags.end}` : tags.start, true),
            getExamplePart(ownerDocument, placeholder));
        if (placeholder.description) entry.title = placeholder.description;
        return entry;
    }));
}

/**
 * Creates one text part of an entry.
 * @param {Document} ownerDocument - the document.
 * @param {string} className - the part's class.
 * @param {string} text - its text.
 * @param {boolean} isPageText - true for text of the page or the document, which is never translated.
 * @returns {HTMLElement} the part.
 */
function createTextPart(ownerDocument, className, text, isPageText) {
    const part = ownerDocument.createElement('span');
    part.className = className;
    part.textContent = text;
    if (isPageText) part.setAttribute('data-no-i18n', '');
    return part;
}

/**
 * Creates the example part of an entry: the example text, the picture's name, the section's
 * example state or the fields of a list.
 * @param {Document} ownerDocument - the document.
 * @param {import('./template-examples.js').TemplatePlaceholder} placeholder - the placeholder.
 * @returns {HTMLElement} the part.
 */
function getExamplePart(ownerDocument, placeholder) {
    if (placeholder.kind === 'section' && placeholder.shown !== null) return createTextPart(ownerDocument, 'placeholder-example', placeholder.shown ? SHOWN_TEXT : HIDDEN_TEXT, false);
    const text = placeholder.kind === 'value' ? placeholder.example || ''
        : placeholder.kind === 'image' ? placeholder.image || ''
            : placeholder.kind === 'list' ? placeholder.fields.map(field => field.label).join(', ') : '';
    return createTextPart(ownerDocument, 'placeholder-example', text.replace(/\s+/g, ' '), true);
}

/**
 * Puts a placeholder's tag into the code: a value or picture tag at the cursor (in the place of
 * the selection), a section's start and end tag around the selection, which stays selected.
 * @param {PlaceholderBoxEditor} editor - what the box needs from the editor.
 * @param {import('./template-examples.js').TemplatePlaceholder} placeholder - the placeholder.
 * @returns {void}
 */
function addPlaceholderTag(editor, placeholder) {
    const textarea = editor.textarea;
    const start = textarea.selectionStart, end = textarea.selectionEnd;
    const tags = buildPlaceholderTags(placeholder, editor.syntax);
    if (!tags.end) { editor.insertText(start, end, tags.start, start + tags.start.length, start + tags.start.length); return; }
    const selected = textarea.value.slice(start, end);
    editor.insertText(start, end, tags.start + selected + tags.end, start + tags.start.length, start + tags.start.length + selected.length);
}
