/**
 * Whether an AI is connected, shown at the AI button and at the top of the
 * AI dialog. The button is green with a check mark only while an AI is
 * connected for good (addDelivery()):
 *   - AI through the page around the editor: from its first result until the page
 *     ends its AI session (resetDelivery(): "clear" from the page, or the page that
 *     opened the editor window is gone); the next session has a new key and needs
 *     the new prompt;
 *   - a browser agent (WebMCP): while its last call is less than 5 minutes ago.
 * A document from an AI link (or a pasted answer) is no connection, since the AI
 * only sees what the user copied: the check mark shows for about 3 seconds, then
 * the button is normal again. Nothing of it is stored: a new page starts with the
 * normal button.
 *
 * The lines in the dialog show the three ways an AI reaches the editor:
 *   - AI through the page around the editor (endpoint and the session's key, see sync.js;
 *     a page that gives its own answering instructions has no key in the prompt)
 *   - a browser agent through WebMCP (tools offered, last call, see mcp.js)
 *   - AI links: a link tab hands its document to the editor tab used last
 *     (ai.js); inside another website the browser keeps the tabs apart.
 * The editor tabs tell each other when they get the focus on their own
 * channel, so each tab knows whether it is the one links go to.
 *
 * createAiStatus() runs these steps:
 *   1. join the channel of the editor tabs (top level only);
 *   2. note when this tab gets the focus;
 *   3. show the status, and again every two seconds.
 *
 * The same file serves every giit editor.
 */

import { isAnswerFromPage } from './prompt-parts.js?v=1';

const AGENT_ACTIVE_MS = 5 * 60 * 1000;  // a browser agent counts as active this long after its last call
const LINK_NOTICE_MS = 3000;           // how long the check mark shows after a document from an AI link
const REFRESH_INTERVAL_MS = 2000;
const MINUTE_MS = 60000;
const CHANNEL_SUFFIX = '.status';
const STATE_CONNECTED = 'on';
const STATE_WAITING = 'waiting';
const STATE_NOTICE = 'delivered';      // the button: the check mark alone, after a document from an AI link
const STATE_NONE = '';
const TAB_MESSAGE = { hello: 'hello', focus: 'focus', bye: 'bye' };
const DELIVERY_TEXTS = { link: 'a document from an AI link', page: 'a result through the page', agent: 'a browser agent (WebMCP)' };
const DEFAULT_DELIVERY_TEXT = 'a result';
const DELIVERY = { link: 'link', page: 'page', agent: 'agent' };
const PAGE_LINE = 1;                    // the line of the AI through the page, in the list of status lines
const AGENT_LINE = 2;                   // the line of the browser agent, in the list of status lines

/**
 * What the editor hands to createAiStatus().
 * @typedef {Object} AiStatusOptions
 * @property {string} prefix - the message prefix of the editor ("latexeditor", "svgeditor" …).
 * @property {HTMLElement} btn - the AI button.
 * @property {HTMLElement|null} box - the list in the AI dialog, or null.
 * @property {function(): (PageAi|null)} remote - the page's AI settings, or null without a page AI.
 * @property {function(): ({last: function(): number}|null)} agent - the WebMCP status from initMcp, or null without WebMCP.
 */

/**
 * The page's AI settings as far as the status uses them.
 * @typedef {Object} PageAi
 * @property {string} label - the name of the page's AI.
 * @property {string} [site] - the host of the page.
 * @property {string} [endpoint] - the address results go to.
 * @property {string} [key] - the session's key, empty while it is missing.
 */

/**
 * A message between editor tabs on the status channel.
 * @typedef {Object} TabMessage
 * @property {string} t - "hello", "focus" or "bye".
 * @property {string} tab - the id of the sending tab.
 * @property {number} [at] - when the sending tab last had the focus (ms since the epoch), 0 for never.
 */

/**
 * One line of the status: its state ("on": connected, "waiting": waiting for the key, "": not connected) and its text.
 * @typedef {Array<string>} StatusLine
 */

/**
 * What createAiStatus() gives back to the editor.
 * @typedef {Object} AiStatus
 * @property {function(): void} update - shows the status again.
 * @property {function(string): void} addDelivery - an AI has delivered something: "link", "page" or "agent".
 * @property {function(): void} resetDelivery - the page's AI session is over: the button is normal again.
 */

/**
 * Shows the AI status at the AI button and in the AI dialog, and keeps it current.
 * @param {AiStatusOptions} options - the editor's prefix, the button, the list and the status sources.
 * @returns {AiStatus} the commands that change the status.
 */
export function createAiStatus({ prefix, btn, box, remote, agent }) {
    const isFramed = window.parent !== window;
    const tabId = Math.random().toString(36).slice(2);
    const baseTitle = btn.title;
    let lastFocus = document.hasFocus() ? Date.now() : 0;
    const otherTabs = new Map();        // other editor tabs: id -> when they last had the focus
    let deliveredAt = 0, deliveredVia = '';   // when and how an AI last delivered in this page session
    let isPageConnected = false;        // the page's AI has delivered and its session goes on
    let agentDeliveredAt = 0;           // when a browser agent last called a tool
    let noticeEndsAt = 0;               // until when the check mark of an AI link shows
    const channel = !isFramed && 'BroadcastChannel' in window ? new BroadcastChannel(prefix + CHANNEL_SUFFIX) : null;

    if (channel) startTabChannel();
    addEventListener('focus', sendFocus);
    setInterval(update, REFRESH_INTERVAL_MS);
    update();
    return { update, addDelivery, resetDelivery };

    /**
     * Joins the channel of the editor tabs: answers their messages, greets them and says goodbye.
     * @returns {void}
     */
    function startTabChannel() {
        channel.onmessage = receiveTabMessage;
        sendTabMessage(TAB_MESSAGE.hello);
        addEventListener('pagehide', () => channel.postMessage({ t: TAB_MESSAGE.bye, tab: tabId }));
        addEventListener('pageshow', sendHelloOnReturn);
    }

    /**
     * Sends a message with this tab's id and focus time to the other editor tabs.
     * @param {string} type - "hello" or "focus".
     * @returns {void}
     */
    function sendTabMessage(type) {
        channel.postMessage({ t: type, tab: tabId, at: lastFocus });
    }

    /**
     * Notes what another editor tab tells: it is there, it got the focus, or it is gone.
     * @param {MessageEvent} event - the channel message.
     * @returns {void}
     */
    function receiveTabMessage(event) {
        const message = event.data || {};
        if (message.tab === tabId || typeof message.tab !== 'string') return;
        if (message.t === TAB_MESSAGE.hello) sendTabMessage(TAB_MESSAGE.focus);
        if (message.t === TAB_MESSAGE.hello || message.t === TAB_MESSAGE.focus) otherTabs.set(message.tab, Number(message.at) || 0);
        if (message.t === TAB_MESSAGE.bye) otherTabs.delete(message.tab);
        update();
    }

    /**
     * Greets the other tabs again when the page comes back from the browser's page cache.
     * @param {PageTransitionEvent} event - the pageshow event.
     * @returns {void}
     */
    function sendHelloOnReturn(event) {
        if (event.persisted) sendTabMessage(TAB_MESSAGE.hello);
    }

    /**
     * Notes that this tab got the focus and tells the other tabs.
     * @returns {void}
     */
    function sendFocus() {
        lastFocus = Date.now();
        if (channel) sendTabMessage(TAB_MESSAGE.focus);
        update();
    }

    /**
     * Returns how long ago a moment is, as the status shows it.
     * @param {number} timestamp - the moment in ms since the epoch.
     * @returns {string} the elapsed-time status text, under a minute or in whole minutes.
     */
    function formatAgo(timestamp) {
        const minutes = Math.floor((Date.now() - timestamp) / MINUTE_MS);
        return minutes < 1 ? 'just now' : `${minutes} min ago`;
    }

    /**
     * Returns the status lines in the order of the dialog: this session, the page's AI,
     * the browser agent and the AI links.
     * @returns {StatusLine[]} the four lines.
     */
    function getStatusLines() {
        return [getSessionLine(), getPageLine(), getAgentLine(), getLinkLine()];
    }

    /**
     * Returns the line of what an AI delivered in this page session.
     * @returns {StatusLine} the state and text.
     */
    function getSessionLine() {
        const via = DELIVERY_TEXTS[deliveredVia] || DEFAULT_DELIVERY_TEXT;
        return deliveredAt
            ? [STATE_CONNECTED, `AI in this session: ${via}, ${formatAgo(deliveredAt)}`]
            : [STATE_NONE, 'AI in this session: nothing received yet - copy the prompt for your AI'];
    }

    /**
     * Returns the line of the AI through the page around the editor: connected with its key,
     * waiting for the key, or the page's own answering instructions (no key in the prompt).
     * @returns {StatusLine} the state and text.
     */
    function getPageLine() {
        const pageAi = remote();
        const where = pageAi && (pageAi.site && pageAi.site !== pageAi.label ? `${pageAi.label} (${pageAi.site})` : pageAi.label);
        if (isAnswerFromPage(pageAi)) return [STATE_NONE, `AI through ${where}: the website gives the answering instructions`];
        if (!pageAi || !pageAi.endpoint) return [STATE_NONE, 'AI through a website: not connected'];
        return pageAi.key
            ? [STATE_CONNECTED, `AI through ${where}: connected`]
            : [STATE_WAITING, `AI through ${where}: connected, waiting for the key`];
    }

    /**
     * Returns the line of the browser agent (WebMCP).
     * @returns {StatusLine} the state and text.
     */
    function getAgentLine() {
        const agentStatus = agent();
        const lastCall = agentStatus ? agentStatus.last() : 0;
        if (!agentStatus) return [STATE_NONE, 'Browser agent (WebMCP): not offered by this browser'];
        if (isAgentActive(lastCall)) return [STATE_CONNECTED, `Browser agent (WebMCP): active, last used ${formatAgo(lastCall)}`];
        return [STATE_NONE, lastCall ? `Browser agent (WebMCP): available, last used ${formatAgo(lastCall)}` : 'Browser agent (WebMCP): available, not used yet'];
    }

    /**
     * Tells whether a browser agent called a tool less than 5 minutes ago.
     * @param {number} lastCall - the last call the WebMCP status knows (ms since the epoch), 0 for none.
     * @returns {boolean} true while the agent counts as connected.
     */
    function isAgentActive(lastCall) {
        const latest = Math.max(lastCall || 0, agentDeliveredAt);
        return latest > 0 && Date.now() - latest < AGENT_ACTIVE_MS;
    }

    /**
     * Returns the line of the AI links: whether they arrive in this tab.
     * @returns {StatusLine} the state and text.
     */
    function getLinkLine() {
        if (isFramed) return [STATE_NONE, 'AI links: cannot reach the editor inside this website - paste the AI\'s answer here'];
        if (!channel) return [STATE_NONE, 'AI links: open the editor in a new tab'];
        if ([...otherTabs.values()].some(focusTime => focusTime > lastFocus)) return [STATE_NONE, 'AI links: go to another editor tab (the one used last)'];
        return [STATE_CONNECTED, 'AI links: arrive in this tab'];
    }

    /**
     * Shows the status at the button (color and tooltip) and in the dialog's list.
     * @returns {void}
     */
    function update() {
        const lines = getStatusLines();
        showButtonState(lines);
        if (box) box.replaceChildren(...lines.map(createStatusItem));
    }

    /**
     * Colors the button and writes the status lines into its tooltip.
     * @param {StatusLine[]} lines - the status lines.
     * @returns {void}
     */
    function showButtonState(lines) {
        const state = getButtonState(lines);
        if (state) btn.dataset.ai = state; else delete btn.dataset.ai;
        btn.title = baseTitle + '\n' + lines.map(line => line[1]).join('\n');
    }

    /**
     * Returns the state of the button: green while the page's AI or a browser agent is
     * connected, the check mark alone shortly after a document from an AI link, yellow
     * while the page's AI waits for its key, otherwise normal.
     * @param {StatusLine[]} lines - the status lines.
     * @returns {string} "on", "delivered", "waiting" or "" for normal.
     */
    function getButtonState(lines) {
        if (isPageConnected || lines[AGENT_LINE][0] === STATE_CONNECTED) return STATE_CONNECTED;
        if (Date.now() < noticeEndsAt) return STATE_NOTICE;
        return lines[PAGE_LINE][0] === STATE_WAITING ? STATE_WAITING : STATE_NONE;
    }

    /**
     * Builds the list item of one status line.
     * @param {StatusLine} line - the state and text.
     * @returns {HTMLLIElement} the item.
     */
    function createStatusItem([state, text]) {
        const item = document.createElement('li');
        if (state) item.dataset.ai = state;
        item.textContent = text;
        return item;
    }

    /**
     * Notes that an AI has delivered something in this page session.
     * @param {string} via - "link", "page" or "agent".
     * @returns {void}
     */
    function addDelivery(via) {
        deliveredAt = Date.now();
        deliveredVia = via;
        if (via === DELIVERY.page) isPageConnected = true;
        if (via === DELIVERY.agent) agentDeliveredAt = deliveredAt;
        if (via === DELIVERY.link) showLinkNotice();
        update();
    }

    /**
     * Shows the check mark for a while after a document from an AI link, then the
     * normal button again.
     * @returns {void}
     */
    function showLinkNotice() {
        noticeEndsAt = Date.now() + LINK_NOTICE_MS;
        setTimeout(update, LINK_NOTICE_MS);
    }

    /**
     * Ends the page's AI session: the button is normal again.
     * @returns {void}
     */
    function resetDelivery() {
        deliveredAt = 0;
        deliveredVia = '';
        isPageConnected = false;
        update();
    }
}
