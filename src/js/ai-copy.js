/**
 * Copying the prompt of the AI Assistant: to the clipboard, else with the browser's old copy
 * command, else selected in a field of the dialog to copy by hand.
 */

/**
 * Copies text with the browser's old copy command, from a hidden field inside the open dialog
 * (the only place that can take the focus). A command that returns whether it took place, so
 * the caller can fall back to copying by hand.
 * @param {string} text - the text.
 * @param {HTMLElement} container - the open dialog the field goes into.
 * @returns {boolean} true when it was copied.
 */
function copyWithCommand(text, container) {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    container.append(field);
    field.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch (e) { /* not allowed */ }
    field.remove();
    return copied;
}

/**
 * Copies text: to the clipboard, else with the old copy command (inside another website the
 * page has to allow the clipboard with allow="clipboard-write"), else selected in a field to
 * copy by hand.
 * @param {string} text - the text.
 * @param {HTMLElement} container - the open dialog.
 * @param {function(string): void} showToast - shows a short message.
 * @param {function(): void} onCopied - called once it is copied.
 * @returns {Promise<void>} resolves when it is copied or shown to copy by hand.
 */
export async function copyText(text, container, showToast, onCopied) {
    const handCopy = document.getElementById('ai-prompt-text');
    /**
     * Hides the field for copying by hand and reports the copy.
     * @returns {void}
     */
    const showCopyDone = () => { handCopy.hidden = true; onCopied(); };
    try { await navigator.clipboard.writeText(text); showCopyDone(); return; } catch (e) { /* not allowed here */ }
    if (copyWithCommand(text, container)) { showCopyDone(); return; }
    handCopy.value = text;
    handCopy.hidden = false;
    handCopy.focus();
    handCopy.select();
    showToast('Copying is not allowed here - it is selected below: press Ctrl+C (⌘C)');
}
