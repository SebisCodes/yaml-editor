/**
 * Data for "Open in another editor": JSON, YAML, TOML, SHLS, XML and CSV
 * are turned into one another through plain values.
 *
 * A conversion runs in two steps:
 * 1. the source is read into a value (`parseData`); comments and the like are listed as lost;
 * 2. the value is written in the target format (convert-data-write.js); what the target
 *    cannot hold is listed as lost.
 *
 * The YAML library, the TOML reader and the SHLS module are loaded when they are needed;
 * only the TOML editor converts from TOML, and it has toml.js.
 */

import { LOSS } from './convert-model.js?v=2';
import { importShls, formatYaml, formatToml, formatCsv, formatShls, formatXml } from './convert-data-write.js?v=3';

/** The separators a CSV file may use; the one found most often in the first line wins. */
const CSV_SEPARATORS = [',', ';', '\t', '|'];
/** The DOM node types whose value is the text of an XML element: text and CDATA. */
const TEXT_NODE_TYPES = [3, 4];

/**
 * Converts data from one format of the data group into another.
 * @param {string} from - the source format: json, yaml, toml, shls, csv or xml.
 * @param {string} to - the target format: json, yaml, toml, csv, shls; any other gives XML.
 * @param {string} code - the source document.
 * @param {string} name - the document name, used as the SHLS section name.
 * @returns {Promise<import('./convert-model.js').ConversionResult>} the converted document and what is lost.
 * @throws {Error} when the source cannot be read or the data does not fit the target.
 */
export async function convertData(from, to, code, name) {
    const lost = new Set();
    const value = await parseData(from, code, lost);
    let out;
    if (to === 'json') out = JSON.stringify(value, null, 2) + '\n';
    else if (to === 'yaml') out = formatYaml(value) + '\n';
    else if (to === 'toml') out = formatToml(value, lost);
    else if (to === 'csv') out = formatCsv(value, lost);
    else if (to === 'shls') out = await formatShls(value, name, lost);
    else out = formatXml(value, lost);
    return { code: out, lost: [...lost] };
}

/**
 * Reads a document of the data group into a plain value.
 * @param {string} from - the format: json, yaml, toml, shls, csv or xml.
 * @param {string} code - the document.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {Promise<*>} the value.
 * @throws {Error} when the document cannot be read or the format is unknown.
 */
async function parseData(from, code, lost) {
    switch (from) {
        case 'json': return JSON.parse(code);
        case 'yaml': {
            if (/^\s*#/m.test(code)) lost.add(LOSS.comments);
            const YAML = await import('../vendor/yaml/index.js');
            return YAML.parse(code, { merge: true });
        }
        case 'toml': {
            if (/^\s*#/m.test(code)) lost.add(LOSS.comments);
            const TOML = await import('./toml.js?v=6');
            return TOML.convertFromToml(code);
        }
        case 'shls': { const SHLS = await importShls(); return SHLS.convertToJs(SHLS.parseShls(code)); }
        case 'csv': return parseCsv(code, lost);
        case 'xml': return parseXml(code, lost);
        default: throw new Error('Unknown format');
    }
}

/**
 * Reads a CSV document into records; the first row names the fields.
 * @param {string} source - the CSV text.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {Object<string, string>[]} one record per row after the header.
 * @throws {Error} when the document has no row with content.
 */
function parseCsv(source, lost) {
    const rows = getCsvRows(source, getCsvSeparator(source)).filter(row => row.some(cell => cell.trim()));
    if (!rows.length) throw new Error('The document is empty');
    const header = getCsvHeader(rows, lost);
    return rows.slice(1).map(row => Object.fromEntries(header.map((field, column) => [field, row[column] ?? ''])));
}

/**
 * Returns the separator of a CSV document: the one found most often in its first line.
 * @param {string} source - the CSV text.
 * @returns {string} the separator.
 */
function getCsvSeparator(source) {
    const firstLine = source.split(/\r?\n/, 1)[0];
    return CSV_SEPARATORS.slice().sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
}

/**
 * Splits a CSV document into rows of fields; quoted fields may hold separators, quotes and line breaks.
 * @param {string} source - the CSV text.
 * @param {string} separator - the field separator.
 * @returns {string[][]} the rows, empty ones included.
 */
function getCsvRows(source, separator) {
    const rows = [];
    let row = [], cell = '', quoted = false;
    for (let index = 0; index < source.length; index++) {
        const char = source[index];
        if (quoted) { if (char === '"' && source[index + 1] === '"') { cell += '"'; index++; } else if (char === '"') quoted = false; else cell += char; }
        else if (char === '"' && !cell) quoted = true;
        else if (char === separator) { row.push(cell); cell = ''; }
        else if (char === '\n' || char === '\r') { if (char === '\r' && source[index + 1] === '\n') index++; row.push(cell); rows.push(row); row = []; cell = ''; }
        else cell += char;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
}

/**
 * Returns the field names of a CSV document. Every field is kept: a name used twice is
 * numbered, fields beyond the header get a column of their own.
 * @param {string[][]} rows - the rows with content; the first is the header.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {string[]} one unique name per column of the widest row.
 */
function getCsvHeader(rows, lost) {
    const width = Math.max(...rows.map(row => row.length));
    const header = [], used = new Set();
    for (let column = 0; column < width; column++) {
        const wanted = (rows[0][column] ?? '').trim() || `Column ${column + 1}`;
        let field = wanted;
        for (let number = 2; used.has(field); number++) field = `${wanted} (${number})`;
        if (field !== wanted) lost.add(LOSS.duplicateColumns);
        if (column >= rows[0].length) lost.add(LOSS.extraFields);
        used.add(field);
        header.push(field);
    }
    return header;
}

/**
 * Reads an XML document into a value: the root element by its name.
 * @param {string} code - the XML text.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {Object<string, *>} an object with the root element's name and value.
 * @throws {Error} when the XML cannot be read.
 */
function parseXml(code, lost) {
    const doc = new DOMParser().parseFromString(code, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('The XML cannot be read - fix the problem above the code first');
    if (/<!--/.test(code)) lost.add(LOSS.comments);
    return { [doc.documentElement.nodeName]: getXmlValue(doc.documentElement) };
}

/**
 * Returns the value of an XML element: its text when it has neither attributes nor
 * children, else an object of `@attribute`s, children by name (repeated ones as a list)
 * and its own text as `#text`.
 * @param {Element} element - the element.
 * @returns {string|Object<string, *>} the value.
 */
function getXmlValue(element) {
    const value = Object.create(null);   // element names such as constructor or __proto__ are plain keys
    for (const attribute of element.attributes) value['@' + attribute.name] = attribute.value;
    const children = [...element.children];
    const ownText = [...element.childNodes].filter(node => TEXT_NODE_TYPES.includes(node.nodeType)).map(node => node.nodeValue).join('').trim();
    for (const child of children) {
        const childValue = getXmlValue(child);
        if (Object.hasOwn(value, child.nodeName)) {
            if (!Array.isArray(value[child.nodeName])) value[child.nodeName] = [value[child.nodeName]];
            value[child.nodeName].push(childValue);
        } else value[child.nodeName] = childValue;
    }
    if (!children.length && !element.attributes.length) return ownText;
    if (ownText) value['#text'] = ownText;
    return Object.fromEntries(Object.entries(value));   // a plain object again, the names as own keys
}
