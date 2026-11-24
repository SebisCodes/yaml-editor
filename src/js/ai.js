/**
 * AI Assistant without any server: any AI sends a document as a link (ai-links.js).
 *
 * "Copy prompt" puts the instructions and the open document on the clipboard (ai-prompt.js).
 * A tab opened with an AI link hands the document to the editor tab that is already open
 * (BroadcastChannel) and shows that it was taken over (the document can be opened there
 * too); without an open editor it loads the document itself. The AI's whole answer can also
 * be pasted into the editor (Ctrl+V anywhere, or the field in the dialog).
 *
 * createAi() runs these steps:
 *   1. answer other editor tabs on the channel and take documents meant for this tab (ai-tabs.js);
 *   2. connect the AI button, the copy button and the paste field;
 *   3. open the document of a link in the address, at start and whenever the address changes;
 *   4. return { updateRemote } to show the page's AI settings in the dialog.
 */

import { openDialog } from './dialogs.js?v=5';
import { readHash, findLinks, readLink } from './ai-links.js?v=2';
import { createTabChannel, createRequestId, findEditorTab, sendToTab } from './ai-tabs.js?v=3';
import { isKeyInPrompt, isAnswerFromPage, getPageTexts } from './prompt-parts.js?v=1';
import { getPrompt } from './ai-prompt.js?v=3';
import { copyText } from './ai-copy.js?v=2';

const BROKEN = 'The document in this link is incomplete or damaged. If the AI\'s link was split over several lines (as in a terminal), copy the whole answer and paste it into the editor with Ctrl+V - the editor joins the lines.';
const FRAMED_STEP = 'The AI answers with a link: <b>paste its whole answer below</b> (a clicked link opens a separate editor). <b>Undo</b> takes it back.';

/**
 * What the editor hands to createAi().
 * @typedef {object} AiEditor
 * @property {function(): object} getState - the document for the prompt (PromptState without framed and remote).
 * @property {function(string, string, object): Promise<string>} receiveDocument - takes a YAML document with its mode and target; resolves with the id of the document it is in.
 * @property {function(string): void} showToast - shows a short message.
 * @property {function(): (import('./ai-prompt.js').AiSettings|null)} [getRemote] - the page's AI settings (sync.js).
 * @property {function(): Promise<*>} [fetchKey] - asks the page for the session's key while there is none.
 * @property {function(): boolean} [hasValidKey] - true when the session has its key.
 * @property {function(string): boolean} [tryOpenDocument] - opens a stored document in this tab; false when there is none.
 * @property {function(function(): void): void} [handleAiClick] - a press on the AI button: the page's own dialog when it shows one, else the function given (the editor's dialog).
 * @property {function(): string} [getKeyDecline] - the page's text for a declined key request, "" without.
 */

/**
 * The AI Assistant as set up by createAi(): what it needs from the editor, its elements and
 * the texts of the dialog as the page shows them at start.
 * @typedef {object} AiArea
 * @property {AiEditor} editor - what the AI Assistant needs from the editor.
 * @property {HTMLDialogElement} dialog - the AI dialog.
 * @property {HTMLElement} notice - the notice of a tab opened by a link.
 * @property {BroadcastChannel|null} channel - the channel of the editor tabs.
 * @property {boolean} framed - true inside another website.
 * @property {string} stepHtml - the step about links as the dialog shows it without a page's AI.
 * @property {string} privacyText - the privacy note without a page's AI.
 */

/** @type {AiArea|null} */
let area = null;
/** Links being taken: one paste can fire several input events, each with the whole answer. */
const linksInProgress = new Set();

/**
 * Sets up the AI Assistant.
 * @param {AiEditor} editor - what the AI Assistant needs from the editor.
 * @returns {{updateRemote: function(): void}} shows the page's AI settings in the dialog again.
 */
export function createAi(editor) {
    area = createArea(editor);
    connectDialog();
    addEventListener('hashchange', openLink);
    openLink();
    return { updateRemote };
}

/**
 * Creates the state of the AI Assistant; inside another website a clicked link opens a separate
 * editor, so the dialog asks to paste the answer.
 * @param {AiEditor} editor - what the AI Assistant needs from the editor.
 * @returns {AiArea} the state.
 */
function createArea(editor) {
    const filled = { getRemote: () => null, fetchKey: () => Promise.resolve(null), hasValidKey: () => false, tryOpenDocument: () => false, handleAiClick: openEditorDialog => openEditorDialog(), getKeyDecline: () => '', ...editor };
    const framed = window.parent !== window;
    const stepLink = document.getElementById('ai-step-link');
    if (framed) stepLink.innerHTML = FRAMED_STEP;
    return {
        editor: filled, framed,
        dialog: document.getElementById('ai'), notice: document.getElementById('ai-receive'),
        channel: createTabChannel(filled.receiveDocument),
        stepHtml: stepLink.innerHTML, privacyText: document.getElementById('ai-privacy').textContent,
    };
}

/**
 * Connects the AI button, the copy button, pasting an answer anywhere and the paste field.
 * @returns {void}
 */
function connectDialog() {
    const pasteField = document.getElementById('ai-paste');
    document.getElementById('btn-ai').addEventListener('click', () => area.editor.handleAiClick(openAiDialog));
    document.getElementById('ai-copy').addEventListener('click', copyPrompt);
    /**
     * Takes an answer with editor links pasted anywhere outside another field (a paste handler).
     * @param {ClipboardEvent} event - the paste.
     * @returns {void}
     */
    const receivePastedAnswer = event => {
        const active = document.activeElement;
        if (active && active !== pasteField && active.matches('textarea, input, select, [contenteditable]')) return;
        const text = event.clipboardData.getData('text');
        if (!findLinks(text).length) return;
        event.preventDefault();
        pasteField.value = '';
        receiveAiAnswer(text);
    };
    addEventListener('paste', receivePastedAnswer);
    pasteField.addEventListener('input', () => { if (findLinks(pasteField.value).length) receiveAiAnswer(pasteField.value).then(() => { pasteField.value = ''; }); });
}

/**
 * Shows the notice of a tab opened by a link; while loading it is the loading screen
 * (no buttons).
 * @param {string} title - the heading.
 * @param {string} text - the text below it.
 * @param {function(): void|null} [openHere] - what "Open it here" does; no button without it.
 * @param {boolean} [loading] - true for the loading screen.
 * @returns {void}
 */
function showNotice(title, text, openHere = null, loading = false) {
    const notice = area.notice;
    notice.classList.toggle('loading', loading);
    notice.querySelector('h2').textContent = title;
    notice.querySelector('p').textContent = text;
    const hereButton = notice.querySelector('[data-here]');
    hereButton.hidden = !openHere;
    /**
     * Hides the notice and opens the document here ("Open it here").
     * @returns {void}
     */
    const openHereOnClick = () => { notice.hidden = true; openHere(); };
    hereButton.onclick = openHereOnClick;
    notice.hidden = false;
}

/**
 * Opens the document of a link in the address: hands it to the editor tab used last, or
 * loads it here. The link is removed from the address first.
 * @returns {Promise<void>} resolves when the document is handed over or loaded.
 */
async function openLink() {
    if (!readHash(location.hash)) return;
    const hash = location.hash;
    history.replaceState(null, '', location.pathname + location.search);
    showNotice('Loading…', '', null, true);
    const result = await readLink(hash);
    if (result.missing) {
        showNotice(`Part ${result.part} of ${result.of} received`, `Open the other ${result.missing.length === 1 ? 'link' : 'links'} from the AI too (still missing: part ${result.missing.join(', ')}).`);
        return;
    }
    if (result.error) { showNotice('The link could not be read', BROKEN); return; }
    await sendDocumentToTab(result);
}

/**
 * Hands a document from a link to the editor tab used last; without one it is loaded here.
 * @param {import('./ai-links.js').LinkResult} result - the document of the link.
 * @returns {Promise<void>} resolves when it is handed over or loaded.
 */
async function sendDocumentToTab({ text, mode, target }) {
    const { editor, channel } = area;
    const requestId = createRequestId();
    const tab = await findEditorTab(channel, requestId);
    const sent = tab && await sendToTab(channel, tab, text, mode, target, requestId);
    if (sent) {
        // "Open it here" opens the document the other tab saved; one that is not stored there (kept in memory) comes from the link again.
        showNotice('Taken over by your editor', 'The document is now in the YAML Editor tab you already had open. Switch to that tab, or open it here.', () => { if (!sent.id || !editor.tryOpenDocument(sent.id)) editor.receiveDocument(text, mode, target); });
        return;
    }
    area.notice.hidden = true;
    editor.receiveDocument(text, mode, target);
}

/**
 * Shows in the dialog whether the AI works through the page's server (sync.js): its name and
 * host, its prompt, the key and the privacy note.
 * @returns {void}
 */
function updateRemote() {
    const remote = area.editor.getRemote();
    const stepLink = document.getElementById('ai-step-link');
    document.getElementById('ai-remote').hidden = !remote;
    document.getElementById('ai-privacy').textContent = !remote ? area.privacyText : isAnswerFromPage(remote)
        ? `${remote.label} gives the AI its instructions for answering. What you paste into your AI is handled by its provider.`
        : `The AI sends the document to ${remote.label} with a key that only works for this session. What you paste into your AI is handled by its provider.`;
    if (!remote) { stepLink.innerHTML = area.stepHtml; return; }
    document.getElementById('ai-remote-host').textContent = remote.site && remote.site !== remote.label ? `${remote.label} (${remote.site})` : remote.label;
    const details = document.getElementById('ai-remote-details');
    const pageTexts = getPageTexts(remote);
    details.hidden = !pageTexts;
    details.querySelector('span').textContent = remote.site || remote.label;
    document.getElementById('ai-remote-prompt').textContent = pageTexts;
    stepLink.textContent = isAnswerFromPage(remote)
        ? `The AI answers as ${remote.label} describes in the prompt. If it answers with a link, paste its answer below.`
        : `The AI sends its result to ${remote.label} by itself, and it opens here. If it answers with a link, paste its answer below.`;
    document.getElementById('ai-key-exp').textContent = !isKeyInPrompt(remote) ? '' : !remote.key ? '(no key yet)' : '(key valid while the editor is open)';
}

/**
 * Opens the AI dialog with the name of the open document and the page's AI settings.
 * @returns {void}
 */
function openAiDialog() {
    document.getElementById('ai-cur').textContent = area.editor.getState().name;
    updateRemote();
    openDialog(area.dialog);
}

/**
 * Copies the prompt; when it tells the AI to post to the page's server and there is no key yet,
 * it asks the page for the key first, and without one the prompt asks the AI for a link. A page
 * that declines the key gives the message shown after copying.
 * @returns {Promise<void>} resolves when the prompt is copied.
 */
async function copyPrompt() {
    const { editor, dialog, framed } = area;
    let remote = editor.getRemote(), declined = '';
    if (isKeyInPrompt(remote) && !editor.hasValidKey()) {
        await editor.fetchKey();
        remote = editor.getRemote();
        updateRemote();
        if (remote && !editor.hasValidKey()) { declined = editor.getKeyDecline(); editor.showToast(declined || `No key from ${remote.label} - the prompt asks the AI for a link instead`); }
    }
    const makeNew = dialog.querySelector('[name=ai-target]:checked').value === 'new';
    const text = getPrompt({ ...editor.getState(), framed, remote: remote && remote.endpoint && !editor.hasValidKey() ? { ...remote, key: '' } : remote }, makeNew);
    copyText(text, area.dialog, area.editor.showToast, () => { editor.showToast(declined || (remote && editor.hasValidKey() && !isAnswerFromPage(remote) ? `Prompt copied - the AI sends its result to ${remote.label}` : 'Prompt copied - paste it into your AI and say what it should write')); dialog.close(); });
}

/**
 * Takes the AI's answer pasted into the editor: every complete document in it, in order.
 * A command that returns whether it took place, so the paste field is emptied then.
 * @param {string} text - the pasted answer.
 * @returns {Promise<boolean>} true when the text held links.
 */
async function receiveAiAnswer(text) {
    const links = findLinks(text);
    if (!links.length) return false;
    const own = [];
    try {
        const { last, complete } = await readAnswerLinks(links, own);
        if (!last) return false;
        if (complete.length) {
            for (const result of complete) await area.editor.receiveDocument(result.text, result.mode, result.target);
            area.dialog.close();
            return true;
        }
        showAnswerState(last);
        return true;
    } finally { for (const link of own) linksInProgress.delete(link); }
}

/**
 * Reads the links of a pasted answer, each once; a link another paste is reading counts as
 * busy. A reader that notes each link it takes as in progress, in linksInProgress and in own
 * (receiveAiAnswer() clears them), and returns what it read.
 * @param {string[]} links - the links of the answer.
 * @param {string[]} own - collects the links this call reads.
 * @returns {Promise<{last: object|null, complete: Array}>} the last link read (or { busy: true })
 *   and the complete documents in order.
 */
async function readAnswerLinks(links, own) {
    let last = null;
    const complete = [];
    for (const link of new Set(links)) {             // the same link twice counts once
        if (linksInProgress.has(link)) { last = last || { busy: true }; continue; }
        linksInProgress.add(link);
        own.push(link);
        const result = await readLink('#' + link);
        if (!result) continue;
        last = result;
        if (!result.missing && !result.error) complete.push(result);
    }
    return { last, complete };
}

/**
 * Tells what is missing when a pasted answer held no complete document.
 * @param {object} last - the last link read (a LinkResult of ai-links.js), or { busy: true }
 *   when it is being read by another paste.
 * @returns {void}
 */
function showAnswerState(last) {
    if (last.busy) return;
    if (last.missing) area.editor.showToast(`Part ${last.part} of ${last.of} received - paste the other ${last.missing.length === 1 ? 'link' : 'links'} too (missing: ${last.missing.join(', ')})`);
    else if (last.error) area.editor.showToast('This link is incomplete or damaged - please ask the AI to send it again');
}
