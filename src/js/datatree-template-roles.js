/**
 * The roles of template placeholders in JSON and YAML (datatree-template.js): for every tag, what
 * it stands for at its place in the code.
 *
 * - "text": inside a string, a comment, a YAML block scalar, or in the middle of a YAML plain value
 *   in block style; the format reads it as text, so it stays as written.
 * - "value": a placeholder where a value stands (`"port": {{port}}`, `port: {{port}}`).
 * - "key": a placeholder where a key stands (`{ {{k}}: 1 }`, `{{k}}: 1`).
 * - "section": a section tag ({{#name}}, {{^name}}, {{/name}}) or a tag with a sign outside the
 *   syntax outside text; the text between the tags of a section counts once.
 *
 * JSON is read by a small scanner of strings and comments. YAML is read once by the yaml package
 * with every tag written as letters, and each tag gets the role of the scalar it falls in.
 *
 * The places (findJsonTagPlaces, findYamlTagPlaces) add to each role the kind of text a tag stands
 * in, so the example view (datatree-examples.js) writes an example in that text's own escaping.
 */

import { getYamlLibrary } from './datatree-core.js?v=3';

/** The deepest nesting of a YAML document whose scalars are collected. */
const MAX_YAML_DEPTH = 400;

/**
 * A scalar of the YAML probe with its place and context.
 * @typedef {object} YamlScalarPlace
 * @property {number} start - the offset of the scalar.
 * @property {number} end - the offset after its value.
 * @property {string} style - the yaml package's style: PLAIN, QUOTE_SINGLE, QUOTE_DOUBLE, BLOCK_LITERAL, BLOCK_FOLDED.
 * @property {boolean} isKey - the scalar is the key of a pair.
 * @property {boolean} isFlow - the scalar stands inside a flow collection ([ ] or { }).
 */

/**
 * A tag's role with the kind of text it stands in.
 * @typedef {object} TagPlace
 * @property {string} role - text, value, key or section.
 * @property {?string} style - for a tag of the role text, the kind of text: JSON "double", "single",
 *     "comment"; YAML the scalar style (PLAIN, QUOTE_DOUBLE, QUOTE_SINGLE, BLOCK_LITERAL, BLOCK_FOLDED)
 *     or "comment"; null for the other roles.
 * @property {boolean} [bare] - false for a value tag that is part of a longer plain value (YAML
 *     `address: {{street}} {{city}}`), whose style then names the kind of text; true or absent for a
 *     value tag that is the whole value.
 * @property {boolean} [flow] - YAML: true for text inside a flow collection ([ ] or { }).
 * @property {boolean} [key] - YAML: true for text inside the key of a pair.
 * @property {boolean} [stringStart] - TOML: true for text right after the opening quotes of a multi-line string.
 */

/**
 * A part of a JSON text that is text to the format.
 * @typedef {object} JsonTextRange
 * @property {number} start - where it starts.
 * @property {number} end - where it ends.
 * @property {string} style - "double" or "single" for a string, "comment" for a comment.
 */

/** The style of a JSON text range by the character it starts with. */
const JSON_TEXT_STYLES = { '"': 'double', "'": 'single', '/': 'comment' };

/**
 * Returns the role of every tag of a JSON text (JSON with comments, JSON5 and JSON Lines too).
 * @param {string} src - the code.
 * @param {import('./template-tags.js').TemplateTag[]} tags - the tags of the code, in order.
 * @returns {string[]} the role of each tag: text, value, key or section.
 */
export function findJsonTagRoles(src, tags) {
    return findJsonTagPlaces(src, tags).map(place => place.role);
}

/**
 * Returns the place of every tag of a JSON text: its role, and for text the kind of text.
 * @param {string} src - the code.
 * @param {import('./template-tags.js').TemplateTag[]} tags - the tags of the code, in order.
 * @returns {TagPlace[]} the place of each tag.
 */
export function findJsonTagPlaces(src, tags) {
    const tagsByStart = new Map(tags.map(tag => [tag.start, tag]));
    const textRanges = getJsonTextRanges(src, tagsByStart);
    return tags.map(tag => {
        const range = findRangeAt(textRanges, tag.start);
        if (range) return { role: 'text', style: range.style };
        if (tag.kind !== 'value') return { role: 'section', style: null };
        return { role: src[getJsonTokenAfter(src, tag.end, tagsByStart)] === ':' ? 'key' : 'value', style: null };
    });
}

/**
 * Returns the parts of a JSON text that are text to the format: strings and comments.
 * @param {string} src - the code.
 * @param {Map<number, object>} tagsByStart - the tags by their offset; outside text they are passed over whole.
 * @returns {JsonTextRange[]} the ranges, in order.
 */
function getJsonTextRanges(src, tagsByStart) {
    const ranges = [];
    let index = 0;
    while (index < src.length) {
        const tag = tagsByStart.get(index);
        if (tag) { index = tag.end; continue; }
        const end = getJsonTextEnd(src, index);
        if (end > index) { ranges.push({ start: index, end, style: JSON_TEXT_STYLES[src[index]] }); index = end; } else index++;
    }
    return ranges;
}

/**
 * Returns where a string or comment that starts at an offset ends.
 * @param {string} src - the code.
 * @param {number} index - the offset.
 * @returns {number} the offset after the string or comment, or the offset itself when none starts there.
 */
function getJsonTextEnd(src, index) {
    const char = src[index];
    if (char === '"' || char === "'") return getQuotedEnd(src, index);
    if (char === '/' && src[index + 1] === '/') return getLineEndAt(src, index);
    if (char === '/' && src[index + 1] === '*') { const close = src.indexOf('*/', index + 2); return close < 0 ? src.length : close + 2; }
    return index;
}

/**
 * Returns where a quoted string ends: after its closing quote, or at the end of its line when it stays open.
 * @param {string} src - the code.
 * @param {number} start - the offset of the opening quote.
 * @returns {number} the offset after the string.
 */
function getQuotedEnd(src, start) {
    const quote = src[start];
    let index = start + 1;
    while (index < src.length) {
        const char = src[index];
        if (char === '\\') index += src.startsWith('\r\n', index + 1) ? 3 : 2;
        else if (char === quote) return index + 1;
        else if (char === '\n') return index;
        else index++;
    }
    return src.length;
}

/**
 * Returns the offset of the line break that ends the line of an offset.
 * @param {string} src - the code.
 * @param {number} index - the offset.
 * @returns {number} the offset of the line break, or the text's length.
 */
function getLineEndAt(src, index) {
    const end = src.indexOf('\n', index);
    return end < 0 ? src.length : end;
}

/**
 * Returns the offset of the next JSON token after an offset: white space, comments and section tags are passed over.
 * @param {string} src - the code.
 * @param {number} index - the offset.
 * @param {Map<number, object>} tagsByStart - the tags by their offset.
 * @returns {number} the offset of the token, or the text's length.
 */
function getJsonTokenAfter(src, index, tagsByStart) {
    for (;;) {
        while (index < src.length && /\s/.test(src[index])) index++;
        const tag = tagsByStart.get(index);
        if (tag && tag.kind !== 'value') { index = tag.end; continue; }
        if (src[index] === '/' && (src[index + 1] === '/' || src[index + 1] === '*')) { index = getJsonTextEnd(src, index); continue; }
        return index;
    }
}

/**
 * Finds the range that holds an offset.
 * @param {JsonTextRange[]} ranges - the ranges, in order.
 * @param {number} offset - the offset.
 * @returns {?JsonTextRange} the range, or null when none holds the offset.
 */
function findRangeAt(ranges, offset) {
    let low = 0, high = ranges.length - 1;
    while (low <= high) {
        const middle = (low + high) >> 1;
        if (offset < ranges[middle].start) high = middle - 1;
        else if (offset >= ranges[middle].end) low = middle + 1;
        else return ranges[middle];
    }
    return null;
}

/**
 * Returns the role of every tag of a YAML text (the yaml package is loaded).
 * @param {string} src - the code.
 * @param {import('./template-tags.js').TemplateTag[]} tags - the tags of the code, in order.
 * @returns {string[]} the role of each tag: text, value, key or section.
 */
export function findYamlTagRoles(src, tags) {
    return findYamlTagPlaces(src, tags).map(place => place.role);
}

/**
 * Returns the place of every tag of a YAML text (the yaml package is loaded): its role, and for
 * text the scalar style or "comment".
 * @param {string} src - the code.
 * @param {import('./template-tags.js').TemplateTag[]} tags - the tags of the code, in order.
 * @returns {TagPlace[]} the place of each tag.
 */
export function findYamlTagPlaces(src, tags) {
    const tagsByStart = new Map(tags.map(tag => [tag.start, tag]));
    const lineTags = new Set(tags.filter(tag => isSectionLineTag(src, tag, tagsByStart)));
    const scalars = getYamlScalarPlaces(buildYamlProbe(src, tags, lineTags));
    return tags.map(tag => {
        const scalar = findScalarPlaceAt(scalars, tag.start);
        const role = lineTags.has(tag) ? (scalar && scalar.style !== 'PLAIN' ? 'text' : 'section') : getYamlTagRole(src, tag, scalar);
        if (role === 'value' && scalar && (scalar.start !== tag.start || scalar.end !== tag.end)) return { role, style: scalar.style, bare: false, flow: scalar.isFlow };
        if (role !== 'text') return { role, style: null };
        return scalar ? { role, style: scalar.style, flow: scalar.isFlow, key: scalar.isKey } : { role, style: 'comment' };
    });
}

/**
 * Returns the role of a YAML tag from the scalar it falls in.
 * @param {string} src - the code.
 * @param {import('./template-tags.js').TemplateTag} tag - the tag.
 * @param {YamlScalarPlace|null} scalar - the scalar of the probe that holds the tag's start.
 * @returns {string} text, value, key or section.
 */
function getYamlTagRole(src, tag, scalar) {
    if (!scalar) return isInYamlComment(src, tag.start) ? 'text' : tag.kind === 'value' ? 'value' : 'section';
    if (scalar.style !== 'PLAIN') return 'text';
    const isFirst = scalar.start === tag.start;
    if (!isFirst && !scalar.isFlow) return 'text';
    if (tag.kind !== 'value') return 'section';
    return isFirst && scalar.isKey ? 'key' : 'value';
}

/**
 * Tells whether a section tag stands on a line that holds only section tags and white space.
 * @param {string} src - the code.
 * @param {import('./template-tags.js').TemplateTag} tag - the tag.
 * @param {Map<number, object>} tagsByStart - the tags by their offset.
 * @returns {boolean} true for a section tag on a line of its own.
 */
function isSectionLineTag(src, tag, tagsByStart) {
    if (tag.kind === 'value') return false;
    let index = src.lastIndexOf('\n', tag.start - 1) + 1;
    const end = getLineEndAt(src, tag.start);
    while (index < end) {
        const other = tagsByStart.get(index);
        if (other && other.kind !== 'value') index = other.end;
        else if (/\s/.test(src[index])) index++;
        else return false;
    }
    return true;
}

/**
 * Builds the text the yaml package reads to find the roles: section tags on lines of their own as
 * spaces, every other tag as letters of the same length, so it reads as one word of plain text.
 * @param {string} src - the code.
 * @param {import('./template-tags.js').TemplateTag[]} tags - the tags.
 * @param {Set<object>} lineTags - the section tags on lines of their own.
 * @returns {string} the probe text, as long as the code.
 */
function buildYamlProbe(src, tags, lineTags) {
    let probe = '', last = 0;
    for (const tag of tags) {
        probe += src.slice(last, tag.start) + (lineTags.has(tag) ? ' ' : 'x').repeat(tag.end - tag.start);
        last = tag.end;
    }
    return probe + src.slice(last);
}

/**
 * Returns the scalars of every document of a YAML text with their place, sorted by place.
 * @param {string} probe - the YAML text.
 * @returns {YamlScalarPlace[]} the scalars; empty when the yaml package cannot read the text.
 */
function getYamlScalarPlaces(probe) {
    const YAML = getYamlLibrary();
    const places = [];
    let documents;
    try { documents = YAML.parseAllDocuments(probe, { prettyErrors: false }); } catch (error) { return places; }
    for (const document of Array.from(documents)) collectYamlScalarPlaces(YAML, document.contents, false, false, places, 0);
    return places.sort((first, second) => first.start - second.start);
}

/**
 * Collects the scalars of a node of the yaml package and of everything inside it.
 * @param {object} YAML - the yaml package.
 * @param {object|null} node - the package's node.
 * @param {boolean} isFlow - the node stands inside a flow collection.
 * @param {boolean} isKey - the node is the key of a pair.
 * @param {YamlScalarPlace[]} places - the list that gets the scalars; changed in place.
 * @param {number} depth - the nesting depth.
 * @returns {void}
 */
function collectYamlScalarPlaces(YAML, node, isFlow, isKey, places, depth) {
    if (!node || depth > MAX_YAML_DEPTH) return;
    if (YAML.isScalar(node)) {
        if (node.range) places.push({ start: node.range[0], end: node.range[1], style: node.type, isKey, isFlow });
        return;
    }
    if (!YAML.isMap(node) && !YAML.isSeq(node)) return;
    const inner = isFlow || !!node.flow;
    for (const item of node.items) {
        if (YAML.isPair(item)) {
            collectYamlScalarPlaces(YAML, item.key, inner, true, places, depth + 1);
            collectYamlScalarPlaces(YAML, item.value, inner, false, places, depth + 1);
        } else collectYamlScalarPlaces(YAML, item, inner, false, places, depth + 1);
    }
}

/**
 * Finds the scalar that holds an offset.
 * @param {YamlScalarPlace[]} scalars - the scalars, sorted by place.
 * @param {number} offset - the offset.
 * @returns {YamlScalarPlace|null} the scalar, or null when none holds the offset.
 */
function findScalarPlaceAt(scalars, offset) {
    let low = 0, high = scalars.length - 1, found = null;
    while (low <= high) {
        const middle = (low + high) >> 1;
        if (scalars[middle].start <= offset) { found = scalars[middle]; low = middle + 1; } else high = middle - 1;
    }
    return found && offset < found.end ? found : null;
}

/**
 * Tells whether an offset of a YAML text lies in a comment: a # at the line's start or after white
 * space, outside quotes, comes before it on its line.
 * @param {string} src - the code.
 * @param {number} offset - the offset.
 * @returns {boolean} true inside a comment.
 */
function isInYamlComment(src, offset) {
    const lineStart = src.lastIndexOf('\n', offset - 1) + 1;
    let quote = null;
    for (let index = lineStart; index < offset; index++) {
        const char = src[index];
        const isWordStart = index === lineStart || /[\s[{,:-]/.test(src[index - 1]);
        if (quote) { if (char === quote) quote = null; }
        else if ((char === '"' || char === "'") && isWordStart) quote = char;
        else if (char === '#' && (index === lineStart || /\s/.test(src[index - 1]))) return true;
    }
    return false;
}
