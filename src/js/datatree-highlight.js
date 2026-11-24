/**
 * The colors of the code view of the data tree: the code as HTML with a
 * span per token. The classes are k (key), s (string), d (number),
 * e (true / false / null, YAML document markers), p (punctuation),
 * c (comment), a (anchor, alias, tag, directive) and v (plain YAML value).
 * With a template syntax set, each template tag shows as written, as plain text in the colors
 * of the place it stands in.
 */

import { getAddedFormat } from './datatree-core.js?v=3';
import { escapeTemplateTags, buildHighlightWithTemplateTags } from './template-tags.js?v=2';
import { getActiveTemplateSyntax } from './datatree-template.js?v=1';

const JSON_TOKEN = /("(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?)(\s*:)?|(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|([+-]?(?:0[xX][\da-fA-F]+|Infinity|NaN|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?))|\b(true|false|null)\b|([{}[\],:])|([A-Za-z_$][\w$]*)(\s*:)?/g;
/** A value on one line: quoted strings, comments, anchors, aliases, tags, flow punctuation, plain values. */
const YAML_VALUE_TOKEN = /("(?:[^"\\]|\\.)*"?|'(?:[^']|'')*'?)|((?:^|\s)#.*$)|([&*][^\s,[\]{}]+|![^\s,[\]{}]*)|([[\]{},])|([^\s,[\]{}#][^,[\]{}#]*?)(?=\s*(?:[,[\]{}]|\s#|$))/g;
const YAML_LINE = /^(\s*)((?:-\s+)*)(?:("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s#'"[\]{},][^#]*?|\?)(\s*:)(?=\s|$))?(.*)$/;
const YAML_CONSTANT = /^(true|false|True|False|TRUE|FALSE|null|Null|NULL|~)$/;
const YAML_NUMBER = /^[-+]?(\d[\d_]*(\.\d*)?([eE][-+]?\d+)?|\.\d+|0x[\da-fA-F]+|0o[0-7]+|\.inf|\.Inf|\.nan|\.NaN)$/;
/** A line that starts a block scalar (| or >, with chomping and indentation indicators). */
const BLOCK_SCALAR_START = /(^|\s|:)[|>][-+0-9]*\s*(#.*)?$/;

/**
 * Escapes a text for HTML (also inside attributes in double quotes).
 * @param {*} text - the text.
 * @returns {string} the text with &, <, > and " escaped.
 */
export const escapeHtml = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Wraps a text in a span with a class.
 * @param {string} className - the token's class.
 * @param {string} text - the code of the token.
 * @returns {string} the HTML.
 */
const renderSpan = (className, text) => `<span class="${className}">${escapeHtml(text)}</span>`;

/**
 * Colors JSON (with comments and JSON5).
 * @param {string} src - the code.
 * @returns {string} the HTML.
 */
function highlightJson(src) {
    const pattern = new RegExp(JSON_TOKEN.source, 'g');
    let html = '', last = 0, match;
    while ((match = pattern.exec(src))) {
        html += escapeHtml(src.slice(last, match.index));
        if (match[1] !== undefined) html += match[2] ? renderSpan('k', match[1]) + renderSpan('p', match[2]) : renderSpan('s', match[1]);
        else if (match[3] !== undefined) html += renderSpan('c', match[3]);
        else if (match[4] !== undefined) html += renderSpan('d', match[4]);
        else if (match[5] !== undefined) html += renderSpan('e', match[5]);
        else if (match[6] !== undefined) html += renderSpan('p', match[6]);
        else if (match[7] !== undefined) html += match[8] ? renderSpan('k', match[7]) + renderSpan('p', match[8]) : escapeHtml(match[7]);
        last = pattern.lastIndex;
    }
    return html + escapeHtml(src.slice(last));
}

/**
 * Colors the value part of a YAML line.
 * @param {string} text - the part after the key.
 * @returns {string} the HTML.
 */
function highlightYamlValue(text) {
    const pattern = new RegExp(YAML_VALUE_TOKEN.source, 'g');
    let html = '', last = 0, match;
    while ((match = pattern.exec(text))) {
        if (match[0] === '') { pattern.lastIndex++; continue; }
        html += escapeHtml(text.slice(last, match.index));
        if (match[1] !== undefined) html += renderSpan('s', match[1]);
        else if (match[2] !== undefined) html += renderSpan('c', match[2]);
        else if (match[3] !== undefined) html += renderSpan('a', match[3]);
        else if (match[4] !== undefined) html += renderSpan('p', match[4]);
        else if (match[5] !== undefined) html += highlightYamlWord(match[5]);
        last = pattern.lastIndex;
    }
    return html + escapeHtml(text.slice(last));
}

/**
 * Colors a plain YAML value: a constant, a number, a key inside a flow mapping, or text.
 * @param {string} word - the plain value.
 * @returns {string} the HTML.
 */
function highlightYamlWord(word) {
    if (YAML_CONSTANT.test(word)) return renderSpan('e', word);
    if (YAML_NUMBER.test(word)) return renderSpan('d', word);
    if (/^[^:]+:(\s|$)/.test(word)) return highlightYamlLine(word);
    return renderSpan('v', word);
}

/**
 * Colors one YAML line: indentation, dashes, the key and its value.
 * @param {string} line - the line.
 * @returns {string} the HTML.
 */
function highlightYamlLine(line) {
    const match = YAML_LINE.exec(line);
    if (!match) return escapeHtml(line);
    let html = escapeHtml(match[1]);
    if (match[2]) html += renderSpan('p', match[2]);
    if (match[3] !== undefined) html += renderSpan('k', match[3]) + renderSpan('p', match[4]);
    return html + highlightYamlValue(match[5]);
}

/**
 * Colors YAML line by line; the lines of a block scalar are one string.
 * @param {string} src - the code.
 * @returns {string} the HTML.
 */
function highlightYaml(src) {
    const lines = src.split('\n');
    let blockIndent = -1;            // indentation of the line that started a block scalar (-1: none)
    const html = [];
    for (const line of lines) {
        const indent = /^ */.exec(line)[0].length;
        if (blockIndent >= 0) {
            if (!line.trim() || indent > blockIndent) { html.push(renderSpan('s', line)); continue; }
            blockIndent = -1;
        }
        if (/^\s*#/.test(line)) { html.push(renderSpan('c', line)); continue; }
        if (/^(---|\.\.\.)(\s|$)/.test(line)) { html.push(renderSpan('e', line.slice(0, 3)) + highlightYamlValue(line.slice(3))); continue; }
        if (/^%/.test(line)) { html.push(renderSpan('a', line)); continue; }
        if (BLOCK_SCALAR_START.test(line)) blockIndent = indent + (/^\s*-\s/.test(line) ? 1 : 0);
        html.push(highlightYamlLine(line));
    }
    return html.join('\n');
}

/**
 * Colors the code of a format. With a template syntax set, the code is colored with every tag
 * as spaces (so a tag never starts a comment or a collection there), and the characters of each
 * tag are put back as written.
 * @param {string} format - 'json', 'yaml' or an added format.
 * @param {string} src - the code.
 * @returns {string} the HTML.
 */
export function highlight(format, src) {
    const syntax = getActiveTemplateSyntax();
    if (!syntax) return highlightFormat(format, src);
    return buildHighlightWithTemplateTags(highlightFormat(format, escapeTemplateTags(src, syntax, () => '')), syntax, src);
}

/**
 * Colors the code of a format with the format's own colors.
 * @param {string} format - 'json', 'yaml' or an added format.
 * @param {string} src - the code.
 * @returns {string} the HTML.
 */
function highlightFormat(format, src) {
    const added = getAddedFormat(format);
    if (added) return added.highlight(src);
    return format === 'yaml' ? highlightYaml(src) : highlightJson(src);
}
