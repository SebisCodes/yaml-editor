/**
 * The edits of the data tree: one change made in the tree (a value, a key, a
 * type, an entry added, duplicated, moved or removed) as a small change of
 * the code that keeps the rest of its formatting and comments.
 *
 * editCode runs these steps:
 * 1. hand the change to an added format (TOML) when the document is one;
 * 2. find the indentation step of the document;
 * 3. write the change for its kind, in comma style (JSON, YAML flow
 *    collections) or in YAML block style;
 * 4. return the new code with the path of the node to select afterwards.
 */

import { getYamlLibrary, getAddedFormat, isContainer, getAliasTarget, setOwnProperty } from './datatree-core.js?v=2';
import { STRICT_NUMBER } from './datatree-json.js?v=3';
import { getColonEnd } from './datatree-yaml.js?v=3';
import { getPlainValue, getPath } from './datatree-values.js?v=3';
import {
    formatJsonLine, formatJsonText, formatYamlScalar, formatYamlFlow, formatYamlBlock, isEmptyContainer,
    formatYamlValuePart, formatYamlItemPart, formatHangingIndent,
} from './datatree-write.js?v=3';

/** The indentation when the document has none. */
const DEFAULT_INDENT = 2;
/** The widest indentation step taken from a document. */
const MAX_INDENT = 8;
/** How many indented lines getIndentUnit looks at. */
const INDENT_PROBE_LINES = 400;
/** A JSON value longer than this goes on its own lines when its container has several lines. */
const ONE_LINE_LENGTH = 60;
/** A number in YAML as the user may type it. */
const YAML_NUMBER = /^[-+]?(\d[\d_]*(\.\d*)?([eE][-+]?\d+)?|\.\d+)$/;
/** A JSON5 key that can stay without quotes. */
const BARE_KEY = /^[A-Za-z_$][\w$]*$/;
/** The longest number code a string keeps when a number becomes a string. */
const RAW_NUMBER_LENGTH = 40;

/** JSON Lines: while true, every value stays on its line. */
let singleLine = false;

/**
 * Where an edit happens: the code and how it is written.
 * @typedef {object} EditContext
 * @property {string} format - 'json' or 'yaml'.
 * @property {string} src - the code.
 * @property {string} unit - one indentation step.
 * @property {boolean} yaml - the document is YAML.
 */

/**
 * Returns the code with new text in place of a part.
 * @param {string} text - the code.
 * @param {number} from - the start of the part.
 * @param {number} to - the end of the part.
 * @param {string} insert - the new text.
 * @returns {string} the new code.
 */
const getSplicedText = (text, from, to, insert) => text.slice(0, from) + insert + text.slice(to);
/**
 * Returns the offset where the line of a position starts.
 * @param {string} text - the code.
 * @param {number} pos - an offset.
 * @returns {number} the start of its line.
 */
const getLineStart = (text, pos) => text.lastIndexOf('\n', pos - 1) + 1;
/**
 * Returns the offset of the line break that ends the line of a position.
 * @param {string} text - the code.
 * @param {number} pos - an offset.
 * @returns {number} the end of its line (the text's length on the last line).
 */
const getLineEnd = (text, pos) => { const end = text.indexOf('\n', pos); return end < 0 ? text.length : end; };
/**
 * Returns the indentation of the line of a position.
 * @param {string} text - the code.
 * @param {number} pos - an offset.
 * @returns {string} the spaces and tabs at the line's start.
 */
const getLineIndent = (text, pos) => /^[ \t]*/.exec(text.slice(getLineStart(text, pos)))[0];
/**
 * Tells whether the entries of a container are separated by commas: JSON, or a YAML flow collection.
 * @param {string} format - the format.
 * @param {DataNode} container - the object or array.
 * @returns {boolean} true for comma style.
 */
const isCommaStyle = (format, container) => format === 'json' || !!container.flow;

/**
 * Returns the indentation step the document uses (2 spaces when it has none).
 * @param {string} src - the code.
 * @returns {string} a tab, or 1 to 8 spaces.
 */
export function getIndentUnit(src) {
    let best = 0, tab = false;
    const pattern = /\n([ \t]+)(?=\S)/g;
    let match, lines = 0;
    while ((match = pattern.exec(src)) && lines < INDENT_PROBE_LINES) {
        lines++;
        if (match[1][0] === '\t') { tab = true; break; }
        const width = match[1].length;
        if (!best || width < best) best = width;
    }
    if (tab) return '\t';
    return ' '.repeat(best >= 1 && best <= MAX_INDENT ? best : DEFAULT_INDENT);
}

/**
 * Returns the indentation of the entries of a container.
 * @param {string} src - the code.
 * @param {DataNode} container - the object or array.
 * @param {string} unit - one indentation step.
 * @returns {string} the indentation of its first entry, or one step more than the container.
 */
function getEntryIndent(src, container, unit) {
    const first = container.entries[0];
    if (first) {
        const lineStart = getLineStart(src, first.start);
        if (/^[ \t]*$/.test(src.slice(lineStart, first.start))) return src.slice(lineStart, first.start);
    }
    return getLineIndent(src, container.start) + unit;
}

/**
 * Tells whether a container is written on several lines; an empty one follows its nearest non-empty parent.
 * @param {string} src - the code.
 * @param {DataNode} container - the object or array.
 * @returns {boolean} true for several lines (never in JSON Lines).
 */
function isMultiLine(src, container) {
    if (singleLine) return false;
    if (container.entries.length) return src.slice(container.start, container.end).includes('\n');
    for (let parent = container.entry && container.entry.parent; parent; parent = parent.entry && parent.entry.parent) if (parent.entries.length) return src.slice(parent.start, parent.end).includes('\n');
    return src.includes('\n') || !container.entry;
}

/**
 * Tells whether a container sits inside a YAML flow collection.
 * @param {DataNode} container - the object or array.
 * @returns {boolean} true when a parent is a flow collection.
 */
function isInsideFlow(container) {
    for (let parent = container.entry && container.entry.parent; parent; parent = parent.entry && parent.entry.parent) if (parent.flow) return true;
    return false;
}

/**
 * Inserts an entry into a comma-separated container.
 * @param {string} src - the code.
 * @param {DataNode} container - the object or array.
 * @param {number} at - the index of the new entry.
 * @param {string} entryText - the entry's code.
 * @param {string} entryIndent - the indentation of the entries.
 * @param {boolean} multiLine - one entry per line.
 * @returns {string} the new code.
 */
function addCommaEntry(src, container, at, entryText, entryIndent, multiLine) {
    const entries = container.entries, count = entries.length;
    if (!count) {
        const indent = getLineIndent(src, container.start);
        return getSplicedText(src, container.start + 1, container.end - 1, multiLine ? `\n${entryIndent}${entryText}\n${indent}` : entryText);
    }
    if (at < count) { const pos = entries[at].start; return getSplicedText(src, pos, pos, entryText + (multiLine ? ',\n' + entryIndent : ', ')); }
    let pos = entries[count - 1].node.end;
    const trailingComma = /^[ \t]*,/.exec(src.slice(pos));
    if (trailingComma) { pos += trailingComma[0].length; return getSplicedText(src, pos, pos, (multiLine ? '\n' + entryIndent : ' ') + entryText + ','); }
    return getSplicedText(src, pos, pos, (multiLine ? ',\n' + entryIndent : ', ') + entryText);
}

/**
 * Removes an entry from a comma-separated container, with its comma and, when it stands alone, its line.
 * @param {string} src - the code.
 * @param {DataNode} container - the object or array.
 * @param {number} index - the entry's index.
 * @returns {string} the new code.
 */
function removeCommaEntry(src, container, index) {
    const entries = container.entries, entry = entries[index], count = entries.length;
    if (count === 1) return getSplicedText(src, container.start + 1, container.end - 1, '');
    if (index === count - 1) return getSplicedText(src, entries[index - 1].node.end, entry.node.end, '');
    let from = entry.start, comma = entry.node.end;
    while (comma < src.length && src[comma] !== ',') comma++;
    let to = comma + 1;
    while (src[to] === ' ' || src[to] === '\t') to++;
    if (src[to] === '/' && src[to + 1] === '/') to = getLineEnd(src, to);
    const lineStart = getLineStart(src, from);
    if ((src[to] === '\n' || src[to] === '\r') && /^[ \t]*$/.test(src.slice(lineStart, from))) { from = lineStart; to += src[to] === '\r' && src[to + 1] === '\n' ? 2 : 1; }
    return getSplicedText(src, from, to, '');
}

/**
 * Swaps two neighboring entries in the code.
 * @param {string} src - the code.
 * @param {DataEntry} first - the entry that comes first.
 * @param {DataEntry} second - the entry after it.
 * @returns {string} the new code.
 */
function buildSwappedEntries(src, first, second) {
    const firstText = src.slice(first.start, first.node.end), secondText = src.slice(second.start, second.node.end), between = src.slice(first.node.end, second.start);
    return getSplicedText(src, first.start, second.node.end, secondText + between + firstText);
}

/**
 * Returns a key that is not in the object yet: "key", "key 2" …
 * @param {DataNode} container - the object.
 * @param {string} [wanted] - the key wanted.
 * @returns {string} the wanted key, or it with the next free number.
 */
export function getFreeKey(container, wanted = 'key') {
    const taken = new Set(container.entries.map(entry => entry.key));
    if (!taken.has(wanted)) return wanted;
    const stem = wanted.replace(/ \d+$/, '');
    for (let number = 2; ; number++) if (!taken.has(`${stem} ${number}`)) return `${stem} ${number}`;
}

/**
 * Returns the value a node gets when its type changes; the old value is kept where it fits.
 * @param {DataNode} node - the node.
 * @param {string} type - string, number, boolean, null, object or array.
 * @returns {*} the new value.
 * @throws {Error} for an unknown type.
 */
export function convertValue(node, type) {
    const resolved = getAliasTarget(node) || node;
    const value = getPlainValue(resolved);
    const oldType = resolved.type === 'alias' ? 'null' : resolved.type;
    switch (type) {
        case 'string': return oldType === 'object' || oldType === 'array' ? '' : oldType === 'null' ? '' : oldType === 'number' ? String(resolved.raw && !/^0x|^\+/i.test(resolved.raw) && resolved.raw.length < RAW_NUMBER_LENGTH ? resolved.raw : value) : String(value);
        case 'number': { const number = oldType === 'boolean' ? +value : Number(typeof value === 'string' ? value.trim() : value); return oldType !== 'object' && oldType !== 'array' && value !== '' && value !== null && Number.isFinite(number) ? number : 0; }
        case 'boolean': return oldType === 'string' ? /^(true|yes|on|1)$/i.test(value.trim()) : oldType === 'number' ? value !== 0 : oldType === 'object' || oldType === 'array' ? Object.keys(value).length > 0 : !!value;
        case 'null': return null;
        case 'object': if (oldType === 'array') { const object = {}; value.forEach((item, index) => setOwnProperty(object, String(index), item)); return object; } return {};
        case 'array': if (oldType === 'object') return Object.values(value); return oldType === 'null' ? [] : oldType === 'string' && value === '' ? [] : [value];
        default: throw new Error('unknown type');
    }
}

/**
 * Turns one change from the tree into a change of the code.
 * @param {string} format - 'json', 'jsonl', 'yaml' or an added format.
 * @param {string} src - the code.
 * @param {TreeEdit} op - the change.
 * @returns {EditResult} the new code and the path to select.
 * @throws {Error} with a message for the user when the change cannot be made.
 */
export function editCode(format, src, op) {
    const added = getAddedFormat(format);
    if (added) return added.applyEdit(src, op);
    if (format === 'jsonl') {
        singleLine = true;
        try { return editCode('json', src, op); } finally { singleLine = false; }
    }
    const context = { format, src, unit: getIndentUnit(src), yaml: format === 'yaml' };
    if (context.yaml && !getYamlLibrary()) throw new Error('importYamlLibrary() first');
    switch (op.kind) {
        case 'type': return editCode(format, src, { kind: 'value', node: op.node, value: convertValue(op.node, op.type) });
        case 'value': return context.yaml ? editYamlValue(context, op) : editJsonValue(context, op);
        case 'key': return editKey(context, op);
        case 'add': return addEntry(context, op);
        case 'duplicate': return copyEntry(context, op);
        case 'move': return moveEntry(context, op);
        case 'remove': return removeEntry(context, op);
        default: throw new Error('unknown change');
    }
}

/**
 * Writes a new value of a node in JSON; a container keeps its layout, a small value in place of a scalar stays on its line.
 * @param {EditContext} context - the code.
 * @param {TreeEdit} op - a 'value' change.
 * @returns {EditResult} the new code.
 */
function editJsonValue({ src, unit }, op) {
    const node = op.node, entry = node.entry, value = op.value;
    const path = getPath(node);
    const indent = getLineIndent(src, entry ? entry.start : node.start);
    const multiLine = !singleLine && (isContainer(node) ? (node.entries.length ? isMultiLine(src, node) : src.includes('\n')) : formatJsonLine(value).length > ONE_LINE_LENGTH && (!entry || isMultiLine(src, entry.parent)));
    const raw = typeof value === 'number' && typeof op.raw === 'string' && STRICT_NUMBER.test(op.raw) && Number(op.raw) === value ? op.raw : null;
    return { code: getSplicedText(src, node.start, node.end, raw ?? formatJsonText(value, indent, unit, multiLine)), path };
}

/**
 * Writes a new value of a node in YAML: in flow style inside a flow collection, else as a scalar or block lines.
 * @param {EditContext} context - the code.
 * @param {TreeEdit} op - a 'value' change.
 * @returns {EditResult} the new code.
 */
function editYamlValue({ src, unit }, op) {
    const node = op.node, entry = node.entry, value = op.value;
    const path = getPath(node);
    const inFlow = entry && entry.parent.flow;
    const column = entry ? entry.start - getLineStart(src, entry.start) : 0;
    // inside a flow collection, or a flow collection that gets another collection: flow style
    if (inFlow || (node.flow && !op.block && value !== null && typeof value === 'object')) return { code: getSplicedText(src, node.start, node.end, formatYamlFlow(value)), path };
    if (value === null || typeof value !== 'object' || isEmptyContainer(value)) return { code: writeYamlScalarValue(src, unit, op, column), path };
    if (!entry) return { code: getSplicedText(src, node.start, node.end, formatYamlBlock(value, '', unit).replace(/^\s+/, '')), path };
    const regionStart = getValueRegionStart(src, node);
    const before = node.empty ? '' : getPropsBefore(src, node, regionStart);
    if (entry.parent.type === 'object') return { code: getSplicedText(src, regionStart, node.end, before + '\n' + formatYamlBlock(value, ' '.repeat(column) + unit, unit)), path };
    return { code: getSplicedText(src, regionStart, node.end, before + ' ' + formatHangingIndent(formatYamlBlock(value, '', unit), column + 2)), path };
}

/**
 * Writes a scalar or an empty collection as the new YAML value of a node.
 * @param {string} src - the code.
 * @param {string} unit - one indentation step.
 * @param {TreeEdit} op - a 'value' change.
 * @param {number} column - the column of the node's entry.
 * @returns {string} the new code.
 */
function writeYamlScalarValue(src, unit, op, column) {
    const node = op.node, entry = node.entry, value = op.value;
    const raw = typeof value === 'number' && typeof op.raw === 'string' && Number(op.raw) === value && YAML_NUMBER.test(op.raw) ? op.raw : null;
    const text = isEmptyContainer(value) ? (Array.isArray(value) ? '[]' : '{}') : raw ?? formatYamlScalar(value, { style: node.type === 'string' ? node.style : undefined, indent: ' '.repeat(column) + unit });
    const replacesBlock = isContainer(node) && !node.flow && node.entries.length;
    if (replacesBlock || (node.empty && entry)) {
        const regionStart = getValueRegionStart(src, node);
        return getSplicedText(src, regionStart, node.end, (node.empty ? '' : getPropsBefore(src, node, regionStart)) + ' ' + text);
    }
    return getSplicedText(src, node.start, node.end, text);
}

/**
 * Returns where the value region of a YAML entry starts: after "key:" or "- ".
 * @param {string} src - the code.
 * @param {DataNode} node - the value's node.
 * @returns {number} the offset; the node's start for a root.
 */
function getValueRegionStart(src, node) {
    const entry = node.entry;
    if (!entry) return node.start;
    return entry.parent.type === 'object' ? getColonEnd(src, entry.keyEnd) : entry.start + 1;
}

/**
 * Returns what stands between the value region's start and the value (an &anchor or a !tag), which stays.
 * @param {string} src - the code.
 * @param {DataNode} node - the value's node.
 * @param {number} regionStart - the start of the value region.
 * @returns {string} that text without trailing white space.
 */
const getPropsBefore = (src, node, regionStart) => src.slice(regionStart, node.start).replace(/\s+$/, '');

/**
 * Gives an entry of an object a new key.
 * @param {EditContext} context - the code.
 * @param {TreeEdit} op - a 'key' change.
 * @returns {EditResult} the new code.
 * @throws {Error} for an array entry, a key that is taken, or a YAML key that is a collection.
 */
function editKey({ src, yaml }, op) {
    const entry = op.entry, key = String(op.key);
    if (entry.parent.type !== 'object') throw new Error('Entries of an array have no key');
    if (entry.parent.entries.some(other => other !== entry && other.key === key)) throw new Error(`There is already a key "${key}" here`);
    let text;
    if (!yaml) text = entry.bare && BARE_KEY.test(key) ? key : JSON.stringify(key);
    else if (entry.complexKey) throw new Error('This key is a collection - change it in the code');
    else text = entry.parent.flow ? formatYamlScalar(key, { flow: true }) : formatYamlScalar(key, { style: entry.keyStyle === 'QUOTE_DOUBLE' || entry.keyStyle === 'QUOTE_SINGLE' ? entry.keyStyle : undefined });
    if (yaml && /\n/.test(text)) text = JSON.stringify(key);
    return { code: getSplicedText(src, entry.keyStart, entry.keyEnd, text), path: [...getPath(entry.parent), key] };
}

/**
 * Adds an entry to an object or array.
 * @param {EditContext} context - the code.
 * @param {TreeEdit} op - an 'add' change.
 * @returns {EditResult} the new code.
 * @throws {Error} when the key is taken.
 */
function addEntry(context, op) {
    const { format, src, unit, yaml } = context;
    const container = op.box, at = Math.max(0, Math.min(op.at ?? container.entries.length, container.entries.length));
    const isObject = container.type === 'object';
    const key = isObject ? String(op.key ?? getFreeKey(container)) : at;
    if (isObject && container.entries.some(entry => entry.key === key)) throw new Error(`There is already a key "${key}" here`);
    const value = op.value === undefined ? '' : op.value;
    const path = [...getPath(container), key];
    if (!isCommaStyle(format, container)) return { code: addYamlBlockEntry(context, container, at, isObject ? formatYamlScalar(key, {}) + ':' : null, value), path };
    // the first entry of an empty {} or [] in a block context turns it into a block
    const multiLine = isMultiLine(src, container);
    const entryIndent = getEntryIndent(src, container, unit);
    const entryText = !yaml ? (isObject ? JSON.stringify(key) + ': ' : '') + formatJsonText(value, entryIndent, unit, multiLine) : (isObject ? formatYamlScalar(key, { flow: true }) + ': ' : '') + formatYamlFlow(value);
    if (yaml && !container.entries.length && !isInsideFlow(container)) return { ...editCode(format, src, { kind: 'value', node: container, value: isObject ? { [key]: value } : [value], block: true }), path };
    return { code: addCommaEntry(src, container, at, entryText, entryIndent, multiLine), path };
}

/**
 * Adds an entry to a YAML block collection, on its own line.
 * @param {EditContext} context - the code.
 * @param {DataNode} container - the block mapping or sequence (with entries).
 * @param {number} at - the index of the new entry.
 * @param {string|null} keyText - "key:" for a mapping, null for a sequence.
 * @param {*} value - the new value.
 * @returns {string} the new code.
 */
function addYamlBlockEntry({ src, unit }, container, at, keyText, value) {
    const entries = container.entries;
    const column = entries[0].start - getLineStart(src, entries[0].start);
    const pad = ' '.repeat(column);
    const entryText = keyText !== null ? keyText + formatYamlValuePart(value, column, unit) : '- ' + formatYamlItemPart(value, column, unit);
    if (at >= entries.length) {
        const pos = getLineEnd(src, entries[entries.length - 1].node.end);
        return getSplicedText(src, pos, pos, '\n' + pad + entryText);
    }
    const target = entries[at], lineStart = getLineStart(src, target.start);
    if (/^[ \t]*$/.test(src.slice(lineStart, target.start))) return getSplicedText(src, lineStart, lineStart, pad + entryText + '\n');
    return getSplicedText(src, target.start, target.start, entryText + '\n' + pad);
}

/**
 * Adds a copy of an entry right after it (an object's copy gets a free key "… copy").
 * @param {EditContext} context - the code.
 * @param {TreeEdit} op - a 'duplicate' change.
 * @returns {EditResult} the new code.
 * @throws {Error} for a YAML key that is a collection.
 */
function copyEntry({ format, src, unit, yaml }, op) {
    const entry = op.entry, container = entry.parent, isObject = container.type === 'object';
    const key = isObject ? getFreeKey(container, entry.key + ' copy') : entry.index + 1;
    const path = [...getPath(container), key];
    if (isCommaStyle(format, container)) {
        const keyText = !isObject ? '' : !yaml ? JSON.stringify(key) : formatYamlScalar(key, { flow: true });
        const copy = isObject ? keyText + src.slice(entry.keyEnd, entry.node.end) : src.slice(entry.start, entry.node.end);
        return { code: addCommaEntry(src, container, entry.index + 1, copy, getEntryIndent(src, container, unit), isMultiLine(src, container)), path };
    }
    if (isObject && entry.complexKey) throw new Error('This key is a collection - copy it in the code');
    const column = entry.start - getLineStart(src, entry.start);
    const copy = isObject ? formatYamlScalar(key, {}) + src.slice(entry.keyEnd, entry.node.end) : src.slice(entry.start, entry.node.end);
    const pos = getLineEnd(src, entry.node.end);
    return { code: getSplicedText(src, pos, pos, '\n' + ' '.repeat(column) + copy), path };
}

/**
 * Moves an entry one place up or down.
 * @param {EditContext} context - the code.
 * @param {TreeEdit} op - a 'move' change.
 * @returns {EditResult} the new code.
 * @throws {Error} when the entry is the first or last already.
 */
function moveEntry({ src }, op) {
    const entry = op.entry, container = entry.parent, target = entry.index + op.by;
    if (target < 0 || target >= container.entries.length) throw new Error(op.by < 0 ? 'This entry is the first already' : 'This entry is the last already');
    const [first, second] = op.by < 0 ? [container.entries[target], entry] : [entry, container.entries[target]];
    const path = [...getPath(container), container.type === 'array' ? target : entry.key];
    return { code: buildSwappedEntries(src, first, second), path };
}

/**
 * Removes an entry; the path leads to the entry that takes its place.
 * @param {EditContext} context - the code.
 * @param {TreeEdit} op - a 'remove' change.
 * @returns {EditResult} the new code.
 */
function removeEntry({ format, src }, op) {
    const entry = op.entry, container = entry.parent;
    const count = container.entries.length;
    const next = count === 1 ? [] : container.type === 'array' ? [Math.min(entry.index, count - 2)] : [container.entries[entry.index + 1 < count ? entry.index + 1 : entry.index - 1].key];
    const path = [...getPath(container), ...next];
    if (isCommaStyle(format, container)) return { code: removeCommaEntry(src, container, entry.index), path };
    if (count === 1) return editCode(format, src, { kind: 'value', node: container, value: container.type === 'array' ? [] : {} });
    const lineStart = getLineStart(src, entry.start);
    if (/^[ \t]*$/.test(src.slice(lineStart, entry.start))) {
        let from = lineStart, to = getLineEnd(src, entry.node.end);
        if (to < src.length) to++;
        else if (from > 0) from--;
        return { code: getSplicedText(src, from, to, ''), path };
    }
    return { code: getSplicedText(src, entry.start, container.entries[entry.index + 1].start, ''), path };
}
