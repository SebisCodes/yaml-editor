/**
 * The format list of Export: rows to choose from, made from the select
 * #ex-format, which stays the source of the choice for the editor's own code.
 *
 * On import, when the page has the Export dialog and its select:
 *   1. add the box with the title and the list of formats after the select's row;
 *   2. fill the list each time the dialog opens, so the texts are in the language of the page;
 *   3. mark the row of the format the select holds whenever it changes.
 *
 * The same file serves every giit editor.
 */

const DIALOG_ID = 'export';
const SELECT_ID = 'ex-format';
const SELECT_ROW_SELECTOR = '.ex-row';
const BOX_CLASS = 'ex-formats-box';
const TITLE_CLASS = 'ex-formats-title';
const LIST_CLASS = 'ex-formats';
const ROW_CLASS = 'ex-format';
const GROUP_CLASS = 'ex-group';
const MANY_CLASS = 'many';
const RADIO_NAME = 'ex-format-choice';
const MANY_FORMATS = 10;                // from this number of formats on, the list is laid out for many

/**
 * The parts of the format list.
 * @typedef {Object} FormatList
 * @property {HTMLDialogElement} dialog - the Export dialog.
 * @property {HTMLSelectElement} select - the select #ex-format that holds the choice.
 * @property {HTMLDivElement} box - the box around title and list.
 * @property {HTMLDivElement} title - the title above the list.
 * @property {HTMLDivElement} list - the radio group of the formats.
 */

const exportDialog = document.getElementById(DIALOG_ID);
const formatSelect = document.getElementById(SELECT_ID);
if (exportDialog && formatSelect) addFormatList(exportDialog, formatSelect);

/**
 * Adds the format list to the Export dialog and keeps it in step with the select.
 * @param {HTMLDialogElement} dialog - the Export dialog.
 * @param {HTMLSelectElement} select - the select #ex-format.
 * @returns {void}
 */
function addFormatList(dialog, select) {
    const formatList = createFormatList(dialog, select);
    select.closest(SELECT_ROW_SELECTOR).after(formatList.box);
    new MutationObserver(() => { if (dialog.open) renderFormatList(formatList); }).observe(dialog, { attributes: true, attributeFilter: ['open'] });
    select.addEventListener('change', () => selectChosenFormat(formatList));
}

/**
 * Builds the empty box with the title and the radio group.
 * @param {HTMLDialogElement} dialog - the Export dialog.
 * @param {HTMLSelectElement} select - the select #ex-format.
 * @returns {FormatList} the parts of the list.
 */
function createFormatList(dialog, select) {
    const box = document.createElement('div');
    box.className = BOX_CLASS;
    const title = document.createElement('div');
    title.className = TITLE_CLASS;
    const list = document.createElement('div');
    list.className = LIST_CLASS;
    list.setAttribute('role', 'radiogroup');
    box.append(title, list);
    return { dialog, select, box, title, list };
}

/**
 * Fills the list with one row per option of the select and a heading per option group,
 * and puts the focus on the chosen row. It runs when the dialog opens, so the texts are
 * in the language of the page.
 * @param {FormatList} formatList - the parts of the list.
 * @returns {void}
 */
function renderFormatList({ select, title, list }) {
    title.textContent = select.closest('label')?.querySelector('span')?.textContent || '';
    list.setAttribute('aria-label', title.textContent);
    list.replaceChildren();
    for (const child of select.children) {
        if (child.localName === 'optgroup') list.append(createGroupHeading(child), ...[...child.children].map(option => createFormatRow(option, select)));
        else list.append(createFormatRow(child, select));
    }
    list.classList.toggle(MANY_CLASS, select.options.length >= MANY_FORMATS);
    list.querySelector('input:checked')?.focus();
}

/**
 * Builds the heading of an option group.
 * @param {HTMLOptGroupElement} group - the option group.
 * @returns {HTMLDivElement} the heading.
 */
function createGroupHeading(group) {
    const heading = document.createElement('div');
    heading.className = GROUP_CLASS;
    heading.textContent = group.label;
    return heading;
}

/**
 * Builds the row of one format: a radio button that sets the select and tells the editor.
 * @param {HTMLOptionElement} option - the option of the format.
 * @param {HTMLSelectElement} select - the select #ex-format.
 * @returns {HTMLLabelElement} the row.
 */
function createFormatRow(option, select) {
    const label = document.createElement('label');
    label.className = ROW_CLASS;
    label.title = option.textContent;
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = RADIO_NAME;
    radio.value = option.value;
    radio.checked = select.value === option.value;
    radio.addEventListener('change', () => selectFormat(select, option.value));
    const text = document.createElement('span');
    text.textContent = option.textContent;
    label.append(radio, text);
    return label;
}

/**
 * Sets the select to a format and fires its change event, as a choice in the select would.
 * @param {HTMLSelectElement} select - the select #ex-format.
 * @param {string} format - the value of the chosen option.
 * @returns {void}
 */
function selectFormat(select, format) {
    select.value = format;
    select.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Selects (checks) the row of the format the select holds.
 * @param {FormatList} formatList - the parts of the list.
 * @returns {void}
 */
function selectChosenFormat({ select, list }) {
    const radio = [...list.querySelectorAll('input')].find(input => input.value === select.value);
    if (radio) radio.checked = true;
}
