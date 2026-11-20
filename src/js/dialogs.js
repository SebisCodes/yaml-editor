/**
 * Dialogs: only one is open at a time. openConfirmation() is the editor's own
 * confirmation box (its texts come from the caller and are translated like the rest of
 * the interface, unlike the browser's confirm()).
 *
 * The same file serves every giit editor. An editor with a popup of its own that is no
 * <dialog> (the SVG editor's color picker) closes it through addDialogOpenListener().
 */

const CONFIRM_DIALOG_ID = 'ask';
const TITLE_SELECTOR = '#ask-title';
const TEXT_SELECTOR = '#ask-text';
const OK_BUTTON_SELECTOR = '#ask-ok';
const CANCEL_BUTTON_SELECTOR = '#ask-cancel';
const DEFAULT_OK_LABEL = 'OK';
const DEFAULT_CANCEL_LABEL = 'Cancel';

const openListeners = [];               // functions that run before a dialog opens

/**
 * What openConfirmation() asks.
 * @typedef {Object} ConfirmationRequest
 * @property {string} title - the question in the title of the box.
 * @property {string} text - the explanation below it.
 * @property {string} [ok] - the label of the button that agrees, "OK" by default.
 * @property {string} [cancel] - the label of the button that declines, "Cancel" by default.
 */

/**
 * Registers a function that runs each time a dialog opens, such as one that closes a
 * popup of the editor that is no <dialog>.
 * @param {function(): void} listener - the function to run.
 * @returns {void}
 */
export function addDialogOpenListener(listener) {
    openListeners.push(listener);
}

/**
 * Opens a dialog as a modal one and closes every other open dialog.
 * @param {HTMLDialogElement} dialog - the dialog to open.
 * @returns {void}
 */
export function openDialog(dialog) {
    openListeners.forEach(listener => listener());
    document.querySelectorAll('dialog[open]').forEach(openOne => { if (openOne !== dialog) openOne.close(); });
    if (!dialog.open) dialog.showModal();
}

/**
 * Asks the user to confirm in the editor's own box. A command that returns a
 * Promise so the caller can wait for the answer.
 * @param {ConfirmationRequest} request - the title, the text and the button labels.
 * @returns {Promise<boolean>} true when the user agrees; false for the other button or when the box closes.
 */
export function openConfirmation({ title, text, ok = DEFAULT_OK_LABEL, cancel = DEFAULT_CANCEL_LABEL }) {
    const dialog = document.getElementById(CONFIRM_DIALOG_ID);
    dialog.querySelector(TITLE_SELECTOR).textContent = title;
    dialog.querySelector(TEXT_SELECTOR).textContent = text;
    const okButton = dialog.querySelector(OK_BUTTON_SELECTOR), cancelButton = dialog.querySelector(CANCEL_BUTTON_SELECTOR);
    okButton.textContent = ok;
    cancelButton.textContent = cancel;
    openDialog(dialog);
    okButton.focus();
    return new Promise(resolve => {
        /**
         * Ends the question: removes the handlers, closes the box and gives the answer.
         * @param {boolean} answer - whether the user agreed.
         * @returns {void}
         */
        const closeQuestion = answer => {
            okButton.onclick = cancelButton.onclick = dialog.onclose = null;
            if (dialog.open) dialog.close();
            resolve(answer);
        };
        okButton.onclick = () => closeQuestion(true);
        cancelButton.onclick = () => closeQuestion(false);
        dialog.onclose = () => closeQuestion(false);
    });
}
