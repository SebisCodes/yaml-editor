/**
 * Editor tabs of this browser talk over a BroadcastChannel: a tab opened by an AI link asks
 * which editor tabs are open (ping), picks the one used last and hands it the document; that
 * tab answers with the id of the document it is in. The viewer neither hands a link to an open
 * editor tab nor takes one.
 */

/** The name of the channel. */
const CHANNEL = 'yamleditor';
const ID_RADIX = 36;
const ID_START = 2;
/** How long a tab waits for the other editor tabs to answer, in milliseconds. */
const PING_WAIT = 350;
/** How long a tab waits for another tab to take a document, in milliseconds. */
const HANDOVER_WAIT = 4000;

const tabId = Math.random().toString(ID_RADIX).slice(ID_START);
let lastFocus = document.hasFocus() ? Date.now() : 0;
addEventListener('focus', () => { lastFocus = Date.now(); });

/**
 * An editor tab that answered a ping.
 * @typedef {object} EditorTab
 * @property {string} tab - its id.
 * @property {number} focus - when it last had the focus (milliseconds since 1970).
 */

/**
 * Creates the channel of the editor tabs and answers the other tabs on it.
 * @param {function(string, string, object): Promise<string>} receiveDocument - takes a document
 *   meant for this tab; resolves with the id of the document it is in.
 * @returns {BroadcastChannel|null} the channel, null in the viewer or without BroadcastChannel.
 */
export function createTabChannel(receiveDocument) {
    const channel = new URLSearchParams(location.search).get('viewer') !== '1' && 'BroadcastChannel' in window ? new BroadcastChannel(CHANNEL) : null;
    if (channel) channel.addEventListener('message', event => sendChannelAnswer(channel, receiveDocument, event));
    return channel;
}

/**
 * Returns a new id for one request on the channel.
 * @returns {string} the id.
 */
export function createRequestId() {
    return Math.random().toString(ID_RADIX).slice(ID_START);
}

/**
 * Answers a message of another tab: a ping with this tab's id and last focus, a document meant
 * for this tab with "got" and the id of the document it is now in (for "Open it here" in the
 * other tab).
 * @param {BroadcastChannel} channel - the channel.
 * @param {function(string, string, object): Promise<string>} receiveDocument - takes the document.
 * @param {MessageEvent} event - the message.
 * @returns {void}
 */
function sendChannelAnswer(channel, receiveDocument, event) {
    const message = event.data || {};
    if (message.type === 'ping') channel.postMessage({ type: 'pong', ask: message.ask, tab: tabId, focus: lastFocus });
    if (message.type === 'document' && message.to === tabId) {
        Promise.resolve(receiveDocument(message.text, message.mode, message.target)).catch(() => null).then(id => channel.postMessage({ type: 'got', ask: message.ask, id }));
    }
}

/**
 * Returns the open editor tab that was used last.
 * @param {BroadcastChannel|null} channel - the channel.
 * @param {string} requestId - the id of this request.
 * @returns {Promise<EditorTab|null>} the tab, null when there is none.
 */
export function findEditorTab(channel, requestId) {
    if (!channel) return Promise.resolve(null);
    return new Promise(resolve => {
        const tabs = [];
        /**
         * Collects the tabs that answer this request.
         * @param {MessageEvent} event - a message on the channel.
         * @returns {void}
         */
        const addAnswer = event => { if (event.data && event.data.type === 'pong' && event.data.ask === requestId) tabs.push(event.data); };
        channel.addEventListener('message', addAnswer);
        channel.postMessage({ type: 'ping', ask: requestId });
        setTimeout(() => {
            channel.removeEventListener('message', addAnswer);
            tabs.sort((a, b) => b.focus - a.focus);
            resolve(tabs[0] || null);
        }, PING_WAIT);
    });
}

/**
 * Hands a document to another editor tab.
 * @param {BroadcastChannel} channel - the channel.
 * @param {EditorTab} tab - the tab.
 * @param {string} text - the document.
 * @param {string} mode - "add" or "set".
 * @param {object} target - which document it goes to.
 * @param {string} requestId - the id of this request.
 * @returns {Promise<{id: string}|null>} the id of the document it is in there, null when the tab did not answer.
 */
export function sendToTab(channel, tab, text, mode, target, requestId) {
    return new Promise(resolve => {
        /**
         * Resolves with the answer of the tab to this request.
         * @param {MessageEvent} event - a message on the channel.
         * @returns {void}
         */
        const receiveAnswer = event => {
            if (event.data && event.data.type === 'got' && event.data.ask === requestId) { channel.removeEventListener('message', receiveAnswer); resolve({ id: event.data.id }); }
        };
        channel.addEventListener('message', receiveAnswer);
        channel.postMessage({ type: 'document', to: tab.tab, text, mode, target, ask: requestId });
        setTimeout(() => { channel.removeEventListener('message', receiveAnswer); resolve(null); }, HANDOVER_WAIT);
    });
}
