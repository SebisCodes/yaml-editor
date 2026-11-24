/**
 * Writers of the data group of "Open in another editor": a plain value as
 * YAML, XML, CSV, SHLS or TOML. Each writer lists in the loss set what its format
 * cannot hold (convert-model.js): TOML has no null and its document is a table, CSV
 * needs a list of records, SHLS holds every value as text, XML needs valid names.
 *
 * The five writers share their value checks and stay together in this file, so it is
 * longer than the 300 lines of a module.
 */

import { LOSS, escapeHtml } from './convert-model.js?v=2';

/** YAML text that cannot stay a plain scalar: indicators, edges, comments, booleans, numbers. */
const YAML_PLAIN_BAD = /^[-?:,[\]{}#&*!|>'"%@`]|^\s|\s$|: |\s#|:$|^(true|false|yes|no|on|off|null|~|y|n)$|^[-+]?(\d|\.\d)|^\.(inf|nan)$/i;
/** The steps a nested YAML mapping is indented by. */
const YAML_INDENT = 2;
/** The XML declaration that starts a written document. */
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
/** The section name of SHLS data that has none. */
const SHLS_DEFAULT_SECTION = 'Data';
/** TOML integers are 64 bits; larger numbers are written as floats. */
const TOML_INTEGER_LIMIT = 9223372036854775807;

/**
 * Loads the SHLS module.
 * @returns {Promise<object>} the module of shls.js.
 */
export async function importShls() {
    return import('./shls.js?v=8');
}

/* ---------- YAML ---------- */

/**
 * Returns a YAML scalar for a text: plain when that reads back the same, else in quotes.
 * @param {string} text - the text.
 * @returns {string} the YAML scalar.
 */
function formatYamlString(text) {
    return text === '' || YAML_PLAIN_BAD.test(text) || /[\n\r\t\\"]/.test(text) ? JSON.stringify(text) : text;
}

/**
 * Returns a YAML scalar for a text, number, boolean or empty value.
 * @param {*} value - the value; null and undefined become `null`.
 * @returns {string} the YAML scalar.
 */
function formatYamlScalar(value) {
    if (typeof value === 'string') return formatYamlString(value);
    return value === null || value === undefined ? 'null' : String(value);
}

/**
 * Tells whether a value is an object or list with at least one entry.
 * @param {*} value - the value.
 * @returns {boolean} true for a filled object or list.
 */
function isFilledObject(value) {
    return Boolean(value && typeof value === 'object' && Object.keys(value).length);
}

/**
 * Returns a value that fits on the line of its key or list marker: a scalar, `[]` or `{}`.
 * @param {*} value - a scalar or an empty object or list.
 * @returns {string} the YAML text.
 */
function formatYamlLeaf(value) {
    if (value && typeof value === 'object') return Array.isArray(value) ? '[]' : '{}';
    return formatYamlScalar(value);
}

/**
 * Writes a value as YAML in block style.
 * @param {*} value - the value.
 * @param {number} [level=0] - the indentation in spaces.
 * @returns {string} the YAML text without a final line break.
 */
export function formatYaml(value, level = 0) {
    const pad = ' '.repeat(level);
    if (Array.isArray(value)) {
        if (!value.length) return '[]';
        return value.map(item => (isFilledObject(item) ? `${pad}- ${formatYaml(item, level + YAML_INDENT).trimStart()}` : `${pad}- ${formatYamlLeaf(item)}`)).join('\n');
    }
    if (value && typeof value === 'object') {
        const keys = Object.keys(value);
        if (!keys.length) return '{}';
        return keys.map(key => {
            const item = value[key];
            if (isFilledObject(item)) return `${pad}${formatYamlString(key)}:\n${formatYaml(item, level + (Array.isArray(item) ? 0 : YAML_INDENT))}`;
            return `${pad}${formatYamlString(key)}: ${formatYamlLeaf(item)}`;
        }).join('\n');
    }
    return pad + formatYamlScalar(value);
}

/* ---------- XML ---------- */

/**
 * Writes a value as an XML document: a single key is the root element, anything else
 * goes into a `root` element (list entries as `item`).
 * @param {*} value - the value.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {string} the XML document, ending with a line break.
 */
export function formatXml(value, lost) {
    const keys = value && !Array.isArray(value) && typeof value === 'object' ? Object.keys(value) : [];
    const single = keys.length === 1 && !Array.isArray(value[keys[0]]);
    let body;
    if (single) body = formatXmlElement(keys[0], value[keys[0]], 0, lost);
    else if (Array.isArray(value)) body = `<root>\n${value.map(item => formatXmlElement('item', item, 1, lost)).join('\n')}\n</root>`;
    else if (keys.length) body = `<root>\n${keys.map(key => formatXmlElement(key, value[key], 1, lost)).join('\n')}\n</root>`;
    else body = `<root>\n  ${escapeHtml(value)}\n</root>`;
    return `${XML_DECLARATION}\n${body}\n`;
}

/**
 * Returns a valid XML name for a key; a changed key is listed as lost.
 * @param {string} key - the key.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {string} the name: invalid characters as `_`, a leading `_` when the name does not start with a letter.
 */
function getXmlName(key, lost) {
    const name = String(key).replace(/[^\p{L}\p{N}_.:-]/gu, '_').replace(/^[^\p{L}_]/u, start => `_${start}`);
    if (name !== String(key)) lost.add(LOSS.invalidXmlNames);
    return name || '_';
}

/**
 * Writes a value as an XML element; a list repeats the element, `@` keys become
 * attributes and `#text` the element's own text.
 * @param {string} key - the element name.
 * @param {*} value - the value.
 * @param {number} level - the depth, indented by two spaces each.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {string} the XML text.
 */
function formatXmlElement(key, value, level, lost) {
    const pad = '  '.repeat(level), name = getXmlName(key, lost);
    if (Array.isArray(value)) return value.map(item => formatXmlElement(key, item, level, lost)).join('\n');
    if (!value || typeof value !== 'object') return value === null || value === undefined ? `${pad}<${name}/>` : `${pad}<${name}>${escapeHtml(value)}</${name}>`;
    const entries = Object.entries(value);
    const attributes = entries.filter(([entryKey, item]) => entryKey.startsWith('@') && (item === null || typeof item !== 'object')).map(([entryKey, item]) => ` ${getXmlName(entryKey.slice(1), lost)}="${escapeHtml(item ?? '')}"`).join('');
    const ownText = value['#text'];
    const children = entries.filter(([entryKey]) => !entryKey.startsWith('@') && entryKey !== '#text').map(([entryKey, item]) => formatXmlElement(entryKey, item, level + 1, lost));
    if (!children.length) return ownText === undefined ? `${pad}<${name}${attributes}/>` : `${pad}<${name}${attributes}>${escapeHtml(ownText)}</${name}>`;
    return `${pad}<${name}${attributes}>${ownText === undefined ? '' : escapeHtml(ownText)}\n${children.join('\n')}\n${pad}</${name}>`;
}

/* ---------- CSV ---------- */

/**
 * Returns a CSV field, quoted when it holds a quote, comma or line break.
 * @param {string} text - the field.
 * @returns {string} the CSV field.
 */
function formatCsvField(text) {
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Returns the list of records a value holds: the value itself, the only list in it,
 * or the only list one level down; with several lists the first one.
 * @param {*} value - the value.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {*} the records, or a value that is not a list when there are none.
 */
function getCsvRecords(value, lost) {
    if (!value || Array.isArray(value) || typeof value !== 'object') return value;
    const keys = Object.keys(value), values = Object.values(value);
    const lists = values.filter(Array.isArray);
    if (keys.length === 1 && lists.length === 1) return lists[0];
    if (keys.length === 1 && values[0] && typeof values[0] === 'object') {
        const inner = Object.values(values[0]).filter(Array.isArray);
        return inner.length === 1 ? inner[0] : [value];
    }
    if (lists.length > 1) { lost.add(LOSS.firstListOnly); return lists[0]; }
    return [value];
}

/**
 * Writes a value as CSV: one column per field of the records, in the order they are found.
 * @param {*} value - the value; it must hold a list of records.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {string} the CSV text, ending with a line break.
 * @throws {Error} when the value holds no list of records.
 */
export function formatCsv(value, lost) {
    const rows = getCsvRecords(value, lost);
    if (!Array.isArray(rows) || !rows.length) throw new Error('This data has no list of records, so it does not make a table');
    const columns = [];
    const records = rows.map(row => (row && typeof row === 'object' && !Array.isArray(row) ? row : { Value: row }));
    for (const record of records) for (const key of Object.keys(record)) if (!columns.includes(key)) columns.push(key);
    const lines = [columns.map(formatCsvField).join(','), ...records.map(record => columns.map(column => formatCsvField(formatCsvCell(record[column], lost))).join(','))];
    return lines.join('\n') + '\n';
}

/**
 * Returns the text of a CSV cell; a nested value goes into the cell as JSON.
 * @param {*} value - the value of the field.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {string} the cell text, '' for null and undefined.
 */
function formatCsvCell(value, lost) {
    if (value && typeof value === 'object') { lost.add(LOSS.nestedValues); return JSON.stringify(value); }
    return value === null || value === undefined ? '' : String(value);
}

/* ---------- SHLS ---------- */

/**
 * Tells whether a value holds anything that is not text, which SHLS cannot keep.
 * @param {*} value - the value.
 * @returns {boolean} true when a number, boolean, undefined or the like is in it.
 */
function hasTypedValues(value) {
    return value && typeof value === 'object' ? Object.values(value).some(hasTypedValues) : value !== null && typeof value !== 'string';
}

/**
 * Writes a value as SHLS: lists become sections, other data goes into one section.
 * @param {*} value - the value.
 * @param {string} name - the document name, used for a section without a name.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {Promise<string>} the SHLS text, ending with a line break.
 */
export async function formatShls(value, name, lost) {
    const SHLS = await importShls();
    if (hasTypedValues(value)) lost.add(LOSS.shlsText);
    const data = SHLS.convertFromJs(value);
    const section = name || SHLS_DEFAULT_SECTION;
    let sections;
    if (Array.isArray(data)) sections = new Map([[section, data]]);
    else if (data instanceof Map && [...data.values()].every(item => Array.isArray(item))) sections = data;
    else if (data instanceof Map) sections = new Map([...data].map(([key, item]) => [key, Array.isArray(item) ? item : [item]]));
    else sections = new Map([[section, [data]]]);
    return SHLS.formatShls(sections) + '\n';
}

/* ---------- TOML ---------- */

/**
 * Returns a TOML key: bare when it can be, else quoted.
 * @param {string} key - the key.
 * @returns {string} the TOML key.
 */
function formatTomlKey(key) {
    return /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * Returns a TOML basic string.
 * @param {string} text - the text.
 * @returns {string} the quoted string with the characters TOML does not take raw escaped.
 */
function formatTomlString(text) {
    return JSON.stringify(text).replace(/\u007f/g, '\\u007f').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * Tells whether a value is an object that is not a list.
 * @param {*} value - the value.
 * @returns {boolean} true for an object.
 */
function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Tells whether a value is a list of tables, written as `[[name]]`.
 * @param {*} value - the value.
 * @returns {boolean} true for a non-empty list of objects.
 */
function isTableArray(value) {
    return Array.isArray(value) && value.length > 0 && value.every(isPlainObject);
}

/**
 * Tells whether a value can be written in TOML; an empty value is listed as lost.
 * @param {*} value - the value.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {boolean} false for null and undefined.
 */
function isTomlValue(value, lost) {
    if (value !== null && value !== undefined) return true;
    lost.add(LOSS.tomlNull);
    return false;
}

/**
 * Returns a TOML number: integers below 64 bits as they are, others as floats, `nan` and `inf`.
 * @param {number} number - the number.
 * @returns {string} the TOML number.
 */
function formatTomlNumber(number) {
    if (Number.isNaN(number)) return 'nan';
    if (!Number.isFinite(number)) return number < 0 ? '-inf' : 'inf';
    if (Number.isInteger(number) && Math.abs(number) < TOML_INTEGER_LIMIT && !/e/.test(String(number))) return String(number);
    return String(number).replace(/^(-?\d+)e/, '$1.0e').replace('e+', 'e');
}

/**
 * Writes a value on one line: a scalar, an array or an inline table.
 * @param {*} value - the value, not null.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {string} the TOML value.
 */
function formatTomlInline(value, lost) {
    if (typeof value === 'string') return formatTomlString(value);
    if (typeof value === 'number') return formatTomlNumber(value);
    if (typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return `[${value.filter(item => isTomlValue(item, lost)).map(item => formatTomlInline(item, lost)).join(', ')}]`;
    const keys = Object.keys(value).filter(key => isTomlValue(value[key], lost));
    return keys.length ? `{ ${keys.map(key => `${formatTomlKey(key)} = ${formatTomlInline(value[key], lost)}`).join(', ')} }` : '{}';
}

/**
 * Adds the lines of a table: its `key = value` lines first, then its tables as
 * `[sections]` and its lists of tables as `[[sections]]`.
 * @param {Object<string, *>} table - the table.
 * @param {string[]} path - the keys from the document to this table.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @param {string[]} lines - the lines written so far; the table's lines are appended.
 * @returns {void}
 */
function addTomlTable(table, path, lost, lines) {
    const subTables = [];
    for (const key of Object.keys(table)) {
        const value = table[key];
        if (!isTomlValue(value, lost)) continue;
        if ((isPlainObject(value) && Object.keys(value).length) || isTableArray(value)) subTables.push(key);
        else lines.push(`${formatTomlKey(key)} = ${formatTomlInline(value, lost)}`);
    }
    for (const key of subTables) {
        const value = table[key], subPath = [...path, key], header = subPath.map(formatTomlKey).join('.');
        for (const subTable of isTableArray(value) ? value : [value]) {
            if (lines.length) lines.push('');
            lines.push(isTableArray(value) ? `[[${header}]]` : `[${header}]`);
            addTomlTable(subTable, subPath, lost, lines);
        }
    }
}

/**
 * Writes a value as a TOML document. TOML has no null (left out) and its document is a
 * table (other data goes under the key `value`).
 * @param {*} value - the value.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {string} the TOML text, ending with a line break unless it is empty.
 */
export function formatToml(value, lost) {
    let table = value;
    if (!isPlainObject(table)) { lost.add(LOSS.tomlNoTable); table = { value: table }; }
    const lines = [];
    addTomlTable(table, [], lost, lines);
    return lines.join('\n') + (lines.length ? '\n' : '');
}
