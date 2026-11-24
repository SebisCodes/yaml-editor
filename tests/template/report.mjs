/**
 * Reads a JSON list of cases (argv[3]) and runs each through the data tree in src/js (argv[2]) as
 * the editor runs it: the model of the code with the template syntax of the case, the colored
 * code, the schema check, tree edits, and the example view with the page's examples (the filled
 * data, its places in the code, and changes made in it). Prints one JSON result per case for
 * template_test.py.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const scriptFolder = process.argv[2];
const cases = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const datatree = await importModule('datatree.js');
const template = await importModule('template-tags.js');
const templateExamples = await importModule('template-examples.js');
await datatree.importYamlLibrary();
await addTomlFormat();

/**
 * Imports a module of the editor by its file name.
 * @param {string} fileName - the file in src/js, e.g. "datatree.js".
 * @returns {Promise<object>} the module's exports.
 */
function importModule(fileName) {
    return import(pathToFileURL(join(scriptFolder, fileName)).href);
}

/**
 * Registers TOML with the data tree when the editor has it (the TOML Editor).
 * @returns {Promise<void>} settles when TOML is registered or the editor has no TOML.
 */
async function addTomlFormat() {
    try { datatree.addFormat('toml', (await importModule('toml.js')).TOML); } catch (error) { /* an editor without TOML */ }
}

/**
 * One case of template_test.py.
 * @typedef {object} TemplateCase
 * @property {string} code - the code.
 * @property {string} format - json, yaml or toml.
 * @property {?string} template - the template syntax, or null for plain data.
 * @property {*} [schema] - a JSON Schema to check the data against.
 * @property {object[]} [edits] - tree edits, each {kind, path, value?, key?, by?}, each on the code of the case.
 * @property {ExampleCase} [example] - the example view to build, with what to check in it.
 */

/**
 * The example view of a case.
 * @typedef {object} ExampleCase
 * @property {?object} message - the page's template message (placeholders), or null for none.
 * @property {Array<Array<string|number>>} [paths] - nodes of the example view whose place in the code is asked for.
 * @property {object[]} [edits] - changes in the example view, each {kind, path, value?, key?, at?}, each on the code of the case.
 * @property {number[]} [cursors] - places in the code whose node in the example view is asked for.
 */

/**
 * Builds the result of one case: what the editor makes of its code with its template syntax.
 * @param {TemplateCase} testCase - the code, the format and the template syntax.
 * @returns {Promise<object>} the problems, the marked nodes, the data, the colored code, the schema problems, the edits and the example view.
 */
async function buildCaseResult(testCase) {
    const syntax = template.getTemplateSyntax(testCase.template);
    datatree.setTemplateSyntax(syntax);
    const model = datatree.parse(testCase.format, testCase.code);
    return {
        problems: model.problems.map(problem => ({ pos: problem.pos, end: problem.end, kind: problem.kind, msg: problem.msg })),
        broken: model.broken,
        docs: model.docs.length,
        nodes: getMarkedNodes(model),
        keys: getMarkedKeys(model),
        value: getValue(model),
        highlighted: datatree.highlight(testCase.format, testCase.code),
        plainHighlighted: getPlainHighlight(testCase),
        tags: syntax ? template.getTemplateTags(testCase.code, syntax).map(tag => testCase.code.slice(tag.start, tag.end)) : [],
        hasTags: datatree.hasTemplateTags(testCase.code),
        schema: testCase.schema === undefined ? null : model.docs.flatMap(doc => (doc.root ? datatree.getSchemaProblems(doc.root, testCase.schema) : [])).map(problem => problem.msg),
        edits: (testCase.edits || []).map(edit => runEdit(testCase, model, edit, syntax)),
        example: testCase.example ? await buildExampleResult(testCase, model) : null,
    };
}

/**
 * Builds the example view of a case and what it checks: the filled text and data, the places of
 * nodes in the code, changes made in the view, and the nodes at places of the code.
 * @param {TemplateCase} testCase - the case, with its example.
 * @param {object} model - the model of the case's code (the template).
 * @returns {Promise<object>} {text, value, errors, places, edits, cursors}, or {error} when filling stops.
 */
async function buildExampleResult(testCase, model) {
    const message = testCase.example.message;
    const examples = message ? await templateExamples.createTemplateExamples(message, { decodePicture: async () => ({ width: 1, height: 1 }) }) : null;
    let view;
    try { view = datatree.parseExampleView(testCase.format, testCase.code, examples); } catch (error) { return { error: error.name }; }
    return {
        text: view.text,
        value: getValue(view.model),
        errors: view.model.problems.filter(problem => problem.kind === 'error').map(problem => problem.msg),
        places: (testCase.example.paths || []).map(path => getExamplePlace(testCase, model, view, path)),
        edits: (testCase.example.edits || []).map(edit => runExampleEdit(testCase, model, view, edit)),
        cursors: (testCase.example.cursors || []).map(offset => getExampleCursorPath(view, offset)),
    };
}

/**
 * Returns where a node of the example view stands in the code and whether it may be edited.
 * @param {TemplateCase} testCase - the case.
 * @param {object} model - the template's model.
 * @param {object} view - the example view (parseExampleView).
 * @param {Array<string|number>} path - the node's path in the example view.
 * @returns {object} {code, valueEditable, keyEditable}: the code it stands for and what may be edited in place.
 */
function getExamplePlace(testCase, model, view, path) {
    const node = datatree.getNodeAtPath(view.model.docs[0].root, path);
    if (!node) return { missing: true };
    const range = datatree.getCodeRangeByViewRange(view.map, node.start, node.end);
    const info = { node, entry: node.entry };
    return {
        code: testCase.code.slice(range.start, range.end),
        valueEditable: datatree.isExampleEditable('value', info, model, view.map),
        keyEditable: datatree.isExampleEditable('key', info, model, view.map),
    };
}

/**
 * Runs one change made in the example view on the code of a case: led back to the template's own
 * nodes, then written as a tree edit.
 * @param {TemplateCase} testCase - the case.
 * @param {object} model - the template's model.
 * @param {object} view - the example view.
 * @param {object} edit - {kind, path, value?, key?, at?}.
 * @returns {object} {code} after the change, or {error} with the message.
 */
function runExampleEdit(testCase, model, view, edit) {
    const node = datatree.getNodeAtPath(view.model.docs[0].root, edit.path);
    const op = { kind: edit.kind, value: edit.value, key: edit.key, at: edit.at };
    if (edit.kind === 'add') op.box = node;
    else if (edit.kind === 'value' || edit.kind === 'type') op.node = node;
    else op.entry = node && node.entry;
    const change = datatree.buildTemplateChange(op, model, view.map);
    if (!change) return { error: datatree.EXAMPLE_EDIT_MESSAGE };
    try { return { code: datatree.editCode(testCase.format, testCase.code, change).code }; } catch (error) { return { error: error.message }; }
}

/**
 * Returns the path of the node of the example view at a place in the code.
 * @param {object} view - the example view.
 * @param {number} offset - the place in the code.
 * @returns {string} the path, e.g. $.items[2].title; "" without a node.
 */
function getExampleCursorPath(view, offset) {
    const node = datatree.getNodeAtPosition(view.model, datatree.getViewOffsetByCodeOffset(view.map, offset));
    return node ? datatree.formatPath(datatree.getPath(node)) : '';
}

/**
 * Returns the colored code of a case without template syntax.
 * @param {TemplateCase} testCase - the case.
 * @returns {string} the HTML of the code view in plain mode.
 */
function getPlainHighlight(testCase) {
    const syntax = datatree.getActiveTemplateSyntax();
    datatree.setTemplateSyntax(null);
    const html = datatree.highlight(testCase.format, testCase.code);
    datatree.setTemplateSyntax(syntax);
    return html;
}

/**
 * Returns the nodes the template marked: placeholder values, strings that hold a tag and
 * containers a section repeats.
 * @param {object} model - the model.
 * @returns {object[]} each with its path, type, placeholder, repeated, value and place.
 */
function getMarkedNodes(model) {
    const nodes = [];
    datatree.runForEachNode(model, (node, doc, path) => {
        if (node.placeholder || node.repeated) nodes.push({ path: path.join('.'), type: node.type, placeholder: node.placeholder || null, repeated: !!node.repeated, value: node.entries ? null : node.value, start: node.start, end: node.end });
    });
    return nodes;
}

/**
 * Returns the keys that hold a tag.
 * @param {object} model - the model.
 * @returns {object[]} each with the key and its place.
 */
function getMarkedKeys(model) {
    const keys = [];
    datatree.runForEachNode(model, node => {
        for (const entry of node.entries || []) if (entry.placeholderKey) keys.push({ key: entry.key, start: entry.keyStart, end: entry.keyEnd });
    });
    return keys;
}

/**
 * Returns the data of a model, or the error that stopped it.
 * @param {object} model - the model.
 * @returns {*} the data, or {error} with the message.
 */
function getValue(model) {
    try { return datatree.getModelValue(model); } catch (error) { return { error: error.message }; }
}

/**
 * Runs one tree edit on the code of a case.
 * @param {TemplateCase} testCase - the case.
 * @param {object} model - the model of the case's code.
 * @param {object} edit - {kind, path, value?, key?, by?, type?}; kind "merge" adds value to the root (&mode=add).
 * @param {?object} syntax - the template syntax.
 * @returns {object} {code, tagsKept} after the edit, or {error} with the message.
 */
function runEdit(testCase, model, edit, syntax) {
    const node = datatree.getNodeAtPath(model.docs[0].root, edit.path);
    const op = { kind: edit.kind, node, entry: node && node.entry, value: edit.value, key: edit.key, by: edit.by, type: edit.type, box: node };
    try {
        const code = edit.kind === 'merge' ? datatree.mergeData(testCase.format, testCase.code, edit.value) : datatree.editCode(testCase.format, testCase.code, op).code;
        const before = getTagTexts(testCase.code, syntax), after = getTagTexts(code, syntax);
        return { code, tagsKept: before.every(tag => after.includes(tag)), tags: after };
    } catch (error) {
        return { error: error.message };
    }
}

/**
 * Returns the tags of a code as written.
 * @param {string} code - the code.
 * @param {?object} syntax - the template syntax, or null.
 * @returns {string[]} the tags in order; empty without syntax.
 */
function getTagTexts(code, syntax) {
    return syntax ? template.getTemplateTags(code, syntax).map(tag => code.slice(tag.start, tag.end)) : [];
}

const results = [];
for (const testCase of cases) results.push(await buildCaseResult(testCase));
console.log(JSON.stringify(results));
