/**
 * Saving on the user's own server, and the editor inside other websites.
 *
 * Webhook: every saved version goes to a URL as a POST with JSON
 *   { editor, event: "save", id, name, content, assets, updated }
 * (with "Authorization: Bearer <token>" when a token is set). The URL is set
 * in the "Save to server" dialog, or for one document by the link
 * ?webhook=<URL> (asked first, unless the editor is embedded). A token the
 * user enters is kept for this browser tab only (sessionStorage), never with
 * the address; a link cannot carry one. "Automatically" sends a few seconds
 * after each change, otherwise only "Save" (Ctrl+S) sends.
 *
 * Embedding: <iframe src="https://latex.giit.ch/?embed=1"> (or any other
 * editor). The editor posts { type: "<P>:ready" } to the page around it,
 * which answers with { type: "<P>:load", name, content, assets }; the editor
 * answers { type: "<P>:loaded", id, name }. Edits are reported as
 * { type: "<P>:change", id, name, content }, "Save" posts
 * { type: "<P>:save", id, name, content, assets }. <P> is the editor's
 * message prefix ("latexeditor", "svgeditor", ...). The page may also send
 * { type: "<P>:get" } and always gets a "<P>:save" message back.
 * In an editor whose documents have files (ed.files: LaTeX, HTML, Markdown,
 * Typst), "save" (and the answer to "get") carries all pictures and files of
 * the document as data URIs, plus assetsChanged / assetsRemoved: the names
 * that differ from what the page has (after load, save or get). A load with
 * "assets" sets the document's whole set of pictures; pictures added,
 * changed or removed in the editor count as a change. An editor without
 * files never sends these fields and ignores "assets". ?save=0 hides the
 * Save button (Ctrl+S still saves). With ?tidy=1, or "tidy": true in a load,
 * the editor tidies the document (its Tidy / Format, ed.tidy) as part of the
 * load: the tidied code is what the page has, no change is reported for it
 * and Undo does not go back past it. Inside a page, F5 / Ctrl+R do not reload
 * the editor but send { type: "<P>:reload", id, unsaved } so the page can ask.
 * Everything sent to the page is about the HOST DOCUMENT only - the one the
 * page loaded (or opened with ?src=). Other documents in the user's browser
 * never go to the page, also when the user switches to them; until the first
 * load, "get" answers with id and content null.
 * "load" may carry
 *   context: { host, title, rules }   for the AI prompt (plain text, capped)
 *   hook: { url, token, assets }      a webhook for this document only: kept
 *                                     in memory, never stored; assets: false
 *                                     leaves the pictures out of the body
 *                                     (editors with files only).
 *
 * Own window: window.open("https://latex.giit.ch/?embed=window", name) gives
 * the full editor in a window of its own (so links from an AI reach it). It
 * talks to window.opener exactly like an iframe to its parent, and on closing
 * it always sends { type: "<P>:closing", id, name, unsaved } (with content
 * when unsaved). Once the page has sent a message, answers go only to its
 * origin. When the opener is gone, the page's AI settings and webhook end.
 *
 * Nothing the page hands over is stored: its documents and their pictures are
 * kept in memory only (temp) and are gone when the editor closes.
 *
 * AI through the page's server: the page may hand over its own prompt and the
 * key of this editor session, in "load" as ai: { ... } or at any time as
 *   { type: "<P>:ai", prompt, endpoint, key, label, base }
 * (fields left out stay as they are; { type: "<P>:ai", clear: true } ends it).
 * "Copy prompt" then tells the AI to POST its result to the endpoint with
 * "Authorization: Bearer <key>" and target "current" or "new". The endpoint
 * must be https on the page's own site. The editor never sends the key
 * anywhere itself and never stores it. A session has one key: it stays valid
 * in the editor until the session ends, a different key is not taken until
 * "clear", and only while there is none the editor asks with
 * { type: "<P>:key-request", reason: "missing" }; the page answers with a
 * "<P>:ai" message. The result comes back as a "load" with from: "ai" (a short
 * note to the user) and target: "new" for a separate document, which stays in
 * the user's browser only. In an editor with files, ai: { assets: true } says
 * that the endpoint takes pictures: only then the prompt offers the AI
 * "assets". The pictures of a "load" with from: "ai" are ADDED to the
 * document's (a picture under the same name gets the new content, the others
 * stay), and only data URIs of PNG, JPEG, GIF, WebP or PDF under a plain name
 * are taken - never a URL, never SVG.
 * The page's own parts of the AI (sync.js keeps them, the prompt and the AI dialog use them):
 *   answer: "<text>"   the "HOW TO ANSWER" part of the prompt is the page's text (marked as
 *                      the page's); "none" leaves it out; "" gives the editor's part back. The
 *                      prompt then carries no endpoint and no key, so no key-request is sent.
 *   dialog: "page"     a press on the AI button sends { type: "<P>:ai-click", request, id, name }
 *                      (host document only, once the page has spoken) and waits AI_CLICK_WAIT_MS
 *                      for { type: "<P>:ai-click", request, handled: true }: then the page shows
 *                      its own dialog; otherwise the editor's dialog opens.
 * The page may answer a key-request with { type: "<P>:ai", decline: true, message }: the wait
 * ends at once and the user sees "<host>: <message>" after copying the prompt.
 *
 * Files from the page: in an editor with files that takes them (ed.addAssets), the page may send
 *   { type: "<P>:assets", add: { "<name>": "data:<type>;base64,..." } }
 * to add files to the host document or replace files of the same name. The text stays as it is,
 * and the page holds the files already: they join what the page has, so "change", assetsChanged
 * and the automatic save stay with the user's edits. Checked as a whole like pictures from an
 * AI, with an extension that fits the type, at most 40 MB per message, waiting and per document.
 * They wait for the page's load before them and are stored in the order the messages came; a load
 * after them waits for them. The page gets { type: "<P>:assets", id, added } or { id, error } back.
 *
 * Template placeholders: in an editor that offers them (ed.parseTemplate and ed.onTemplate), the
 * page may send { type: "<P>:template", placeholders, assets } or the same object as the field
 * `template` of "load"; { type: "<P>:template", clear: true } (or template: null) ends it. The
 * editor checks it (ed.parseTemplate) and keeps it in memory for the host document only: a
 * message replaces the one before, an older check that finishes late is dropped, a load's
 * template comes in together with its document, a load waits for the check of a message that
 * came before it (so the document shows with it from the first paint), and a load without the
 * field keeps the template. The editor shows it while the host document is open (getTemplate()); when the
 * opener is gone or the editor closes, it ends.
 *
 * PDF: the page may send { type: "<P>:pdf", dpi } (72 to 300, default 200) and
 * gets { type: "<P>:pdf", id, name, pdf, pages } back: pdf is a data URI of a
 * PDF with one JPEG picture per page (its text cannot be selected), or
 * { type: "<P>:pdf", id, error } if that failed. Only for the host document.
 *
 * ?src=<URL> opens a file from a URL (the server must allow CORS);
 * &name=<name> names it (inside a page: in memory only, like a "load").
 * &webhook= works only for that one document and only while the page is open:
 * inside a page (iframe or opener) together with ?src=, otherwise after asking
 * the user. A link never stores a webhook. A document from a page or a ?src=
 * link takes the place of a document that came from the same page (or the
 * same server) only - never of the user's own.
 *
 * Flow of createSync():
 *   1. create the session state from the address, how theme.js found the page opened (the
 *      reduced view is marked there before the first paint) and the editor's adapter;
 *   2. in the viewer, hold back editing input;
 *   3. listen to the messages of the page around the editor;
 *   4. connect the "Save to server" dialog and the Save button;
 *   5. inside a page, hand F5 / Ctrl+R to the page;
 *   6. in an own window, report closing and end the page's settings when the
 *      opener is gone;
 *   7. open what the address asks for (posted document, ?src=, ?webhook=);
 *   8. tell the page the editor is ready.
 *
 * The same file serves every giit editor and stays one module longer than
 * 300 lines: the page messages, the webhook and the AI session share one
 * session state, and the documents and checks of the editors name this one
 * file as the shared sync module.
 */

import { openDialog, openConfirmation } from './dialogs.js?v=5';
import { ANSWER_NONE } from './prompt-parts.js?v=1';

/**
 * A document as the editor hands it over.
 * @typedef {object} EditorDocument
 * @property {string|null} id - the document's id in the editor.
 * @property {string|null} name - the document's name.
 * @property {string|null} content - the document's code.
 * @property {Object<string, string>} [assets] - pictures and files by name, as data URIs (editors with files).
 */

/**
 * What an editor's app.js passes to createSync(). Its property names are the
 * contract between every editor and this shared file.
 * @typedef {object} SyncEditor
 * @property {string} prefix - the message and storage prefix, e.g. "latexeditor".
 * @property {string} editor - the `editor` value of messages and webhooks, e.g. "latex".
 * @property {string} word - what a document is called in messages ("document", "drawing").
 * @property {boolean} [files] - true when documents have pictures and files (assets).
 * @property {function(): EditorDocument} current - the open document.
 * @property {function(object): (Promise<void>|void)} load - opens a document:
 *   { name, content, assets, replaceAssets, into, asNew, page, temp }; `into` is the id
 *   whose document it takes the place of, `asNew` always makes a new one, `replaceAssets`
 *   says the pictures given are the whole set.
 * @property {function(string): void} toast - shows a short message to the user.
 * @property {function(string): (HookSettings|null)} hookFor - the stored webhook of one document.
 * @property {function(string, (HookSettings|null)): void} setHookFor - stores or removes the webhook of one document.
 * @property {function(number): Promise<{pdf: Uint8Array, pages: number}>} [pdf] - the open document as a PDF at a dpi.
 * @property {function((AiSettings|null)): void} [onAi] - the page's AI settings for the open document, or null.
 * @property {function(): void} [onAiResult] - an AI's result arrived.
 * @property {function(): void} [onAiEnd] - the page's AI session ended ("clear", or the opener is gone).
 * @property {function(string): (string|Promise<string>)} [tidy] - the editor's Tidy / Format; code it cannot read comes back as it is.
 * @property {string} [viewerAllow] - selector of what stays usable in the viewer, e.g. the fold arrows of a tree.
 * @property {function(object): Promise<TemplateExamples>} [parseTemplate] - checks the page's template placeholders
 *   (the message or the `template` field of a load) and returns them in the editor's form.
 * @property {function((TemplateExamples|null)): void} [onTemplate] - the template placeholders to show changed:
 *   the host document's, or null.
 * @property {function(string, Object<string, string>): Promise<boolean>} [addAssets] - adds files to a document
 *   of the page by its id, its text as it is; resolves with false when that document is gone.
 */

/**
 * The template placeholders the editor made of a page's message; sync.js only keeps them and
 * calls their close() when they end.
 * @typedef {object} TemplateExamples
 * @property {function(): void} close - lets go of what the examples hold (object addresses of pictures).
 */

/**
 * The page's template placeholders as the session keeps them.
 * @typedef {object} PageTemplate
 * @property {TemplateExamples} examples - the checked placeholders.
 * @property {string|null} hostId - the host document they belong to; null until the next load of the page.
 */

/**
 * A webhook: the general one, one stored for a document, or one set by the page or a link.
 * @typedef {object} HookSettings
 * @property {string} url - the address the saved versions go to.
 * @property {string} [token] - the Bearer token, kept for this tab only.
 * @property {boolean} [auto] - true to send a few seconds after each change.
 * @property {boolean} [assets] - false leaves the pictures out of the body.
 * @property {boolean} [page] - true when the page or a link set it: it ends with the page.
 * @property {string} [id] - the document a page's webhook belongs to.
 */

/**
 * The AI settings of the page's server.
 * @typedef {object} AiSettings
 * @property {string} [prompt] - the page's own prompt text.
 * @property {string} label - the name the user sees for the page.
 * @property {boolean} base - false leaves the editor's own prompt out.
 * @property {boolean} assets - true when the endpoint takes pictures (editors with files).
 * @property {string} [endpoint] - the https address the AI posts its result to.
 * @property {string} [key] - the key of this editor session.
 * @property {string} site - the host of the page's real origin.
 * @property {string} [answer] - the page's own answer part of the prompt, "none" to leave it out, "" for the editor's.
 * @property {string} [dialog] - "page" when the page shows its own AI dialog, "" otherwise.
 */

/**
 * A press on the AI button that waits for the page's answer to "ai-click".
 * @typedef {object} AiClickWait
 * @property {number} request - the id the page's answer has to carry.
 * @property {function(): void} openEditorDialog - opens the editor's own AI dialog.
 * @property {number} timer - the timer that opens the editor's dialog after AI_CLICK_WAIT_MS.
 * @property {number} deadline - the time (performance.now()) up to which an answer counts.
 */

/**
 * A request to a webhook, kept with the document, content and webhook of the moment of asking.
 * @typedef {object} HookJob
 * @property {HookSettings} hook - the webhook to send to.
 * @property {object} body - the JSON body without the final event.
 * @property {string} signature - document, address, name, content and pictures in short, to skip a repeated change.
 * @property {string} event - "save" or "change".
 * @property {boolean} quiet - true to leave out the success message.
 * @property {boolean} isHostDocument - true when the body is the page's host document.
 */

/**
 * The state of one editor's sync session.
 * @typedef {object} SyncSession
 * @property {SyncEditor} ed - the editor's adapter.
 * @property {string} prefix - the message and storage prefix.
 * @property {boolean} hasFiles - true when documents have pictures and files.
 * @property {URLSearchParams} params - the parameters of the address.
 * @property {boolean} framed - true inside an iframe.
 * @property {boolean} ownWindow - true in an own window opened by a page.
 * @property {boolean} embedded - true for the reduced view.
 * @property {boolean} trusted - true when a page around the editor (or its opener) may set things for its document.
 * @property {Window|null} peer - the page the editor works for.
 * @property {string|null} parentOrigin - the origin of the page's first message.
 * @property {object|null} pageContext - from "load": what the AI prompt says about the page.
 * @property {HookSettings|null} pageHook - from "load" or a link: the webhook for that one document.
 * @property {AiSettings|null} remote - the page's AI settings while they are usable.
 * @property {AiSettings|null} remoteState - the same, also while not usable: the session's key stays until "clear".
 * @property {Array<function((AiSettings|null)): void>} keyWaiters - callers waiting for the session's key.
 * @property {boolean} keyAsked - true while a key-request is on its way.
 * @property {string} keyDecline - the page's text for the last declined key-request, "" without.
 * @property {AiClickWait|null} aiClick - the press on the AI button waiting for the page's answer.
 * @property {number} aiClickCount - counts the presses sent to the page: the id of the next one.
 * @property {string} hookStorageKey - the localStorage key of the general webhook.
 * @property {TokenStore} tokens - the tokens of this tab.
 * @property {HookSettings} generalHook - the general webhook.
 * @property {{id: string, sent: string, edited: string}|null} postedDocument - a document sent by HTTP POST (memory only): its id, the text as sent and the text with the edits.
 * @property {EditorDocument|null} host - the host document as last seen.
 * @property {number} autoSaveTimer - the timer of the automatic save.
 * @property {number} changeReportTimer - the timer of the change report to the page.
 * @property {string} lastSentSignature - the signature of the last request the webhook took.
 * @property {boolean} sending - true while a webhook request runs.
 * @property {string} status - the status line of the dialog.
 * @property {Snapshot|null} base - what the page has of the host document.
 * @property {string} reported - the host document as the page last heard of it (load, save, get or change).
 * @property {boolean} hideSave - true for ?save=0.
 * @property {boolean} tidyAll - true for ?tidy=1.
 * @property {Map<string, HookJob>} waitingJobs - saves waiting for the running request, by document and address.
 * @property {boolean} pdfBusy - true while a PDF is being made for the page.
 * @property {number} loadGeneration - counts the page's loads: an older one that finishes later is dropped.
 * @property {PageTemplate|null} template - the page's template placeholders, or null.
 * @property {number} templateRevision - counts the page's template messages and loads with a template: an older check that finishes later is dropped.
 * @property {Promise<void>} templateCheck - settles when the check of the page's last template message is taken; a load waits for it.
 * @property {Promise<void>} hostLoad - settles when the page's last load of a host document (or ?src=) is done or dropped.
 * @property {number} hostLoadCount - counts the loads of a host document that started.
 * @property {number} hostNumber - the number of the load that made the host document what it is.
 * @property {Promise<void>} assetsQueue - settles when the files of the page's earlier "assets" messages are stored or refused.
 * @property {number} assetsWaiting - the data URI characters of the "assets" messages that wait.
 * @property {boolean} closingSent - true once "closing" went to the opener.
 * @property {HTMLDialogElement} dialog - the "Save to server" dialog.
 * @property {HTMLButtonElement} saveButton - the Save button.
 * @property {SettingsFields|null} fields - the fields of the dialog.
 */

/**
 * What the page has of a document: its content and the fingerprints of its pictures by name.
 * @typedef {object} Snapshot
 * @property {string} content - the document's code.
 * @property {Object<string, string>} assets - picture fingerprints by name, sorted by name.
 */

/**
 * A document the page sent with "load", on its way into the editor.
 * @typedef {object} HostLoad
 * @property {object} message - the load message.
 * @property {number} generation - the number of this load among the page's loads.
 * @property {string} name - the document's name.
 * @property {Object<string, string>} pictures - the pictures to load by name.
 * @property {boolean} fromAi - true for an AI's result.
 * @property {string} label - the page's name for messages.
 * @property {object|null} hook - the webhook the page sent with it.
 * @property {?{revision: number, examples: Promise<(TemplateExamples|null)>}} template - the template the page sent with it
 *   (examples null to end it), or null when the load keeps the template as it is.
 * @property {number} [number] - the number of this load among the loads of a host document.
 */

/**
 * The fields of the "Save to server" dialog.
 * @typedef {object} SettingsFields
 * @property {HTMLInputElement} url - the webhook address.
 * @property {HTMLInputElement} token - the token.
 * @property {HTMLInputElement} auto - "Automatically".
 * @property {HTMLInputElement} scope - "Only for this document".
 */

/**
 * What createSync() returns to the editor. The object is also reachable
 * through the editor's test hook (window.<x>Editor.sync()).
 * @typedef {object} SyncApi
 * @property {function(): Promise<boolean>} save - "Save": to the page and/or the webhook; resolves with true when a page or a webhook is there to save to.
 * @property {function(): void} handleChange - called by the editor on every change.
 * @property {function(): void} updateUi - shows the Save button and the dialog's status as they are.
 * @property {boolean} embedded - true for the reduced view.
 * @property {boolean} framed - true inside an iframe.
 * @property {boolean} ownWindow - true in an own window opened by a page.
 * @property {function(): (object|null)} getContext - the page's context for the AI prompt.
 * @property {function(): boolean} isActive - true when a page or a webhook takes the saves.
 * @property {function(): (AiSettings|null)} getAiSettings - the page's AI settings for the open document.
 * @property {function(): boolean} hasValidKey - true when the session has its key and the page is there.
 * @property {function(): Promise<(AiSettings|null)>} fetchKey - asks the page for the session's key.
 * @property {function(): boolean} isHost - true when the host document is open.
 * @property {function(function(): void): void} handleAiClick - a press on the AI button: the page's own dialog when it shows one, else the editor's (the function given).
 * @property {function(): string} getKeyDecline - the page's text for a declined key-request ("<host>: <message>"), "" without.
 * @property {function(): (TemplateExamples|null)} getTemplate - the page's template placeholders while the host document is open, else null.
 */

/** True in the read-only viewer (?viewer=1). */
export const VIEWER = new URLSearchParams(location.search).get('viewer') === '1';

const VIEWER_POINTER_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'touchstart', 'touchend'];
const VIEWER_INPUT_EVENTS = ['beforeinput', 'paste', 'cut', 'drop', 'dragover', 'dragstart'];
const VIEWER_ZOOM_CONTROLS = '#zoom-out, #zoom-100, #zoom-in, #zoom-fit, #zoom-page, #size-down, #size-100, #size-up';
const VIEWER_AREA = '#work, body > *:not(dialog):not(.header)';
const VIEWER_NAVIGATION_KEY = /^(Arrow|Page|Home$|End$|Tab$|Escape$)/;
const VIEWER_SCROLL_KEY = /^(Arrow|Page|Home$|End$)/;
const VIEWER_COPY_SHORTCUT = /^[acpe]$/i;
const VIEWER_THIRD_PARTY_NOTICE = 'Content from a third party, not checked by giit.ch';
const MIDDLE_BUTTON = 1;
const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';
const OPENABLE_LINK = /^(https:|mailto:)/i;

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$/;
const WWW_PREFIX = /^www\./;
/** A key that fits an Authorization header and is long enough not to be guessed. */
const SESSION_KEY_PATTERN = /^[A-Za-z0-9._~+\/=-]{16,512}$/;
const AI_PICTURE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$/;
const AI_PICTURE_DATA = /^data:(image\/(png|jpeg|gif|webp)|application\/pdf);base64,[A-Za-z0-9+\/]+={0,2}$/;
const AI_PICTURE_LIMIT = 20;
const AI_PICTURES_NAMED = 5;
/** The extensions a file from the page may have, by its type. */
const PAGE_FILE_EXTENSIONS = { 'image/png': ['png'], 'image/jpeg': ['jpg', 'jpeg'], 'image/gif': ['gif'], 'image/webp': ['webp'], 'application/pdf': ['pdf'] };
/** The answers to a refused "assets" message: fixed texts. */
const ASSETS_INVALID = 'Only PNG, JPEG, GIF, WebP or PDF as base64 data URIs under a plain name with a fitting extension, 1 to 20 files';
const ASSETS_TOO_LARGE = 'The files are larger than 40 MB';
const ASSETS_QUEUE_FULL = 'More than 40 MB of files wait to be added';
const ASSETS_DOCUMENT_TOO_LARGE = 'With these files the document would be larger than 40 MB';
const ASSETS_NO_DOCUMENT = 'No document from the page';
const ASSETS_NOT_LOADED = 'The document the files are for is not the document from the page';
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b-\u001f]/g;
const FILE_EXTENSION = /\.[^.]+$/;

const PROMPT_LIMIT = 8000;
const LABEL_LIMIT = 80;
const NAME_LIMIT = 80;
const CONTEXT_HOST_LIMIT = 80;
const CONTEXT_TITLE_LIMIT = 160;
const CONTEXT_RULES_LIMIT = 2000;
const TOKEN_LIMIT = 1000;
const MESSAGE_LIMIT = 200;
const ANSWER_LIMIT = 4000;
const SHORT_ANSWER_LENGTH = 200;
const MAX_LOAD_CHARACTERS = 5e6;
const MAX_REQUEST_BYTES = 40e6;
const BLOB_MEASURE_LENGTH = 10e6;
const BYTES_PER_MB = 1e6;

const MESSAGE_VERSION = 2;
/** The message types a page may send; only one of them sets the page's origin. */
const PAGE_MESSAGE_TYPES = new Set(['load', 'ai', 'ai-click', 'get', 'save', 'pdf', 'template', 'assets']);
const KEY_REQUEST_WAIT_MS = 5000;
/** How long a press on the AI button waits for the page that shows its own AI dialog. */
const AI_CLICK_WAIT_MS = 300;
/** The `dialog` value of a page that shows its own AI dialog. */
const DIALOG_PAGE = 'page';
/** Characters that break or hide a line in a one-line text from the page. */
const LINE_BREAKING_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g;
/** Delete and the C1 control characters, removed from the page's answer part as well. */
const EXTRA_CONTROL_CHARACTERS = /[\u007f-\u009f]/g;
/** Marks that change the writing direction; the page's text gets its own isolated direction. */
const DIRECTION_MARKS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const ISOLATE_START = '\u2068';
const ISOLATE_END = '\u2069';
/** A server that never finishes its answer does not hold up later saves. */
const HOOK_TIMEOUT_MS = 60000;
const CHANGE_REPORT_DELAY_MS = 400;
const AUTO_SAVE_DELAY_MS = 2500;
const OPENER_CHECK_INTERVAL_MS = 2000;
const PDF_DPI_MIN = 72;
const PDF_DPI_MAX = 300;
const PDF_DPI_DEFAULT = 200;
const BASE64_CHUNK = 0x8000;
const SIGNATURE_SAMPLES = 64;
const SIGNATURE_TAIL = 16;

const DEFAULT_NAME = 'Document';
const DEFAULT_PAGE_LABEL = 'the page';
const DEFAULT_SITE_LABEL = 'the website';
const FAILED_TO_FETCH = 'Failed to fetch';
const CORS_HINT = 'no connection, or the server does not allow it (CORS)';
const STAYS_IN_BROWSER = 'This document stays in your browser - only the document from the page is saved there';
const LOADED_ELSEWHERE = 'the page loaded another document meanwhile';
/** The message when a document sent by HTTP POST cannot be opened. */
const POSTED_DOCUMENT_ERROR = 'The document could not be opened';
const LINK_PARAMETERS = ['src', 'webhook', 'token', 'auto', 'name'];
const POSTED_DOCUMENT_ID = 'posted-doc';
/**
 * How the editor page is opened, marked on the root by theme.js in the head before the first paint, which also sets the classes that hide the way back to the overview and the footer.
 */
const OPENED_ATTRIBUTE = 'data-opened';
const OPENED_WITH_EMBED = 'embed';
const OPENED_AS_WINDOW = 'window';
const VIEWER_EMPTY_CLASS = 'viewer-empty';

/* ---------- Stored settings and this tab's tokens ----------
   The general webhook is stored as <prefix>.hook, one for a single document in
   that document's entry of the file list (ed.hookFor) - both without the token.
   Tokens are kept for this tab only: in sessionStorage
   (<prefix>.tokens: { "": general, <id>: per document }) and in memory. */

/**
 * Returns an object stored as JSON in localStorage, or an empty object.
 * @param {string} key - the localStorage key.
 * @returns {object} the stored object; empty when missing, unreadable or blocked.
 */
function readStoredObject(key) {
    try { const stored = JSON.parse(localStorage.getItem(key) || '{}'); return stored && typeof stored === 'object' ? stored : {}; } catch (error) { return {}; }
}

/**
 * Stores an object as JSON in localStorage; when storage is blocked the setting lasts until the page is closed.
 * @param {string} key - the localStorage key.
 * @param {object} value - the object to store.
 * @returns {void}
 */
function writeStoredObject(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (error) { /* storage blocked: the setting lasts until the page is closed */ }
}

/**
 * The tokens of this browser tab, by webhook ("" for the general one, else the document id).
 * @typedef {object} TokenStore
 * @property {function(string): string} get - the token of a webhook, or "".
 * @property {function(string, string): void} set - sets a token; an empty one removes it.
 */

/**
 * Creates the token store of this tab: sessionStorage, and memory when that is blocked.
 * @param {string} key - the sessionStorage key.
 * @returns {TokenStore} the store.
 */
function createTokenStore(key) {
    let tokensById = {};
    try { tokensById = JSON.parse(sessionStorage.getItem(key) || '{}') || {}; } catch (error) { /* blocked: memory only */ }
    return {
        /**
         * Returns the token of one webhook.
         * @param {string} hookId - "" for the general webhook, else the document id.
         * @returns {string} the token, or "".
         */
        get(hookId) {
            return typeof tokensById[hookId] === 'string' ? tokensById[hookId] : '';
        },
        /**
         * Sets or removes the token of one webhook.
         * @param {string} hookId - "" for the general webhook, else the document id.
         * @param {string} token - the token; empty removes it.
         * @returns {void}
         */
        set(hookId, token) {
            if (token) tokensById[hookId] = token; else delete tokensById[hookId];
            try { sessionStorage.setItem(key, JSON.stringify(tokensById)); } catch (error) { /* blocked: memory only */ }
        },
    };
}

/**
 * Returns a stored webhook entry without its token.
 * @param {HookSettings|null} entry - the stored entry.
 * @returns {HookSettings|null} the entry without a token; the entry itself when it has none.
 */
function getEntryWithoutToken(entry) {
    if (!entry || !entry.token) return entry;
    const { token, ...rest } = entry;
    return rest;
}

/**
 * Moves a token found in a stored webhook entry to this tab's store and stores the entry without it,
 * so no token stays stored with an address.
 * @param {SyncSession} sync - the session.
 * @param {HookSettings|null} entry - the stored entry.
 * @param {string} hookId - "" for the general webhook, else the document id.
 * @param {function(HookSettings): void} writeEntry - stores the entry without the token.
 * @returns {void}
 */
function moveStoredTokenToTab(sync, entry, hookId, writeEntry) {
    if (!entry || !entry.token) return;
    sync.tokens.set(hookId, String(entry.token));
    writeEntry(getEntryWithoutToken(entry));
}

/**
 * Returns the general webhook with this tab's token. Reading also moves a token found in storage
 * to this tab (see moveStoredTokenToTab), so no token stays stored with an address.
 * @param {SyncSession} sync - the session.
 * @returns {HookSettings} the general webhook; url "" when none is set.
 */
function readGeneralHook(sync) {
    const stored = readStoredObject(sync.hookStorageKey);
    moveStoredTokenToTab(sync, stored, '', entry => writeStoredObject(sync.hookStorageKey, entry));
    return { url: '', auto: false, ...getEntryWithoutToken(stored), token: sync.tokens.get('') };
}

/**
 * Stores the general webhook, its token for this tab only.
 * @param {SyncSession} sync - the session.
 * @param {HookSettings} hook - the webhook with its token.
 * @returns {void}
 */
function writeGeneralHook(sync, hook) {
    const { token, ...rest } = hook;
    writeStoredObject(sync.hookStorageKey, rest);
    sync.tokens.set('', token);
}

/**
 * Returns the webhook stored for one document, with this tab's token. Reading also moves a token
 * found in storage to this tab (see moveStoredTokenToTab).
 * @param {SyncSession} sync - the session.
 * @param {string} documentId - the document.
 * @returns {HookSettings|null} the document's webhook, as stored when it has no address.
 */
function readDocumentHook(sync, documentId) {
    const stored = sync.ed.hookFor(documentId);
    moveStoredTokenToTab(sync, stored, documentId, entry => sync.ed.setHookFor(documentId, entry));
    const entry = getEntryWithoutToken(stored);
    return entry && entry.url ? { ...entry, token: sync.tokens.get(documentId) } : entry;
}

/**
 * Stores or removes the webhook of one document, its token for this tab only.
 * @param {SyncSession} sync - the session.
 * @param {string} documentId - the document.
 * @param {HookSettings|null} hook - the webhook with its token, or null to remove it.
 * @returns {void}
 */
function writeDocumentHook(sync, documentId, hook) {
    if (!hook) { sync.tokens.set(documentId, ''); sync.ed.setHookFor(documentId, null); return; }
    const { token, ...rest } = hook;
    sync.tokens.set(documentId, token);
    sync.ed.setHookFor(documentId, rest);
}

/* ---------- Small helpers ---------- */

/**
 * Tells whether an address may take a document: https, or http on this machine for testing.
 * @param {string} url - the address.
 * @returns {boolean} true when it is usable.
 */
function isValidUrl(url) {
    try { const parsed = new URL(url); return parsed.protocol === 'https:' || (parsed.protocol === 'http:' && LOCAL_HOST.test(parsed.hostname)); } catch (error) { return false; }
}

/**
 * Returns the host of an address for messages.
 * @param {string} url - the address.
 * @returns {string} its host, or the text itself when it is no address.
 */
function getUrlHost(url) {
    try { return new URL(url).host; } catch (error) { return url; }
}

/**
 * Returns a host name without a leading "www.".
 * @param {string} hostname - the host name.
 * @returns {string} the host name without "www.".
 */
function getBaseHost(hostname) {
    return hostname.replace(WWW_PREFIX, '');
}

/**
 * Returns a text from a page as plain, short text: control characters removed, cut and trimmed.
 * @param {*} value - the value; anything but a string counts as "".
 * @param {number} maxLength - the most characters kept.
 * @returns {string} the cleaned text.
 */
function getPlainShortText(value, maxLength) {
    return (typeof value === 'string' ? value : '').replace(CONTROL_CHARACTERS, '').slice(0, maxLength).trim();
}

/**
 * Returns a text from a page as one plain line: line breaks and control characters as one
 * space, direction marks removed, cut and trimmed.
 * @param {*} value - the value; anything but a string counts as "".
 * @param {number} maxLength - the most characters kept.
 * @returns {string} the cleaned line.
 */
function getPlainLine(value, maxLength) {
    return (typeof value === 'string' ? value : '').replace(DIRECTION_MARKS, '').replace(LINE_BREAKING_CHARACTERS, ' ').trim().slice(0, maxLength).trim();
}

/**
 * Returns a short fingerprint of a data URI: its length and characters spread over it (cheap even for big pictures).
 * @param {string} dataUri - the picture as a data URI.
 * @returns {string} the fingerprint.
 */
function getAssetSignature(dataUri) {
    const text = String(dataUri), length = text.length, step = Math.max(1, Math.floor(length / SIGNATURE_SAMPLES));
    let signature = length + ':';
    for (let index = 0; index < length; index += step) signature += text[index];
    return signature + text.slice(-SIGNATURE_TAIL);
}

/**
 * Returns what the page has of a document: its content and the fingerprints of its pictures, sorted by name.
 * @param {EditorDocument} editorDocument - the document.
 * @returns {Snapshot} the snapshot.
 */
function createSnapshot(editorDocument) {
    const signatures = Object.entries(editorDocument.assets || {}).map(([name, dataUri]) => [name, getAssetSignature(dataUri)]);
    return { content: editorDocument.content, assets: Object.fromEntries(signatures.sort((a, b) => (a[0] < b[0] ? -1 : 1))) };
}

/**
 * Returns a snapshot as one comparable text.
 * @param {Snapshot} snapshot - the snapshot.
 * @returns {string} content and pictures in one text.
 */
function getSnapshotKey(snapshot) {
    return snapshot.content + '\u0000' + JSON.stringify(snapshot.assets);
}

/**
 * Splits pictures from an AI into those taken and those refused: only data URIs of the allowed types
 * under a plain name, at most AI_PICTURE_LIMIT.
 * @param {*} assets - the `assets` of the load message.
 * @returns {{accepted: Object<string, string>, refused: string[]}} the pictures taken by name, and the names refused.
 */
function selectAiPictures(assets) {
    const accepted = {}, refused = [];
    if (!assets || typeof assets !== 'object' || Array.isArray(assets)) return { accepted, refused };
    for (const [name, dataUri] of Object.entries(assets)) {
        if (Object.keys(accepted).length < AI_PICTURE_LIMIT && AI_PICTURE_NAME.test(name) && typeof dataUri === 'string' && AI_PICTURE_DATA.test(dataUri)) accepted[name] = dataUri;
        else refused.push(name);
    }
    return { accepted, refused };
}

/**
 * Tells whether an AI endpoint is https on the page's own host (with or without www.) or a subdomain of it;
 * http only when both are on this machine.
 * @param {string|null} parentOrigin - the origin of the page.
 * @param {string} url - the endpoint.
 * @returns {boolean} true when the endpoint may be used.
 */
function isEndpointAllowed(parentOrigin, url) {
    if (!parentOrigin || parentOrigin === '*') return false;
    let endpoint, page;
    try { endpoint = new URL(url); page = new URL(parentOrigin); } catch (error) { return false; }
    if (endpoint.username || endpoint.password) return false;
    if (endpoint.protocol === 'http:') return LOCAL_HOST.test(endpoint.hostname) && LOCAL_HOST.test(page.hostname);
    if (endpoint.protocol !== 'https:') return false;
    const endpointHost = getBaseHost(endpoint.hostname), pageHost = getBaseHost(page.hostname);
    return endpointHost === pageHost || endpointHost.endsWith('.' + pageHost);
}

/**
 * Returns bytes as a base64 text, in chunks so big files do not overflow the call stack.
 * @param {Uint8Array} bytes - the bytes.
 * @returns {string} the base64 text.
 */
function getBase64(bytes) {
    let binary = '';
    for (let index = 0; index < bytes.length; index += BASE64_CHUNK) binary += String.fromCharCode.apply(null, bytes.subarray(index, index + BASE64_CHUNK));
    return btoa(binary);
}

/* ---------- The viewer (?viewer=1) ----------
   Input that would edit never reaches the editor's handlers. Only the handlers
   are held back, so scrolling, selecting and copying stay as they are; the
   middle button still pans. */

/**
 * Follows a link in the viewer: a #place scrolls to it, https and mailto open in a new tab.
 * @param {Element} target - the element clicked.
 * @param {Document|ShadowRoot} root - where #places are looked up first (a drawing's shadow root).
 * @returns {void}
 */
function openViewerLink(target, root) {
    const link = target.closest?.('a[href], a[*|href]');
    if (!link) return;
    const href = (link.getAttribute('href') || link.getAttributeNS(XLINK_NAMESPACE, 'href') || '').trim();
    if (href.startsWith('#')) {
        let placeId = href.slice(1);
        try { placeId = decodeURIComponent(placeId); } catch (error) { /* keep it as it is */ }
        (root.getElementById?.(placeId) || document.getElementById(placeId))?.scrollIntoView();
    } else if (OPENABLE_LINK.test(href)) window.open(href, '_blank', 'noopener,noreferrer');
}

/**
 * Holds back a pointer event in the viewer; a click on a link follows it.
 * @param {Event} event - the pointer, mouse or touch event.
 * @param {string} type - the event type.
 * @param {function(Element): boolean} isInArea - true for elements whose handlers are held back.
 * @param {string} allowSelector - what stays usable.
 * @returns {void}
 */
function stopViewerPointer(event, type, isInArea, allowSelector) {
    // event.target is the shadow host for what is inside a drawing, the innermost element is in composedPath().
    const target = event.target, inner = event.composedPath()[0];
    if (!target?.closest || !isInArea(target) || (event.button === MIDDLE_BUTTON && type !== 'click' && type !== 'auxclick')) return;
    if (target.closest(allowSelector ? `${VIEWER_ZOOM_CONTROLS}, ${allowSelector}` : VIEWER_ZOOM_CONTROLS)) return;
    event.stopImmediatePropagation();
    if ((type === 'click' || type === 'auxclick') && inner?.closest?.('a')) {
        event.preventDefault();
        if (type === 'click') openViewerLink(inner, inner.getRootNode?.() || inner.ownerDocument);   // a drawing's #places are in its shadow root
    }
}

/**
 * Holds back input that would change the document (typing, paste, cut, drop), except in dialogs.
 * @param {Event} event - the input event.
 * @returns {void}
 */
function stopViewerInput(event) {
    if (event.target?.closest?.('dialog')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
}

/**
 * Holds back keys in the viewer except moving, Tab, Escape and the copy, select-all, print and
 * search shortcuts; plain moving keys reach the browser only, not the editor.
 * @param {KeyboardEvent} event - the keydown event.
 * @returns {void}
 */
function stopViewerKey(event) {
    if (event.target?.closest?.('dialog')) return;
    const withModifier = event.ctrlKey || event.metaKey;
    if (VIEWER_NAVIGATION_KEY.test(event.key) || (withModifier && VIEWER_COPY_SHORTCUT.test(event.key))) {
        if (!withModifier && VIEWER_SCROLL_KEY.test(event.key)) event.stopImmediatePropagation();
        return;
    }
    event.stopImmediatePropagation();
}

/**
 * In the viewer, keeps input that would edit away from the editor's handlers below a root.
 * Does nothing outside the viewer.
 * @param {Window|Document|Element} root - where the listeners go (capture phase).
 * @param {function(Element): boolean} [isInArea] - true for elements whose handlers are held back.
 * @param {string} [allowSelector] - what stays usable, e.g. the fold arrows of a tree.
 * @returns {void}
 */
export function disableViewerEdits(root, isInArea = () => true, allowSelector = '') {
    if (!VIEWER) return;
    for (const type of VIEWER_POINTER_EVENTS) root.addEventListener(type, event => stopViewerPointer(event, type, isInArea, allowSelector), true);
    for (const type of VIEWER_INPUT_EVENTS) root.addEventListener(type, event => stopViewerInput(event), true);
    root.addEventListener('keydown', event => stopViewerKey(event), true);
}

/* ---------- Start ---------- */

/**
 * Starts saving to the user's server and the work with a page around the editor.
 * @param {SyncEditor} ed - the editor's adapter.
 * @returns {SyncApi} what the editor calls.
 */
export function createSync(ed) {
    const sync = createSyncSession(ed);
    if (VIEWER) startViewerMode(sync);
    addEventListener('message', event => handlePageMessage(sync, event));
    connectSettingsDialog(sync);
    if (sync.trusted) addEventListener('keydown', event => sendReloadToPage(sync, event), true);
    if (sync.ownWindow) watchOpener(sync);
    addEventListener('pagehide', event => { if (!event.persisted) clearPageTemplate(sync); });
    updateSyncUi(sync);
    openLinkedDocuments(sync);
    sendToPage(sync, { type: 'ready', version: MESSAGE_VERSION, editor: ed.editor, window: sync.ownWindow });
    return createSyncApi(sync);
}

/**
 * Creates the session state from the address, how theme.js found the page opened and the editor's adapter.
 * @param {SyncEditor} ed - the editor's adapter.
 * @returns {SyncSession} the new session.
 */
function createSyncSession(ed) {
    const params = new URLSearchParams(location.search);
    const openedAs = document.documentElement.getAttribute(OPENED_ATTRIBUTE);
    const framed = window.parent !== window;
    const ownWindow = !framed && openedAs === OPENED_AS_WINDOW;
    const sync = {
        ed, prefix: ed.prefix, hasFiles: !!ed.files, params, framed, ownWindow,
        embedded: framed || openedAs === OPENED_WITH_EMBED,
        trusted: framed || ownWindow,
        peer: framed ? window.parent : ownWindow ? window.opener : null,
        parentOrigin: null, pageContext: null, pageHook: null, remote: null, remoteState: null,
        keyWaiters: [], keyAsked: false, keyDecline: '', aiClick: null, aiClickCount: 0,
        hookStorageKey: ed.prefix + '.hook',
        tokens: createTokenStore(ed.prefix + '.tokens'),
        generalHook: null, postedDocument: null, host: null,
        autoSaveTimer: 0, changeReportTimer: 0, lastSentSignature: '', sending: false, status: '',
        base: null, reported: '',
        hideSave: params.get('save') === '0',
        tidyAll: params.get('tidy') === '1',
        waitingJobs: new Map(), pdfBusy: false, loadGeneration: 0, template: null, templateRevision: 0, templateCheck: Promise.resolve(),
        hostLoad: Promise.resolve(), hostLoadCount: 0, hostNumber: 0, assetsQueue: Promise.resolve(), assetsWaiting: 0, closingSent: false,
        dialog: document.getElementById('sync'),
        saveButton: document.getElementById('btn-save'),
        fields: null,
    };
    sync.generalHook = readGeneralHook(sync);
    return sync;
}

/**
 * Creates the object the editor calls.
 * @param {SyncSession} sync - the session.
 * @returns {SyncApi} the editor's interface to this session.
 */
function createSyncApi(sync) {
    return {
        save: () => saveDocument(sync),
        handleChange: () => handleChange(sync),
        updateUi: () => updateSyncUi(sync),
        embedded: sync.embedded, framed: sync.framed, ownWindow: sync.ownWindow,
        getContext: () => sync.pageContext,
        isActive: () => !!(sync.peer || getEffectiveHook(sync)),
        getAiSettings: () => getAiSettings(sync),
        hasValidKey: () => hasValidKey(sync),
        fetchKey: () => fetchKey(sync),
        isHost: () => isHostOpen(sync),
        handleAiClick: openEditorDialog => handleAiClick(sync, openEditorDialog),
        getKeyDecline: () => sync.keyDecline,
        getTemplate: () => getHostTemplate(sync),
    };
}

/**
 * Starts the viewer: input held back, the third-party notice when opened directly, and a load
 * that shows the document area.
 * @param {SyncSession} sync - the session.
 * @returns {void}
 */
function startViewerMode(sync) {
    disableViewerEdits(window, target => !!target.closest(VIEWER_AREA), sync.ed.viewerAllow);
    // Opened directly, what is shown can come from anyone. A page around the viewer answers for its own content.
    if (!sync.trusted) showThirdPartyNotice();
    const loadDocument = sync.ed.load;
    sync.ed.load = async (...args) => {
        const result = await loadDocument(...args);
        document.documentElement.classList.remove(VIEWER_EMPTY_CLASS);
        dispatchEvent(new Event('resize'));
        return result;
    };
}

/**
 * Shows the notice that the content comes from a third party in the top bar.
 * @returns {void}
 */
function showThirdPartyNotice() {
    const notice = document.createElement('span');
    notice.className = 'viewer-hint';
    notice.textContent = notice.title = VIEWER_THIRD_PARTY_NOTICE;
    document.querySelector('.header')?.prepend(notice);
}

/* ---------- The host document and the page ---------- */

/**
 * Tells whether the page and the window it is in are still there.
 * @param {SyncSession} sync - the session.
 * @returns {boolean} true when messages can reach the page.
 */
function isPeerThere(sync) {
    try { return !!sync.peer && !sync.peer.closed; } catch (error) { return false; }
}

/**
 * Tells whether the host document is the open one.
 * @param {SyncSession} sync - the session.
 * @returns {boolean} true when the host document is open.
 */
function isHostOpen(sync) {
    return !!sync.host && sync.ed.current().id === sync.host.id;
}

/**
 * Takes the host document from the editor while it is open, so sync.host is as it is in the editor.
 * @param {SyncSession} sync - the session.
 * @returns {void}
 */
function updateHostFromEditor(sync) {
    if (!sync.host || !isHostOpen(sync)) return;
    const current = sync.ed.current();
    sync.host = { id: current.id, name: current.name, content: current.content, assets: current.assets || {} };
}

/**
 * Makes the open document the host document.
 * @param {SyncSession} sync - the session.
 * @returns {void}
 */
function setHostToCurrent(sync) {
    const current = sync.ed.current();
    sync.host = { id: current.id, name: current.name, content: current.content, assets: current.assets || {} };
}

/**
 * Notes a document as what the page has of the host document.
 * @param {SyncSession} sync - the session.
 * @param {EditorDocument} editorDocument - the document the page has.
 * @returns {void}
 */
function setBase(sync, editorDocument) {
    sync.base = createSnapshot(editorDocument);
    sync.reported = getSnapshotKey(sync.base);
}

/**
 * Tells whether a document differs from what the page has.
 * @param {SyncSession} sync - the session.
 * @param {EditorDocument} editorDocument - the document.
 * @returns {boolean} true when content or pictures differ, or the page has nothing.
 */
function isChangedFromBase(sync, editorDocument) {
    if (!sync.base) return true;
    const snapshot = createSnapshot(editorDocument);
    return snapshot.content !== sync.base.content || JSON.stringify(snapshot.assets) !== JSON.stringify(sync.base.assets);
}

/**
 * Tells whether the host document has edits the page does not have. The caller takes the host
 * from the editor first (updateHostFromEditor).
 * @param {SyncSession} sync - the session.
 * @returns {boolean} true when the host document has unsaved edits.
 */
function isHostUnsaved(sync) {
    return !!sync.host && isChangedFromBase(sync, sync.host);
}

/**
 * Returns which pictures differ from what the page has.
 * @param {SyncSession} sync - the session.
 * @param {EditorDocument} editorDocument - the document.
 * @returns {{assetsChanged?: string[], assetsRemoved?: string[]}} the names; empty in editors without files.
 */
function getAssetDiff(sync, editorDocument) {
    if (!sync.hasFiles) return {};
    const current = createSnapshot(editorDocument).assets, known = sync.base ? sync.base.assets : {};
    return { assetsChanged: Object.keys(current).filter(name => current[name] !== known[name]), assetsRemoved: Object.keys(known).filter(name => !(name in current)) };
}

/**
 * Returns the body of a save for the page or a webhook.
 * @param {SyncSession} sync - the session.
 * @param {string} event - the event name.
 * @param {boolean} [includeAssets] - false leaves the pictures out.
 * @param {EditorDocument} [editorDocument] - the document; the open one by default.
 * @returns {object} { editor, event, id, name, content, assets?, updated }.
 */
function createPayload(sync, event, includeAssets = true, editorDocument = sync.ed.current()) {
    const payload = { editor: sync.ed.editor, event, id: editorDocument.id, name: editorDocument.name, content: editorDocument.content, assets: editorDocument.assets || {}, updated: new Date().toISOString() };
    if (!includeAssets || !sync.hasFiles) delete payload.assets;
    return payload;
}

/**
 * Returns the content of a document from the page, tidied when the page asked for it
 * (?tidy=1, or "tidy": true in the load).
 * @param {SyncSession} sync - the session.
 * @param {string} content - the document's code.
 * @param {object} [message] - the load message.
 * @returns {Promise<string>} the content to load.
 */
async function getLoadContent(sync, content, message) {
    if (!sync.ed.tidy || !(sync.tidyAll || (message && message.tidy === true))) return content;
    try { const tidied = await sync.ed.tidy(content); return typeof tidied === 'string' ? tidied : content; } catch (error) { return content; }
}

/**
 * Sends a message to the page around the editor, with the prefix in its type.
 * @param {SyncSession} sync - the session.
 * @param {object} message - the message with its type without prefix.
 * @returns {void}
 */
function sendToPage(sync, message) {
    if (!isPeerThere(sync)) return;
    // A window that opened the editor may have gone to another site: the document only goes to the page that sent "load".
    if (sync.ownWindow && !sync.parentOrigin && message.type !== 'ready') return;
    try { sync.peer.postMessage({ ...message, type: `${sync.prefix}:${message.type}` }, sync.parentOrigin || '*'); } catch (error) { /* the page is gone */ }
}

/**
 * Sends a document to the page as "save", with the pictures that differ, and notes it as what the page has.
 * @param {SyncSession} sync - the session.
 * @param {EditorDocument} editorDocument - the host document.
 * @returns {void}
 */
function sendDocumentToPage(sync, editorDocument) {
    const payload = { ...createPayload(sync, 'save', true, editorDocument), ...getAssetDiff(sync, editorDocument) };
    setBase(sync, editorDocument);
    sendToPage(sync, { ...payload, type: 'save' });
}

/* ---------- Status and Save button ---------- */

/**
 * Returns the webhook for the open document: the page's, the document's own, or the general one.
 * @param {SyncSession} sync - the session.
 * @returns {HookSettings|null} the webhook, or null when none is set.
 */
function getEffectiveHook(sync) {
    const current = sync.ed.current();
    if (sync.pageHook && sync.pageHook.id === current.id) return sync.pageHook;
    const documentHook = readDocumentHook(sync, current.id);
    if (documentHook && documentHook.url) return { ...sync.generalHook, ...documentHook, auto: documentHook.auto ?? sync.generalHook.auto };
    return sync.generalHook.url ? sync.generalHook : null;
}

/**
 * Shows the Save button, its title, the dialog's status and the webhook mark as they are.
 * @param {SyncSession} sync - the session.
 * @returns {void}
 */
function updateSyncUi(sync) {
    const hook = getEffectiveHook(sync);
    sync.saveButton.hidden = sync.hideSave || !(sync.embedded || sync.peer || hook);
    sync.saveButton.title = getSaveTitle(sync, hook);
    const statusElement = document.getElementById('sync-status');
    if (statusElement) statusElement.textContent = sync.status;
    const syncButton = document.getElementById('btn-sync');
    if (syncButton) syncButton.classList.toggle('on', !!hook);
}

/**
 * Returns the title of the Save button: where Save sends the document.
 * @param {SyncSession} sync - the session.
 * @param {HookSettings|null} hook - the webhook of the open document.
 * @returns {string} the title.
 */
function getSaveTitle(sync, hook) {
    if (sync.peer && isHostOpen(sync) && !hook) return 'Save - hand the document to the page around the editor (Ctrl+S)';
    if (hook) return `Save - send the document to ${getUrlHost(hook.url)} (Ctrl+S)`;
    return sync.peer && sync.host ? STAYS_IN_BROWSER : 'Save';
}

/* ---------- AI through the page's server ---------- */

/**
 * Sets the AI settings from a "load" or "ai" message; fields left out stay, `clear` or null ends them.
 * One key per session: the first valid key stays until "clear"; the same key again is fine.
 * @param {SyncSession} sync - the session.
 * @param {object|null} message - the AI settings of the page.
 * @returns {void}
 */
function setRemote(sync, message) {
    if (!message || message.clear) { clearRemote(sync); return; }
    const settings = { ...(sync.remoteState || {}) };
    copyAiTexts(settings, message);
    if ('endpoint' in message) setAiEndpoint(sync, settings, message.endpoint);
    if ('key' in message && !settings.key) setAiKey(sync, settings, message.key);
    applyAiSettingsDefaults(sync, settings);
    sync.remoteState = settings;
    sync.remote = settings.endpoint || settings.prompt || settings.answer ? settings : null;
    sync.ed.onAi?.(sync.remote);
    if ('key' in message) sync.keyAsked = false;
    if (sync.remote && sync.remote.key) while (sync.keyWaiters.length) sync.keyWaiters.shift()(sync.remote);
}

/**
 * Ends the page's AI settings and the session's key; tells the editor when a session ended.
 * @param {SyncSession} sync - the session.
 * @returns {void}
 */
function clearRemote(sync) {
    const hadRemote = !!sync.remote;
    sync.remote = null;
    sync.remoteState = null;
    sync.keyAsked = false;
    sync.keyDecline = '';
    while (sync.keyWaiters.length) sync.keyWaiters.shift()(null);   // a copy waiting for a key goes on without the ended session
    if (sync.aiClick) stopAiClick(sync, sync.aiClick.request, false);
    sync.ed.onAi?.(null);
    if (hadRemote) sync.ed.onAiEnd?.();                          // the page's AI session is over
}

/**
 * Copies the prompt, label and switches of an AI message into the settings, capped.
 * @param {object} settings - the AI settings being built.
 * @param {object} message - the AI settings of the page.
 * @returns {void}
 */
function copyAiTexts(settings, message) {
    if ('prompt' in message) settings.prompt = getPlainShortText(message.prompt, PROMPT_LIMIT);
    if ('label' in message) settings.label = getPlainShortText(message.label, LABEL_LIMIT);
    if ('base' in message) settings.base = message.base !== false;
    if ('assets' in message) settings.assets = message.assets === true;
    if ('answer' in message) settings.answer = message.answer === ANSWER_NONE ? ANSWER_NONE : getPlainShortText(message.answer, ANSWER_LIMIT).replace(EXTRA_CONTROL_CHARACTERS, '');
    if ('dialog' in message) settings.dialog = message.dialog === DIALOG_PAGE ? DIALOG_PAGE : '';
}

/**
 * Sets the AI endpoint when it is allowed, else clears it and tells the user.
 * @param {SyncSession} sync - the session.
 * @param {object} settings - the AI settings being built.
 * @param {*} endpoint - the endpoint of the message.
 * @returns {void}
 */
function setAiEndpoint(sync, settings, endpoint) {
    if (isEndpointAllowed(sync.parentOrigin, String(endpoint || ''))) { settings.endpoint = String(endpoint); return; }
    settings.endpoint = '';
    sync.ed.toast('The address for the AI must be https:// on the site of the page around the editor - it is not used');
}

/**
 * Sets the session's key when it is valid, else leaves it empty and tells the user about a bad one.
 * @param {SyncSession} sync - the session.
 * @param {object} settings - the AI settings being built.
 * @param {*} key - the key of the message.
 * @returns {void}
 */
function setAiKey(sync, settings, key) {
    settings.key = typeof key === 'string' && SESSION_KEY_PATTERN.test(key) ? key : '';
    if (key && !settings.key) sync.ed.toast('The key from the page is not valid (16 to 512 letters, digits or ._~+/=-)');
}

/**
 * Fills in the site, the label and the switches of AI settings.
 * @param {SyncSession} sync - the session.
 * @param {object} settings - the AI settings being built.
 * @returns {void}
 */
function applyAiSettingsDefaults(sync, settings) {
    try { settings.site = new URL(sync.parentOrigin).host; } catch (error) { settings.site = ''; }    // the real origin, not the page's own label
    if (!settings.label) settings.label = settings.site || DEFAULT_SITE_LABEL;
    settings.base = settings.base !== false;
    settings.assets = sync.hasFiles && settings.assets === true;           // the endpoint takes pictures (editors with files only)
}

/**
 * Tells whether the session has its key and the page is there.
 * @param {SyncSession} sync - the session.
 * @returns {boolean} true when the AI can send to the page's server.
 */
function hasValidKey(sync) {
    return !!(sync.remote && sync.remote.key && isPeerThere(sync));
}

/**
 * Returns the AI settings; they apply to the host document only, and only while the page is there.
 * @param {SyncSession} sync - the session.
 * @returns {AiSettings|null} the settings, or null.
 */
function getAiSettings(sync) {
    return sync.remote && isHostOpen(sync) && isPeerThere(sync) ? sync.remote : null;
}

/**
 * Asks the page for the session's key while there is none (one request at a time). A command that
 * returns a Promise so the caller can wait for the answer.
 * @param {SyncSession} sync - the session.
 * @returns {Promise<AiSettings|null>} the AI settings with the key, or null after KEY_REQUEST_WAIT_MS.
 */
function fetchKey(sync) {
    if (!sync.remote || !isPeerThere(sync)) return Promise.resolve(null);
    if (sync.remote.key) return Promise.resolve(sync.remote);
    if (!sync.keyAsked) { sync.keyAsked = true; sync.keyDecline = ''; sendToPage(sync, { type: 'key-request', reason: 'missing' }); }
    return new Promise(resolve => {
        /**
         * Hands the AI settings with the key to the caller and stops the wait.
         * @param {AiSettings|null} settings - the settings with the key.
         * @returns {void}
         */
        const stopKeyWait = settings => { clearTimeout(timeout); resolve(settings); };
        const timeout = setTimeout(() => {
            const index = sync.keyWaiters.indexOf(stopKeyWait);
            if (index >= 0) sync.keyWaiters.splice(index, 1);
            if (!sync.keyWaiters.length) sync.keyAsked = false;
            resolve(null);
        }, KEY_REQUEST_WAIT_MS);
        sync.keyWaiters.push(stopKeyWait);
    });
}

/**
 * Ends a waiting key-request the page declined: the callers get no key at once, and the page's
 * text is kept for the message after copying. A decline without a waiting request changes nothing.
 * @param {SyncSession} sync - the session.
 * @param {object} message - the page's "ai" message with decline: true and an optional message.
 * @returns {void}
 */
function stopDeclinedKeyRequest(sync, message) {
    if (!sync.keyAsked) return;
    sync.keyAsked = false;
    sync.keyDecline = buildDeclineText(sync, message.message);
    while (sync.keyWaiters.length) sync.keyWaiters.shift()(null);
}

/**
 * Returns the text of a declined key-request as the user sees it: the page's real host, then
 * the page's text on one line, isolated in its own writing direction.
 * @param {SyncSession} sync - the session.
 * @param {*} text - the page's text.
 * @returns {string} "<host>: <text>", or "" without a text.
 */
function buildDeclineText(sync, text) {
    const line = getPlainLine(text, MESSAGE_LIMIT);
    if (!line) return '';
    let host = DEFAULT_SITE_LABEL;
    try { host = new URL(sync.parentOrigin).host; } catch (error) { /* no origin yet */ }
    return `${host}: ${ISOLATE_START}${line}${ISOLATE_END}`;
}

/**
 * Handles a press on the AI button: a page that shows its own AI dialog is asked first and the
 * editor's dialog opens when the page does not take it within AI_CLICK_WAIT_MS; in every other
 * case the editor's dialog opens at once. A press while one waits is dropped.
 * @param {SyncSession} sync - the session.
 * @param {function(): void} openEditorDialog - opens the editor's own AI dialog.
 * @returns {void}
 */
function handleAiClick(sync, openEditorDialog) {
    if (sync.aiClick) return;
    if (!isPageDialogOn(sync)) { openEditorDialog(); return; }
    const request = ++sync.aiClickCount;
    sync.aiClick = { request, openEditorDialog, deadline: performance.now() + AI_CLICK_WAIT_MS, timer: setTimeout(() => stopAiClick(sync, request, false), AI_CLICK_WAIT_MS) };
    sendToPage(sync, { type: 'ai-click', request, id: sync.host.id, name: sync.host.name });
}

/**
 * Tells whether a press on the AI button goes to the page: it asked with dialog: "page", it is
 * there and has spoken, and the host document is open.
 * @param {SyncSession} sync - the session.
 * @returns {boolean} true when the page is asked to show its own dialog.
 */
function isPageDialogOn(sync) {
    return !!(sync.remoteState && sync.remoteState.dialog === DIALOG_PAGE && sync.parentOrigin && isPeerThere(sync) && isHostOpen(sync));
}

/**
 * Takes the page's answer to "ai-click": only for the waiting press, once, within AI_CLICK_WAIT_MS,
 * and only while the page still shows its own dialog for the open host document.
 * @param {SyncSession} sync - the session.
 * @param {object} message - the page's "ai-click" message with request and handled.
 * @returns {void}
 */
function receiveAiClickAnswer(sync, message) {
    if (!sync.aiClick || message.request !== sync.aiClick.request) return;
    const inTime = performance.now() <= sync.aiClick.deadline;
    stopAiClick(sync, message.request, message.handled === true && inTime && isPageDialogOn(sync));
}

/**
 * Ends a waiting press on the AI button: the editor's dialog opens unless the page took it.
 * @param {SyncSession} sync - the session.
 * @param {number} request - the id of the press.
 * @param {boolean} handled - true when the page shows its own dialog.
 * @returns {void}
 */
function stopAiClick(sync, request, handled) {
    const wait = sync.aiClick;
    if (!wait || wait.request !== request) return;
    sync.aiClick = null;
    clearTimeout(wait.timer);
    if (!handled) wait.openEditorDialog();
}

/* ---------- Webhook ---------- */

/**
 * Sends the open document to its webhook. A command that returns a Promise so the caller can wait.
 * @param {SyncSession} sync - the session.
 * @param {string} event - "save" or "change".
 * @param {boolean} quiet - true to leave out the success message.
 * @returns {Promise<boolean>} false when there is no usable webhook or the request failed.
 */
async function sendHook(sync, event, quiet) {
    const hook = getEffectiveHook(sync);
    if (!hook || !isValidUrl(hook.url)) return false;
    if (hook.page && !isPeerThere(sync)) return false;           // the page's webhook ends with the page
    const isHostDocument = isHostOpen(sync);
    if (isHostDocument) updateHostFromEditor(sync);
    const body = { ...createPayload(sync, event, hook.assets !== false), ...(isHostDocument ? getAssetDiff(sync, sync.host) : {}) };
    return sendHookJob(sync, { hook, body, signature: getHookSignature(hook, body), event, quiet, isHostDocument });
}

/**
 * Returns what a webhook request carries in short; pictures count by content, so a picture
 * changed under its name is sent again.
 * @param {HookSettings} hook - the webhook.
 * @param {object} body - the request body.
 * @returns {string} the signature.
 */
function getHookSignature(hook, body) {
    const pictures = Object.entries(body.assets || {}).map(([name, dataUri]) => name + '=' + getAssetSignature(dataUri)).join(',');
    return body.id + '\n' + hook.url + '\n' + body.name + '\n' + body.content + '\n' + pictures;
}

/**
 * Returns how many bytes a text takes as UTF-8, the way a request carries it.
 * @param {string} text - the text.
 * @returns {number} the bytes.
 */
function getUtf8Size(text) {
    return text.length > BLOB_MEASURE_LENGTH ? new Blob([text]).size : new TextEncoder().encode(text).length;
}

/**
 * Sends a webhook request, or keeps it while another one runs. A save that waits keeps its document,
 * content and webhook as they are at the moment of asking (the newest one per document and address),
 * not what is open when it goes. A command that returns a Promise so the caller can wait.
 * @param {SyncSession} sync - the session.
 * @param {HookJob} job - the request.
 * @returns {Promise<boolean>} false when the request failed.
 */
async function sendHookJob(sync, job) {
    if (job.event === 'change' && job.signature === sync.lastSentSignature) return true;
    if (sync.sending) { addHookJob(sync, job); return true; }
    sync.sending = true;
    sync.status = 'Sending…';
    updateSyncUi(sync);
    const abort = new AbortController();
    const deadline = setTimeout(() => abort.abort(), HOOK_TIMEOUT_MS);
    try {
        await sendHookRequest(sync, job, abort.signal);
        showHookSuccess(sync, job);
        return true;
    } catch (error) {
        showHookFailure(sync, job.hook, error, abort.signal.aborted);
        return false;
    } finally {
        clearTimeout(deadline);
        sync.sending = false;
        updateSyncUi(sync);
        startNextHookJob(sync);
    }
}

/**
 * Keeps a request until the running one is done; a waiting save stays a save when a change follows it.
 * @param {SyncSession} sync - the session.
 * @param {HookJob} job - the request.
 * @returns {void}
 */
function addHookJob(sync, job) {
    const key = job.body.id + '\n' + job.hook.url, waitingJob = sync.waitingJobs.get(key);
    sync.waitingJobs.set(key, waitingJob && waitingJob.event === 'save' && job.event === 'change' ? { ...job, event: 'save', quiet: waitingJob.quiet && job.quiet } : job);
}

/**
 * Starts the oldest waiting request, if there is one.
 * @param {SyncSession} sync - the session.
 * @returns {void}
 */
function startNextHookJob(sync) {
    const next = sync.waitingJobs.values().next();
    if (next.done) return;
    sync.waitingJobs.delete(next.value.body.id + '\n' + next.value.hook.url);
    setTimeout(() => sendHookJob(sync, next.value), 0);
}

/**
 * Posts a request to the webhook and checks the answer.
 * @param {SyncSession} sync - the session.
 * @param {HookJob} job - the request.
 * @param {AbortSignal} signal - ends the request after HOOK_TIMEOUT_MS.
 * @returns {Promise<void>} resolves when the server took the document.
 * @throws {Error} when the body is too big or the server refused it (with the server's own words).
 */
async function sendHookRequest(sync, job, signal) {
    const headers = { 'Content-Type': 'application/json' };
    if (job.hook.token) headers.Authorization = 'Bearer ' + job.hook.token;
    const json = JSON.stringify({ ...job.body, event: job.event === 'change' ? 'save' : job.event });
    const bytes = getUtf8Size(json);
    if (bytes > MAX_REQUEST_BYTES) throw new Error(`the ${sync.ed.word} with its pictures is ${(bytes / BYTES_PER_MB).toFixed(0)} MB - at most 40 MB go in one request`);
    const response = await fetch(job.hook.url, { method: 'POST', headers, body: json, mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', signal });
    // The server's own words, if it sends {error} or {message} (or a short text).
    const text = await response.text().catch(error => { if (signal.aborted) throw error; return ''; });
    let answer = null;
    try { answer = JSON.parse(text); } catch (error) { /* not JSON */ }
    const said = getPlainShortText(answer && typeof answer === 'object' ? String(answer.error || answer.message || '') : text.length < SHORT_ANSWER_LENGTH ? text : '', MESSAGE_LIMIT);
    if (!response.ok || (answer && answer.ok === false)) throw new Error(`The server answered ${response.status}${said ? ': ' + said : ''}`);
}

/**
 * Notes a request the server took: the host document counts as saved at the page when it is unchanged.
 * @param {SyncSession} sync - the session.
 * @param {HookJob} job - the request.
 * @returns {void}
 */
function showHookSuccess(sync, job) {
    const host = getUrlHost(job.hook.url);
    sync.lastSentSignature = job.signature;
    if (job.isHostDocument && sync.host && sync.host.id === job.body.id) {
        updateHostFromEditor(sync);
        if (sync.host.content === job.body.content) setBase(sync, sync.host);
    }
    sync.status = `Saved on ${host} at ${new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}`;
    if (!job.quiet) sync.ed.toast(`Saved on ${host}`);
}

/**
 * Shows why a request failed, in the status and as a message.
 * @param {SyncSession} sync - the session.
 * @param {HookSettings} hook - the webhook.
 * @param {Error} error - what went wrong.
 * @param {boolean} timedOut - true when the server did not answer in time.
 * @returns {void}
 */
function showHookFailure(sync, hook, error, timedOut) {
    const reason = timedOut ? `the server did not answer within ${HOOK_TIMEOUT_MS / 1000} seconds`
        : error.message === FAILED_TO_FETCH ? CORS_HINT : error.message;
    sync.status = `Not saved on ${getUrlHost(hook.url)}: ${reason}`;
    sync.ed.toast(sync.status);
}

/* ---------- Save and change ---------- */

/**
 * "Save" (button, Ctrl+S): to the page around the editor and/or the webhook. A command that returns
 * a Promise so the caller can wait.
 * @param {SyncSession} sync - the session.
 * @returns {Promise<boolean>} false when there is no place to save to.
 */
async function saveDocument(sync) {
    const toPage = isPeerThere(sync) && (sync.framed || sync.parentOrigin) && isHostOpen(sync);
    if (!toPage && !getEffectiveHook(sync)) {
        if (sync.peer && sync.host && !isHostOpen(sync)) sync.ed.toast(STAYS_IN_BROWSER);
        else if (sync.ownWindow) sync.ed.toast('The page that opened the editor is closed - download the document so nothing is lost');
        return false;
    }
    if (toPage) {
        updateHostFromEditor(sync);
        sendDocumentToPage(sync, sync.host);
        if (!getEffectiveHook(sync)) sync.ed.toast('Saved');
    }
    if (getEffectiveHook(sync)) await sendHook(sync, 'save', false);
    return true;
}

/**
 * Handles a change in the editor: keeps the host document, reports the change to the page after a
 * short pause and starts the automatic save.
 * @param {SyncSession} sync - the session.
 * @returns {void}
 */
function handleChange(sync) {
    // The host document is taken at once, so an edit made just ahead of switching documents is not lost.
    if (sync.peer && isHostOpen(sync)) updateHostFromEditor(sync);
    if (sync.postedDocument && sync.ed.current().id === sync.postedDocument.id) sync.postedDocument.edited = sync.ed.current().content;
    clearTimeout(sync.changeReportTimer);
    sync.changeReportTimer = setTimeout(() => sendChangeToPage(sync), CHANGE_REPORT_DELAY_MS);
    const hook = getEffectiveHook(sync);
    if (hook && hook.auto) { clearTimeout(sync.autoSaveTimer); sync.autoSaveTimer = setTimeout(() => sendHook(sync, 'change', true), AUTO_SAVE_DELAY_MS); }
}

/**
 * Reports the host document to the page when it differs from what the page last heard. Only real
 * edits count: loading a document is not a change; going back to what the page has is one.
 * @param {SyncSession} sync - the session.
 * @returns {void}
 */
function sendChangeToPage(sync) {
    if (!sync.peer || !sync.host) return;
    if (isHostOpen(sync)) updateHostFromEditor(sync);
    const host = sync.host, key = getSnapshotKey(createSnapshot(host));
    if (key === sync.reported) return;
    sync.reported = key;
    sendToPage(sync, { type: 'change', id: host.id, name: host.name, content: host.content, ...getAssetDiff(sync, host) });
}

/* ---------- Messages from the page around the editor ---------- */

/**
 * Tells whether a message comes from the page the editor works for, with this editor's prefix and
 * from a real origin that is the page's.
 * @param {SyncSession} sync - the session.
 * @param {MessageEvent} event - the message event.
 * @returns {boolean} true when the message is the page's.
 */
function isPageMessage(sync, event) {
    if (!sync.peer || event.source !== sync.peer) return false;
    const message = event.data;
    if (!message || typeof message !== 'object' || typeof message.type !== 'string' || !message.type.startsWith(sync.prefix + ':')) return false;
    if (!isKnownMessageType(sync, message.type.slice(sync.prefix.length + 1))) return false;
    if (!event.origin || event.origin === 'null') return false;                      // no answers to a page without a real origin
    return !(sync.parentOrigin && event.origin !== sync.parentOrigin);              // the page went elsewhere
}

/**
 * Tells whether a page message has a type this editor answers; only such a message sets the
 * page's origin.
 * @param {SyncSession} sync - the session.
 * @param {string} type - the type without the prefix.
 * @returns {boolean} true for a known type ("template" only in an editor with template placeholders,
 * "assets" only in an editor that takes files from the page).
 */
function isKnownMessageType(sync, type) {
    return PAGE_MESSAGE_TYPES.has(type) && (type !== 'template' || hasTemplateSupport(sync)) && (type !== 'assets' || hasAssetSupport(sync));
}

/**
 * Tells whether the editor takes files the page adds to its document.
 * @param {SyncSession} sync - the session.
 * @returns {boolean} true in an editor with files that stores them for the page.
 */
function hasAssetSupport(sync) {
    return sync.hasFiles && typeof sync.ed.addAssets === 'function';
}

/**
 * Tells whether the editor offers template placeholders.
 * @param {SyncSession} sync - the session.
 * @returns {boolean} true when the editor checks and shows a page's template.
 */
function hasTemplateSupport(sync) {
    return typeof sync.ed.parseTemplate === 'function' && typeof sync.ed.onTemplate === 'function';
}

/**
 * Routes a message of the page to what it asks for (postMessage handler).
 * @param {SyncSession} sync - the session.
 * @param {MessageEvent} event - the message event.
 * @returns {void}
 */
function handlePageMessage(sync, event) {
    if (!isPageMessage(sync, event)) return;
    const message = event.data;
    sync.parentOrigin = event.origin;
    const type = message.type.slice(sync.prefix.length + 1);
    if (type === 'load') importPageDocument(sync, message);
    else if (type === 'ai') { if (message.decline === true) stopDeclinedKeyRequest(sync, message); else setRemote(sync, message); }
    else if (type === 'ai-click') receiveAiClickAnswer(sync, message);
    else if (type === 'get') sendHostDocument(sync);
    else if (type === 'save') { if (isHostOpen(sync)) saveDocument(sync); }
    else if (type === 'pdf') sendPdf(sync, message);
    else if (type === 'template') receiveTemplate(sync, message);
    else if (type === 'assets') receivePageAssets(sync, message);
}

/**
 * Answers "get": the host document as "save", or nulls until the first load.
 * @param {SyncSession} sync - the session.
 * @returns {void}
 */
function sendHostDocument(sync) {
    updateHostFromEditor(sync);
    if (sync.host) { sendDocumentToPage(sync, sync.host); return; }
    sendToPage(sync, { type: 'save', editor: sync.ed.editor, event: 'save', id: null, name: null, content: null, ...(sync.hasFiles ? { assets: {} } : {}), updated: new Date().toISOString() });
}

/**
 * Loads a document the page sent: the page's host document, the AI's result for it, or the AI's
 * new document.
 * @param {SyncSession} sync - the session.
 * @param {object} message - the load message.
 * @returns {void}
 */
function importPageDocument(sync, message) {
    if (typeof message.content !== 'string' || message.content.length > MAX_LOAD_CHARACTERS) return;
    const generation = ++sync.loadGeneration;
    const name = getPlainShortText(String(message.name || DEFAULT_NAME), NAME_LIMIT) || DEFAULT_NAME;
    const fromAi = message.from === 'ai', label = sync.remote?.label || DEFAULT_PAGE_LABEL;
    const pictures = getLoadPictures(sync, message, fromAi);
    if ('ai' in message) setRemote(sync, message.ai && typeof message.ai === 'object' ? message.ai : null);
    setPageContext(sync, message);
    // A new document from the AI: a separate file in the user's browser; the host document stays as it is.
    if (fromAi && message.target === 'new') { openAiDocument(sync, message, name, pictures, label); return; }
    const hook = getLoadHook(sync, message);
    if ('hook' in message || !fromAi) sync.pageHook = null;
    const template = getLoadTemplate(sync, message);
    importHostDocument(sync, { message, generation, name, pictures, fromAi, label, hook, template });
}

/**
 * Returns the pictures of a load: the page's as sent, the AI's only as far as they are allowed
 * (and tells the user which were refused).
 * @param {SyncSession} sync - the session.
 * @param {object} message - the load message.
 * @param {boolean} fromAi - true for an AI's result.
 * @returns {Object<string, string>} the pictures by name.
 */
function getLoadPictures(sync, message, fromAi) {
    if (!(sync.hasFiles && fromAi && 'assets' in message)) return sync.hasFiles && message.assets && typeof message.assets === 'object' ? message.assets : {};
    const { accepted, refused } = selectAiPictures(message.assets);
    if (refused.length) showRefusedAiPictures(sync, refused);
    return accepted;
}

/**
 * Tells the user which pictures from the AI were not taken.
 * @param {SyncSession} sync - the session.
 * @param {string[]} refused - the names refused.
 * @returns {void}
 */
function showRefusedAiPictures(sync, refused) {
    const names = refused.slice(0, AI_PICTURES_NAMED).join(', ').slice(0, MESSAGE_LIMIT) + (refused.length > AI_PICTURES_NAMED ? ' …' : '');
    sync.ed.toast(`Not taken from the AI (only PNG, JPEG, GIF, WebP or PDF under a plain name, at most 20): ${names}`);
}

/**
 * Sets the page's context for the AI prompt from a load; `context` without an object clears it.
 * @param {SyncSession} sync - the session.
 * @param {object} message - the load message.
 * @returns {void}
 */
function setPageContext(sync, message) {
    if (message.context && typeof message.context === 'object') {
        const context = message.context;
        sync.pageContext = { host: getPlainShortText(context.host, CONTEXT_HOST_LIMIT), title: getPlainShortText(context.title, CONTEXT_TITLE_LIMIT), rules: getPlainShortText(context.rules, CONTEXT_RULES_LIMIT), site: new URL(sync.parentOrigin).host };
    } else if ('context' in message) sync.pageContext = null;
}

/**
 * Returns the webhook of a load when its address is usable; tells the user about one that is not.
 * @param {SyncSession} sync - the session.
 * @param {object} message - the load message.
 * @returns {object|null} the `hook` of the message, or null.
 */
function getLoadHook(sync, message) {
    const hook = message.hook && typeof message.hook === 'object' && isValidUrl(String(message.hook.url || '')) ? message.hook : null;
    if (message.hook && !hook) sync.ed.toast('The webhook from the page is not an https:// address - it is not used');
    return hook;
}

/**
 * Opens an AI's result as a new document in the user's browser and tells the page.
 * @param {SyncSession} sync - the session.
 * @param {object} message - the load message.
 * @param {string} name - the document's name.
 * @param {Object<string, string>} pictures - the pictures of the result.
 * @param {string} label - the page's name for messages.
 * @returns {void}
 */
function openAiDocument(sync, message, name, pictures, label) {
    const previousId = sync.ed.current().id;
    getLoadContent(sync, message.content, message)
        .then(content => sync.ed.load({ name: `${name} (AI)`, content, assets: pictures, asNew: true, page: sync.parentOrigin, temp: false }))
        .then(() => showAiDocumentResult(sync, previousId, label))
        .catch(() => sync.ed.toast("The AI's result could not be opened"));
}

/**
 * Tells the user and the page about the AI's new document, or that it could not be made.
 * @param {SyncSession} sync - the session.
 * @param {string} previousId - the id of the document open ahead of the load.
 * @param {string} label - the page's name for messages.
 * @returns {void}
 */
function showAiDocumentResult(sync, previousId, label) {
    const current = sync.ed.current();
    updateSyncUi(sync);
    // Not made (e.g. the browser's storage is full): nothing about the document that is open goes to the page.
    if (current.id === previousId) { sync.ed.toast("The AI's result could not be opened - your browser's storage may be full"); return; }
    sync.ed.toast(`The AI's new ${sync.ed.word} is open as "${current.name}" - it stays in your browser and is not saved to ${label}`);
    sync.ed.onAiResult?.();
    sendToPage(sync, { type: 'loaded', id: current.id, name: current.name, target: 'new' });
}

/**
 * Loads the page's document (or the AI's result for it) as the host document. The AI's result goes
 * into the host document, whatever its name. The page's pictures are the whole set (what the page
 * removed must not come back); without "assets" they stay. The AI's pictures are added: the ones it
 * did not send stay. The load waits for the files of the page's earlier "assets" messages, and
 * sync.hostLoad settles when it is done or dropped.
 * @param {SyncSession} sync - the session.
 * @param {HostLoad} load - the load.
 * @returns {void}
 */
function importHostDocument(sync, load) {
    const { message, generation, name, pictures, fromAi, template } = load;
    load.number = ++sync.hostLoadCount;
    sync.hostLoad = Promise.all([getLoadContent(sync, message.content, message), template ? template.examples : null, sync.templateCheck, sync.assetsQueue])
        .then(([content, examples]) => {
            if (generation !== sync.loadGeneration) { examples?.close(); return false; }
            if (template) setTemplateIfCurrent(sync, template.revision, examples, null);
            return Promise.resolve(sync.ed.load({ name, content, assets: pictures, replaceAssets: sync.hasFiles && 'assets' in message && !fromAi, into: fromAi && sync.host ? sync.host.id : null, page: sync.parentOrigin, temp: true })).then(() => true);
        })
        .then(done => {
            if (done) applyHostLoad(sync, load);           // otherwise a newer load from the page came first
        })
        .then(() => {}, () => {});
}

/**
 * Takes the loaded document as the host document, sets the page's webhook and tells the page.
 * @param {SyncSession} sync - the session.
 * @param {HostLoad} load - the load.
 * @returns {void}
 */
function applyHostLoad(sync, load) {
    const { fromAi, label, hook } = load;
    setHostToCurrent(sync);
    sync.hostNumber = load.number;
    const host = sync.host;
    if (sync.template) { sync.template.hostId = host.id; sync.ed.onTemplate?.(getHostTemplate(sync)); }
    if (!fromAi) setBase(sync, host);                     // an AI result is not saved at the page yet
    if (hook) setPageHook(sync, host.id, hook);
    updateSyncUi(sync);
    sync.ed.onAi?.(getAiSettings(sync));
    if (fromAi) { sync.ed.toast(`The AI's result from ${label} is open - Undo takes it back`); sync.ed.onAiResult?.(); }
    sendToPage(sync, { type: 'loaded', id: host.id, name: host.name });
}

/* ---------- Files the page adds ---------- */

/**
 * Takes the files of a "<P>:assets" message: measured and checked at once, then stored with the
 * host document after the page's load before the message and after the files of earlier messages.
 * A refused message gets its answer at once.
 * @param {SyncSession} sync - the session.
 * @param {object} message - the assets message with `add`.
 * @returns {void}
 */
function receivePageAssets(sync, message) {
    const size = getPageAssetsSize(message.add);
    const refusal = size > MAX_REQUEST_BYTES ? ASSETS_TOO_LARGE : sync.assetsWaiting + size > MAX_REQUEST_BYTES ? ASSETS_QUEUE_FULL : '';
    const files = refusal ? null : selectPageAssets(message.add);
    if (!files) { sendAssetsAnswer(sync, sync.host ? sync.host.id : null, { error: refusal || ASSETS_INVALID }); return; }
    const number = sync.hostLoadCount, hostLoad = sync.hostLoad;
    sync.assetsWaiting += size;
    sync.assetsQueue = sync.assetsQueue
        .then(() => hostLoad)
        .then(() => addHostAssets(sync, files, number))
        .catch(() => sendAssetsAnswer(sync, sync.host ? sync.host.id : null, { error: ASSETS_NOT_LOADED }))
        .finally(() => { sync.assetsWaiting -= size; });
}

/**
 * Returns how many characters the files of an "assets" message hold, names and data URIs; cheap,
 * so it comes before the checks.
 * @param {*} add - the `add` field of the message.
 * @returns {number} the characters; 0 for an `add` other than an object.
 */
function getPageAssetsSize(add) {
    if (!add || typeof add !== 'object') return 0;
    return Object.entries(add).reduce((sum, [name, dataUri]) => sum + name.length + (typeof dataUri === 'string' ? dataUri.length : 0), 0);
}

/**
 * Returns the files of an "assets" message when every one of them may be taken: 1 to
 * AI_PICTURE_LIMIT files, each a picture or PDF as the AI may send it, with an extension that fits
 * its type and base64 that decodes.
 * @param {*} add - the `add` field of the message.
 * @returns {Object<string, string>|null} the files by name, or null when the message is refused.
 */
function selectPageAssets(add) {
    if (!add || typeof add !== 'object' || Array.isArray(add) || Object.getPrototypeOf(add) !== Object.prototype) return null;
    const entries = Object.entries(add);
    if (!entries.length || entries.length > AI_PICTURE_LIMIT) return null;
    return entries.every(([name, dataUri]) => isPageAsset(name, dataUri)) ? Object.fromEntries(entries) : null;
}

/**
 * Tells whether one file from the page may be taken.
 * @param {string} name - the file's name.
 * @param {*} dataUri - its content, a data URI.
 * @returns {boolean} true for an allowed type under a plain name with a fitting extension and base64 that decodes.
 */
function isPageAsset(name, dataUri) {
    if (!AI_PICTURE_NAME.test(name) || typeof dataUri !== 'string') return false;
    const match = AI_PICTURE_DATA.exec(dataUri);
    if (!match) return false;
    const extension = (FILE_EXTENSION.exec(name) || [''])[0].slice(1).toLowerCase();
    return PAGE_FILE_EXTENSIONS[match[1]].includes(extension) && isDecodableBase64(dataUri.slice(dataUri.indexOf(',') + 1));
}

/**
 * Tells whether base64 text decodes: with padding, the text fills whole blocks of four characters;
 * without padding, the last block holds two or three characters.
 * @param {string} text - base64 of the allowed characters, padding at the end only.
 * @returns {boolean} true when it decodes.
 */
function isDecodableBase64(text) {
    return text.endsWith('=') ? text.length % 4 === 0 : text.length % 4 !== 1;
}

/**
 * Stores files from the page with the host document of the page's load before the message, when
 * that document is still the host document and stays within the size, and answers the page.
 * @param {SyncSession} sync - the session.
 * @param {Object<string, string>} files - the checked files by name.
 * @param {number} number - the number of the page's last load of a host document when the message came.
 * @returns {Promise<void>} resolves when the files are stored or refused and the page has its answer.
 */
async function addHostAssets(sync, files, number) {
    if (!sync.host || sync.hostNumber !== number) { sendAssetsAnswer(sync, sync.host ? sync.host.id : null, { error: sync.host ? ASSETS_NOT_LOADED : ASSETS_NO_DOCUMENT }); return; }
    updateHostFromEditor(sync);
    const host = sync.host;
    if (getDocumentBytes(sync, { ...host, assets: { ...host.assets, ...files } }) > MAX_REQUEST_BYTES) { sendAssetsAnswer(sync, host.id, { error: ASSETS_DOCUMENT_TOO_LARGE }); return; }
    const stored = await sync.ed.addAssets(host.id, files);
    if (!stored || !sync.host || sync.host.id !== host.id) { sendAssetsAnswer(sync, host.id, { error: ASSETS_NOT_LOADED }); return; }
    setAssetsKnownToPage(sync, files);
    sendAssetsAnswer(sync, host.id, { added: Object.keys(files) });
}

/**
 * Returns how many bytes a document takes in a save to a webhook, its files included.
 * @param {SyncSession} sync - the session.
 * @param {EditorDocument} editorDocument - the document.
 * @returns {number} the bytes of the request body.
 */
function getDocumentBytes(sync, editorDocument) {
    return getUtf8Size(JSON.stringify(createPayload(sync, 'save', true, editorDocument)));
}

/**
 * Notes files the page added as part of the host document, of what the page has and of what it
 * last heard; the text and the other files of each stay as they were.
 * @param {SyncSession} sync - the session.
 * @param {Object<string, string>} files - the files added.
 * @returns {void}
 */
function setAssetsKnownToPage(sync, files) {
    if (isHostOpen(sync)) updateHostFromEditor(sync);
    else sync.host = { ...sync.host, assets: { ...sync.host.assets, ...files } };
    if (sync.base) sync.base = addAssetsToSnapshot(sync.base, files);
    if (sync.reported) sync.reported = getSnapshotKey(addAssetsToSnapshot(parseSnapshotKey(sync.reported), files));
}

/**
 * Returns the snapshot a key of getSnapshotKey() stands for; the fingerprints are JSON, which
 * holds its control characters escaped, so the last NUL character ends the content.
 * @param {string} key - the key.
 * @returns {Snapshot} the snapshot.
 */
function parseSnapshotKey(key) {
    const end = key.lastIndexOf('\u0000');
    return { content: key.slice(0, end), assets: JSON.parse(key.slice(end + 1)) };
}

/**
 * Returns a snapshot with the fingerprints of more files, sorted by name.
 * @param {Snapshot} snapshot - the snapshot.
 * @param {Object<string, string>} files - the files to add by name, as data URIs.
 * @returns {Snapshot} the merged snapshot.
 */
function addAssetsToSnapshot(snapshot, files) {
    const added = createSnapshot({ content: snapshot.content, assets: files }).assets;
    const merged = Object.entries({ ...snapshot.assets, ...added }).sort((a, b) => (a[0] < b[0] ? -1 : 1));
    return { content: snapshot.content, assets: Object.fromEntries(merged) };
}

/**
 * Sends the answer to an "assets" message.
 * @param {SyncSession} sync - the session.
 * @param {string|null} id - the host document's id, null before the first load.
 * @param {{added?: string[], error?: string}} fields - the names added, or the reason for the refusal.
 * @returns {void}
 */
function sendAssetsAnswer(sync, id, fields) {
    sendToPage(sync, { type: 'assets', id, ...fields });
}

/* ---------- Template placeholders ---------- */

/**
 * Takes the page's template placeholders from a "<P>:template" message: checked by the editor,
 * for the host document (or the next one the page loads); { clear: true } ends them. Only while
 * the page is there.
 * @param {SyncSession} sync - the session.
 * @param {object} message - the template message.
 * @returns {void}
 */
function receiveTemplate(sync, message) {
    if (!isPeerThere(sync)) return;
    const revision = ++sync.templateRevision;
    if (message.clear === true) { setTemplate(sync, null); return; }
    sync.templateCheck = checkPageTemplate(sync, message).then(examples => setTemplateIfCurrent(sync, revision, examples, null));
}

/**
 * Returns the template a load carries, on its way through the editor's check: an object sets
 * it, null or { clear: true } ends it; a load without the field keeps the template.
 * @param {SyncSession} sync - the session.
 * @param {object} message - the load message.
 * @returns {?{revision: number, examples: Promise<(TemplateExamples|null)>}} the template on its way, or null to keep the template.
 */
function getLoadTemplate(sync, message) {
    if (!hasTemplateSupport(sync) || !('template' in message)) return null;
    const template = message.template;
    if (template !== null && typeof template !== 'object') return null;
    const revision = ++sync.templateRevision;
    return { revision, examples: template === null || template.clear === true ? Promise.resolve(null) : checkPageTemplate(sync, template) };
}

/**
 * Has the editor check a page's template.
 * @param {SyncSession} sync - the session.
 * @param {object} template - the message or the `template` field.
 * @returns {Promise<(TemplateExamples|null)>} the checked placeholders; null when the check failed.
 */
function checkPageTemplate(sync, template) {
    return Promise.resolve().then(() => sync.ed.parseTemplate(template)).catch(() => null);
}

/**
 * Takes checked placeholders when no newer message or load came meanwhile; an older result is
 * let go of. Placeholders of a "<P>:template" message belong to the host document when their
 * check finishes (the one a load finished meanwhile), else to the next load.
 * @param {SyncSession} sync - the session.
 * @param {number} revision - the revision of the message or load.
 * @param {TemplateExamples|null} examples - the checked placeholders, or null to end them.
 * @param {string|null} hostId - the host document they belong to; null for the host document of the moment (or the next load).
 * @returns {void}
 */
function setTemplateIfCurrent(sync, revision, examples, hostId) {
    if (revision !== sync.templateRevision) { examples?.close(); return; }
    setTemplate(sync, examples ? { examples, hostId: hostId ?? (sync.host ? sync.host.id : null) } : null);
}

/**
 * Ends the page's template placeholders with the page session: a check still on its way is
 * dropped when it finishes.
 * @param {SyncSession} sync - the session.
 * @returns {void}
 */
function clearPageTemplate(sync) {
    sync.templateRevision++;
    setTemplate(sync, null);
}

/**
 * Sets the page's template placeholders, lets go of the ones before and tells the editor.
 * @param {SyncSession} sync - the session.
 * @param {PageTemplate|null} template - the new template, or null to end it.
 * @returns {void}
 */
function setTemplate(sync, template) {
    const previous = sync.template;
    if (!previous && !template) return;
    sync.template = template;
    if (previous && previous.examples !== template?.examples) previous.examples.close();
    if (hasTemplateSupport(sync)) sync.ed.onTemplate(getHostTemplate(sync));
}

/**
 * Returns the page's template placeholders while the host document they belong to is open.
 * @param {SyncSession} sync - the session.
 * @returns {TemplateExamples|null} the placeholders, or null.
 */
function getHostTemplate(sync) {
    const template = sync.template;
    return template && template.hostId !== null && isHostOpen(sync) && template.hostId === sync.host.id ? template.examples : null;
}

/**
 * Sets the webhook the page sent with its document, in memory only.
 * @param {SyncSession} sync - the session.
 * @param {string} documentId - the host document.
 * @param {object} hook - the `hook` of the load message.
 * @returns {void}
 */
function setPageHook(sync, documentId, hook) {
    sync.pageHook = { id: documentId, url: String(hook.url), token: getPlainShortText(hook.token, TOKEN_LIMIT), auto: !!hook.auto, assets: sync.hasFiles && hook.assets !== false, page: true };
    sync.lastSentSignature = '';
    sync.status = `Saves to ${getUrlHost(sync.pageHook.url)} (set by the page)`;
}

/**
 * Sends the host document to the page as a PDF of page pictures. One at a time.
 * @param {SyncSession} sync - the session.
 * @param {object} message - the pdf message with its `dpi`.
 * @returns {Promise<void>} resolves when the answer went to the page.
 */
async function sendPdf(sync, message) {
    updateHostFromEditor(sync);
    const host = sync.host;
    if (!host || !isHostOpen(sync) || !sync.ed.pdf) { sendToPage(sync, { type: 'pdf', id: host ? host.id : null, error: 'The document from the page is not open' }); return; }
    if (sync.pdfBusy) { sendToPage(sync, { type: 'pdf', id: host.id, error: 'A PDF is already being made' }); return; }
    sync.pdfBusy = true;
    try {
        const dpi = Math.min(PDF_DPI_MAX, Math.max(PDF_DPI_MIN, Number(message.dpi) || PDF_DPI_DEFAULT));
        const { pdf, pages } = await sync.ed.pdf(dpi);
        sendToPage(sync, { type: 'pdf', id: host.id, name: host.name, pages, pdf: 'data:application/pdf;base64,' + getBase64(pdf) });
    } catch (error) {
        sendToPage(sync, { type: 'pdf', id: host.id, error: getPlainShortText(String(error && error.message || error), MESSAGE_LIMIT) || 'The PDF could not be made' });
    } finally { sync.pdfBusy = false; }
}

/* ---------- The "Save to server" dialog ---------- */

/**
 * Connects the dialog's buttons and the Save button.
 * @param {SyncSession} sync - the session.
 * @returns {void}
 */
function connectSettingsDialog(sync) {
    sync.fields = {
        url: document.getElementById('sync-url'), token: document.getElementById('sync-token'),
        auto: document.getElementById('sync-auto'), scope: document.getElementById('sync-doc'),
    };
    document.getElementById('btn-sync')?.addEventListener('click', () => openSettings(sync));
    document.getElementById('sync-ok').addEventListener('click', () => saveSettingsOnOk(sync));
    document.getElementById('sync-test').addEventListener('click', () => sendSettingsTest(sync));
    sync.saveButton.addEventListener('click', () => saveDocument(sync));
}

/**
 * Opens the dialog with the webhook of the open document (its own, else the general one).
 * @param {SyncSession} sync - the session.
 * @returns {void}
 */
function openSettings(sync) {
    const current = sync.ed.current();
    const documentHook = readDocumentHook(sync, current.id);
    const hook = documentHook && documentHook.url ? documentHook : sync.generalHook;
    sync.fields.url.value = hook.url || '';
    sync.fields.token.value = hook.token || '';
    sync.fields.auto.checked = !!hook.auto;
    sync.fields.scope.checked = !!(documentHook && documentHook.url);
    document.getElementById('sync-docname').textContent = current.name;
    updateSyncUi(sync);
    openDialog(sync.dialog);
}

/**
 * Stores the dialog's webhook, for the open document or as the general one. Returns whether it
 * took place, as the caller goes on only then.
 * @param {SyncSession} sync - the session.
 * @returns {boolean} false when the address is not usable.
 */
function applySettings(sync) {
    const url = sync.fields.url.value.trim();
    if (url && !isValidUrl(url)) { sync.ed.toast('Please enter an https:// address (or http://localhost for testing)'); sync.fields.url.focus(); return false; }
    const hook = { url, token: sync.fields.token.value.trim(), auto: sync.fields.auto.checked };
    const current = sync.ed.current();
    if (sync.fields.scope.checked) writeDocumentHook(sync, current.id, url ? hook : null);
    else { writeDocumentHook(sync, current.id, null); sync.generalHook = hook; writeGeneralHook(sync, sync.generalHook); }
    sync.status = url ? '' : 'Not connected';
    updateSyncUi(sync);
    return true;
}

/**
 * "OK" in the dialog: stores the webhook and closes the dialog.
 * @param {SyncSession} sync - the session.
 * @returns {void}
 */
function saveSettingsOnOk(sync) {
    if (!applySettings(sync)) return;
    sync.dialog.close();
    sync.ed.toast(sync.fields.url.value.trim() ? 'Saved versions now go to your server' : 'Webhook switched off');
}

/**
 * "Test" in the dialog: stores the webhook and sends the open document at once.
 * @param {SyncSession} sync - the session.
 * @returns {Promise<void>} resolves when the request is done.
 */
async function sendSettingsTest(sync) {
    if (!applySettings(sync)) return;
    sync.lastSentSignature = '';
    await sendHook(sync, 'save', false);
}

/* ---------- Links: ?src= and ?webhook=, and a document by HTTP POST ---------- */

/**
 * Opens what the address asks for: a document posted by HTTP POST, ?src=, ?webhook=; then removes
 * those parameters from the address. A step waits only when it has to (a load, a download, a
 * question to the user); a step that is done at once lets the next one run in the same task, so
 * an address without anything to wait for is handled before the editor reports "ready".
 * @param {SyncSession} sync - the session.
 * @returns {Promise<void>} resolves when all is open.
 */
async function openLinkedDocuments(sync) {
    const sourceUrl = sync.params.get('src'), webhookUrl = VIEWER ? null : sync.params.get('webhook');
    const postedPending = openPostedDocument(sync);
    if (postedPending) await postedPending;
    const sourcePending = sourceUrl ? openSourceDocument(sync, sourceUrl) : undefined;
    if (sourcePending) await sourcePending;
    const webhookPending = webhookUrl ? applyLinkWebhook(sync, webhookUrl) : undefined;
    if (webhookPending) await webhookPending;
    if (sourceUrl || webhookUrl) removeLinkParameters();
    updateSyncUi(sync);
}

/**
 * Opens a document sent by HTTP POST (post.php): hostile data like a link, in memory only, not the
 * page's host document. Reading the posted data happens at once; only the load is waited for.
 * @param {SyncSession} sync - the session.
 * @returns {Promise<void>|undefined} a promise that resolves when the document is open or refused,
 * undefined when there is no posted document or its data cannot be read.
 */
function openPostedDocument(sync) {
    const posted = document.getElementById(POSTED_DOCUMENT_ID);
    if (!posted) return undefined;
    let postedDocument;
    try {
        postedDocument = JSON.parse(posted.textContent);
        posted.remove();
        if (typeof postedDocument.content !== 'string') throw new Error('no document');
    } catch (error) {
        sync.ed.toast(POSTED_DOCUMENT_ERROR);
        return undefined;
    }
    return importPostedDocument(sync, postedDocument);
}

/**
 * Loads the data of a posted document into the editor as a new document in memory.
 * @param {SyncSession} sync - the session.
 * @param {object} postedDocument - the posted data: `name` (any value) and `content` (a string).
 * @returns {Promise<void>} resolves when the document is open or refused.
 */
async function importPostedDocument(sync, postedDocument) {
    try {
        await sync.ed.load({ name: getPlainShortText(postedDocument.name, NAME_LIMIT) || DEFAULT_NAME, content: await getLoadContent(sync, postedDocument.content), assets: {}, page: 'post', temp: true, asNew: true });
    } catch (error) {
        sync.ed.toast(POSTED_DOCUMENT_ERROR);
        return;
    }
    const current = sync.ed.current();
    sync.postedDocument = { id: current.id, sent: current.content, edited: current.content };
    // Kept in memory only: leaving the page (another language, a reload) asks first when it has edits.
    addEventListener('beforeunload', handleLeavingPostedDocument.bind(null, sync));
}

/**
 * Asks the browser to confirm leaving the page while the posted document has unsaved edits.
 * @param {SyncSession} sync - the session.
 * @param {BeforeUnloadEvent} event - the browser's event.
 * @returns {void}
 */
function handleLeavingPostedDocument(sync, event) {
    const posted = sync.postedDocument;
    if (!posted || posted.edited === posted.sent) return;
    event.preventDefault();
    event.returnValue = '';
}

/**
 * Opens the file of ?src= (the server must allow CORS); inside a page it becomes the host document.
 * An address that is refused is reported at once; only the download and the load are waited for.
 * @param {SyncSession} sync - the session.
 * @param {string} sourceUrl - the ?src= address.
 * @returns {Promise<void>|undefined} a promise that resolves when the file is open or refused,
 * undefined when the address is refused at once.
 */
function openSourceDocument(sync, sourceUrl) {
    try {
        if (!isValidUrl(new URL(sourceUrl, location.href).href)) throw new Error('only https:// addresses can be opened');
    } catch (error) {
        showSourceError(sync, error);
        return undefined;
    }
    const loading = receiveSourceDocument(sync, sourceUrl);
    if (sync.trusted) sync.hostLoad = loading;
    return loading;
}

/**
 * Downloads the file of ?src= and loads it.
 * @param {SyncSession} sync - the session.
 * @param {string} sourceUrl - the ?src= address, an https address.
 * @returns {Promise<void>} resolves when the file is open or refused.
 */
async function receiveSourceDocument(sync, sourceUrl) {
    const number = ++sync.hostLoadCount;
    try {
        const generation = sync.loadGeneration;
        const response = await fetch(new URL(sourceUrl, location.href), { credentials: 'omit' });
        if (!response.ok) throw new Error(`the server answered ${response.status}`);
        const text = await response.text();
        if (generation !== sync.loadGeneration) throw new Error(LOADED_ELSEWHERE);
        const name = getSourceName(sync, sourceUrl);
        const content = await getLoadContent(sync, text);
        if (generation !== sync.loadGeneration) throw new Error(LOADED_ELSEWHERE);
        await sync.ed.load({ name, content, assets: {}, page: 'src:' + new URL(sourceUrl, location.href).origin, temp: sync.trusted });
        if (sync.trusted) { setHostToCurrent(sync); setBase(sync, sync.host); sync.hostNumber = number; }
    } catch (error) { showSourceError(sync, error); }
}

/**
 * Tells the user why the file of ?src= could not be opened.
 * @param {SyncSession} sync - the session.
 * @param {Error} error - what went wrong.
 * @returns {void}
 */
function showSourceError(sync, error) {
    sync.ed.toast(`The file could not be opened: ${error.message === FAILED_TO_FETCH ? CORS_HINT : error.message}`);
}

/**
 * Returns the name of a ?src= document: &name=, else the file name without its extension.
 * @param {SyncSession} sync - the session.
 * @param {string} sourceUrl - the ?src= address.
 * @returns {string} the name.
 * @throws {URIError} when the file name in the address is not valid percent-encoding.
 */
function getSourceName(sync, sourceUrl) {
    const fileName = new URL(sourceUrl, location.href).pathname.split('/').pop() || DEFAULT_NAME;
    return getPlainShortText(sync.params.get('name') || decodeURIComponent(fileName).replace(FILE_EXTENSION, ''), NAME_LIMIT) || DEFAULT_NAME;
}

/**
 * Uses the webhook of ?webhook= for one document and this session only. Inside a page, the page
 * chose it: only for the document it opened with ?src=. Otherwise the user is asked. A link never
 * stores a webhook.
 * @param {SyncSession} sync - the session.
 * @param {string} webhookUrl - the ?webhook= address.
 * @returns {Promise<void>|undefined} a promise that resolves when the user has answered, undefined
 * when no question is needed.
 */
function applyLinkWebhook(sync, webhookUrl) {
    const hook = { url: webhookUrl, token: '', auto: sync.params.has('auto'), page: sync.trusted };
    if (sync.params.has('token')) sync.ed.toast('A token in a link is not used - enter it under "Save to server"');
    if (!isValidUrl(webhookUrl)) sync.ed.toast('The webhook in the link is not an https:// address - it is not used');
    else if (sync.trusted) {
        if (sync.host) { sync.pageHook = { ...hook, id: sync.host.id }; sync.status = ''; }
        else sync.ed.toast('The webhook in the link only works together with ?src= - it is not used');
    } else return applyLinkWebhookOnConfirm(sync, hook, webhookUrl);
    return undefined;
}

/**
 * Asks the user whether the webhook of a link may receive the open document, and uses it on "Allow".
 * @param {SyncSession} sync - the session.
 * @param {HookSettings} hook - the webhook of the link.
 * @param {string} webhookUrl - the ?webhook= address.
 * @returns {Promise<void>} resolves when the user has answered.
 */
async function applyLinkWebhookOnConfirm(sync, hook, webhookUrl) {
    if (await openConfirmation({ title: 'Save on this server?', text: `This link asks the editor to send the saved versions of "${sync.ed.current().name}" to ${getUrlHost(webhookUrl)} while this page is open. Only allow it if you trust that site.`, ok: 'Allow', cancel: 'No' })) {
        sync.pageHook = { ...hook, id: sync.ed.current().id };
        sync.status = '';
    }
}

/**
 * Removes the link parameters from the address, so a reload does not open them again.
 * @returns {void}
 */
function removeLinkParameters() {
    const kept = new URLSearchParams(location.search);
    LINK_PARAMETERS.forEach(name => kept.delete(name));
    const query = kept.toString();
    history.replaceState(null, '', location.pathname + (query ? '?' + query : '') + location.hash);
}

/* ---------- Inside a page: reload and own window ---------- */

/**
 * Inside a page, F5 / Ctrl+R would throw the editor away without the page knowing: the page is
 * asked with "reload" (keydown handler).
 * @param {SyncSession} sync - the session.
 * @param {KeyboardEvent} event - the keydown event.
 * @returns {void}
 */
function sendReloadToPage(sync, event) {
    const withModifier = event.ctrlKey || event.metaKey;
    if (!(event.key === 'F5' || (withModifier && !event.altKey && (event.key === 'r' || event.key === 'R')))) return;
    if (!isPeerThere(sync)) return;
    event.preventDefault();
    updateHostFromEditor(sync);
    const host = sync.host;
    sendToPage(sync, { type: 'reload', id: host ? host.id : null, unsaved: !!host && isChangedFromBase(sync, host) });
}

/**
 * In an own window: always tells the page when closing (with the content when it is not saved
 * there), and ends the page's AI settings and webhook once the page is gone.
 * @param {SyncSession} sync - the session.
 * @returns {void}
 */
function watchOpener(sync) {
    // Chrome drops messages to a page of another site sent as late as pagehide, so "closing" goes out in beforeunload.
    addEventListener('beforeunload', event => {
        if (isPeerThere(sync) && sync.parentOrigin) sendClosing(sync);
        else {
            updateHostFromEditor(sync);
            if (isHostUnsaved(sync)) { event.preventDefault(); event.returnValue = ''; }
        }
    });
    addEventListener('pagehide', () => { if (isPeerThere(sync) && sync.parentOrigin) sendClosing(sync); });
    addEventListener('pageshow', event => { if (event.persisted) sync.closingSent = false; });
    setInterval(() => stopPageSessionWithoutOpener(sync), OPENER_CHECK_INTERVAL_MS);
    addEventListener('focus', () => stopPageSessionWithoutOpener(sync));
}

/**
 * Sends "closing" to the opener, once per page show.
 * @param {SyncSession} sync - the session.
 * @returns {void}
 */
function sendClosing(sync) {
    if (sync.closingSent) return;
    sync.closingSent = true;
    updateHostFromEditor(sync);
    const host = sync.host, unsaved = isHostUnsaved(sync);
    sendToPage(sync, { type: 'closing', id: host ? host.id : null, name: host ? host.name : null, unsaved, ...(unsaved ? { content: host.content } : {}) });
}

/**
 * Ends the page's AI settings, webhook and template placeholders when the opener is closed. (A page that went to another
 * site cannot be told apart from it: messages to it are dropped by its origin, and the page's
 * server ends the key.)
 * @param {SyncSession} sync - the session.
 * @returns {void}
 */
function stopPageSessionWithoutOpener(sync) {
    if (isPeerThere(sync)) return;
    if (sync.remote || sync.remoteState) setRemote(sync, null);
    clearPageTemplate(sync);
    if (sync.pageHook && sync.pageHook.page) { sync.pageHook = null; sync.status = ''; updateSyncUi(sync); }
}
