/**
 * The text writers of the data tree's edits: a value as JSON or YAML code,
 * on one line, in flow style or as indented block lines, so an edit can put
 * it into the document at the right place.
 */

import { getYamlLibrary } from './datatree-core.js?v=2';

/**
 * How a YAML scalar is written.
 * @typedef {object} ScalarContext
 * @property {boolean} [flow] - inside a flow collection: no block scalars.
 * @property {string} [indent] - the indentation of a block scalar's lines.
 * @property {string} [style] - the style the scalar has in the code (QUOTE_DOUBLE …).
 */

/**
 * Writes a value as JSON on one line, with a space after ":" and ",".
 * @param {*} value - the value.
 * @returns {string} the JSON text.
 */
export function formatJsonLine(value) {
    if (Array.isArray(value)) return `[${value.map(formatJsonLine).join(', ')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).map(key => `${JSON.stringify(key)}: ${formatJsonLine(value[key])}`).join(', ')}}`;
    return JSON.stringify(value) ?? 'null';
}

/**
 * Writes a value as JSON, on one line or on several indented lines.
 * @param {*} value - the value.
 * @param {string} indent - the indentation of the line the value starts on.
 * @param {string} unit - one indentation step.
 * @param {boolean} multiLine - write a non-empty container on several lines.
 * @returns {string} the JSON text.
 */
export function formatJsonText(value, indent, unit, multiLine) {
    if (!multiLine || value === null || typeof value !== 'object' || !Object.keys(value).length) return formatJsonLine(value);
    return JSON.stringify(value, null, unit).replace(/\n/g, '\n' + indent);
}

/**
 * Writes one scalar as YAML, keeping its quote style or block style where that fits.
 * @param {*} value - a string, number, boolean or null.
 * @param {ScalarContext} [context] - where and how it is written.
 * @returns {string} the YAML text.
 */
export function formatYamlScalar(value, context = {}) {
    if (value === null) return 'null';
    if (typeof value === 'boolean') return String(value);
    if (typeof value === 'number') return Number.isNaN(value) ? '.nan' : value === Infinity ? '.inf' : value === -Infinity ? '-.inf' : String(value);
    const text = String(value);
    if (context.style === 'QUOTE_DOUBLE') return JSON.stringify(text);
    if (context.style === 'QUOTE_SINGLE' && !/[\n\r]/.test(text)) return `'${text.replace(/'/g, "''")}'`;
    if (/[\n\r]/.test(text)) return formatYamlMultiLine(text, context);
    const YAML = getYamlLibrary();
    if (context.flow) return /^[A-Za-z_][\w .@/-]*$/.test(text) && !/\s$/.test(text) && YAML.stringify(text).trim() === text ? text : JSON.stringify(text);
    const written = YAML.stringify(text, { lineWidth: 0 }).replace(/\n$/, '');
    return written.includes('\n') ? JSON.stringify(text) : written;
}

/**
 * Writes a text with line breaks as a YAML block scalar, or quoted where a block cannot be used.
 * @param {string} text - the text.
 * @param {ScalarContext} context - where and how it is written.
 * @returns {string} the YAML text.
 */
function formatYamlMultiLine(text, context) {
    if (context.flow || context.indent == null || /^[ \t]|[\r\u2028\u2029]/.test(text.split('\n')[0] || 'x')) return JSON.stringify(text);
    const body = text.replace(/\n+$/, '');
    const tail = text.length - body.length;
    const chomp = tail === 0 ? '-' : tail === 1 ? '' : '+';
    // Folded (>) would read a line break between two lines as a space: a value with breaks inside is written literal (|).
    const head = (context.style === 'BLOCK_FOLDED' && !body.includes('\n') ? '>' : '|') + chomp;
    return head + '\n' + (body + '\n'.repeat(Math.max(0, tail - 1))).split('\n').map(line => (line ? context.indent + line : '')).join('\n');
}

/**
 * Writes a value in YAML flow style ([a, b], {k: v}).
 * @param {*} value - the value.
 * @returns {string} the YAML text on one line.
 */
export function formatYamlFlow(value) {
    if (Array.isArray(value)) return `[${value.map(formatYamlFlow).join(', ')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).map(key => `${formatYamlScalar(key, { flow: true })}: ${formatYamlFlow(value[key])}`).join(', ')}}`;
    return formatYamlScalar(value, { flow: true });
}

/**
 * Writes a collection as block YAML, every line with the same indentation.
 * @param {*} value - the collection.
 * @param {string} indent - the indentation of every line.
 * @param {string} unit - one indentation step of the document.
 * @returns {string} the YAML lines.
 */
export function formatYamlBlock(value, indent, unit) {
    return getYamlLibrary().stringify(value, { indent: Math.max(2, unit.length), lineWidth: 0 }).replace(/\n$/, '').split('\n').map(line => (line ? indent + line : line)).join('\n');
}

/**
 * Tells whether a value is an empty object or array.
 * @param {*} value - the value.
 * @returns {boolean} true for {} and [].
 */
export const isEmptyContainer = value => value !== null && typeof value === 'object' && !Object.keys(value).length;

/**
 * Writes what follows "key:" in a block mapping for a value.
 * @param {*} value - the value.
 * @param {number} column - the column of the key.
 * @param {string} unit - one indentation step.
 * @returns {string} a space and a scalar, or a line break and indented block lines.
 */
export function formatYamlValuePart(value, column, unit) {
    if (value === null || typeof value !== 'object') return ' ' + formatYamlScalar(value, { indent: ' '.repeat(column) + unit });
    if (isEmptyContainer(value)) return Array.isArray(value) ? ' []' : ' {}';
    return '\n' + formatYamlBlock(value, ' '.repeat(column) + unit, unit);
}

/**
 * Writes what follows "- " in a block sequence for a value.
 * @param {*} value - the value.
 * @param {number} column - the column of the dash.
 * @param {string} unit - one indentation step.
 * @returns {string} the scalar, or block lines indented past the dash.
 */
export function formatYamlItemPart(value, column, unit) {
    if (value === null || typeof value !== 'object') return formatYamlScalar(value, { indent: ' '.repeat(column + 2) });
    if (isEmptyContainer(value)) return Array.isArray(value) ? '[]' : '{}';
    return formatHangingIndent(formatYamlBlock(value, '', unit), column + 2);
}

/**
 * Indents every line but the first of a text, leaving empty lines empty.
 * @param {string} text - the lines.
 * @param {number} column - the number of spaces.
 * @returns {string} the text with the lines after the first indented.
 */
export function formatHangingIndent(text, column) {
    return text.split('\n').map((line, index) => (index && line ? ' '.repeat(column) + line : line)).join('\n');
}
