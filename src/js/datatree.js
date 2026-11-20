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
 *
 * The model: { format, docs: [{ root, start, end, label?, broken? }], problems,
 * broken, jsonl? } (DataModel in datatree-core.js). A node is { id, type, value,
 * raw, start, end, entries, entry, anchor, tag, style, flow, target }; type is
 * object, array, string, number, boolean, null or alias (YAML); start / end are
 * its place in the code. The members of an object or array are entries { key,
 * keyStart, keyEnd, start, node, parent, index }: key is the name in an object
 * and the position in an array.
 */

import { getAddedFormat } from './datatree-core.js?v=2';
import { parseJson, parseJsonl, isJsonLines } from './datatree-json.js?v=3';
import { parseYaml } from './datatree-yaml.js?v=3';
import { findKey } from './datatree-values.js?v=3';
import { editCode } from './datatree-edit.js?v=3';

export {
    TYPES, importYamlLibrary, getYamlLibrary, addFormat, getAliasTarget, setOwnProperty,
} from './datatree-core.js?v=2';
export { parseJson, parseJsonl, isJsonLines } from './datatree-json.js?v=3';
export { parseYaml } from './datatree-yaml.js?v=3';
export {
    VALUE_LIMIT, TooManyValues, getPlainValue, getModelValue, getPath, getDocIndex, formatPath, parsePath,
    getNodeAtPath, findKey, getNodeAtPosition, runForEachNode,
} from './datatree-values.js?v=3';
export { getSchemaProblems } from './datatree-schema.js?v=3';
export { getIndentUnit, getFreeKey, convertValue, editCode } from './datatree-edit.js?v=3';
export { escapeHtml, highlight } from './datatree-highlight.js?v=2';
export { createTree } from './datatree-view.js?v=4';

/**
 * Options of parse.
 * @typedef {object} ParseOptions
 * @property {boolean} [jsonl] - read JSON as JSON Lines (otherwise only when it looks like it).
 */

/**
 * Reads the code of a format into a model.
 * @param {string} format - 'json', 'yaml' or an added format.
 * @param {string} src - the code.
 * @param {ParseOptions} [opts] - options.
 * @returns {DataModel} the model, with `src` set to the code.
 */
export function parse(format, src, opts = {}) {
    const added = getAddedFormat(format);
    const model = added ? added.parse(src) : format === 'yaml' ? parseYaml(src) : opts.jsonl || isJsonLines(src) ? parseJsonl(src) : parseJson(src);
    model.src = src;
    return model;
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
