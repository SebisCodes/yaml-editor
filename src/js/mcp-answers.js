/**
 * The answers of the WebMCP tools (mcp.js): each reads from or changes the editor through the
 * functions it hands to createMcp() and returns the text the agent gets, or throws an Error
 * with a message for the agent. The ones that change the editor do the work of one tool and
 * return its answer, which the tool's execute passes on unchanged.
 */

/** The format the tools name. */
export const FORMAT = 'YAML';
/** The name of the document argument of set_document and new_file. */
export const ARG = 'yaml';
/** The characters of an ISO time stamp list_files shows, YYYY-MM-DDTHH:MM. */
const STAMP_LENGTH = 16;

/**
 * get_document: the name, the selection and the code of the open document.
 * @param {import('./mcp.js').McpEditor} editor - the editor.
 * @returns {string} the answer to the agent.
 */
export function getDocument(editor) {
    const state = editor.getState();
    return `Document: "${state.name}" (${FORMAT})\n${state.path ? `Selected in the tree: ${state.path}\n` : ''}${state.sel ? `Selected text: ${state.sel}\n` : ''}\n${state.code}`;
}

/**
 * get_problems: the problems with line and column.
 * @param {import('./mcp.js').McpEditor} editor - the editor.
 * @returns {string} the answer to the agent.
 */
export function getProblems(editor) {
    const problems = editor.getProblems();
    return problems.length ? problems.map(problem => `line ${problem.line}, column ${problem.col} (${problem.kind}): ${problem.msg}`).join('\n') : 'No problems.';
}

/**
 * get_value: the value at a path as JSON.
 * @param {import('./mcp.js').McpEditor} editor - the editor.
 * @param {object} args - the tool's arguments.
 * @param {string} args.path - the path.
 * @param {number} [args.document] - the document of the file, 1 = the first.
 * @returns {string} the answer to the agent.
 * @throws {Error} with a message for the agent when there is no value at the path.
 */
export function getValue(editor, { path, document }) {
    const result = editor.getValue(String(path ?? '$'), document);
    if (result.error) throw new Error(result.error);
    return `${result.path} (${result.type}, line ${result.line}):\n${JSON.stringify(result.value, null, 2)}`;
}

/**
 * set_value: sets or adds the value at a path. The work of the WebMCP tool, returning the
 * tool's answer.
 * @param {import('./mcp.js').McpEditor} editor - the editor.
 * @param {object} args - the tool's arguments.
 * @param {string} args.path - the path.
 * @param {*} args.value - the new value.
 * @param {number} [args.document] - the document of the file, 1 = the first.
 * @returns {string} the answer to the agent.
 * @throws {Error} with a message for the agent when the value cannot be set.
 */
export function setValue(editor, { path, value, document }) {
    const result = editor.setValue(String(path ?? ''), value, document);
    if (result.error) throw new Error(result.error);
    return result.added ? `Added ${result.path}.` : `Changed ${result.path}.`;
}

/**
 * set_document: replaces the whole open document. The work of the WebMCP tool, returning the
 * tool's answer.
 * @param {import('./mcp.js').McpEditor} editor - the editor.
 * @param {object} args - the tool's arguments, the code under ARG.
 * @returns {string} the answer to the agent.
 * @throws {Error} when the code is empty.
 */
export function setDocument(editor, args) {
    const text = String(args[ARG] || '');
    if (!text.trim()) throw new Error('The document is empty.');
    editor.receiveDocument(text, 'replace', { direct: true });
    const errors = editor.getProblems().filter(problem => problem.kind === 'error');
    return errors.length ? `Loaded, with ${errors.length} error(s) - see get_problems.` : 'The document is in the editor.';
}

/**
 * replace_text: replaces an exact piece of the code. The work of the WebMCP tool, returning the
 * tool's answer.
 * @param {import('./mcp.js').McpEditor} editor - the editor.
 * @param {object} args - the tool's arguments.
 * @param {string} args.find - the exact text to find.
 * @param {string} args.replace - the new text.
 * @param {boolean} [args.all] - true to replace every match.
 * @returns {string} the answer to the agent.
 * @throws {Error} when the text is not in the code.
 */
export function updateText(editor, { find, replace, all }) {
    const count = editor.updateText(String(find || ''), String(replace ?? ''), !!all);
    if (!count) throw new Error('The text was not found - call get_document to see the exact code.');
    return `Replaced ${count} time${count === 1 ? '' : 's'}.`;
}

/**
 * list_files: the user's documents, the open one marked.
 * @param {import('./mcp.js').McpEditor} editor - the editor.
 * @returns {string} the answer to the agent.
 */
export function getFileList(editor) {
    return editor.getFiles().map(file => `${file.open ? '* ' : '  '}"${file.name}" (changed ${new Date(file.updated).toISOString().slice(0, STAMP_LENGTH).replace('T', ' ')})`).join('\n') + '\n(* = open now)';
}

/**
 * open_file: opens a document by name. The work of the WebMCP tool, returning the tool's
 * answer.
 * @param {import('./mcp.js').McpEditor} editor - the editor.
 * @param {string} name - the name.
 * @returns {string} the answer to the agent.
 * @throws {Error} when there is no such document.
 */
export function openFile(editor, name) {
    if (!editor.openFileByName(name)) throw new Error(`No document "${name}" - call list_files.`);
    return `"${name}" is open.`;
}

/**
 * new_file: makes a new document and opens it. The work of the WebMCP tool, returning the
 * tool's answer with the new document's name.
 * @param {import('./mcp.js').McpEditor} editor - the editor.
 * @param {object} args - the tool's arguments: name, and the code under ARG.
 * @returns {string} the answer to the agent.
 * @throws {Error} when the storage is full.
 */
export function createFile(editor, args) {
    const name = editor.createFile(args.name, args[ARG]);
    if (!name) throw new Error('The browser storage is full.');
    return `New document "${name}" is open.`;
}
