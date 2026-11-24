/**
 * The YAML reader of the data tree: the model of datatree-json.js from the
 * vendored yaml package (YAML 1.2, several documents with ---, anchors and
 * aliases, merge keys, comments kept in the code).
 *
 * parseYaml runs these steps:
 * 1. let the yaml package read every document;
 * 2. turn its errors and warnings into problems with their place;
 * 3. build the nodes of each document, following anchors to their aliases;
 * 4. report tabs used for indentation, which the package reports only in part.
 */

import { getYamlLibrary, createNode } from './datatree-core.js?v=3';

/** The messages for the yaml package's error codes. */
const YAML_MESSAGES = {
    DUPLICATE_KEY: key => `The key "${key}" is twice in this mapping - most programs keep only the last one`,
    TAB_AS_INDENT: () => 'A tab is used for indentation - YAML only allows spaces there',
    BAD_INDENT: () => 'The indentation does not fit here - entries of one level start in the same column',
    BLOCK_AS_IMPLICIT_KEY: () => 'A mapping cannot start on the same line as its key - put it on the next line, indented',
    MULTILINE_IMPLICIT_KEY: () => 'A key must be on one line - did a ":" or a quote go missing?',
    MISSING_CHAR: () => 'A closing character is missing (a quote, ] or })',
    MULTIPLE_ANCHORS: () => 'A value can only have one anchor',
    MULTIPLE_TAGS: () => 'A value can only have one tag',
    MULTIPLE_DOCS: () => 'Several documents need --- between them',
    BAD_SCALAR_START: () => 'A plain value cannot start with this character - put the value in quotes',
    TAG_RESOLVE_FAILED: () => 'The value does not fit its tag',
    BAD_ALIAS: () => 'This alias is not valid',
    UNEXPECTED_TOKEN: () => 'Unexpected text here - check the indentation, a missing ":" or "-", or quotes',
    ALIAS_PROPS: () => 'An alias cannot have an anchor or a tag',
};
/** The deepest nesting of one document whose nodes are built. */
const MAX_YAML_DEPTH = 400;
/** How many characters of a duplicate key the message quotes. */
const KEY_QUOTE_LENGTH = 60;
/** How far back from a value a written tag is looked for. */
const TAG_LOOKBACK = 40;
/** How many tab indentations are reported. */
const MAX_TAB_PROBLEMS = 1;

/**
 * Returns the first line of a message of the yaml package, without "at line …".
 * @param {string} message - the package's message.
 * @returns {string} the short message.
 */
const getYamlText = message => String(message || '').split('\n')[0].replace(/ at line \d+, column \d+:?$/, '').trim();

/**
 * Reads YAML into a model with the place of every value.
 * @param {string} src - the code.
 * @returns {DataModel} the model with one document per YAML document.
 * @throws {Error} when the yaml package is not loaded (importYamlLibrary() first).
 */
export function parseYaml(src) {
    const YAML = getYamlLibrary();
    if (!YAML) throw new Error('importYamlLibrary() first');
    const problems = [];
    let list;
    try {
        list = YAML.parseAllDocuments(src, { uniqueKeys: true, merge: true, prettyErrors: false });
    } catch (error) {
        return { format: 'yaml', docs: [], problems: [{ pos: 0, end: 0, kind: 'error', msg: 'The YAML parser stopped: ' + getYamlText(error.message) }], broken: true, count: 0 };
    }
    let broken = false;
    const counter = { count: 0 };
    const docs = [];
    for (const yamlDoc of Array.from(list)) {
        const documentProblems = getDocumentProblems(src, yamlDoc);
        problems.push(...documentProblems);
        if (documentProblems.some(problem => problem.kind === 'error')) broken = true;
        const builder = createNodeBuilder(YAML, src, problems, counter);
        let root = null;
        try { root = yamlDoc.contents ? builder(yamlDoc.contents, 0) : null; } catch (error) { broken = true; problems.push({ pos: 0, end: 0, kind: 'error', msg: 'The data is nested too deeply' }); }
        docs.push({ root, start: yamlDoc.range[0], end: yamlDoc.range[2] });
    }
    if (!docs.length) {
        docs.push({ root: null, start: 0, end: src.length });
        if (!src.trim()) problems.push({ pos: 0, end: 0, kind: 'warn', msg: 'The document is empty' });
    }
    const tabProblems = getTabProblems(src, problems);
    problems.push(...tabProblems);
    if (tabProblems.length) broken = true;
    problems.sort((a, b) => a.pos - b.pos);
    return { format: 'yaml', docs, problems, broken, count: counter.count };
}

/**
 * Returns the errors and warnings of one document of the yaml package as problems. A duplicate
 * key is a warning; every other error makes the document broken.
 * @param {string} src - the code.
 * @param {object} yamlDoc - a document of the yaml package.
 * @returns {Problem[]} the problems in the order the package reports them.
 */
function getDocumentProblems(src, yamlDoc) {
    const problems = [];
    for (const error of yamlDoc.errors) {
        const pos = error.pos ? error.pos[0] : 0, end = error.pos ? error.pos[1] : pos + 1;
        if (error.code === 'DUPLICATE_KEY') {
            const key = src.slice(pos, end).replace(/^["']|["']$/g, '').slice(0, KEY_QUOTE_LENGTH);
            problems.push({ pos, end, kind: 'warn', msg: YAML_MESSAGES.DUPLICATE_KEY(key) });
            continue;
        }
        const getMessage = YAML_MESSAGES[error.code];
        problems.push({ pos, end, kind: 'error', msg: getMessage ? getMessage() : 'YAML: ' + getYamlText(error.message) });
    }
    for (const warning of yamlDoc.warnings) {
        const pos = warning.pos ? warning.pos[0] : 0;
        problems.push({ pos, end: warning.pos ? warning.pos[1] : pos + 1, kind: 'warn', msg: 'YAML: ' + getYamlText(warning.message) });
    }
    return problems;
}

/**
 * Returns an error for each of the first tabs used for indentation that the yaml package did not report.
 * @param {string} src - the code.
 * @param {Problem[]} reported - the problems found so far.
 * @returns {Problem[]} the errors to add, empty when every such tab is reported.
 */
function getTabProblems(src, reported) {
    const pattern = /^( *)\t/gm;
    const added = [];
    let match, tabs = 0;
    while ((match = pattern.exec(src)) && tabs < MAX_TAB_PROBLEMS) {
        const pos = match.index + match[1].length;
        if (!reported.some(problem => problem.pos === pos)) added.push({ pos, end: pos + 1, kind: 'error', msg: YAML_MESSAGES.TAB_AS_INDENT() });
        tabs++;
    }
    return added;
}

/**
 * Counts the nodes built in all documents.
 * @typedef {object} NodeCounter
 * @property {number} count - the number so far.
 */

/**
 * Creates the function that builds the nodes of one YAML document; anchors are known only within it.
 * @param {object} YAML - the yaml package.
 * @param {string} src - the code.
 * @param {Problem[]} problems - the list for aliases without anchor.
 * @param {NodeCounter} counter - counts every node built.
 * @returns {function(object, number): DataNode} builds the node of a package node at a depth.
 */
function createNodeBuilder(YAML, src, problems, counter) {
    const anchors = new Map();

    /**
     * Builds the node of a node of the yaml package, with its entries.
     * @param {object} yamlNode - the package's node.
     * @param {number} depth - the nesting depth.
     * @returns {DataNode} the node.
     * @throws {Error} when the data is nested deeper than MAX_YAML_DEPTH.
     */
    function buildNode(yamlNode, depth) {
        if (depth > MAX_YAML_DEPTH) throw new Error('nested too deeply');
        let node;
        if (YAML.isAlias(yamlNode)) node = buildAlias(yamlNode);
        else if (YAML.isScalar(yamlNode)) node = buildScalar(yamlNode);
        else if (YAML.isMap(yamlNode) || YAML.isSeq(yamlNode)) node = buildCollection(yamlNode, depth);
        else {
            node = createNode('null', yamlNode && yamlNode.range ? yamlNode.range[0] : 0);
            node.value = null;
        }
        if (yamlNode.anchor) { node.anchor = yamlNode.anchor; anchors.set(yamlNode.anchor, node); }
        if (yamlNode.tag && !YAML.isAlias(yamlNode) && /^!/.test(src.slice(Math.max(0, node.start - TAG_LOOKBACK), node.start).split(/\s/).filter(Boolean).pop() || '')) node.tag = yamlNode.tag.replace(/^tag:yaml\.org,2002:/, '!!');
        counter.count++;
        return node;
    }

    /**
     * Builds an alias node and links it to its anchor.
     * @param {object} yamlNode - the package's alias.
     * @returns {DataNode} the alias node.
     */
    function buildAlias(yamlNode) {
        const node = createNode('alias', yamlNode.range[0]);
        node.end = yamlNode.range[1];
        node.value = yamlNode.source;
        node.target = anchors.get(yamlNode.source) || null;
        if (!node.target) problems.push({ pos: node.start, end: node.end, kind: 'error', msg: `The alias *${yamlNode.source} has no anchor &${yamlNode.source} before it` });
        return node;
    }

    /**
     * Builds the node of a scalar with its type, style and code.
     * @param {object} yamlNode - the package's scalar.
     * @returns {DataNode} the scalar's node.
     */
    function buildScalar(yamlNode) {
        const value = yamlNode.value;
        const type = value === null || value === undefined ? 'null' : typeof value === 'boolean' ? 'boolean' : typeof value === 'number' || typeof value === 'bigint' ? 'number' : 'string';
        const node = createNode(type, yamlNode.range[0]);
        node.value = type === 'null' ? null : type === 'number' ? Number(value) : type === 'string' ? (typeof value === 'string' ? value : String(value)) : value;
        node.style = yamlNode.type;
        let end = yamlNode.range[1];
        // A block scalar ends with its last line; the line break after it belongs to what follows.
        if (yamlNode.type === 'BLOCK_LITERAL' || yamlNode.type === 'BLOCK_FOLDED') while (end > node.start && /[\r\n]/.test(src[end - 1])) end--;
        node.end = end;
        node.raw = src.slice(node.start, end);
        if (yamlNode.range[0] === yamlNode.range[1]) node.empty = true;
        return node;
    }

    /**
     * Builds a mapping or sequence with its entries.
     * @param {object} yamlNode - the package's map or seq.
     * @param {number} depth - the nesting depth.
     * @returns {DataNode} the object or array node.
     */
    function buildCollection(yamlNode, depth) {
        const isMap = YAML.isMap(yamlNode);
        const node = createNode(isMap ? 'object' : 'array', yamlNode.range[0]);
        node.entries = [];
        node.flow = !!yamlNode.flow;
        node.merge = isMap;
        if (yamlNode.anchor) anchors.set(yamlNode.anchor, node);
        yamlNode.items.forEach((item, index) => {
            const entry = isMap ? buildMapEntry(node, item, index, depth) : buildSeqEntry(node, yamlNode, item, index, depth);
            entry.node.entry = entry;
            node.entries.push(entry);
        });
        if (yamlNode.flow) node.end = yamlNode.range[1];
        else node.end = node.entries.length ? Math.max(...node.entries.map(entry => entry.node.end), node.start) : yamlNode.range[1];
        return node;
    }

    /**
     * Builds an entry of a mapping: its key, its place and its value.
     * @param {DataNode} parent - the mapping's node.
     * @param {object} pair - the package's pair.
     * @param {number} index - the entry's position.
     * @param {number} depth - the mapping's depth.
     * @returns {DataEntry} the entry.
     */
    function buildMapEntry(parent, pair, index, depth) {
        const key = pair.key;
        const entry = { key: '', parent, index };
        if (key && YAML.isScalar(key)) {
            entry.key = key.value === null || key.value === undefined ? '' : typeof key.value === 'symbol' ? '<<' : String(key.value);      // the merge key << is a symbol
            entry.keyStart = key.range[0];
            entry.keyEnd = key.range[1];
            entry.keyStyle = key.type;
        } else if (key) {
            entry.key = src.slice(key.range[0], key.range[1]);
            entry.keyStart = key.range[0];
            entry.keyEnd = key.range[1];
            entry.complexKey = true;
        } else {
            const at = pair.value && pair.value.range ? pair.value.range[0] : parent.start;
            entry.keyStart = entry.keyEnd = at;
        }
        entry.start = entry.keyStart;
        if (pair.value) entry.node = buildNode(pair.value, depth + 1);
        else entry.node = createEmptyNode(getColonEnd(src, entry.keyEnd));
        return entry;
    }

    /**
     * Builds an entry of a sequence: its value and the place of its "-".
     * @param {DataNode} parent - the sequence's node.
     * @param {object} yamlNode - the package's sequence.
     * @param {object|null} item - the package's item.
     * @param {number} index - the entry's position.
     * @param {number} depth - the sequence's depth.
     * @returns {DataEntry} the entry.
     */
    function buildSeqEntry(parent, yamlNode, item, index, depth) {
        const entry = { key: index, parent, index };
        entry.node = item ? buildNode(item, depth + 1) : createEmptyNode(parent.start);
        entry.start = yamlNode.flow ? entry.node.start : getDashStart(src, entry.node.start);
        return entry;
    }

    return buildNode;
}

/**
 * Creates the null node of an entry without value.
 * @param {number} start - the offset of the missing value.
 * @returns {DataNode} an empty null node.
 */
function createEmptyNode(start) {
    const node = createNode('null', start);
    node.value = null;
    node.empty = true;
    node.raw = '';
    return node;
}

/**
 * Returns the position after the ":" that follows a key.
 * @param {string} src - the code.
 * @param {number} keyEnd - the offset after the key.
 * @returns {number} the offset after the colon, or keyEnd when none follows.
 */
export function getColonEnd(src, keyEnd) {
    let index = keyEnd;
    while (index < src.length && (src[index] === ' ' || src[index] === '\t')) index++;
    return src[index] === ':' ? index + 1 : keyEnd;
}

/**
 * Returns the "-" of a block sequence item in front of its value.
 * @param {string} src - the code.
 * @param {number} valueStart - the offset of the item's value.
 * @returns {number} the offset of the dash, or valueStart when there is none on the line.
 */
function getDashStart(src, valueStart) {
    for (let index = valueStart - 1; index >= 0 && src[index] !== '\n'; index--) {
        if (src[index] === '-' && (index === 0 || /\s/.test(src[index - 1])) && /\s/.test(src[index + 1] || ' ')) return index;
    }
    return valueStart;
}
