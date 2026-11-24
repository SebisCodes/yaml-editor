/**
 * The JSON Schema check of the data tree (the common keywords of drafts 4 to
 * 2020-12): the problems of a document's data against a schema the user chose.
 *
 * getSchemaProblems runs these steps:
 * 1. expand the data once, so data whose aliases grow past the limit is
 *    reported as "not checked" and the page does not freeze;
 * 2. walk the data and the schema together, keyword group by keyword group
 *    (references, type, enum / const, strings, numbers, objects, arrays,
 *    allOf / anyOf / oneOf / not / if);
 * 3. stop with "not checked" when the walk needs more than a million steps
 *    (aliases and a schema that refers to itself can make it exponential).
 *
 * In a template (datatree-template.js) a value is checked once it is filled: a value written
 * with a placeholder matches every schema, a string that holds a tag is checked for its type,
 * a key that holds a tag for nothing; the counts and combinations that depend on such a value,
 * a key or a section (required, items and keys counted, uniqueItems, contains, oneOf, not, if)
 * are checked on what the template fixes.
 */

import { getAliasTarget } from './datatree-core.js?v=3';
import { VALUE_LIMIT, TooManyValues, getPlainValue, getEffectiveEntries } from './datatree-values.js?v=4';

/** The checks of the "format" keyword. */
const FORMATS = {
    email: text => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text),
    date: text => /^\d{4}-\d{2}-\d{2}$/.test(text) && !isNaN(Date.parse(text + 'T00:00:00Z')),
    'date-time': text => /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?([Zz]|[+-]\d{2}:\d{2})$/.test(text) && !isNaN(Date.parse(text)),
    time: text => /^\d{2}:\d{2}(:\d{2}(\.\d+)?)?([Zz]|[+-]\d{2}:\d{2})?$/.test(text),
    uri: text => /^[A-Za-z][A-Za-z0-9+.-]*:[^\s]*$/.test(text),
    'uri-reference': text => !/\s/.test(text),
    uuid: text => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text),
    ipv4: text => /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(text),
    hostname: text => /^(?=.{1,253}$)([A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/.test(text),
};
/** At most this many problems are reported. */
const MAX_PROBLEMS = 300;
/** How deep the schema is followed. */
const MAX_SCHEMA_DEPTH = 60;
/** How long a list of allowed values in a message may be. */
const LIST_TEXT_LENGTH = 160;
/** How many characters of a node a problem marks at most. */
const MARK_LENGTH = 200;
/** How many characters of an outside reference a message quotes. */
const REFERENCE_QUOTE_LENGTH = 80;
/** How close two numbers count as equal for multipleOf. */
const MULTIPLE_TOLERANCE = 1e-9;
/**
 * A pattern with a repeated group that repeats inside, like ^(a+)+$: JavaScript's matcher can take
 * exponential time on a long text that almost matches. Such a pattern is only tried on short texts.
 */
const NESTED_REPEAT = /\((?:[^()\\]|\\.)*(?:[+*]|\{\d+,\d*\})(?:[^()\\]|\\.)*\)(?:[+*]|\{\d+,\d*\})/;
const RISKY_LENGTH = 24;

/**
 * Tells whether a pattern may take very long on a text.
 * @param {string} pattern - the regular expression's source.
 * @param {string} text - the text it would be tried on.
 * @returns {boolean} true for a nested repetition on a text longer than RISKY_LENGTH.
 */
const isRiskyPattern = (pattern, text) => text.length > RISKY_LENGTH && NESTED_REPEAT.test(pattern);

/**
 * Writes values as a short list for a message.
 * @param {Array<*>} values - the values.
 * @returns {string} the values as JSON, separated by commas, at most LIST_TEXT_LENGTH characters.
 */
const formatValueList = values => values.map(value => JSON.stringify(value)).join(', ').slice(0, LIST_TEXT_LENGTH);

/**
 * Tells whether two plain values are equal, deeply.
 * @param {*} a - one value.
 * @param {*} b - the other value.
 * @returns {boolean} true when both hold the same data.
 */
function isDeepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) return a.length === b.length && a.every((item, index) => isDeepEqual(item, b[index]));
    const keysA = Object.keys(a), keysB = Object.keys(b);
    return keysA.length === keysB.length && keysA.every(key => Object.prototype.hasOwnProperty.call(b, key) && isDeepEqual(a[key], b[key]));
}

/**
 * Returns the problems of the data against a schema.
 * @param {DataNode|null} root - the document's root.
 * @param {*} schema - the schema as a plain value.
 * @returns {Problem[]} the problems (kind 'schema'), at most MAX_PROBLEMS, or one "not checked" problem.
 */
export function getSchemaProblems(root, schema) {
    const problems = [];
    const budget = { left: VALUE_LIMIT };
    const told = new Set();
    const templateParts = new WeakMap();
    /**
     * Returns the single problem that says the data is not checked.
     * @param {string} reason - why.
     * @returns {Problem[]} a list with that one problem.
     */
    const getNotChecked = reason => [{ pos: root ? root.start : 0, end: root ? root.start + 1 : 0, kind: 'schema', msg: 'Schema: not checked - ' + reason }];
    try { getPlainValue(root); } catch (error) {
        if (!(error instanceof TooManyValues)) throw error;
        return getNotChecked(error.message.replace(/^T/, 't'));
    }

    /**
     * Returns the schema a $ref points to inside the schema.
     * @param {*} reference - the value of $ref.
     * @returns {*} the schema there; true (anything allowed) for an outside or unknown reference; null when $ref is no text.
     */
    function getReferencedSchema(reference) {
        if (typeof reference !== 'string') return null;
        if (!reference.startsWith('#')) {
            if (!told.has('ext')) { told.add('ext'); problems.push({ pos: root ? root.start : 0, end: root ? root.start + 1 : 0, kind: 'schema', msg: `Schema: the schema refers to another file (${reference.slice(0, REFERENCE_QUOTE_LENGTH)}) - only references inside the schema are followed` }); }
            return true;
        }
        let target = schema;
        for (const part of reference.slice(1).split('/').filter(Boolean)) {
            let key;
            try { key = decodeURIComponent(part).replace(/~1/g, '/').replace(/~0/g, '~'); } catch (error) { return true; }   // "#/%": not a reference
            if (!target || typeof target !== 'object' || !Object.hasOwn(target, key)) return true;
            target = target[key];
        }
        return target;
    }

    /**
     * Adds a problem of a node, up to MAX_PROBLEMS.
     * @param {DataNode} node - the node it concerns.
     * @param {string} message - what is wrong.
     * @param {number} [pos] - the offset to mark, else the node's start.
     * @param {number} [end] - the end of the mark, else the node's end (at most MARK_LENGTH characters).
     * @returns {void}
     */
    const addProblem = (node, message, pos, end) => { if (problems.length < MAX_PROBLEMS) problems.push({ pos: pos ?? node.start, end: end ?? Math.max(node.start + 1, Math.min(node.end, node.start + MARK_LENGTH)), kind: 'schema', msg: 'Schema: ' + message }); };

    /**
     * Checks a node against a schema and reports every problem.
     * @param {DataNode} node - the node.
     * @param {*} subschema - the schema for it.
     * @param {number} depth - how deep in the schema.
     * @param {function(DataNode, string, number=, number=): void|null} sink - gets the problems; null: addProblem.
     * @returns {void}
     * @throws {TooManyValues} past the step budget.
     */
    function checkNode(node, subschema, depth, sink) {
        if (--budget.left < 0) throw new TooManyValues();
        if (subschema === true || subschema === undefined || subschema === null) return;
        if ((getAliasTarget(node) || node).placeholder === 'value') return;
        if (depth > MAX_SCHEMA_DEPTH) return;
        const tell = sink || addProblem;
        if (subschema === false) { tell(node, 'no value is allowed here'); return; }
        if (typeof subschema !== 'object') return;
        // A reference to false is checked too (no value allowed); null: not followed.
        if (subschema.$ref) {
            const target = getReferencedSchema(subschema.$ref);
            if (target !== null && target !== subschema) checkNode(node, target, depth + 1, sink);
            if (!('type' in subschema) && Object.keys(subschema).length === 1) return;
        }
        const resolved = getAliasTarget(node) || node;
        const value = getPlainValue(resolved, new Set(), budget);
        const type = resolved.type === 'alias' ? 'null' : resolved.type;
        const check = { node, resolved, value, type, schema: subschema, depth, sink, tell };
        if (!checkType(check)) return;
        if (resolved.placeholder !== 'text') checkValueKeywords(check);
        if (type === 'string' && resolved.placeholder !== 'text') checkStringKeywords(check);
        if (type === 'number') checkNumberKeywords(check);
        if (type === 'object') checkObjectKeywords(check);
        if (type === 'array') checkArrayKeywords(check);
        checkCombinators(check);
    }

    /**
     * What every keyword group gets: the node, its value and the schema.
     * @typedef {object} SchemaCheck
     * @property {DataNode} node - the node as found (an alias stays an alias).
     * @property {DataNode} resolved - the node an alias stands for.
     * @property {*} value - its plain value.
     * @property {string} type - its type (an alias without target: 'null').
     * @property {object} schema - the schema.
     * @property {number} depth - how deep in the schema.
     * @property {function|null} sink - passed on to deeper checks.
     * @property {function(DataNode, string, number=, number=): void} tell - reports a problem.
     */

    /**
     * Checks the "type" keyword.
     * @param {SchemaCheck} check - the node and the schema.
     * @returns {boolean} true when the type fits and the other keywords are checked.
     */
    function checkType({ node, value, type, schema: subschema, tell }) {
        if (subschema.type === undefined) return true;
        const wanted = Array.isArray(subschema.type) ? subschema.type : [subschema.type];
        const fits = wanted.some(name => name === type || (name === 'integer' && type === 'number' && Number.isInteger(value)) || (name === 'number' && type === 'number'));
        if (!fits) tell(node, `the type must be ${wanted.join(' or ')} (it is ${type === 'number' && Number.isInteger(value) ? 'integer' : type})`);
        return fits;
    }

    /**
     * Checks "enum" and "const".
     * @param {SchemaCheck} check - the node and the schema.
     * @returns {void}
     */
    function checkValueKeywords({ node, value, schema: subschema, tell }) {
        if (subschema.enum && Array.isArray(subschema.enum) && !subschema.enum.some(item => isDeepEqual(item, value))) tell(node, `must be one of ${formatValueList(subschema.enum)} (enum)`);
        if ('const' in subschema && !isDeepEqual(subschema.const, value)) tell(node, `must be ${formatValueList([subschema.const])} (const)`);
    }

    /**
     * Checks minLength, maxLength, pattern and format of a string.
     * @param {SchemaCheck} check - the node and the schema.
     * @returns {void}
     */
    function checkStringKeywords({ node, value, schema: subschema, tell }) {
        const length = [...value].length;
        if (typeof subschema.minLength === 'number' && length < subschema.minLength) tell(node, `at least ${subschema.minLength} characters (minLength)`);
        if (typeof subschema.maxLength === 'number' && length > subschema.maxLength) tell(node, `at most ${subschema.maxLength} characters (maxLength)`);
        if (typeof subschema.pattern === 'string') {
            if (isRiskyPattern(subschema.pattern, value)) tell(node, `the pattern ${subschema.pattern} is not checked on this long text - it repeats a repeated group, which can take very long (pattern)`);
            else { try { if (!new RegExp(subschema.pattern, 'u').test(value)) tell(node, `must match the pattern ${subschema.pattern} (pattern)`); } catch (error) { /* a pattern JavaScript cannot read is skipped */ } }
        }
        if (typeof subschema.format === 'string' && Object.hasOwn(FORMATS, subschema.format) && !FORMATS[subschema.format](value)) tell(node, `not a valid ${subschema.format} (format)`);
    }

    /**
     * Checks the limits of a number (drafts 4 and later: exclusive limits as booleans or numbers).
     * @param {SchemaCheck} check - the node and the schema.
     * @returns {void}
     */
    function checkNumberKeywords({ node, value, schema: subschema, tell }) {
        const exclusiveMinimum = typeof subschema.exclusiveMinimum === 'number' ? subschema.exclusiveMinimum : subschema.exclusiveMinimum === true ? subschema.minimum : undefined;
        const exclusiveMaximum = typeof subschema.exclusiveMaximum === 'number' ? subschema.exclusiveMaximum : subschema.exclusiveMaximum === true ? subschema.maximum : undefined;
        if (typeof subschema.minimum === 'number' && subschema.exclusiveMinimum !== true && value < subschema.minimum) tell(node, `must be at least ${subschema.minimum} (minimum)`);
        if (typeof subschema.maximum === 'number' && subschema.exclusiveMaximum !== true && value > subschema.maximum) tell(node, `must be at most ${subschema.maximum} (maximum)`);
        if (typeof exclusiveMinimum === 'number' && value <= exclusiveMinimum) tell(node, `must be greater than ${exclusiveMinimum} (exclusiveMinimum)`);
        if (typeof exclusiveMaximum === 'number' && value >= exclusiveMaximum) tell(node, `must be less than ${exclusiveMaximum} (exclusiveMaximum)`);
        if (typeof subschema.multipleOf === 'number' && subschema.multipleOf > 0 && Math.abs(value / subschema.multipleOf - Math.round(value / subschema.multipleOf)) > MULTIPLE_TOLERANCE) tell(node, `must be a multiple of ${subschema.multipleOf} (multipleOf)`);
    }

    /**
     * Checks the keys of a mapping as YAML reads it: its own keys, then those a merge key brings in.
     * @param {SchemaCheck} check - the node and the schema.
     * @returns {void}
     */
    function checkObjectKeywords({ node, resolved, schema: subschema, depth, sink, tell }) {
        const entries = getEffectiveEntries(resolved);
        const keys = entries.map(entry => entry.key);
        if (resolved.repeated || entries.some(entry => entry.placeholderKey)) { checkPropertyValues(entries, subschema, depth, sink, tell); return; }
        if (Array.isArray(subschema.required)) for (const key of subschema.required) if (!keys.includes(key)) tell(node, `"${key}" is missing (required)`, resolved.start, resolved.start + 1);
        if (typeof subschema.minProperties === 'number' && keys.length < subschema.minProperties) tell(node, `at least ${subschema.minProperties} keys (minProperties)`);
        if (typeof subschema.maxProperties === 'number' && keys.length > subschema.maxProperties) tell(node, `at most ${subschema.maxProperties} keys (maxProperties)`);
        if (subschema.dependentRequired && typeof subschema.dependentRequired === 'object') {
            for (const [key, needed] of Object.entries(subschema.dependentRequired)) if (keys.includes(key) && Array.isArray(needed)) for (const other of needed) if (!keys.includes(other)) tell(node, `"${key}" needs "${other}" as well (dependentRequired)`, resolved.start, resolved.start + 1);
        }
        checkPropertyValues(entries, subschema, depth, sink, tell);
    }

    /**
     * Checks every entry with a fixed key against properties, patternProperties, additionalProperties
     * and propertyNames; a key that holds a template tag is checked once it is filled.
     * @param {DataEntry[]} entries - the entries.
     * @param {object} subschema - the mapping's schema.
     * @param {number} depth - how deep in the schema.
     * @param {function|null} sink - passed on to deeper checks.
     * @param {function(DataNode, string, number=, number=): void} tell - reports a problem.
     * @returns {void}
     */
    function checkPropertyValues(entries, subschema, depth, sink, tell) {
        const properties = subschema.properties && typeof subschema.properties === 'object' ? subschema.properties : {};
        const patterns = subschema.patternProperties && typeof subschema.patternProperties === 'object' ? Object.entries(subschema.patternProperties).map(([pattern, patternSchema]) => { try { return [new RegExp(pattern, 'u'), patternSchema]; } catch (error) { return null; } }).filter(Boolean) : [];
        for (const entry of entries) if (!entry.placeholderKey) checkProperty(entry, properties, patterns, { schema: subschema, depth, sink, tell });
    }

    /**
     * Checks one entry of a mapping: properties, patternProperties, additionalProperties and propertyNames.
     * @param {DataEntry} entry - the entry.
     * @param {object} properties - the schema's properties.
     * @param {Array<[RegExp, *]>} patterns - the schema's patternProperties, read.
     * @param {SchemaCheck} context - the mapping's check (schema, depth, sink, tell are used).
     * @returns {void}
     */
    function checkProperty(entry, properties, patterns, { schema: subschema, depth, sink, tell }) {
        let known = false;
        if (Object.prototype.hasOwnProperty.call(properties, entry.key)) { known = true; checkNode(entry.node, properties[entry.key], depth + 1, sink); }
        for (const [pattern, patternSchema] of patterns) if (!isRiskyPattern(pattern.source, entry.key) && pattern.test(entry.key)) { known = true; checkNode(entry.node, patternSchema, depth + 1, sink); }
        if (!known && subschema.additionalProperties !== undefined) {
            if (subschema.additionalProperties === false) tell(entry.node, `"${entry.key}" is not allowed here (additionalProperties)`, entry.keyStart, entry.keyEnd);
            else checkNode(entry.node, subschema.additionalProperties, depth + 1, sink);
        }
        if (subschema.propertyNames && typeof subschema.propertyNames === 'object') {
            const probe = { type: 'string', value: entry.key, start: entry.keyStart, end: entry.keyEnd };
            const bad = [];
            checkNode(probe, subschema.propertyNames, depth + 1, (badNode, message) => bad.push(message));
            if (bad.length) tell(entry.node, `the key "${entry.key}" does not fit the schema of the key names (propertyNames)`, entry.keyStart, entry.keyEnd);
        }
    }

    /**
     * Checks the entries of an array: counts, uniqueItems, items / prefixItems and contains.
     * @param {SchemaCheck} check - the node and the schema.
     * @returns {void}
     */
    function checkArrayKeywords({ node, resolved, schema: subschema, depth, sink, tell }) {
        const items = resolved.entries;
        if (resolved.repeated) { checkRepeatedItems(items, subschema, depth, sink, tell); return; }
        if (typeof subschema.minItems === 'number' && items.length < subschema.minItems) tell(node, `at least ${subschema.minItems} entries (minItems)`);
        if (typeof subschema.maxItems === 'number' && items.length > subschema.maxItems) tell(node, `at most ${subschema.maxItems} entries (maxItems)`);
        if (subschema.uniqueItems === true) {
            const values = items.filter(entry => !hasTemplatePart(entry.node)).map(entry => getPlainValue(entry.node, new Set(), budget));
            if (values.some((item, index) => values.findIndex(other => isDeepEqual(item, other)) !== index)) tell(node, 'the entries must be different (uniqueItems)');
        }
        const tuple = Array.isArray(subschema.prefixItems) ? subschema.prefixItems : Array.isArray(subschema.items) ? subschema.items : null;
        const rest = Array.isArray(subschema.prefixItems) ? subschema.items : Array.isArray(subschema.items) ? subschema.additionalItems : subschema.items;
        items.forEach((entry, index) => {
            if (tuple && index < tuple.length) checkNode(entry.node, tuple[index], depth + 1, sink);
            else if (rest === false) tell(entry.node, `entry ${index} is not allowed here (items)`);
            else if (rest !== undefined) checkNode(entry.node, rest, depth + 1, sink);
        });
        if (subschema.contains !== undefined) {
            const matches = items.filter(entry => isValid(entry.node, subschema.contains, depth));
            const minimum = typeof subschema.minContains === 'number' ? subschema.minContains : 1;
            if (matches.length < minimum) tell(node, 'no entry matches "contains" (contains)');
            const fixedHits = typeof subschema.maxContains === 'number' ? matches.filter(entry => !hasTemplatePart(entry.node)).length : 0;
            if (typeof subschema.maxContains === 'number' && fixedHits > subschema.maxContains) tell(node, `more than ${subschema.maxContains} entries match "contains" (maxContains)`);
        }
    }

    /**
     * Checks the entries of a template array whose entries a section repeats or leaves out: each
     * entry against the schema of every entry (items), without counts and places.
     * @param {DataEntry[]} items - the entries.
     * @param {object} subschema - the array's schema.
     * @param {number} depth - how deep in the schema.
     * @param {function|null} sink - passed on to deeper checks.
     * @param {function(DataNode, string, number=, number=): void} tell - reports a problem.
     * @returns {void}
     */
    function checkRepeatedItems(items, subschema, depth, sink, tell) {
        const isTuple = Array.isArray(subschema.prefixItems) || Array.isArray(subschema.items);
        if (isTuple || subschema.items === undefined) return;
        items.forEach((entry, index) => {
            if (subschema.items === false) tell(entry.node, `entry ${index} is not allowed here (items)`);
            else checkNode(entry.node, subschema.items, depth + 1, sink);
        });
    }

    /**
     * Tells whether a node holds a part a template fills in: a placeholder value, a string or key
     * that holds a tag, or entries a section repeats.
     * @param {DataNode} node - the node.
     * @returns {boolean} true when the node or something inside it holds such a part.
     */
    function hasTemplatePart(node) {
        if (templateParts.has(node)) return templateParts.get(node);
        templateParts.set(node, false);      // an alias cycle reads as holding no template part
        const target = getAliasTarget(node);
        const found = target && target !== node ? hasTemplatePart(target) : !!(node.placeholder || node.repeated) || (!!node.entries && node.entries.some(entry => entry.placeholderKey || hasTemplatePart(entry.node)));
        templateParts.set(node, found);
        return found;
    }

    /**
     * Checks allOf, anyOf, oneOf, not and if / then / else.
     * @param {SchemaCheck} check - the node and the schema.
     * @returns {void}
     */
    function checkCombinators({ node, schema: subschema, depth, sink, tell }) {
        if (Array.isArray(subschema.allOf)) for (const part of subschema.allOf) checkNode(node, part, depth + 1, sink);
        if (Array.isArray(subschema.anyOf) && !subschema.anyOf.some(part => isValid(node, part, depth))) tell(node, 'matches none of the allowed forms (anyOf)');
        if (Array.isArray(subschema.oneOf)) {
            const matches = subschema.oneOf.filter(part => isValid(node, part, depth)).length;
            if (matches === 0) tell(node, 'matches none of the allowed forms (oneOf)');
            else if (matches > 1 && !hasTemplatePart(node)) tell(node, `matches ${matches} of the forms, but only one is allowed (oneOf)`);
        }
        if (hasTemplatePart(node)) return;
        if (subschema.not !== undefined && isValid(node, subschema.not, depth)) tell(node, 'must not match the "not" schema (not)');
        if (subschema.if !== undefined) {
            if (isValid(node, subschema.if, depth)) { if (subschema.then !== undefined) checkNode(node, subschema.then, depth + 1, sink); }
            else if (subschema.else !== undefined) checkNode(node, subschema.else, depth + 1, sink);
        }
    }

    /**
     * Tells whether a node fits a schema, without reporting anything.
     * @param {DataNode} node - the node.
     * @param {*} subschema - the schema.
     * @param {number} depth - how deep in the schema.
     * @returns {boolean} true when no problem is found.
     */
    function isValid(node, subschema, depth) {
        let bad = 0;
        checkNode(node, subschema, depth + 1, () => { bad++; });
        return !bad;
    }

    try { if (root) checkNode(root, schema, 0, null); } catch (error) {
        if (!(error instanceof TooManyValues)) throw error;
        return getNotChecked('the data and the schema together need more than a million steps');
    }
    return problems;
}
