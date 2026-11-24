/**
 * The shared base of the data tree (datatree.js): the model's shapes, the
 * state that exists once per page (the YAML package, the formats an editor
 * adds, the node ids) and the small node helpers every other part uses.
 */

/** Where the vendored yaml package lives, relative to this file. */
const YAML_LIBRARY_URL = '../vendor/yaml/index.js';

/** The types of a value, in the order the type menus show them. */
export const TYPES = ['string', 'number', 'boolean', 'null', 'object', 'array'];

/** The deepest nesting the parsers read; deeper data would overflow the browser's stack in the parser and the views. */
export const MAX_DEPTH = 1000;

/**
 * A problem of a document: a syntax error, a note or a schema finding.
 * @typedef {object} Problem
 * @property {number} pos - the offset in the code where it starts.
 * @property {number} end - the offset where it ends.
 * @property {'error'|'warn'|'schema'} kind - what kind of problem it is.
 * @property {string} msg - the message for the user.
 */

/**
 * A value in the tree with its place in the code.
 * @typedef {object} DataNode
 * @property {number} id - unique in the page, for the rows of the tree.
 * @property {'object'|'array'|'string'|'number'|'boolean'|'null'|'alias'} type - the kind of value.
 * @property {*} value - the plain value of a scalar, the name of an alias.
 * @property {string} [raw] - the code of a number or a YAML scalar as written.
 * @property {number} start - the offset of the value in the code.
 * @property {number} end - the offset after the value.
 * @property {DataEntry[]|null} entries - the members of an object or array.
 * @property {DataEntry|null} entry - the entry that holds the node, null for a root.
 * @property {string} [anchor] - a YAML anchor (&name).
 * @property {string} [tag] - a YAML tag written in the code (!!str, !custom).
 * @property {string} [style] - the YAML scalar style (PLAIN, QUOTE_DOUBLE …), 'datetime' for a TOML date.
 * @property {boolean} [flow] - a YAML collection written with brackets.
 * @property {boolean} [merge] - a YAML mapping, where `<<` merges other mappings.
 * @property {boolean} [empty] - a YAML value with no code (`key:` alone).
 * @property {DataNode|null} [target] - the anchored node an alias stands for.
 */

/**
 * A member of an object or array.
 * @typedef {object} DataEntry
 * @property {string|number} key - the name in an object, the position in an array.
 * @property {number} [keyStart] - the offset of the key in the code.
 * @property {number} [keyEnd] - the offset after the key.
 * @property {number} start - the offset where the entry starts (key or `-`).
 * @property {DataNode} node - the value.
 * @property {DataNode} parent - the object or array the entry belongs to.
 * @property {number} index - the position among the parent's entries.
 * @property {boolean} [bare] - a JSON5 key written without quotes.
 * @property {string} [keyStyle] - the YAML style of the key.
 * @property {boolean} [complexKey] - a YAML key that is a collection.
 */

/**
 * One document of a model.
 * @typedef {object} DataDocument
 * @property {DataNode|null} root - the top value, null for an empty document.
 * @property {number} start - the offset where the document starts.
 * @property {number} end - the offset where it ends.
 * @property {string} [label] - the name shown in the tree (JSON Lines: "Line 3").
 * @property {number} [line] - the line of a JSON Lines record.
 * @property {boolean} [broken] - the document has a syntax error.
 */

/**
 * A parsed document with all its parts and problems.
 * @typedef {object} DataModel
 * @property {string} format - 'json', 'yaml' or an added format such as 'toml'.
 * @property {DataDocument[]} docs - the documents, one for JSON.
 * @property {Problem[]} problems - errors and notes, sorted by place.
 * @property {boolean} broken - a syntax error stopped the reading.
 * @property {boolean} [jsonl] - JSON Lines, one document per line.
 * @property {string} [dialect] - 'json', 'jsonc' or 'json5'.
 * @property {number} [comments] - the number of comments in JSON.
 * @property {number} count - the number of values read.
 * @property {string} [src] - the code the model is read from.
 * @property {function(number): DataNode|null} [at] - the node at an offset, for formats that write a table in several places.
 */

/**
 * What a further format (TOML) brings to the tree; the property names are the contract with the format's module.
 * @typedef {object} FormatImplementation
 * @property {function(string): DataModel} parse - reads the code.
 * @property {function(string, TreeEdit): EditResult} applyEdit - one change from the tree as new code.
 * @property {function(string): string} highlight - the colored code as HTML.
 * @property {function(string, *): string} [mergeInto] - adds data to the root of the code.
 * @property {function(string, Array<object>): string[]} [findTemplateRoles] - the role of each template tag
 *   of the code (text, value, key or section; datatree-template.js).
 * @property {function(string, Array<object>): Array<object>} [findTemplatePlaces] - the role of each template
 *   tag with the kind of text it stands in (datatree-template-roles.js TagPlace).
 * @property {function(string, object, string, string): string} [writeTemplateFill] - writes an example for the
 *   place of a value tag in the format (datatree-examples.js FillWriter).
 */

/**
 * One change made in the tree; `kind` says which fields are used.
 * @typedef {object} TreeEdit
 * @property {'value'|'key'|'type'|'add'|'duplicate'|'move'|'remove'} kind - the kind of change.
 * @property {DataNode} [node] - 'value', 'type': the node that changes.
 * @property {*} [value] - 'value', 'add': the new value (any JSON value).
 * @property {string} [raw] - 'value': a number as the user typed it, kept when it means the same number.
 * @property {boolean} [block] - 'value': write a YAML collection in block style.
 * @property {string} [type] - 'type': string, number, boolean, null, object or array.
 * @property {DataEntry} [entry] - 'key', 'duplicate', 'move', 'remove': the entry.
 * @property {string} [key] - 'key', 'add': the new key.
 * @property {DataNode} [box] - 'add': the object or array that gets the entry.
 * @property {number} [at] - 'add': the index of the new entry.
 * @property {number} [by] - 'move': -1 one place up, 1 one place down.
 */

/**
 * The new code after a change, and what to select afterwards.
 * @typedef {object} EditResult
 * @property {string} code - the whole new code.
 * @property {Array<string|number>} path - the keys of the node to select, from the document's root.
 */

let yamlLibrary = null;
const addedFormats = Object.create(null);
let nextNodeId = 1;

/**
 * Loads the vendored yaml package once (the JSON Editor needs it only to convert).
 * @returns {Promise<object>} the yaml package's module.
 */
export async function importYamlLibrary() {
    if (!yamlLibrary) yamlLibrary = await import(YAML_LIBRARY_URL);
    return yamlLibrary;
}

/**
 * Returns the yaml package when it is loaded.
 * @returns {object|null} the yaml package's module, null until importYamlLibrary() has run.
 */
export const getYamlLibrary = () => yamlLibrary;

/**
 * Registers a further format (TOML, by toml.js) with its own parse, applyEdit and highlight.
 * @param {string} name - the format's name, as passed to parse() and editCode().
 * @param {FormatImplementation} implementation - the format's functions.
 * @returns {void}
 */
export function addFormat(name, implementation) { addedFormats[name] = implementation; }

/**
 * Returns the implementation of an added format.
 * @param {string} name - the format's name.
 * @returns {FormatImplementation|undefined} the implementation, undefined for JSON and YAML.
 */
export const getAddedFormat = name => addedFormats[name];

/**
 * Creates a node without value; the parser fills in the rest.
 * @param {string} type - the node's type.
 * @param {number} start - the offset of the value in the code.
 * @returns {DataNode} the new node, with end = start.
 */
export function createNode(type, start) { return { id: nextNodeId++, type, start, end: start, entries: null, entry: null }; }

/**
 * Tells whether a node is an object or an array.
 * @param {DataNode|null|undefined} node - the node.
 * @returns {boolean} true for an object or array.
 */
export const isContainer = node => !!node && (node.type === 'object' || node.type === 'array');

/**
 * Returns the node an alias stands for, or the node itself.
 * @param {DataNode|null|undefined} node - the node.
 * @returns {DataNode|null|undefined} the alias target (null when it has none), else the node.
 */
export const getAliasTarget = node => (node && node.type === 'alias' ? node.target : node);

/**
 * Sets an own property of an object, also for keys like "__proto__".
 * @param {object} object - the object to change.
 * @param {string} key - the property name.
 * @param {*} value - the value.
 * @returns {void}
 */
export function setOwnProperty(object, key, value) {
    if (key === '__proto__') Object.defineProperty(object, key, { value, enumerable: true, writable: true, configurable: true });
    else object[key] = value;
}

/**
 * Tells whether an entry is a YAML merge key (`<<: *anchor` or `<<: [*a, *b]`) of a mapping.
 * @param {DataNode} mapping - the mapping that holds the entry.
 * @param {DataEntry} entry - the entry.
 * @returns {boolean} true for a merge key whose value is an alias or a list of aliases.
 */
export function isMergeEntry(mapping, entry) {
    if (!mapping.merge || entry.key !== '<<') return false;
    const node = entry.node;
    return node.type === 'alias' || (node.type === 'array' && node.entries.every(item => item.node.type === 'alias'));
}

/**
 * Returns the nodes a merge key brings in: the alias, or every alias of its list.
 * @param {DataEntry} entry - a merge entry (isMergeEntry).
 * @returns {DataNode[]} the alias nodes.
 */
export const getMergedNodes = entry => (entry.node.type === 'array' ? entry.node.entries.map(item => item.node) : [entry.node]);
