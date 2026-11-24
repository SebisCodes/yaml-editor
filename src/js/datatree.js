/**
 * The data tree of a JSON, YAML or TOML document. The same files serve the
 * JSON Editor, the YAML Editor and the TOML Editor (byte for byte), so all
 * show and change data the same way. This module is the one the editors
 * import; it reads a document of any format and adds data to it, and passes
 * on the parts, each in its own module:
 *
 * - datatree-core.js: the model's shapes, the yaml package, added formats
 *   (addFormat: TOML brings its own parse, applyEdit and highlight).
 * - datatree-json.js: JSON, JSON with comments, JSON5 and JSON Lines.
 * - datatree-yaml.js: YAML through the vendored yaml package.
 * - datatree-values.js: plain values, paths and the node at a place.
 * - datatree-schema.js: the problems of the data against a JSON Schema.
 * - datatree-write.js and datatree-edit.js: one change in the tree as a small
 *   edit of the code that keeps its formatting and comments.
 * - datatree-highlight.js: the colors of the code view.
 * - datatree-view.js: the foldable tree with path, search and editing in place.
 * - datatree-template.js and datatree-template-roles.js: template placeholders
 *   (?template=), read as the data they stand for.
 * - datatree-examples.js: the example view of a template, the code filled with a
 *   page's examples, and the way from its data back to the code.
 *
 * The model: { format, docs: [{ root, start, end, label?, broken? }], problems,
 * broken, jsonl? } (DataModel in datatree-core.js). A node is { id, type, value,
 * raw, start, end, entries, entry, anchor, tag, style, flow, target }; type is
 * object, array, string, number, boolean, null or alias (YAML); start / end are
 * its place in the code. The members of an object or array are entries { key,
 * keyStart, keyEnd, start, node, parent, index }: key is the name in an object
 * and the position in an array.
 */

import { getAddedFormat } from './datatree-core.js?v=3';
import { parseJson, parseJsonl, isJsonLines } from './datatree-json.js?v=4';
import { parseYaml } from './datatree-yaml.js?v=4';
import { findKey } from './datatree-values.js?v=4';
import { editCode } from './datatree-edit.js?v=4';
import { readTemplateCode, getTemplateRoleFinder } from './datatree-template.js?v=1';
import { buildExampleText } from './datatree-examples.js?v=1';

export {
    TYPES, importYamlLibrary, getYamlLibrary, addFormat, getAliasTarget, setOwnProperty,
} from './datatree-core.js?v=3';
export { parseJson, parseJsonl, isJsonLines } from './datatree-json.js?v=4';
export { parseYaml } from './datatree-yaml.js?v=4';
export {
    VALUE_LIMIT, TooManyValues, getPlainValue, getModelValue, getPath, getDocIndex, formatPath, parsePath,
    getNodeAtPath, findKey, getNodeAtPosition, runForEachNode,
} from './datatree-values.js?v=4';
export { getSchemaProblems } from './datatree-schema.js?v=4';
export { getIndentUnit, getFreeKey, convertValue, editCode } from './datatree-edit.js?v=4';
export { escapeHtml, highlight } from './datatree-highlight.js?v=3';
export { createTree } from './datatree-view.js?v=5';
export {
    setTemplateSyntax, getActiveTemplateSyntax, hasTemplateTags, getTemplateEditRefusal, checkTemplateEdit, readTemplateCode, TEMPLATE_EDIT_MESSAGE, TEMPLATE_FORMAT_MESSAGE,
} from './datatree-template.js?v=1';
export {
    EXAMPLE_EDIT_MESSAGE, getCodeRangeByViewRange, getViewOffsetByCodeOffset, findTemplateNode, isExampleEditable, buildTemplateChange,
} from './datatree-examples.js?v=1';

/**
 * Options of parse.
 * @typedef {object} ParseOptions
 * @property {boolean} [jsonl] - read JSON as JSON Lines (otherwise only when it looks like it).
 */

/**
 * Reads the code of a format into a model. With a template syntax set (setTemplateSyntax), the
 * reader gets the code with its tags escaped, and the model is marked (datatree-template.js).
 * @param {string} format - 'json', 'yaml' or an added format.
 * @param {string} src - the code.
 * @param {ParseOptions} [opts] - options.
 * @returns {DataModel} the model, with `src` set to the code.
 */
export function parse(format, src, opts = {}) {
    const model = readTemplateCode(src, getTemplateRoleFinder(format), code => readFormatCode(format, code, opts));
    model.src = src;
    return model;
}

/**
 * Reads the example view of a template: the code filled with the page's examples
 * (datatree-examples.js), read with the reader of its format as plain data. A template syntax is set.
 * @param {string} format - 'json', 'yaml' or an added format.
 * @param {string} src - the template.
 * @param {?import('./template-examples.js').TemplateExamples} examples - the page's examples, or null.
 * @param {ParseOptions} [opts] - options.
 * @returns {import('./datatree-examples.js').ExampleView} the filled text read as data, with its map back to the code.
 * @throws {import('./template-expansion.js').TemplateExpansionError} past a limit of the filling.
 */
export function parseExampleView(format, src, examples, opts = {}) {
    const view = buildExampleText(format, src, examples);
    const model = readFormatCode(format, view.text, opts);
    model.src = view.text;
    return { model, text: view.text, map: view.map };
}

/**
 * Reads code with the reader of its format.
 * @param {string} format - 'json', 'yaml' or an added format.
 * @param {string} code - the code (with template tags escaped).
 * @param {ParseOptions} opts - options.
 * @returns {DataModel} the model.
 */
function readFormatCode(format, code, opts) {
    const added = getAddedFormat(format);
    if (added) return added.parse(code);
    if (format === 'yaml') return parseYaml(code);
    return opts.jsonl || isJsonLines(code) ? parseJsonl(code) : parseJson(code);
}

/**
 * Adds data to the root of a document (a link with &mode=add): the keys of an object go into the
 * root object (existing ones get the new value), the items of an array are added to the root array.
 * @param {string} format - 'json', 'yaml' or an added format.
 * @param {string} src - the code.
 * @param {*} data - the data to add.
 * @param {number} [doc] - the index of the document to add to.
 * @returns {string} the new code.
 * @throws {Error} with a message for the user when the document is broken or the data does not fit the root.
 */
export function mergeData(format, src, data, doc = 0) {
    const added = getAddedFormat(format);
    if (added && added.mergeInto) return added.mergeInto(src, data);
    let code = src;
    /**
     * Returns the root of the document in the code as it stands.
     * @returns {DataNode|null|undefined} the root.
     */
    const getRoot = () => parse(format, code).docs[doc]?.root;
    let root = getRoot();
    if (!root) throw new Error('The document has no data to add to');
    if (parse(format, code).broken) throw new Error('The document has a syntax error - fix it first');
    if (root.type === 'object' && data && typeof data === 'object' && !Array.isArray(data)) {
        for (const key of Object.keys(data)) {
            root = getRoot();
            const entry = findKey(root, key);
            code = entry ? editCode(format, code, { kind: 'value', node: entry.node, value: data[key] }).code : editCode(format, code, { kind: 'add', box: root, key, value: data[key] }).code;
        }
        return code;
    }
    if (root.type === 'array') {
        for (const value of Array.isArray(data) ? data : [data]) { root = getRoot(); code = editCode(format, code, { kind: 'add', box: root, value }).code; }
        return code;
    }
    throw new Error(root.type === 'object' ? 'Only an object can be added to the root object' : 'The root is neither an object nor an array');
}
