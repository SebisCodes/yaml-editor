/**
 * The example view of a template in the data tree (?template=): the code filled with the
 * examples a page sends, read as the data it gives, and the way back from that data to the code.
 *
 * buildExampleText() runs these steps:
 *   1. find the place of every tag (datatree-template.js getTemplatePlaceFinder): its role and,
 *      for text, the kind of text it stands in;
 *   2. fill the template (template-expansion.js): sections and lists applied by their example
 *      state, each value tag written for its place:
 *      - a bare value (the tag is the whole value) takes the example as a literal of the format
 *        when it reads as a number, true, false or null there, else as a string of the format;
 *      - a key takes the example as a string of the format;
 *      - text (inside a string, a comment, a block scalar) takes the example in that text's own
 *        escaping; an example that text cannot hold as it is (a plain YAML value that would change
 *        its structure) stops the filling with a TemplateExpansionError, so the tree shows the
 *        template with a note;
 *      - a label in brackets and a picture's name are always strings;
 *   3. hand back the filled text and its map (template-expansion.js ViewSegment).
 * datatree.js parseExampleView() reads the filled text with the format's reader. The other
 * functions lead places, nodes and changes of the example view back to the template: copied
 * text to the same place, a filled value to its tag. A value whose text holds an example stays
 * read-only in the example view.
 */

import { getTemplateTags } from './template-tags.js?v=2';
import { expandTemplate, getCopiedCodeRange, getCodeOffsetByViewOffset, findViewSegment, TemplateExpansionError } from './template-expansion.js?v=2';
import { getAddedFormat, getYamlLibrary, isContainer } from './datatree-core.js?v=3';
import { getNodeAtPosition } from './datatree-values.js?v=4';
import { getActiveTemplateSyntax, getTemplatePlaceFinder } from './datatree-template.js?v=1';

/** The message of a change in the example view that would change text of an example. */
export const EXAMPLE_EDIT_MESSAGE = 'This part shows an example - change it in the template view or in the code';
/** The place of a tag without one: text without a kind. */
const TEXT_PLACE = { role: 'text', style: null };
/** A line break in any form. */
const LINE_BREAK = /\r\n|\r|\n/g;
/** A run of line breaks in any form. */
const LINE_BREAK_RUN = /(?:\r\n|\r|\n)+/g;
/** A character that cannot start a plain YAML value. */
const YAML_INDICATOR_START = /^[-?:,[\]{}#&*!|>'"%@`]/;
/** The word joiner: text to YAML, not shown on the screen. */
const WORD_JOINER = '\u2060';
/** What ends or splits a plain YAML value: ":" before a space or tab, a space or tab before "#", or ":" at its end. */
const YAML_PLAIN_BREAK = /:[ \t]|:$|[ \t]#/;
/** The characters that end a plain YAML value inside a flow collection. */
const YAML_FLOW_INDICATOR = /[,[\]{}]/;
/** The quoted styles of a YAML scalar. */
const YAML_QUOTED_STYLES = new Set(['QUOTE_DOUBLE', 'QUOTE_SINGLE']);

/**
 * Writes an example for the place of a value tag in a format.
 * @callback FillWriter
 * @param {string} text - the example text, the picture's name or the label in brackets.
 * @param {import('./datatree-template-roles.js').TagPlace} place - the tag's role and kind of text.
 * @param {string} indent - the spaces and tabs the tag's line starts with.
 * @param {string} kind - "value" for an example text; "image" and "label" for text that is always a string.
 * @param {string} column - as many spaces as the tag's line holds characters before the tag.
 * @returns {string} the example as text of the format.
 */

/**
 * The example view of a template, read.
 * @typedef {object} ExampleView
 * @property {DataModel} model - the filled text read as data; its positions are places of the filled text.
 * @property {string} text - the filled text.
 * @property {import('./template-expansion.js').ViewSegment[]} map - the way from the filled text back to the code.
 */

/**
 * Fills a template with the page's examples (the steps in the header); a template syntax is set.
 * @param {string} format - 'json', 'yaml' or an added format.
 * @param {string} src - the template.
 * @param {?import('./template-examples.js').TemplateExamples} examples - the page's examples, or null.
 * @returns {import('./template-expansion.js').TemplateView} the filled text and its map.
 * @throws {import('./template-expansion.js').TemplateExpansionError} past a limit of the filling.
 */
export function buildExampleText(format, src, examples) {
    const syntax = getActiveTemplateSyntax();
    const tags = getTemplateTags(src, syntax);
    const places = getTemplatePlaceFinder(format)(src, tags);
    const placeByStart = new Map(tags.map((tag, index) => [tag.start, places[index] || TEXT_PLACE]));
    const writeFill = getFillWriter(format);
    return expandTemplate(src, syntax, {
        examples,
        writeFill: (tag, fill) => writeFill(fill.text, placeByStart.get(tag.start) || TEXT_PLACE, getLineIndent(src, tag.start), fill.kind, getTagColumn(src, tag.start)),
    });
}

/**
 * Returns the writer of examples of a format.
 * @param {string} format - 'json', 'yaml' or an added format.
 * @returns {FillWriter} the format's writer; an added format without one gets the JSON writer.
 */
function getFillWriter(format) {
    const added = getAddedFormat(format);
    if (added && added.writeTemplateFill) return added.writeTemplateFill;
    return format === 'yaml' ? writeYamlFill : writeJsonFill;
}

/**
 * Returns the spaces and tabs the line of an offset starts with.
 * @param {string} src - the code.
 * @param {number} offset - the offset.
 * @returns {string} the indentation of its line.
 */
function getLineIndent(src, offset) {
    const lineStart = src.lastIndexOf('\n', offset - 1) + 1;
    return /^[ \t]*/.exec(src.slice(lineStart, offset))[0];
}

/**
 * Returns as many spaces as the line of an offset holds characters before it.
 * @param {string} src - the code.
 * @param {number} offset - the offset.
 * @returns {string} the spaces.
 */
function getTagColumn(src, offset) {
    return ' '.repeat(offset - (src.lastIndexOf('\n', offset - 1) + 1));
}

/**
 * Writes an example for its place in JSON (JSON with comments, JSON5, JSON Lines).
 * @param {string} text - the example text, the picture's name or the label in brackets.
 * @param {import('./datatree-template-roles.js').TagPlace} place - the tag's role and kind of text.
 * @param {string} indent - the spaces and tabs the tag's line starts with.
 * @param {string} kind - "value" for an example text; "image" and "label" for text that is always a string.
 * @returns {string} the example as JSON text.
 */
export function writeJsonFill(text, place, indent, kind) {
    if (place.role === 'value' && place.bare !== false) return kind === 'value' && isJsonScalarLiteral(text) ? text : JSON.stringify(text);
    if (place.role === 'key') return JSON.stringify(text);
    if (place.style === 'double') return JSON.stringify(text).slice(1, -1);
    if (place.style === 'single') return escapeSingleQuotedJson(text);
    return escapeCommentText(text);
}

/**
 * Tells whether a text is a JSON literal of a number, true, false, null or a string.
 * @param {string} text - the text.
 * @returns {boolean} true when JSON reads it as one value that is no object or array.
 */
export function isJsonScalarLiteral(text) {
    if (!text || text !== text.trim()) return false;
    try {
        const value = JSON.parse(text);
        return value === null || typeof value !== 'object';
    } catch (error) {
        return false;
    }
}

/**
 * Escapes a text for a JSON5 string in single quotes.
 * @param {string} text - the text.
 * @returns {string} the text with backslashes, single quotes and control characters escaped.
 */
function escapeSingleQuotedJson(text) {
    return text.replace(/[\\'\u0000-\u001f\u2028\u2029]/g, character => (character === "'" ? "\\'" : JSON.stringify(character).slice(1, -1)));
}

/**
 * Escapes a text for a comment: on one line, with a space at each end and "*\/" apart, so it ends
 * no block comment, also together with the characters around it.
 * @param {string} text - the text.
 * @returns {string} the escaped text.
 */
function escapeCommentText(text) {
    return ' ' + text.replace(LINE_BREAK, ' ').replace(/\*\//g, '* /') + ' ';
}

/**
 * Writes an example for its place in YAML. A label in brackets or a picture's name that starts a
 * longer plain value gets a word joiner before it, since a plain value cannot start with "[".
 * @param {string} text - the example text, the picture's name or the label in brackets.
 * @param {import('./datatree-template-roles.js').TagPlace} place - the tag's role and kind of text.
 * @param {string} indent - the spaces and tabs the tag's line starts with.
 * @param {string} kind - "value" for an example text; "image" and "label" for text that is always a string.
 * @param {string} column - as many spaces as the tag's line holds characters before the tag.
 * @returns {string} the example as YAML text.
 * @throws {TemplateExpansionError} when a plain value cannot hold the example as it is.
 */
export function writeYamlFill(text, place, indent, kind, column) {
    if (place.role === 'value' && place.bare !== false) return kind === 'value' && isYamlScalarLiteral(text) ? text : JSON.stringify(text);
    if (place.role === 'value' && kind !== 'value' && YAML_INDICATOR_START.test(text)) return WORD_JOINER + writePlainYamlText(text, place, column);
    if (place.role === 'key') return JSON.stringify(text);
    if (place.style === 'QUOTE_DOUBLE') return JSON.stringify(text).slice(1, -1);
    if (place.style === 'QUOTE_SINGLE') return place.key ? text.replace(LINE_BREAK, ' ').replace(/'/g, "''") : escapeYamlLineBreaks(text.replace(/'/g, "''"), column, null);
    if (place.style === 'BLOCK_LITERAL') return text.replace(LINE_BREAK, '\n' + indent);
    if (place.style === 'BLOCK_FOLDED') return escapeYamlLineBreaks(text, indent, column.length === indent.length);
    if (place.style === 'comment') return text.replace(LINE_BREAK, ' ');
    return writePlainYamlText(text, place, column);
}

/**
 * Writes an example as text of a plain YAML value, its line breaks written for the folding of
 * the value (escapeYamlLineBreaks); a key keeps the example on one line. The text keeps the value one value.
 * @param {string} text - the example.
 * @param {import('./datatree-template-roles.js').TagPlace} place - the tag's place; flow is true inside a flow collection, key inside a key.
 * @param {string} column - as many spaces as the tag's line holds characters before the tag.
 * @returns {string} the text of the plain value.
 * @throws {TemplateExpansionError} when the text holds ":" before a space or tab, a space or tab before "#", ends with ":", or, in a flow collection, one of , [ ] { }; a line break counts as a space there.
 */
function writePlainYamlText(text, place, column) {
    const line = text.replace(LINE_BREAK, ' ');
    if (YAML_PLAIN_BREAK.test(line) || (place.flow && YAML_FLOW_INDICATOR.test(line))) throw new TemplateExpansionError('An example changes the structure of a plain YAML value');
    return place.key ? line : escapeYamlLineBreaks(text, column, null);
}

/**
 * Writes the line breaks of an example for a YAML scalar that folds a single line break into a
 * space (single quotes, plain text, a folded block scalar): each run of line breaks gets one more
 * line break, so the empty lines it makes read back as the example's line breaks, and the line
 * after it starts with the indentation given (for single quotes and plain text the tag's column,
 * which stands deeper than every block around it). In a folded block scalar a line that starts
 * with a space or tab keeps its line breaks as they are, so a run next to such a line stays as it is.
 * @param {string} text - the example, escaped for the scalar.
 * @param {string} indent - the spaces and tabs the line after a line break starts with.
 * @param {?boolean} isAtFoldedLineStart - for a folded block scalar (">"): true when the tag starts its line, false
 *     when text stands before it; null for single quotes and plain text.
 * @returns {string} the text with its line breaks written for the scalar.
 */
function escapeYamlLineBreaks(text, indent, isAtFoldedLineStart) {
    const isFoldedBlock = isAtFoldedLineStart !== null;
    /**
     * Returns the line breaks of one run, written for the scalar.
     * @param {string} run - the run of line breaks.
     * @param {number} offset - where the run starts in the text.
     * @returns {string} the line breaks and the indentation of the next line.
     */
    const writeRun = (run, offset) => {
        const count = run.match(LINE_BREAK).length;
        const lineStart = Math.max(text.lastIndexOf('\n', offset - 1), text.lastIndexOf('\r', offset - 1)) + 1;
        const isAfterIndented = (lineStart > 0 || isAtFoldedLineStart) && /^[ \t]/.test(text.slice(lineStart, offset));
        const isNextToIndented = isFoldedBlock && (isAfterIndented || /^[ \t]/.test(text.slice(offset + run.length)));
        return '\n'.repeat(isNextToIndented ? count : count + 1) + indent;
    };
    return text.replace(LINE_BREAK_RUN, writeRun);
}

/**
 * Tells whether a text is one YAML scalar on one line that reads as a number, true, false or null
 * (plain), or as a string (in quotes); without a tag, anchor, alias, comment or document structure
 * (the yaml package is loaded).
 * @param {string} text - the text.
 * @returns {boolean} true for such a scalar.
 */
export function isYamlScalarLiteral(text) {
    const YAML = getYamlLibrary();
    if (!YAML || !text || text !== text.trim() || /[\r\n]/.test(text)) return false;
    let document;
    try { document = YAML.parseDocument(text, { prettyErrors: false }); } catch (error) { return false; }
    const node = document.contents;
    if (document.errors.length || document.warnings.length || document.comment || !YAML.isScalar(node)) return false;
    if (node.tag || node.anchor || node.comment || node.commentBefore) return false;
    if (YAML_QUOTED_STYLES.has(node.type)) return true;
    return node.type === 'PLAIN' && (node.value === null || typeof node.value === 'number' || typeof node.value === 'boolean');
}

/**
 * Returns the stretch of the code a stretch of the example text stands for: copied text its own
 * place, text of an example its tag.
 * @param {import('./template-expansion.js').ViewSegment[]} map - the map of the example view.
 * @param {number} viewStart - where the stretch starts in the example text.
 * @param {number} viewEnd - where it ends.
 * @returns {{start: number, end: number}} the stretch in the code.
 */
export function getCodeRangeByViewRange(map, viewStart, viewEnd) {
    const start = getCodeOffsetByViewOffset(map, viewStart);
    if (viewEnd <= viewStart) return { start, end: start };
    const segment = map[findViewSegment(map, viewEnd - 1)];
    if (!segment) return { start, end: start };
    const end = segment.kind === 'fill' ? segment.codeEnd : segment.codeStart + Math.min(viewEnd, segment.viewEnd) - segment.viewStart;
    return { start, end: Math.max(start, end) };
}

/**
 * Returns the place in the example text of a place in the code: the first copy of the character,
 * the start of the example a tag became, or the next place that was filled in when the code's
 * place was left out (a section's line).
 * @param {import('./template-expansion.js').ViewSegment[]} map - the map of the example view.
 * @param {number} codeOffset - the place in the code.
 * @returns {number} the place in the example text.
 */
export function getViewOffsetByCodeOffset(map, codeOffset) {
    let next = null;
    for (const segment of map) {
        if (codeOffset >= segment.codeStart && codeOffset < segment.codeEnd) return segment.kind === 'copy' ? segment.viewStart + codeOffset - segment.codeStart : segment.viewStart;
        if (segment.codeStart >= codeOffset && (!next || segment.codeStart < next.codeStart)) next = segment;
    }
    if (next) return next.viewStart;
    return map.length ? map[map.length - 1].viewEnd : 0;
}

/**
 * Returns the node of the template a node of the example view comes from: the node whose place in
 * the code is the place the example node stands for.
 * @param {DataModel} templateModel - the template read as data.
 * @param {import('./template-expansion.js').ViewSegment[]} map - the map of the example view.
 * @param {DataNode} node - the node of the example view.
 * @returns {?DataNode} the template's node, or null when no node of the template stands there.
 */
export function findTemplateNode(templateModel, map, node) {
    const range = getCodeRangeByViewRange(map, node.start, node.end);
    const isBox = isContainer(node);
    for (let current = getNodeAtPosition(templateModel, range.start); current; current = current.entry ? current.entry.parent : null) {
        if (current.start < range.start) return null;
        const isPlace = current.start === range.start && (isBox || current.end === range.end);
        if (isPlace && isSameShape(node, current)) return current;
    }
    return null;
}

/**
 * Tells whether a node of the example view and a node of the template stand in the same place of
 * their data: the same kind of value (a placeholder value stands for any), at the same depth, under
 * the same keys (array places may differ, since lists repeat). An object or array matches by its
 * start, since a section left out at its end moves its end.
 * @param {DataNode} node - the node of the example view.
 * @param {DataNode} templateNode - the template's node.
 * @returns {boolean} true when both stand in the same place.
 */
function isSameShape(node, templateNode) {
    if (templateNode.placeholder !== 'value' && isContainer(node) !== isContainer(templateNode)) return false;
    if (isContainer(node) && node.type !== templateNode.type) return false;
    let current = node, other = templateNode;
    while (current.entry && other.entry) {
        const parent = current.entry.parent;
        if (parent.type !== other.entry.parent.type || (parent.type === 'object' && current.entry.key !== other.entry.key)) return false;
        current = parent;
        other = other.entry.parent;
    }
    return !current.entry && !other.entry;
}

/**
 * Tells whether a stretch of the example text is all copied text of the template, in one piece.
 * @param {import('./template-expansion.js').ViewSegment[]} map - the map of the example view.
 * @param {number} viewStart - where it starts.
 * @param {number} viewEnd - where it ends.
 * @returns {boolean} true when no example stands in it.
 */
function isCopiedRange(map, viewStart, viewEnd) {
    return getCopiedCodeRange(map, viewStart, viewEnd) !== null;
}

/**
 * Returns the entry of the template an entry of the example view comes from.
 * @param {DataModel} templateModel - the template read as data.
 * @param {import('./template-expansion.js').ViewSegment[]} map - the map of the example view.
 * @param {DataEntry} entry - the entry of the example view.
 * @returns {?DataEntry} the template's entry, or null when the template has none there.
 */
function findTemplateEntry(templateModel, map, entry) {
    const node = findTemplateNode(templateModel, map, entry.node);
    if (!node || !node.entry) return null;
    return getCodeOffsetByViewOffset(map, entry.start) === node.entry.start ? node.entry : null;
}

/**
 * Returns the entry of the template whose key an entry of the example view shows as copied text.
 * @param {DataModel} templateModel - the template read as data.
 * @param {import('./template-expansion.js').ViewSegment[]} map - the map of the example view.
 * @param {DataEntry} entry - the entry of the example view.
 * @returns {?DataEntry} the template's entry, or null when the key holds an example or the template has none there.
 */
function findTemplateKeyEntry(templateModel, map, entry) {
    if (entry.keyStart === undefined || !isCopiedRange(map, entry.keyStart, entry.keyEnd)) return null;
    const found = findTemplateEntry(templateModel, map, entry);
    return found && found.keyStart === getCodeOffsetByViewOffset(map, entry.keyStart) ? found : null;
}

/**
 * Returns the node of the template whose value a node of the example view shows as copied text.
 * @param {DataModel} templateModel - the template read as data.
 * @param {import('./template-expansion.js').ViewSegment[]} map - the map of the example view.
 * @param {DataNode} node - the node of the example view.
 * @returns {?DataNode} the template's node, or null when the value holds an example or the template has none there.
 */
function findTemplateValueNode(templateModel, map, node) {
    if (!isContainer(node) && !isCopiedRange(map, node.start, node.end)) return null;
    return findTemplateNode(templateModel, map, node);
}

/**
 * Tells whether a key or value of the example view may be edited: it shows copied text of the
 * template, which the edit changes.
 * @param {string} what - 'key' or 'value'.
 * @param {{node: DataNode, entry: ?DataEntry}} info - the node and entry of the example view.
 * @param {DataModel} templateModel - the template read as data.
 * @param {import('./template-expansion.js').ViewSegment[]} map - the map of the example view.
 * @returns {boolean} true when the edit may start.
 */
export function isExampleEditable(what, info, templateModel, map) {
    if (what === 'key') return !!info.entry && !!findTemplateKeyEntry(templateModel, map, info.entry);
    return !!info.node && !!findTemplateValueNode(templateModel, map, info.node);
}

/**
 * Builds the change of the template that a change in the example view stands for: its node,
 * entry or object leads back to the template's own; a value or key changes only where it shows
 * copied text.
 * @param {import('./datatree-core.js').TreeEdit} change - the change in the example view.
 * @param {DataModel} templateModel - the template read as data.
 * @param {import('./template-expansion.js').ViewSegment[]} map - the map of the example view.
 * @returns {?import('./datatree-core.js').TreeEdit} the change of the template, or null when it would change an example.
 */
export function buildTemplateChange(change, templateModel, map) {
    const result = { ...change };
    if (change.node) result.node = findTemplateValueNode(templateModel, map, change.node);
    if (change.entry) result.entry = change.kind === 'key' ? findTemplateKeyEntry(templateModel, map, change.entry) : findTemplateEntry(templateModel, map, change.entry);
    if (change.box) {
        result.box = findTemplateNode(templateModel, map, change.box);
        result.at = result.box ? getTemplateIndex(templateModel, map, change.box, change.at, result.box) : null;
    }
    const isComplete = (!change.node || result.node) && (!change.entry || result.entry) && (!change.box || (result.box && result.at !== null));
    return isComplete ? result : null;
}

/**
 * Returns where an entry added at an index of an object or array of the example view goes in the
 * template's object or array: after the template's entry the example's entry before it comes from.
 * @param {DataModel} templateModel - the template read as data.
 * @param {import('./template-expansion.js').ViewSegment[]} map - the map of the example view.
 * @param {DataNode} box - the object or array of the example view.
 * @param {number|undefined} at - the index in it; undefined or past its end to add at the end.
 * @param {DataNode} templateBox - the template's object or array.
 * @returns {?number} the index in the template's object or array, or undefined to add at its end; null when the entry before comes from no entry of the template.
 */
function getTemplateIndex(templateModel, map, box, at, templateBox) {
    if (at === undefined) return undefined;
    if (at >= box.entries.length) return templateBox.entries.length;
    if (at <= 0) return 0;
    const before = findTemplateEntry(templateModel, map, box.entries[at - 1]);
    return before && before.parent === templateBox ? before.index + 1 : null;
}
