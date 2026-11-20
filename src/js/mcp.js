/**
 * WebMCP: the editor offers its functions as tools to an AI agent that runs in the browser
 * (document.modelContext, in Chrome as an early preview). The tools run in this page only -
 * no server, no connector. Browsers without WebMCP skip this. Every change is a normal undo
 * step.
 *
 * The data tools work on the open document; list_files, open_file and new_file reach the
 * user's other documents ("My documents"). The tool names, descriptions and parameters are the
 * contract with the agents and stay as they are.
 *
 * createMcp() runs these steps:
 *   1. find WebMCP; without it, return null;
 *   2. wrap every tool so a call notes its time and tells the editor;
 *   3. register the tools;
 *   4. return { last() }, when an agent last used a tool (for the AI status in aistatus.js).
 */

import {
    FORMAT, ARG, getDocument, getProblems, getValue, setValue, setDocument, updateText, getFileList, openFile, createFile,
} from './mcp-answers.js?v=3';

/** The argument that picks one of several documents of a file. */
const DOC_ARGUMENT = { document: { type: 'number', description: 'Only for several documents in one file (---): which one, 1 = the first.' } };

/**
 * What the editor hands to createMcp(); the functions return an object with error, or throw,
 * when a call cannot be done.
 * @typedef {object} McpEditor
 * @property {function(): void} [onUse] - a tool was called.
 * @property {function(): object} getState - the open document: name, code, sel, path.
 * @property {function(): Array<{line: number, col: number, kind: string, msg: string}>} getProblems - the problems.
 * @property {function(string, number): object} getValue - the value at a path: path, type, line, value or error.
 * @property {function(string, *, number): object} setValue - sets the value at a path: path, added or error.
 * @property {function(): Array<{name: string, updated: number, open: boolean}>} getFiles - the documents.
 * @property {function(string): boolean} openFileByName - opens a document by name; false when there is none.
 * @property {function(string, string): string} createFile - makes and opens a document; returns its name.
 * @property {function(string, string, object): Promise<void>} receiveDocument - takes a whole document.
 * @property {function(string, string, boolean): number} updateText - replaces text; returns how often.
 * @property {function(number): void} showLine - shows a line of the code.
 * @property {function(): void} undo - undoes the last change.
 */

/**
 * What createMcp() returns, read by the AI status.
 * @typedef {object} McpStatus
 * @property {function(): number} last - when an agent last used a tool (milliseconds since 1970), 0 for never.
 */

/**
 * Registers the editor's WebMCP tools (an initializeX: it returns the status object).
 * @param {McpEditor} editor - what the tools need of the editor.
 * @returns {McpStatus|null} the status, null without WebMCP.
 */
export function createMcp(editor) {
    const modelContext = document.modelContext || navigator.modelContext;
    if (!modelContext || typeof modelContext.registerTool !== 'function') return null;
    let lastCall = 0;
    for (const tool of createTools(editor)) {
        const run = tool.execute;
        /**
         * Notes the agent's call for the AI status, then runs the tool (the tool's execute).
         * @param {...*} args - the tool's arguments from the agent.
         * @returns {Promise<*>} the tool's answer, passed on unchanged.
         */
        const runTool = async (...args) => { lastCall = Date.now(); editor.onUse?.(); return run(...args); };
        tool.execute = runTool;
        addTool(modelContext, tool);
    }
    /**
     * Returns when an agent last used a tool (McpStatus.last).
     * @returns {number} milliseconds since 1970, 0 for never.
     */
    const getLastCall = () => lastCall;
    return { last: getLastCall };
}

/**
 * Registers one tool; a tool the browser refuses is left out.
 * @param {object} modelContext - the browser's WebMCP object.
 * @param {object} tool - the tool.
 * @returns {void}
 */
function addTool(modelContext, tool) {
    try {
        const result = modelContext.registerTool(tool);
        if (result && typeof result.catch === 'function') result.catch(() => { /* not available on this page */ });
    } catch (e) { /* the browser refused this tool */ }
}

/**
 * Creates the tools with their descriptions, input schemas and functions.
 * @param {McpEditor} editor - what the tools need of the editor.
 * @returns {object[]} the tools in the order they are registered.
 */
function createTools(editor) {
    return [...createReadTools(editor), ...createEditTools(editor), ...createFileTools(editor)];
}

/**
 * Creates the tools that read the open document: get_document, get_problems, get_value.
 * @param {McpEditor} editor - what the tools need of the editor.
 * @returns {object[]} the tools.
 */
function createReadTools(editor) {
    return [
        {
            name: 'get_document',
            description: `Returns the name and the ${FORMAT} code of the document open in the editor, and the selected text.`,
            inputSchema: { type: 'object', properties: {} },
            annotations: { readOnlyHint: true, untrustedContentHint: true },
            execute: async () => getDocument(editor),
        },
        {
            name: 'get_problems',
            description: 'Lists the syntax errors, notes (duplicate keys, tabs, unknown aliases …) and JSON Schema problems of the document, with line and column.',
            inputSchema: { type: 'object', properties: {} },
            annotations: { readOnlyHint: true },
            execute: async () => getProblems(editor),
        },
        {
            name: 'get_value',
            description: 'Returns the value at a path of the data as JSON (aliases resolved), e.g. "$.items[0].name" (also "items[0].name" or a JSON Pointer "/items/0/name").',
            inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'The path; "$" is the whole data.' }, ...DOC_ARGUMENT }, required: ['path'] },
            annotations: { readOnlyHint: true, untrustedContentHint: true },
            execute: async args => getValue(editor, args),
        },
    ];
}

/**
 * Creates the tools that change the open document or show a line: set_value, set_document,
 * replace_text, show_line.
 * @param {McpEditor} editor - what the tools need of the editor.
 * @returns {object[]} the tools.
 */
function createEditTools(editor) {
    return [
        {
            name: 'set_value',
            description: 'Sets the value at a path (any JSON value: string, number, boolean, null, object or array; written as YAML). A new key of an existing mapping, or the next index of a sequence, adds an entry. Only that place of the code changes; the rest keeps its formatting and comments.',
            inputSchema: {
                type: 'object',
                properties: { path: { type: 'string', description: 'The path, e.g. "$.settings.theme".' }, value: { description: 'The new value (JSON).' }, ...DOC_ARGUMENT },
                required: ['path', 'value'],
            },
            execute: async args => setValue(editor, args),
        },
        {
            name: 'set_document',
            description: `Replaces the whole open document with new ${FORMAT} code. Keep the user's existing data unless asked otherwise.`,
            inputSchema: { type: 'object', properties: { [ARG]: { type: 'string', description: `The complete ${FORMAT} code.` } }, required: [ARG] },
            execute: async args => setDocument(editor, args),
        },
        {
            name: 'replace_text',
            description: `Replaces an exact piece of the ${FORMAT} code with new text (the first match, or every match with all=true).`,
            inputSchema: {
                type: 'object',
                properties: {
                    find: { type: 'string', description: 'The exact text to find in the code.' },
                    replace: { type: 'string', description: 'The new text.' },
                    all: { type: 'boolean', description: 'Replace every match.' },
                },
                required: ['find', 'replace'],
            },
            execute: async args => updateText(editor, args),
        },
        {
            name: 'show_line',
            description: 'Moves the cursor to a line of the code and shows that place in the tree, so the user sees it.',
            inputSchema: { type: 'object', properties: { line: { type: 'number', description: 'Line number (1 = first line).' } }, required: ['line'] },
            execute: async ({ line }) => { editor.showLine(Math.max(1, Math.round(+line || 1))); return `Showing line ${line}.`; },
        },
    ];
}

/**
 * Creates the tools for the user's other documents and undo: list_files, open_file, new_file,
 * undo.
 * @param {McpEditor} editor - what the tools need of the editor.
 * @returns {object[]} the tools.
 */
function createFileTools(editor) {
    return [
        {
            name: 'list_files',
            description: 'Lists the user\'s documents stored in the editor ("My documents"), most recently changed first, and which one is open.',
            inputSchema: { type: 'object', properties: {} },
            annotations: { readOnlyHint: true, untrustedContentHint: true },
            execute: async () => getFileList(editor),
        },
        {
            name: 'open_file',
            description: 'Opens one of the user\'s documents by name; the other tools then work on it.',
            inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'The name from list_files.' } }, required: ['name'] },
            execute: async ({ name }) => openFile(editor, name),
        },
        {
            name: 'new_file',
            description: `Creates a new document and opens it; the user's other documents stay unchanged. Without ${ARG} it starts empty.`,
            inputSchema: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'A short name for the document.' },
                    [ARG]: { type: 'string', description: `Optional: the complete ${FORMAT} code.` },
                },
                required: ['name'],
            },
            execute: async args => createFile(editor, args),
        },
        {
            name: 'undo',
            description: 'Undoes the last change in the editor.',
            inputSchema: { type: 'object', properties: {} },
            execute: async () => { editor.undo(); return 'Undone.'; },
        },
    ];
}
