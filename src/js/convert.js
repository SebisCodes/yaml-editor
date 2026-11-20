/**
 * Converting data between JSON, JSON Lines, YAML, CSV and XML, formatting, the plain text of
 * the tree, and a JSON Schema from the data. The same file serves the JSON, YAML and TOML
 * editors (byte for byte), so a conversion gives the same result in all three; it stays one
 * file, as the mappings below belong together. The stability test calls
 * convertToCsv() of this file.
 *
 * The mappings are chosen so that a round trip gives the same data back:
 * - CSV: an array of objects is a table (the keys of all rows are the columns). A field in
 *   quotes is always a string; a field without quotes is read as a number, true, false or
 *   null (an empty field) when it looks like one, an object or array written as JSON is read
 *   back as such. So strings that look like numbers are written in quotes.
 * - XML: <root> holds the data; an object's keys are elements (or <entry key="…"> when the
 *   key is no XML name, @name keys are attributes, #text is the text), an array's items are
 *   <item> elements. type="string", "null", "object" or "array" is added only where the text
 *   alone would be read differently. Any other XML is read the same way: repeated elements
 *   become arrays, attributes @name, mixed text #text.
 * - YAML: through the vendored yaml package (importYamlLibrary() in datatree.js).
 * - JSON Lines: one compact JSON value per line; an array is one line per entry.
 */

import { getYamlLibrary, setOwnProperty, getPlainValue, getAliasTarget, parseJsonl } from './datatree.js?v=12';

const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
/** The separator CSV is written with unless another is given. */
const DEFAULT_CSV_SEPARATOR = ',';
/** CSV separators that are recognized in the header row, in this order. */
const CSV_SEPARATORS = [',', ';', '\t'];
/** A CSV cell with one of these needs quotes. */
const CSV_SPECIAL = /[",;\t\r\n]/;
/** A cell a spreadsheet program would run as a formula starts with one of these. */
const FORMULA_START = /^[=+\-@\t\r]/;
/** An XML element name. */
const XML_NAME = /^[A-Za-z_][\w.-]*$/;
/** A key written as an XML attribute. */
const XML_ATTRIBUTE_KEY = /^@[A-Za-z_][\w.-]*$/;
/** Characters XML 1.0 does not allow; they are written as U+FFFD. */
const XML_INVALID = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;
/** The type marks of an element that XML text reads back. */
const XML_TYPE_MARK = /^(string|null|object|array)$/;
const XML_TEXT_NODE = 3;
const XML_CDATA_NODE = 4;
const XML_INDENT = '  ';
/** The longest part of the browser's XML error the message quotes. */
const MAX_XML_ERROR_LENGTH = 160;
/** The most aliases a YAML document may expand. */
const MAX_YAML_ALIASES = 1000;
/** Numbers in the tree's text keep their writing up to this length. */
const MAX_RAW_NUMBER_LENGTH = 60;
const SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';

/* ---------- Small helpers ---------- */

/**
 * Tells whether a text would be read as another type when written without marks.
 * @param {string} text - the text.
 * @returns {boolean} true for "", true, false, null, a number, or text that starts like JSON.
 */
function isTypedText(text) {
    return text === '' || text === 'true' || text === 'false' || text === 'null' || NUMBER.test(text) || /^\s*[[{]/.test(text);
}

/**
 * Returns the value a text without marks stands for.
 * @param {string} text - the text.
 * @returns {*} true, false, null, a finite number, or the text itself.
 */
function getInferredValue(text) {
    return text === 'true' ? true : text === 'false' ? false : text === 'null' ? null : NUMBER.test(text) && Number.isFinite(Number(text)) ? Number(text) : text;
}

/**
 * Returns the kind of a value.
 * @param {*} value - the value.
 * @returns {string} "null", "array" or the typeof of the value.
 */
function getKind(value) {
    return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
}

/* ---------- JSON ---------- */

/**
 * Returns data as JSON text.
 * @param {*} value - the data (undefined is written as null).
 * @param {number|string} [indent] - the indentation; 0 writes everything on one line without a line break at the end.
 * @returns {string} the JSON, with a line break at the end unless indent is 0.
 */
export function convertToJson(value, indent = 2) {
    const text = JSON.stringify(value === undefined ? null : value, null, indent === 0 ? undefined : indent);
    return indent === 0 ? text : text + '\n';
}

/**
 * Returns a copy of data with the keys of every object in alphabetical order (numbers in
 * numeric order).
 * @param {*} value - the data.
 * @returns {*} the sorted copy.
 */
export function getSortedCopy(value) {
    if (Array.isArray(value)) return value.map(getSortedCopy);
    if (value && typeof value === 'object') {
        const sorted = {};
        for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))) setOwnProperty(sorted, key, getSortedCopy(value[key]));
        return sorted;
    }
    return value;
}

/* ---------- JSON Lines ---------- */

/**
 * Returns an array as JSON Lines (one line per entry).
 * @param {*} value - the data.
 * @returns {{text?: string, error?: string}} the text, or an error when the data is no array.
 */
export function convertToJsonl(value) {
    if (!Array.isArray(value)) return { error: 'JSON Lines needs an array - each entry becomes one line' };
    return { text: value.map(entry => JSON.stringify(entry === undefined ? null : entry)).join('\n') + (value.length ? '\n' : '') };
}

/**
 * Returns JSON Lines as an array of the values.
 * @param {string} text - the JSON Lines.
 * @returns {Array} one value per line with data.
 * @throws {Error} with the line of the first line that is no valid JSON.
 */
export function convertFromJsonl(text) {
    const model = parseJsonl(text);
    const broken = model.docs.find(doc => doc.broken);
    if (broken) throw new Error(`Line ${broken.line} is not valid JSON`);
    return model.docs.map(doc => getPlainValue(doc.root));
}

/* ---------- YAML ---------- */

/**
 * Returns the loaded yaml package.
 * @returns {object} the package.
 * @throws {Error} when it is not loaded yet.
 */
function getYaml() {
    const yaml = getYamlLibrary();
    if (!yaml) throw new Error('The YAML package is not loaded yet');
    return yaml;
}

/**
 * Returns data as YAML text.
 * @param {*} value - the data (undefined is written as null).
 * @param {number} [indent] - the number of spaces per level.
 * @returns {string} the YAML.
 * @throws {Error} when the yaml package is not loaded yet.
 */
export function convertToYaml(value, indent = 2) {
    return getYaml().stringify(value === undefined ? null : value, { indent, lineWidth: 0, aliasDuplicateObjects: false });
}

/**
 * Returns the data of all documents of a YAML text.
 * @param {string} text - the YAML.
 * @returns {*} one value, an array when there are several documents, null for none.
 * @throws {Error} with the first syntax error (duplicate keys are allowed).
 */
export function convertFromYaml(text) {
    const docs = Array.from(getYaml().parseAllDocuments(text, { merge: true }));
    const errors = docs.flatMap(doc => doc.errors.filter(error => error.code !== 'DUPLICATE_KEY'));
    if (errors.length) throw new Error(String(errors[0].message).split('\n')[0]);
    const values = docs.map(doc => doc.toJS({ maxAliasCount: MAX_YAML_ALIASES }));
    return values.length === 0 ? null : values.length === 1 ? values[0] : values;
}

/**
 * Returns the same YAML with consistent indentation; comments stay, and mappings and sequences
 * in flow style ({a: 1}, [1, 2]) are written in block style, one entry per line.
 * @param {string} text - the YAML.
 * @param {number} [indent] - the number of spaces per level.
 * @returns {string} the formatted YAML.
 * @throws {Error} when the YAML has a syntax error.
 */
export function formatYaml(text, indent = 2) {
    const yaml = getYaml();
    const docs = Array.from(yaml.parseAllDocuments(text));
    if (docs.flatMap(doc => doc.errors).length) throw new Error('The document has a syntax error - fix it first');
    for (const doc of docs) yaml.visit(doc, { Collection(_, node) { node.flow = false; } });
    return docs.map(doc => doc.toString({ indent, lineWidth: 0 })).join('');
}

/* ---------- CSV ---------- */

/**
 * Returns text in CSV quotes, with quotes inside doubled.
 * @param {string} text - the text.
 * @returns {string} the quoted text.
 */
function escapeCsv(text) {
    return '"' + text.replace(/"/g, '""') + '"';
}

/**
 * Returns a value as a CSV cell. A text that starts like JSON ([, { or ") is written as a JSON
 * string ("[1,2]"), so it is read back as text, not as a list.
 * @param {*} value - the value.
 * @returns {string} the cell.
 */
function getCellText(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return escapeCsv(JSON.stringify(value));
    if (typeof value === 'string' && /^\s*["[{]/.test(value)) return escapeCsv(JSON.stringify(value));
    if (typeof value === 'string') return isTypedText(value) || CSV_SPECIAL.test(value) || /^\s|\s$/.test(value) ? escapeCsv(value) : value;
    return String(value);
}

/**
 * Returns a cell a spreadsheet program would run as a formula (= + - @, tab, carriage return at
 * the start) with a leading apostrophe; plain signed numbers like -5 stay (as in the CSV editor).
 * @param {*} value - the value.
 * @returns {*} the protected text, or the value as it is.
 */
function escapeFormula(value) {
    return typeof value === 'string' && FORMULA_START.test(value) && !(/^[-+]/.test(value) && NUMBER.test(value.slice(value[0] === '+' ? 1 : 0))) ? "'" + value : value;
}

/**
 * Returns an array of objects as CSV with a header row; an array of plain values becomes one
 * column "value".
 * @param {*} value - the data.
 * @param {string} [separator] - the separator.
 * @param {boolean} [guard] - true to protect cells a spreadsheet would run as formulas.
 * @returns {{text?: string, error?: string}} the CSV, or an error when the data is no table.
 */
export function convertToCsv(value, separator = DEFAULT_CSV_SEPARATOR, guard = false) {
    let rows = value;
    if (!Array.isArray(rows)) return { error: 'CSV needs an array of objects (a list of rows) - this data is not an array' };
    if (!rows.length) return { text: '' };
    if (rows.every(row => row === null || typeof row !== 'object')) rows = rows.map(cell => ({ value: cell }));
    if (!rows.every(row => row && typeof row === 'object' && !Array.isArray(row))) return { error: 'CSV needs an array of objects - some entries of this array are not objects' };
    const columns = getCsvColumns(rows);
    const protect = guard ? escapeFormula : cell => cell;
    const head = columns.map(column => protect(column)).map(column => (CSV_SPECIAL.test(column) || /^\s|\s$/.test(column) || column === '' ? escapeCsv(column) : column)).join(separator);
    const body = rows.map(row => columns.map(column => getCellText(protect(Object.prototype.hasOwnProperty.call(row, column) ? row[column] : null))).join(separator));
    return { text: [head, ...body].join('\n') + '\n' };
}

/**
 * Returns the keys of all rows, in the order they first appear.
 * @param {object[]} rows - the rows.
 * @returns {string[]} the columns.
 */
function getCsvColumns(rows) {
    const columns = [];
    const seen = new Set();
    for (const row of rows) for (const key of Object.keys(row)) if (!seen.has(key)) { seen.add(key); columns.push(key); }
    return columns;
}

/**
 * Returns CSV with a header row as an array of objects; the separator (comma, semicolon or
 * tab) is the one the header row uses most.
 * @param {string} text - the CSV.
 * @returns {object[]} one object per data row.
 * @throws {Error} when a quote is never closed.
 */
export function convertFromCsv(text) {
    const source = text.replace(/^\ufeff/, '');
    const records = readCsvRecords(source, getCsvSeparator(source)).filter(record => !(record.length === 1 && !record[0].quoted && record[0].val === ''));
    if (!records.length) return [];
    const columns = records[0].map(field => field.val);
    return records.slice(1).map(record => {
        const row = {};
        columns.forEach((column, index) => setOwnProperty(row, column, getFieldValue(record[index])));
        return row;
    });
}

/**
 * Returns the separator the first line of CSV uses most (outside quotes).
 * @param {string} source - the CSV.
 * @returns {string} ",", ";" or a tab; "," when the line has none.
 */
function getCsvSeparator(source) {
    const first = source.split(/\r?\n/, 1)[0] || '';
    const counts = CSV_SEPARATORS.map(separator => [separator, (first.replace(/"[^"]*"/g, '').match(new RegExp(separator === '\t' ? '\\t' : separator, 'g')) || []).length]);
    counts.sort((a, b) => b[1] - a[1]);
    return counts[0][1] ? counts[0][0] : ',';
}

/**
 * A field of a CSV record.
 * @typedef {object} CsvField
 * @property {string} val - its text.
 * @property {boolean} quoted - true when it was written in quotes.
 */

/**
 * Reads CSV into records of fields, each with its text and whether it was quoted.
 * @param {string} source - the CSV.
 * @param {string} separator - the separator.
 * @returns {CsvField[][]} the records.
 * @throws {Error} when a quote is never closed.
 */
function readCsvRecords(source, separator) {
    const records = [];
    let record = [], i = 0;
    const length = source.length;
    while (i < length || record.length) {
        let quoted = false, val = '';
        if (source[i] === '"') {
            quoted = true;
            i++;
            for (;;) {
                if (i >= length) throw new Error('A quote in the CSV is never closed');
                if (source[i] === '"') { if (source[i + 1] === '"') { val += '"'; i += 2; continue; } i++; break; }
                val += source[i++];
            }
        }
        while (i < length && source[i] !== separator && source[i] !== '\n' && source[i] !== '\r') val += source[i++];
        record.push({ val, quoted });
        if (source[i] === separator) { i++; if (i >= length) { record.push({ val: '', quoted: false }); records.push(record); record = []; } continue; }
        if (source[i] === '\r') i++;
        if (source[i] === '\n') i++;
        records.push(record);
        record = [];
        if (i >= length) break;
    }
    return records;
}

/**
 * Returns the value of a CSV field: empty and unquoted is null; JSON objects and arrays are
 * read as such; a quoted JSON string as written by convertToCsv() is its text; otherwise quoted is
 * text and unquoted is read as a number, true, false or null when it looks like one.
 * @param {CsvField|undefined} field - the field, undefined when the row is short.
 * @returns {*} the value.
 */
function getFieldValue(field) {
    if (!field || (!field.quoted && field.val === '')) return null;
    if (field.quoted) return /^\s*[[{]/.test(field.val) ? parseJsonOrText(field.val) : /^"/.test(field.val) ? parseJsonText(field.val) : field.val;
    return /^\s*[[{]/.test(field.val) ? parseJsonOrText(field.val) : getInferredValue(field.val);
}

/**
 * Returns text read as JSON, or the text itself when it is no JSON.
 * @param {string} text - the text.
 * @returns {*} the data or the text.
 */
function parseJsonOrText(text) {
    try { return JSON.parse(text); } catch (e) { return text; }
}

/**
 * Returns the text of a JSON string ("\"[1,2]\"" -> "[1,2]", as convertToCsv() writes text that
 * starts like JSON), or the text itself.
 * @param {string} text - the text.
 * @returns {string} the string's text.
 */
function parseJsonText(text) {
    try { const value = JSON.parse(text); return typeof value === 'string' ? value : text; } catch (e) { return text; }
}

/* ---------- XML ---------- */

/**
 * Returns text escaped for XML content; characters XML does not allow become U+FFFD.
 * @param {*} text - the text.
 * @returns {string} the escaped text.
 */
function escapeXml(text) {
    return String(text).replace(XML_INVALID, '�').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Returns text escaped for an XML attribute value (quotes and line breaks too).
 * @param {*} text - the text.
 * @returns {string} the escaped text.
 */
function escapeXmlAttribute(text) {
    return escapeXml(text).replace(/"/g, '&quot;').replace(/\n/g, '&#10;').replace(/\r/g, '&#13;').replace(/\t/g, '&#9;');
}

/**
 * Returns data as XML inside <root> (the mapping in the header).
 * @param {*} value - the data.
 * @returns {string} the XML document.
 */
export function convertToXml(value) {
    const lines = ['<?xml version="1.0" encoding="UTF-8"?>'];
    writeXmlElement('root', value, '', lines, null);
    return lines.join('\n') + '\n';
}

/**
 * Writes one value as an XML element.
 * @param {string} name - the element's name.
 * @param {*} value - the value.
 * @param {string} indent - the element's indentation.
 * @param {string[]} lines - the lines written so far; the element's lines are added.
 * @param {string|null} keyAttribute - the key of an <entry key="…">, null otherwise.
 * @returns {void}
 */
function writeXmlElement(name, value, indent, lines, keyAttribute) {
    /**
     * Returns the start of the element's tag with its key, attributes and end.
     * @param {string} attributes - the attributes.
     * @param {string} [end] - what follows them (">", "/>" …).
     * @returns {string} the tag.
     */
    const getOpenTag = (attributes, end = '') => `${indent}<${name}${keyAttribute != null ? ` key="${escapeXmlAttribute(keyAttribute)}"` : ''}${attributes}${end}`;
    const kind = getKind(value);
    if (kind === 'null') { lines.push(getOpenTag('', ' type="null"/>')); return; }
    if (kind !== 'object' && kind !== 'array') {
        const text = String(value);
        const mark = kind === 'string' && (isTypedText(text) || /^\s|\s$/.test(text)) ? ' type="string"' : '';
        lines.push(text === '' ? getOpenTag(mark, '/>') : getOpenTag(mark, '>') + escapeXml(text) + `</${name}>`);
        return;
    }
    if (kind === 'array') {
        if (!value.length) { lines.push(getOpenTag(' type="array"/>')); return; }
        lines.push(getOpenTag('', '>'));
        for (const item of value) writeXmlElement('item', item, indent + XML_INDENT, lines, null);
        lines.push(`${indent}</${name}>`);
        return;
    }
    writeXmlObject(name, value, indent, lines, getOpenTag);
}

/**
 * Writes an object as an XML element: attributes from @name keys, the other keys as elements.
 * An object that would be read back as an array (only <item> children) or as text is marked.
 * @param {string} name - the element's name.
 * @param {object} value - the object.
 * @param {string} indent - the element's indentation.
 * @param {string[]} lines - the lines written so far; the element's lines are added.
 * @param {function(string, string=): string} getOpenTag - returns the start tag with given attributes and end.
 * @returns {void}
 */
function writeXmlObject(name, value, indent, lines, getOpenTag) {
    const keys = Object.keys(value);
    const attributes = keys.filter(key => XML_ATTRIBUTE_KEY.test(key) && value[key] !== null && typeof value[key] !== 'object' && !(typeof value[key] === 'string' && isTypedText(value[key]) && value[key] !== ''));
    const rest = keys.filter(key => !attributes.includes(key));
    const attributeText = attributes.map(key => ` ${key.slice(1)}="${escapeXmlAttribute(value[key])}"`).join('');
    const needsMark = !rest.length || (rest.every(key => key === 'item') && rest.length > 0) || (rest.length === 1 && rest[0] === '#text' && !attributes.length);
    const mark = needsMark ? ' type="object"' : '';
    if (!rest.length) { lines.push(getOpenTag(attributeText + mark, '/>')); return; }
    lines.push(getOpenTag(attributeText + mark, '>'));
    for (const key of rest) {
        // #text as the element's own text when it reads back the same, otherwise as <entry key="#text">
        if (key === '#text' && typeof value[key] === 'string' && value[key] !== '' && value[key].trim() === value[key] && !isTypedText(value[key])) { lines.push(indent + XML_INDENT + escapeXml(value[key])); continue; }
        if (XML_NAME.test(key) && !/^xml/i.test(key) && key !== 'entry' && key !== 'item') writeXmlElement(key, value[key], indent + XML_INDENT, lines, null);
        else writeXmlElement('entry', value[key], indent + XML_INDENT, lines, key);
    }
    lines.push(`${indent}</${name}>`);
}

/**
 * Returns XML text as data (with the browser's DOMParser), the mapping in the header.
 * @param {string} text - the XML.
 * @returns {*} the data of the root element.
 * @throws {Error} when the XML is not well-formed.
 */
export function convertFromXml(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const error = doc.getElementsByTagName('parsererror')[0];
    if (error) throw new Error('The XML is not well-formed: ' + (error.textContent || '').split('\n').filter(Boolean)[0]?.slice(0, MAX_XML_ERROR_LENGTH));
    return readXmlElement(doc.documentElement);
}

/**
 * Returns the data of an XML element.
 * @param {Element} element - the element.
 * @returns {*} null, text, a value, an array or an object.
 */
function readXmlElement(element) {
    const type = element.getAttribute('type');
    const children = [...element.children];
    const attributes = [...element.attributes].filter(attribute => !(attribute.name === 'type' && XML_TYPE_MARK.test(attribute.value)) && !(attribute.name === 'key' && element.localName === 'entry') && !/^xmlns(:|$)/.test(attribute.name));
    if (type === 'null') return null;
    if (type === 'string') return element.textContent;
    if (type === 'array' || (children.length && !attributes.length && type !== 'object' && children.every(child => child.localName === 'item'))) return children.map(readXmlElement);
    if (!children.length && !attributes.length && type !== 'object') {
        const text = element.textContent;
        if (text === '') return null;
        return getInferredValue(/\n/.test(text) ? text.trim() : text);
    }
    return readXmlObject(element, children, attributes);
}

/**
 * Returns an XML element with attributes or children as an object: @name for attributes, #text
 * for its own text, repeated children as arrays.
 * @param {Element} element - the element.
 * @param {Element[]} children - its child elements.
 * @param {Attr[]} attributes - its attributes without type marks and namespaces.
 * @returns {object} the object.
 */
function readXmlObject(element, children, attributes) {
    const object = {};
    for (const attribute of attributes) setOwnProperty(object, '@' + attribute.name, getInferredValue(attribute.value));
    const text = [...element.childNodes].filter(child => child.nodeType === XML_TEXT_NODE || child.nodeType === XML_CDATA_NODE).map(child => child.nodeValue).join('').trim();
    if (text) setOwnProperty(object, '#text', getInferredValue(text));
    const groups = new Map();
    for (const child of children) {
        const name = child.localName === 'entry' && child.hasAttribute('key') ? child.getAttribute('key') : child.tagName;
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name).push(child);
    }
    for (const [name, elements] of groups) {
        setOwnProperty(object, name, elements.length === 1 ? readXmlElement(elements[0]) : elements.map(readXmlElement));
    }
    return object;
}

/* ---------- Plain text of the tree ---------- */

/**
 * Returns the tree as indented lines: "key: value (type)", objects and arrays with their counts.
 * @param {object} model - the model (datatree.js parse()).
 * @param {function(string): string} [translate] - translates the type names and "Document N".
 * @returns {string} the text.
 */
export function getTreeText(model, translate = text => text) {
    const lines = [];
    model.docs.forEach((doc, index) => {
        if (model.docs.length > 1) lines.push(`# ${translate(`Document ${index + 1}`)}`);
        if (doc.root) writeTreeLine(lines, 0, '$ ', doc.root, translate);
    });
    return lines.join('\n') + '\n';
}

/**
 * Writes the line of one node and the lines of its entries.
 * @param {string[]} lines - the lines written so far; the node's lines are added.
 * @param {number} depth - the node's depth.
 * @param {string} label - the key (or index) with its separator.
 * @param {object} node - the node.
 * @param {function(string): string} translate - translates the type names.
 * @returns {void}
 */
function writeTreeLine(lines, depth, label, node, translate) {
    const resolved = getAliasTarget(node) || node;
    const pad = '  '.repeat(depth);
    const alias = node.type === 'alias' ? ` *${node.value}` : '';
    if (resolved.type === 'object' || resolved.type === 'array') {
        lines.push(`${pad}${label}${resolved.type === 'object' ? '{' + resolved.entries.length + '}' : '[' + resolved.entries.length + ']'}${alias}${node.anchor ? ' &' + node.anchor : ''}`);
        if (node.type === 'alias') return;
        for (const entry of resolved.entries) writeTreeLine(lines, depth + 1, (resolved.type === 'array' ? `[${entry.key}]` : entry.key) + ': ', entry.node, translate);
        return;
    }
    const value = resolved.type === 'string' ? JSON.stringify(resolved.value) : resolved.type === 'null' ? 'null' : resolved.raw && resolved.raw.length < MAX_RAW_NUMBER_LENGTH && resolved.type === 'number' ? resolved.raw : String(resolved.value);
    lines.push(`${pad}${label}${value}${alias} (${translate(resolved.type)})`);
}

/* ---------- A schema from the data ---------- */

/**
 * Returns a JSON Schema that the data fits: types, properties, required keys, items.
 * @param {*} value - the data.
 * @returns {object} the schema with its $schema dialect.
 */
export function getInferredSchema(value) {
    return { $schema: SCHEMA_DIALECT, ...getValueSchema(value) };
}

/**
 * Returns the schema of one value.
 * @param {*} value - the value.
 * @returns {object} the schema (without $schema).
 */
function getValueSchema(value) {
    const kind = getKind(value);
    if (kind === 'null') return { type: 'null' };
    if (kind === 'number') return { type: Number.isInteger(value) ? 'integer' : 'number' };
    if (kind === 'string' || kind === 'boolean') return { type: kind };
    if (kind === 'array') {
        if (!value.length) return { type: 'array' };
        return { type: 'array', items: value.map(getValueSchema).reduce(mergeSchemas) };
    }
    const properties = {};
    for (const key of Object.keys(value)) setOwnProperty(properties, key, getValueSchema(value[key]));
    return { type: 'object', properties, required: Object.keys(value) };
}

/**
 * Returns one schema for two: types joined, keys of objects merged (required: in both).
 * @param {object} first - a schema.
 * @param {object} second - another schema.
 * @returns {object} the schema both fit.
 */
function mergeSchemas(first, second) {
    if (JSON.stringify(first) === JSON.stringify(second)) return first;
    if (first.type === 'object' && second.type === 'object') {
        const properties = { ...first.properties };
        for (const key of Object.keys(second.properties)) setOwnProperty(properties, key, key in properties ? mergeSchemas(properties[key], second.properties[key]) : second.properties[key]);
        return { type: 'object', properties, required: first.required.filter(key => second.required.includes(key)) };
    }
    if (first.type === 'array' && second.type === 'array') return first.items && second.items ? { type: 'array', items: mergeSchemas(first.items, second.items) } : { type: 'array', ...(first.items || second.items ? { items: first.items || second.items } : {}) };
    return mergeTypes(first, second);
}

/**
 * Returns one schema for two of different types: integer and number become number, simple
 * types a list of types, anything else anyOf.
 * @param {object} first - a schema.
 * @param {object} second - another schema.
 * @returns {object} the schema both fit.
 */
function mergeTypes(first, second) {
    const firstTypes = [].concat(first.anyOf ? first.anyOf.map(schema => schema.type) : first.type);
    const secondTypes = [].concat(second.anyOf ? second.anyOf.map(schema => schema.type) : second.type);
    if ((firstTypes.includes('integer') && secondTypes.includes('number')) || (firstTypes.includes('number') && secondTypes.includes('integer'))) {
        if (firstTypes.length === 1 && secondTypes.length === 1) return { type: 'number' };
    }
    const types = [...new Set([...firstTypes, ...secondTypes])].filter(Boolean);
    if (types.every(type => type !== 'object' && type !== 'array')) return { type: types.length === 1 ? types[0] : types };
    return { anyOf: [first, second].flatMap(schema => (schema.anyOf ? schema.anyOf : [schema])) };
}
