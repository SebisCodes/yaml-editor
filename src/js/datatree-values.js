/**
 * Values and paths of the data tree: the plain value of a node (aliases
 * resolved, YAML merge keys applied), the path of a node and the node at a
 * path or at a place in the code.
 */

import { isContainer, getAliasTarget, setOwnProperty, isMergeEntry, getMergedNodes } from './datatree-core.js?v=2';

/**
 * At most this many values from one call: aliases that repeat each other (a: &a [x, x],
 * b: &b [*a, *a] …) grow exponentially, 30 such lines are a billion values.
 */
export const VALUE_LIMIT = 1000000;
/**
 * How many values a call may still make; shared by the calls of one walk.
 * @typedef {object} ValueBudget
 * @property {number} left - the values left, below 0 the walk stops.
 */

/** How deep merge keys that merge further mappings are followed. */
const MAX_MERGE_DEPTH = 20;
/** A key that a path can write after a dot. */
const PLAIN_PATH_KEY = /^[A-Za-z_$][\w$]*$/;

/** The error when aliases expand past VALUE_LIMIT. */
export class TooManyValues extends RangeError {
    /**
     * Creates the error with its message.
     * @returns {void}
     */
    constructor() { super('The aliases expand to more than a million values.'); }
}

/**
 * Returns the plain value of a node: aliases resolved, YAML merge keys applied.
 * @param {DataNode|null} node - the node.
 * @param {Set<DataNode>} [seen] - the anchors being expanded, so an alias of itself gives null.
 * @param {ValueBudget} [budget] - how many values may still be made.
 * @returns {*} the value as plain JavaScript data.
 * @throws {TooManyValues} past VALUE_LIMIT values.
 */
export function getPlainValue(node, seen = new Set(), budget = { left: VALUE_LIMIT }) {
    if (!node) return null;
    if (--budget.left < 0) throw new TooManyValues();
    if (node.type === 'alias') {
        if (!node.target || seen.has(node.target)) return null;
        seen.add(node.target);
        const value = getPlainValue(node.target, seen, budget);
        seen.delete(node.target);
        return value;
    }
    if (node.type === 'array') return node.entries.map(entry => getPlainValue(entry.node, seen, budget));
    if (node.type === 'object') return getObjectValue(node, seen, budget);
    return node.value;
}

/**
 * Returns the plain object of a mapping: the keys of a merge key (<<: *anchor) come in at
 * its place; the mapping's own keys win.
 * @param {DataNode} node - an object node.
 * @param {Set<DataNode>} seen - the anchors being expanded.
 * @param {ValueBudget} budget - how many values may still be made.
 * @returns {object} the plain object.
 * @throws {TooManyValues} past VALUE_LIMIT values.
 */
function getObjectValue(node, seen, budget) {
    const own = new Set(node.entries.filter(entry => !isMergeEntry(node, entry)).map(entry => entry.key));
    const result = {};
    for (const entry of node.entries) {
        if (!isMergeEntry(node, entry)) { setOwnProperty(result, entry.key, getPlainValue(entry.node, seen, budget)); continue; }
        for (const alias of getMergedNodes(entry)) {
            const value = getPlainValue(alias, seen, budget);
            if (value && typeof value === 'object' && !Array.isArray(value)) for (const key of Object.keys(value)) if (!own.has(key) && !Object.prototype.hasOwnProperty.call(result, key)) setOwnProperty(result, key, value[key]);
        }
    }
    return result;
}

/**
 * Returns the entries of a mapping with YAML merge keys applied: its own entries, then the
 * keys of the merged mappings it does not have itself (at the place of the << line, for messages).
 * @param {DataNode} node - an object node.
 * @param {number} [depth] - how many merges deep this call is.
 * @returns {DataEntry[]} the entries; without merges node.entries itself.
 */
export function getEffectiveEntries(node, depth = 0) {
    /**
     * Tells whether an entry of this mapping is a merge key.
     * @param {DataEntry} entry - the entry.
     * @returns {boolean} true for a merge key.
     */
    const isMerge = entry => isMergeEntry(node, entry);
    if (!node.entries.some(isMerge) || depth > MAX_MERGE_DEPTH) return node.entries;
    const result = node.entries.filter(entry => !isMerge(entry));
    const have = new Set(result.map(entry => entry.key));
    for (const entry of node.entries) {
        if (!isMerge(entry)) continue;
        for (const alias of getMergedNodes(entry)) {
            const mapping = getAliasTarget(alias);
            if (!mapping || mapping.type !== 'object') continue;
            for (const merged of getEffectiveEntries(mapping, depth + 1)) if (!have.has(merged.key)) { have.add(merged.key); result.push({ ...merged, keyStart: entry.keyStart, keyEnd: entry.keyEnd }); }
        }
    }
    return result;
}

/**
 * Returns the data of a model: the root's value, or the list of all documents.
 * @param {DataModel} model - the model.
 * @returns {*} the value of the one document, a list for several documents or JSON Lines, null when empty.
 */
export function getModelValue(model) {
    const docs = model.docs.filter(doc => doc.root);
    if (model.jsonl) return docs.map(doc => getPlainValue(doc.root));
    if (docs.length <= 1) return docs.length ? getPlainValue(docs[0].root) : null;
    return docs.map(doc => getPlainValue(doc.root));
}

/**
 * Returns the keys from the document's root to a node.
 * @param {DataNode} node - the node.
 * @returns {Array<string|number>} the path, empty for the root.
 */
export function getPath(node) {
    const path = [];
    for (let current = node; current && current.entry; current = current.entry.parent) path.unshift(current.entry.key);
    return path;
}

/**
 * Returns the index of the document a node belongs to.
 * @param {DataModel} model - the model.
 * @param {DataNode} node - the node.
 * @returns {number} the document's index, 0 when it is not found.
 */
export function getDocIndex(model, node) {
    let current = node;
    while (current && current.entry) current = current.entry.parent;
    return Math.max(0, model.docs.findIndex(doc => doc.root === current));
}

/**
 * Writes a path as text: $.items[3].name.
 * @param {Array<string|number>} path - the keys.
 * @returns {string} the path in JSONPath notation.
 */
export function formatPath(path) {
    let text = '$';
    for (const key of path) text += typeof key === 'number' ? `[${key}]` : PLAIN_PATH_KEY.test(key) ? '.' + key : `[${JSON.stringify(key)}]`;
    return text;
}

/**
 * Reads a path: "$.a[0]['b c']", "a.b[0]" or "/a/0/b" (JSON Pointer).
 * @param {string} text - the path as the user wrote it.
 * @returns {Array<string|number>|null} the keys, null when the text cannot be read.
 */
export function parsePath(text) {
    let source = String(text ?? '').trim();
    if (!source || source === '$') return [];
    if (source[0] === '/') return source.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~')).map(part => (/^\d+$/.test(part) ? +part : part));
    const path = [];
    let index = 0;
    if (source[0] === '$') index = 1;
    else source = '.' + source;
    while (index < source.length) {
        const step = source[index] === '.' ? readDotStep(source.slice(index)) : source[index] === '[' ? readBracketStep(source.slice(index)) : null;
        if (!step) return null;
        path.push(step.key);
        index += step.length;
    }
    return path;
}

/**
 * Reads one ".key" step of a path.
 * @param {string} rest - the path from the dot on.
 * @returns {{key: string, length: number}|null} the key and the length read, null when unreadable.
 */
function readDotStep(rest) {
    const match = /^\.([^.[\]]+)/.exec(rest);
    return match ? { key: match[1], length: match[0].length } : null;
}

/**
 * Reads one "[3]", "["key"]" or "['key']" step of a path.
 * @param {string} rest - the path from the bracket on.
 * @returns {{key: string|number, length: number}|null} the key and the length read, null when unreadable.
 */
function readBracketStep(rest) {
    let match = /^\[\s*(\d+)\s*\]/.exec(rest);
    if (match) return { key: +match[1], length: match[0].length };
    match = /^\[\s*("(?:[^"\\]|\\.)*")\s*\]/.exec(rest);
    if (match) {
        try { return { key: JSON.parse(match[1]), length: match[0].length }; } catch (error) { return null; }
    }
    match = /^\[\s*'((?:[^'\\]|\\.)*)'\s*\]/.exec(rest);
    if (match) return { key: match[1].replace(/\\(.)/g, '$1'), length: match[0].length };
    return null;
}

/**
 * Returns the node at a path; aliases on the way are followed.
 * @param {DataNode|null} root - the document's root.
 * @param {Array<string|number>} path - the keys.
 * @returns {DataNode|null} the node, null when the path leads nowhere.
 */
export function getNodeAtPath(root, path) {
    let node = root;
    for (const key of path) {
        node = getAliasTarget(node);
        if (!isContainer(node)) return null;
        const entry = node.type === 'array' ? (typeof key === 'number' || /^\d+$/.test(key) ? node.entries[+key] : null) : findKey(node, String(key));
        if (!entry) return null;
        node = entry.node;
    }
    return node;
}

/**
 * Returns the last entry of an object with a key (the one programs keep).
 * @param {DataNode} object - the object node.
 * @param {string} key - the key.
 * @returns {DataEntry|null} the entry, null when the key is not there.
 */
export function findKey(object, key) {
    for (let index = object.entries.length - 1; index >= 0; index--) if (object.entries[index].key === key) return object.entries[index];
    return null;
}

/**
 * Returns the deepest node whose place in the code holds an offset.
 * @param {DataModel} model - the model.
 * @param {number} pos - the offset in the code.
 * @returns {DataNode|null} the node, null when the model has no data.
 */
export function getNodeAtPosition(model, pos) {
    if (model.at) return model.at(pos);          // a format whose tables are written in several places
    const doc = model.docs.find(item => item.root && pos >= item.start && pos <= item.end) || model.docs.find(item => item.root);
    if (!doc || !doc.root) return null;
    let node = doc.root;
    for (;;) {
        if (!isContainer(node)) return node;
        const entry = node.entries.find(item => pos >= item.start && pos <= Math.max(item.node.end, item.keyEnd ?? 0));
        if (!entry) return node;
        node = entry.node;
    }
}

/**
 * Calls a function for every node of a model, parents first, then their entries.
 * @param {DataModel} model - the model.
 * @param {function(DataNode, number, Array<string|number>): void} visit - gets the node, the document's index and the path.
 * @returns {void}
 */
export function runForEachNode(model, visit) {
    model.docs.forEach((doc, docIndex) => {
        /**
         * Visits a node and then its entries.
         * @param {DataNode|null} node - the node.
         * @param {Array<string|number>} path - its path.
         * @returns {void}
         */
        const runOnSubtree = (node, path) => {
            if (!node) return;
            visit(node, docIndex, path);
            if (isContainer(node)) for (const entry of node.entries) runOnSubtree(entry.node, [...path, entry.key]);
        };
        runOnSubtree(doc.root, []);
    });
}
