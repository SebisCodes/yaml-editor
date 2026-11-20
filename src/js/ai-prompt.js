/**
 * The AI prompt: instructions for any AI, the user's documents and the open document. The
 * prompt is always English. With the AI settings of a page around the editor (sync.js) the
 * AI sends its result to that page's server, which opens it here.
 */

import { TEXT_KIND } from './ai-links.js?v=2';

const SITE = 'https://yaml.giit.ch/';
/** The prefix of the editor's messages. */
const PREFIX = 'yamleditor';
/** The most other document names the prompt lists. */
const MAX_LISTED_DOCUMENTS = 40;
/** The most problems the prompt lists. */
const MAX_LISTED_PROBLEMS = 12;
/** The longest selection the prompt quotes. */
const MAX_SELECTION_LENGTH = 300;

/** The instructions of the prompt: how to answer and what the editor shows. */
export const PROMPT_BASE = `You write YAML for my editor ${SITE}. It runs in my browser and shows the data as a tree next to the code.

HOW TO ANSWER
Write the complete YAML document (YAML 1.2, spaces for indentation, never tabs; several documents with --- if mine has them). Keep my data, its order and my comments unless I ask otherwise.
Send it as a link: ${SITE}#b64=<base64url of the UTF-8 text> (shorter: zlib-compress first and use #z=; without code: #yaml=<URL-encoded text>). Open the link yourself if you can; otherwise give it to me - I click it or paste your whole answer into the editor.
- New document: add &file=new&name=<short name>. Change one of my documents: add &file=<its exact name>.
- Only add or change some keys of the top-level mapping (or add items to the top-level sequence) of the first document: send just those as YAML and add &mode=add.
- Longer than about 8000 characters: one link per part with &part=N&of=M&id=<short name>.

WHAT THE EDITOR SHOWS
The data as a foldable tree with types, counts and the path ($.items[3].name), one tree per document, anchors (&) and aliases (*) marked; problems with line and column (syntax errors, tabs used for indentation, duplicate keys, unknown aliases, and a JSON Schema I chose); conversions to JSON, CSV (a sequence of mappings) and XML.`;

/** About saving on the user's own server; left out when a page that holds the document opened the editor (it saves there by itself). */
export const PROMPT_SAVING = `MY OWN SERVER (only if I ask about it)
The editor can POST every saved version as JSON {editor, event:"save", id, name, content, updated} to my server (webhook, optional Bearer token, CORS from ${SITE.replace(/\/$/, '')}); content is the document as a string. It can be embedded with <iframe src="${SITE}?embed=1"> or opened with window.open("${SITE}?embed=window") and then talks with postMessage (${PREFIX}:ready, load, loaded, change, save, get, ai, key-request). If I ask you to build that, follow ${SITE}llms.txt exactly.`;
export const PROMPT_HEAD = `${PROMPT_BASE}\n\n${PROMPT_SAVING}`;

/**
 * Plain text about the page that holds the document (from that page, sync.js).
 * @typedef {object} PageContext
 * @property {string} host - the page's host as it names it.
 * @property {string} title - the page's title.
 * @property {string} rules - its rules for the document.
 * @property {string} site - its real host.
 */

/**
 * What the prompt is made from.
 * @typedef {object} PromptState
 * @property {string} code - the open document's code.
 * @property {string} name - its name.
 * @property {string[]} files - the names of all documents.
 * @property {string} sel - the text selected in the code.
 * @property {string} path - the path selected in the tree.
 * @property {string} schema - the name of the chosen schema.
 * @property {string[]} problems - the problems with line and column.
 * @property {PageContext|null} context - what the page that holds the document says about itself.
 * @property {boolean} framed - true inside another website.
 * @property {AiSettings|null} remote - the AI settings of the page around the editor.
 */

/**
 * The AI settings of the page around the editor (sync.js).
 * @typedef {object} AiSettings
 * @property {string} label - the page's name for itself.
 * @property {string} site - its real host.
 * @property {string} prompt - its instructions.
 * @property {string} endpoint - where the AI sends its result.
 * @property {string} key - the key of this editor session.
 * @property {boolean} base - false to leave out the editor's own instructions.
 */

/**
 * Returns text from the website, marked as such: where it comes from (the real origin) and
 * fenced, so the AI can tell it apart from what the user writes.
 * @param {string} head - the heading ("RULES", "INSTRUCTIONS").
 * @param {string} site - the real host of the page.
 * @param {string} label - the page's name for itself.
 * @param {string} text - the text.
 * @returns {string} the marked text.
 */
function formatSiteText(head, site, label, text) {
    return `${head} ${site ? `FROM THE WEBSITE ${site}` : 'FROM THE WEBSITE'}${label && label !== site ? ` ("${label}")` : ''}\n\`\`\`text\n${text.replace(/`{3,}/g, "'''")}\n\`\`\``;
}

/**
 * Returns the part of the prompt about the page that holds the document.
 * @param {PageContext} context - what the page says about itself.
 * @returns {string} the part.
 */
function formatContextPart(context) {
    return `THIS DOCUMENT BELONGS TO ${context.host ? `"${context.host}"` : 'a website'}${context.title ? ` ("${context.title}")` : ''}
That page opened the editor and gets every saved version back by itself when I click Save (or press Ctrl+S) - nothing to set up and no server to build. Keep the document working with that page.${context.rules ? `\n\n${formatSiteText('RULES', context.site, context.host, context.rules)}` : ''}`;
}

/**
 * Returns one part of PROMPT_BASE, from its heading to the next one.
 * @param {string} head - the heading.
 * @returns {string} the part, "" when there is none.
 */
function getPromptPart(head) {
    const index = PROMPT_BASE.indexOf('\n' + head + '\n');
    if (index < 0) return '';
    const rest = PROMPT_BASE.slice(index + 1), end = rest.search(/\n\n[A-Z][A-Z ]+\n/);
    return end < 0 ? rest : rest.slice(0, end);
}

/**
 * Returns the prompt when the page around the editor takes the AI's result on its own server:
 * the AI sends the result there itself, and the page then opens it here.
 * @param {PromptState} state - the document.
 * @param {AiSettings} remote - the page's AI settings.
 * @param {boolean} makeNew - true for a new document.
 * @returns {string} the head of the prompt.
 */
function formatRemotePrompt(state, remote, makeNew) {
    const target = makeNew ? 'new' : 'current';
    const parts = [];
    if (remote.base) {
        const know = getPromptPart('WHAT THE EDITOR SHOWS');
        parts.push(`You write for my YAML editor ${SITE}, inside the website "${remote.label}".\nWrite the complete YAML document (spaces for indentation, never tabs). Keep my data and my comments unless I ask otherwise.${know ? '\n\n' + know : ''}`);
    }
    if (remote.prompt) parts.push(formatSiteText('INSTRUCTIONS', remote.site, remote.label, remote.prompt));
    if (state.context && state.context.rules) parts.push(formatSiteText('RULES', remote.site, remote.label, state.context.rules));
    const what = makeNew ? `Make a NEW document; leave "${state.name}" as it is.` : `Change my document "${state.name}".`;
    const link = `${SITE}#b64=<base64url of the UTF-8 YAML>${makeNew ? '&file=new&name=<short name>' : ''}`;
    if (remote.endpoint && remote.key) parts.push(`HOW TO ANSWER
${what} Send the result with one HTTP request (run it, do not only show it):
  POST ${remote.endpoint}
  Authorization: Bearer ${remote.key}
  Content-Type: application/json
  {"editor":"${TEXT_KIND}","target":"${target}","name":"<short name>","content":"<the complete YAML document as one string>"}
Build the JSON with a JSON library. The result then opens in my editor; tell me briefly what you did, or the server's error message.
If you cannot send HTTP requests, give me the link ${link} and I paste your answer into the editor.`);
    else parts.push(`HOW TO ANSWER\n${what} Give me the link ${link}; I paste your answer into the editor (a clicked link does not reach it).`);
    return parts.join('\n\n');
}

/**
 * Returns the head of the prompt: the instructions, how to answer and, inside a page, what
 * the page says.
 * @param {PromptState} state - the document.
 * @param {boolean} makeNew - true for a new document.
 * @returns {string} the head.
 */
function formatPromptHead(state, makeNew) {
    let head = state.remote ? formatRemotePrompt(state, state.remote, makeNew) : state.context ? `${PROMPT_BASE}\n\n${formatContextPart(state.context)}` : PROMPT_HEAD;
    if (state.framed && !state.remote) head += `\n\nMy editor is inside another website, so a clicked link does not reach it: do not open the link yourself - give it to me and I paste your answer.`;
    return head;
}

/**
 * Returns the part of the prompt about the user's documents and what the AI should change.
 * @param {PromptState} state - the document.
 * @param {boolean} makeNew - true for a new document.
 * @returns {string} the part, ending with a blank line.
 */
function formatDocumentList(state, makeNew) {
    const others = state.files.filter(name => name !== state.name);
    const list = `Open now: "${state.name}"${others.length ? `. Others: ${others.slice(0, MAX_LISTED_DOCUMENTS).map(name => `"${name}"`).join(', ')}${others.length > MAX_LISTED_DOCUMENTS ? ' …' : ''}` : ''}.`;
    const goal = makeNew
        ? 'Unless I say otherwise in my request, make a NEW document (&file=new&name=<short name>) and leave my documents as they are.'
        : `Unless I say otherwise in my request, change "${state.name}" (&file=${encodeURIComponent(state.name)}).`;
    return `${list}\n${goal}\n\n`;
}

/**
 * Returns the whole prompt: the head, the user's documents and the open document with its
 * selection, path, schema and problems, ending where the user writes the request.
 * @param {PromptState} state - the document.
 * @param {boolean} makeNew - true for a new document.
 * @returns {string} the prompt.
 */
export function getPrompt(state, makeNew) {
    let title = makeNew ? `MY OPEN DOCUMENT "${state.name}" (for reference only - do not change it)` : `MY CURRENT DOCUMENT "${state.name}"`;
    if (state.remote) title = `MY ${makeNew ? 'CURRENT' : ''} DOCUMENT "${state.name}"`.replace('  ', ' ');
    const problems = state.problems && state.problems.length ? `\nThe editor reports: ${state.problems.slice(0, MAX_LISTED_PROBLEMS).join('; ')}` : '';
    const schema = state.schema ? `\nThe editor checks it against my JSON Schema "${state.schema}".` : '';
    const selection = state.sel ? ` (I have selected: "${state.sel.slice(0, MAX_SELECTION_LENGTH)}")` : '';
    const path = state.path ? `\nThe tree shows ${state.path}.` : '';
    return `${formatPromptHead(state, makeNew)}\n\n${state.remote ? '' : formatDocumentList(state, makeNew)}${title}${selection}${path}${schema}${problems}\n\`\`\`${TEXT_KIND}\n${state.code.trim()}\n\`\`\`\n\nMy request: `;
}
