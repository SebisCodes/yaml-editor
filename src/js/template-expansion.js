/**
 * The example view of a template: the code filled with the page's examples, and the map that
 * leads every place of the filled text back to the code.
 *
 * expandTemplate() runs these steps:
 *   1. find the tags and build the tree of sections, closed as the section check reads them (an
 *      end tag closes the inner sections with it; a stray end tag and a tag with an unknown sign
 *      add nothing); a line that holds only section tags and spaces is left out with its line
 *      break, as Mustache does (an editor may name further characters such a line holds, as the
 *      pipes of a Markdown table row);
 *   2. walk the tree: text of the code is copied, a value tag becomes its example (or its label
 *      in brackets) written by the editor for its place, a section is shown by its example state
 *      (an inverted section the opposite), a list repeats its body once per example row;
 *   3. keep a segment per copied or filled stretch, so every place of the filled text points into
 *      the code: copied text to the same character, filled text to its tag; an empty fill keeps a
 *      segment of no length, so the text around it is never taken as one piece of the code.
 * The editor writes each fill for its place and sees the filled text just before it, so a place
 * that only exists after sections were left out (a backslash or "<" right before the fill) counts.
 * The work is bounded: the filled text, the segments, the steps and the depth of sections have
 * limits; past one, expandTemplate() throws a TemplateExpansionError.
 * buildTagTextView() makes the template view for an editor that compiles text: every tag as the
 * text the editor writes for it, with the same kind of map.
 * Every editor with template placeholders uses this same file; it works on strings only, so it
 * runs in Node as well.
 */

import { getTemplateTags } from './template-tags.js?v=2';

/** The most characters the filled text may hold beyond the code's own length. */
const EXTRA_CHARACTERS = 2e6;
/** The most segments of a map. */
const MAX_SEGMENTS = 5e5;
/** The most tree nodes visited in one expansion. */
const MAX_STEPS = 2e6;
/** How many characters of the filled text before a fill its writer sees. */
const TAIL_LENGTH = 64;
/** How deep sections may stand in each other. */
const MAX_DEPTH = 32;
/** The kinds of tags that open a section. */
const OPENING_KINDS = new Set(['section', 'inverted']);
/** What a line of section tags holds besides its tags to be left out, unless the editor names more: white space. */
const SPACES_ONLY = /^\s*$/;

/**
 * The error of an expansion that went past one of its limits.
 */
export class TemplateExpansionError extends RangeError {
    /**
     * Creates the error.
     * @param {string} message - what went past its limit.
     * @returns {void}
     */
    constructor(message) {
        super(message);
        this.name = 'TemplateExpansionError';
    }
}

/**
 * A stretch of the filled text and where it comes from in the code. Offsets are UTF-16 code units.
 * @typedef {object} ViewSegment
 * @property {number} viewStart - where it starts in the filled text.
 * @property {number} viewEnd - where it ends in the filled text.
 * @property {number} codeStart - where it comes from: the copied text's start, or the tag's start.
 * @property {number} codeEnd - the copied text's end, or the tag's end.
 * @property {string} kind - "copy" for text of the code, "fill" for text of an example or label.
 * @property {number} row - the number of the list entry it was written for, counted through the
 *     whole text from 1; 0 outside every list.
 * @property {?import('./template-pictures.js').ExamplePicture} picture - fill: the example picture it stands for, else null.
 */

/**
 * What a value tag is filled with, before the editor writes it for its place.
 * @typedef {object} TagFill
 * @property {string} kind - "value" (an example text), "image" (an example picture) or "label" (no example: the label in brackets).
 * @property {string} text - the example text, the picture's name, or the label in brackets.
 * @property {?import('./template-pictures.js').ExamplePicture} picture - the example picture, null for other kinds.
 * @property {?import('./template-examples.js').TemplatePlaceholder} placeholder - the page's placeholder, null for a name it did not list.
 */

/**
 * Writes a value tag's fill for its place in the format.
 * @callback FillWriter
 * @param {import('./template-tags.js').TemplateTag} tag - the tag in the code.
 * @param {TagFill} fill - what it is filled with.
 * @param {string} before - the last characters of the filled text before the fill (at most 64).
 * @returns {string} the fill as the format's text.
 */

/**
 * The filled text with its map.
 * @typedef {object} TemplateView
 * @property {string} text - the filled text.
 * @property {ViewSegment[]} map - the segments in the order of the filled text, covering all of it.
 */

/**
 * Fills a template with the page's examples (the steps in the header).
 * @param {string} code - the template.
 * @param {import('./template-tags.js').TemplateSyntax} syntax - the syntax.
 * @param {object} options - the examples and how a filled value is written.
 * @param {?import('./template-examples.js').TemplateExamples} options.examples - the page's examples, or null.
 * @param {FillWriter} options.writeFill - writes a value tag's fill for the tag's place in the format (escaped for it).
 * @param {RegExp} [options.controlLine] - what the text around the section tags of a line has to match for the line
 *     to be left out with its line break; white space by default.
 * @returns {TemplateView} the filled text and its map.
 * @throws {TemplateExpansionError} when the text, the segments, the steps or the depth go past their limits.
 */
export function expandTemplate(code, syntax, { examples, writeFill, controlLine = SPACES_ONLY }) {
    const tags = getTemplateTags(code, syntax);
    const tree = buildSectionTree(code, tags, getTagCuts(code, tags, controlLine));
    const output = createOutput(code);
    const scopes = [{ byName: examples ? examples.byName : new Map(), row: null, fields: null, isLabelRow: false }];
    writeNodes(output, tree, scopes, { examples, writeFill }, 0, 0);
    return { text: output.parts.join(''), map: output.map };
}

/**
 * Writes a tag as the text a format shows for it in the template view.
 * @callback TagWriter
 * @param {import('./template-tags.js').TemplateTag} tag - the tag in the code.
 * @param {string} before - the last characters of the text before it (at most 64).
 * @returns {string} the tag as the format's text.
 */

/**
 * Builds the template view of a template for an editor that compiles text: the code with every
 * tag, section tags included, as the text the editor writes for it (its own text, escaped for its
 * place). The map leads copied text to the same character and a tag's text to its tag.
 * @param {string} code - the template.
 * @param {import('./template-tags.js').TemplateSyntax} syntax - the syntax.
 * @param {object} options - how a tag is written.
 * @param {TagWriter} options.writeTag - writes a tag for its place in the format.
 * @returns {TemplateView} the text and its map.
 * @throws {TemplateExpansionError} when the text or the segments go past their limits.
 */
export function buildTagTextView(code, syntax, { writeTag }) {
    const output = createOutput(code);
    let last = 0;
    for (const tag of getTemplateTags(code, syntax)) {
        addSegment(output, last, tag.start, null, 0);
        addSegment(output, tag.start, tag.end, String(writeTag(tag, output.tail)), 0);
        last = tag.end;
    }
    addSegment(output, last, code.length, null, 0);
    return { text: output.parts.join(''), map: output.map };
}

/**
 * Creates the output a view is written into.
 * @param {string} code - the template.
 * @returns {object} the output: code, parts, tail, length, map, steps, rows and limit.
 */
function createOutput(code) {
    return { code, parts: [], tail: '', length: 0, map: [], steps: 0, rows: 0, limit: code.length + EXTRA_CHARACTERS };
}

/**
 * A node of the section tree.
 * @typedef {object} TemplateNode
 * @property {string} type - "text", "value" or "section".
 * @property {number} [start] - text: where it starts in the code.
 * @property {number} [end] - text: where it ends.
 * @property {import('./template-tags.js').TemplateTag} [tag] - value and section: the tag.
 * @property {boolean} [inverted] - section: true for an inverted section.
 * @property {TemplateNode[]} [children] - section: the nodes inside.
 */

/**
 * The stretch of the code a tag takes out of the filled text.
 * @typedef {object} TagCut
 * @property {number} start - where it starts in the code.
 * @property {number} end - where it ends.
 */

/**
 * Returns the stretch of the code each tag takes out of the filled text: the tag itself, or, for
 * the tags of a line that holds only section tags and the text of a control line, the whole line
 * with its line break (the first tag takes the text before it, each next tag the text before it,
 * the last one the text after it and the line break).
 * @param {string} code - the template.
 * @param {import('./template-tags.js').TemplateTag[]} tags - its tags.
 * @param {RegExp} controlLine - what the text around the tags of a control line matches.
 * @returns {TagCut[]} the stretch of each tag, in the order of the tags.
 */
function getTagCuts(code, tags, controlLine) {
    const cuts = tags.map(tag => ({ start: tag.start, end: tag.end }));
    let index = 0;
    while (index < tags.length) {
        const lineStart = code.lastIndexOf('\n', tags[index].start - 1) + 1;
        const breakAt = code.indexOf('\n', tags[index].start);
        const lineEnd = breakAt < 0 ? code.length : breakAt;
        let last = index;
        while (last + 1 < tags.length && tags[last + 1].end <= lineEnd) last++;
        const lineTags = tags.slice(index, last + 1);
        if (lineTags.every(tag => tag.kind !== 'value') && isControlLine(code, lineStart, lineEnd, lineTags, controlLine)) {
            for (let tagIndex = index; tagIndex <= last; tagIndex++) {
                cuts[tagIndex].start = tagIndex === index ? lineStart : tags[tagIndex - 1].end;
                cuts[tagIndex].end = tagIndex === last ? (breakAt < 0 ? lineEnd : lineEnd + 1) : tags[tagIndex].end;
            }
        }
        index = last + 1;
    }
    return cuts;
}

/**
 * Tells whether a line holds nothing but tags and the text of a control line.
 * @param {string} code - the template.
 * @param {number} lineStart - where the line starts.
 * @param {number} lineEnd - where it ends (before its line break).
 * @param {import('./template-tags.js').TemplateTag[]} lineTags - the tags on the line, in order.
 * @param {RegExp} controlLine - what the text between and around the tags has to match.
 * @returns {boolean} true when the text between and around the tags matches.
 */
function isControlLine(code, lineStart, lineEnd, lineTags, controlLine) {
    let rest = '', last = lineStart;
    for (const tag of lineTags) {
        rest += code.slice(last, tag.start);
        last = tag.end;
    }
    return controlLine.test(rest + code.slice(last, lineEnd));
}

/**
 * Builds the tree of sections from the tags: text between tags, value tags and sections with
 * their nodes. An end tag closes the last open section of its name and the inner ones with it; a
 * stray end tag and a tag with an unknown sign add no node.
 * @param {string} code - the template.
 * @param {import('./template-tags.js').TemplateTag[]} tags - its tags.
 * @param {TagCut[]} cuts - the stretch each tag takes out of the text.
 * @returns {TemplateNode[]} the nodes of the top level.
 */
function buildSectionTree(code, tags, cuts) {
    const root = { children: [] };
    const open = [root];
    let last = 0;
    tags.forEach((tag, index) => {
        if (cuts[index].start > last) open[open.length - 1].children.push({ type: 'text', start: last, end: cuts[index].start });
        addTagNode(open, tag);
        last = cuts[index].end;
    });
    if (code.length > last) open[open.length - 1].children.push({ type: 'text', start: last, end: code.length });
    return root.children;
}

/**
 * Adds the node of one tag to the open section, or opens or closes a section.
 * @param {Array<object>} open - the open sections (each with its children), the innermost last; changed in place.
 * @param {import('./template-tags.js').TemplateTag} tag - the tag.
 * @returns {void}
 */
function addTagNode(open, tag) {
    const current = open[open.length - 1];
    if (tag.kind === 'value') { current.children.push({ type: 'value', tag }); return; }
    if (OPENING_KINDS.has(tag.kind)) {
        const section = { type: 'section', tag, inverted: tag.kind === 'inverted', children: [] };
        current.children.push(section);
        open.push(section);
        return;
    }
    if (tag.kind !== 'close') return;
    for (let index = open.length - 1; index > 0; index--) {
        if (open[index].tag.name === tag.name) { open.length = index; return; }
    }
}

/**
 * Writes the nodes of one level of the tree into the output.
 * @param {object} output - the output: code, parts, tail (its last characters), length, map, steps, rows and limit; changed in place.
 * @param {TemplateNode[]} nodes - the nodes.
 * @param {Array<object>} scopes - the names known here, the innermost last.
 * @param {object} options - the examples and writeFill of expandTemplate().
 * @param {number} depth - how deep in sections the nodes stand.
 * @param {number} row - the number of the list entry the nodes are written for, 0 outside every list.
 * @returns {void}
 */
function writeNodes(output, nodes, scopes, options, depth, row) {
    if (depth > MAX_DEPTH) throw new TemplateExpansionError('The sections stand too deep in each other');
    for (const node of nodes) {
        if (++output.steps > MAX_STEPS) throw new TemplateExpansionError('The template repeats too much');
        if (node.type === 'text') addSegment(output, node.start, node.end, null, row);
        else if (node.type === 'value') addFill(output, node.tag, getTagFill(node.tag.name, scopes, options.examples), options, row);
        else writeSection(output, node, scopes, options, depth, row);
    }
}

/**
 * Writes a section by its example state: shown once, hidden, or once per example row of a list.
 * @param {object} output - the output; changed in place.
 * @param {TemplateNode} section - the section node.
 * @param {Array<object>} scopes - the names known here.
 * @param {object} options - the examples and writeFill of expandTemplate().
 * @param {number} depth - how deep in sections it stands.
 * @param {number} row - the number of the list entry it is written for.
 * @returns {void}
 */
function writeSection(output, section, scopes, options, depth, row) {
    const state = getSectionState(section.tag.name, scopes);
    if (state.list) {
        const rows = state.list.rows;
        if (section.inverted) { if (rows && !rows.length) writeNodes(output, section.children, scopes, options, depth + 1, row); return; }
        for (const values of rows || [null]) {
            const scope = { byName: null, row: values || new Map(), fields: state.list.fieldsByName, isLabelRow: !values };
            writeNodes(output, section.children, [...scopes, scope], options, depth + 1, ++output.rows);
        }
        return;
    }
    const shown = section.inverted ? state.shown === false : state.shown !== false;
    if (shown) writeNodes(output, section.children, scopes, options, depth + 1, row);
}

/**
 * Returns the example state of a section's name: a list with its rows, or true / false / null
 * (null: no example state, shown once and its inverted section hidden).
 * @param {string} name - the section's name.
 * @param {Array<object>} scopes - the names known here.
 * @returns {{list: ?import('./template-examples.js').TemplatePlaceholder, shown: ?boolean}} the state.
 */
function getSectionState(name, scopes) {
    const found = findName(name, scopes);
    if (!found) return { list: null, shown: null };
    if (found.value !== undefined) return { list: null, shown: typeof found.value === 'boolean' ? found.value : found.value !== '' };
    const placeholder = found.placeholder;
    if (placeholder.kind === 'list') return { list: placeholder, shown: null };
    if (placeholder.kind === 'section') return { list: null, shown: placeholder.shown };
    if (placeholder.kind === 'value') return { list: null, shown: placeholder.example === null ? null : placeholder.example !== '' };
    return { list: null, shown: placeholder.image ? true : null };
}

/**
 * Finds a name in the scopes, the innermost first: a row's value, a list's field, or a
 * placeholder of the page. Names are literal keys.
 * @param {string} name - the name.
 * @param {Array<object>} scopes - the names known here.
 * @returns {?{value: (string|boolean|undefined), placeholder: ?import('./template-examples.js').TemplatePlaceholder, isLabelRow: boolean}} what the
 *     name stands for, or null when no scope knows it.
 */
function findName(name, scopes) {
    for (let index = scopes.length - 1; index >= 0; index--) {
        const scope = scopes[index];
        const field = scope.fields ? scope.fields.get(name) : null;
        if (scope.row && scope.row.has(name)) return { value: scope.row.get(name), placeholder: field || null, isLabelRow: false };
        if (field) return { value: undefined, placeholder: field, isLabelRow: scope.isLabelRow };
        if (scope.byName && scope.byName.has(name)) return { value: undefined, placeholder: scope.byName.get(name), isLabelRow: false };
    }
    return null;
}

/**
 * Returns what a value tag is filled with: a row's value, the placeholder's example or example
 * picture, or the label (the name for a name the page did not list) in brackets; the fields of the
 * one entry a list without rows shows are their labels.
 * @param {string} name - the tag's name.
 * @param {Array<object>} scopes - the names known here.
 * @param {?import('./template-examples.js').TemplateExamples} examples - the page's examples.
 * @returns {TagFill} the fill.
 */
function getTagFill(name, scopes, examples) {
    const found = findName(name, scopes);
    if (!found) return { kind: 'label', text: `[${name}]`, picture: null, placeholder: null };
    const placeholder = found.placeholder;
    const label = { kind: 'label', text: `[${placeholder ? placeholder.label : name}]`, picture: null, placeholder };
    if (found.isLabelRow) return label;
    if (found.value !== undefined) {
        if (placeholder && placeholder.kind === 'image') return getPictureFill(String(found.value), placeholder, examples) || label;
        return typeof found.value === 'string' ? { kind: 'value', text: found.value, picture: null, placeholder } : label;
    }
    if (placeholder.kind === 'value' && placeholder.example !== null) return { kind: 'value', text: placeholder.example, picture: null, placeholder };
    if (placeholder.kind === 'image' && placeholder.image) return getPictureFill(placeholder.image, placeholder, examples) || label;
    return label;
}

/**
 * Returns the fill of an example picture by its name.
 * @param {string} pictureName - the picture's name in the page's `assets`.
 * @param {import('./template-examples.js').TemplatePlaceholder} placeholder - the placeholder.
 * @param {?import('./template-examples.js').TemplateExamples} examples - the page's examples.
 * @returns {?TagFill} the fill, or null when the picture is not there.
 */
function getPictureFill(pictureName, placeholder, examples) {
    const picture = examples ? examples.pictures.get(pictureName) : null;
    return picture ? { kind: 'image', text: picture.name, picture, placeholder } : null;
}

/**
 * Adds a value tag's fill to the output, written for the tag's place by the editor.
 * @param {object} output - the output; changed in place.
 * @param {import('./template-tags.js').TemplateTag} tag - the tag.
 * @param {TagFill} fill - what it is filled with.
 * @param {object} options - the examples and writeFill of expandTemplate().
 * @param {number} row - the number of the list entry, 0 outside every list.
 * @returns {void}
 */
function addFill(output, tag, fill, options, row) {
    addSegment(output, tag.start, tag.end, String(options.writeFill(tag, fill, output.tail)), row, fill.picture);
}

/**
 * Adds a stretch to the output: copied text of the code (fill null) or a tag's fill.
 * @param {object} output - the output; changed in place.
 * @param {number} codeStart - where the copied text or the tag starts in the code.
 * @param {number} codeEnd - where it ends.
 * @param {?string} fill - the written fill, or null to copy the code's text.
 * @param {number} row - the number of the list entry, 0 outside every list.
 * @param {?import('./template-pictures.js').ExamplePicture} [picture=null] - the example picture a fill stands for.
 * @returns {void}
 * @throws {TemplateExpansionError} when the text or the segments go past their limits.
 */
function addSegment(output, codeStart, codeEnd, fill, row, picture = null) {
    const text = fill === null ? output.code.slice(codeStart, codeEnd) : fill;
    if (!text.length && fill === null) return;
    if (output.length + text.length > output.limit) throw new TemplateExpansionError('The filled template is too long');
    const viewStart = output.length;
    output.parts.push(text);
    output.length += text.length;
    output.tail = (output.tail + text).slice(-TAIL_LENGTH);
    const kind = fill === null ? 'copy' : 'fill';
    const previous = output.map[output.map.length - 1];
    if (kind === 'copy' && previous && previous.kind === 'copy' && previous.codeEnd === codeStart && previous.row === row) {
        previous.viewEnd = output.length;
        previous.codeEnd = codeEnd;
        return;
    }
    if (output.map.length >= MAX_SEGMENTS) throw new TemplateExpansionError('The filled template has too many parts');
    output.map.push({ viewStart, viewEnd: output.length, codeStart, codeEnd, kind, row, picture });
}

/**
 * Finds the segment that holds a place of the filled text: the one that starts at or before it
 * and ends after it, else the last one that ends at it.
 * @param {ViewSegment[]} map - the map.
 * @param {number} viewOffset - the place in the filled text.
 * @returns {number} the segment's index, -1 for an empty map.
 */
export function findViewSegment(map, viewOffset) {
    let low = 0, high = map.length - 1, found = -1;
    while (low <= high) {
        const middle = (low + high) >> 1;
        if (map[middle].viewStart <= viewOffset) { found = middle; low = middle + 1; } else high = middle - 1;
    }
    return found < 0 && map.length ? 0 : found;
}

/**
 * Returns the place in the code of a place of the filled text: the same character of copied
 * text, the tag's start for filled text, the end of the last stretch past the text's end.
 * @param {ViewSegment[]} map - the map.
 * @param {number} viewOffset - the place in the filled text.
 * @returns {number} the place in the code.
 */
export function getCodeOffsetByViewOffset(map, viewOffset) {
    const index = findViewSegment(map, viewOffset);
    if (index < 0) return 0;
    const segment = map[index];
    if (segment.kind === 'fill') return viewOffset >= segment.viewEnd ? segment.codeEnd : segment.codeStart;
    return segment.codeStart + Math.max(0, Math.min(viewOffset, segment.viewEnd) - segment.viewStart);
}

/**
 * Returns the stretch of the code a stretch of the filled text was copied from, when all of it
 * is copied text of one piece: the segments it covers are copies, follow each other in the code
 * and belong to the same list entry.
 * @param {ViewSegment[]} map - the map.
 * @param {number} viewStart - where the stretch starts in the filled text.
 * @param {number} viewEnd - where it ends.
 * @returns {?{start: number, end: number}} the stretch in the code, or null when part of it is filled or not of one piece.
 */
export function getCopiedCodeRange(map, viewStart, viewEnd) {
    if (hasFillInRange(map, viewStart, viewEnd)) return null;
    let index = findViewSegment(map, viewStart);
    if (index < 0) return null;
    if (viewStart === viewEnd && map[index].viewEnd === viewStart && map[index + 1]?.viewStart === viewStart && map[index + 1].kind === 'copy') index++;
    const first = map[index];
    if (first.kind !== 'copy' || viewStart > first.viewEnd) return null;
    let segment = first;
    while (segment.viewEnd < viewEnd) {
        const next = map[++index];
        if (!next || next.kind !== 'copy' || next.viewStart !== segment.viewEnd || next.codeStart !== segment.codeEnd || next.row !== segment.row) return null;
        segment = next;
    }
    return { start: first.codeStart + (viewStart - first.viewStart), end: segment.codeStart + (viewEnd - segment.viewStart) };
}

/**
 * Tells whether a stretch of the filled text holds text of an example or a label, or touches an
 * empty fill (at its ends too).
 * @param {ViewSegment[]} map - the map.
 * @param {number} viewStart - where the stretch starts.
 * @param {number} viewEnd - where it ends.
 * @returns {boolean} true when a fill segment overlaps the stretch, or an empty one lies inside or at its ends.
 */
export function hasFillInRange(map, viewStart, viewEnd) {
    for (let index = Math.max(0, findViewSegment(map, viewStart) - 1); index < map.length && map[index].viewStart <= viewEnd; index++) {
        const segment = map[index];
        if (segment.kind !== 'fill') continue;
        const isEmpty = segment.viewStart === segment.viewEnd;
        if (isEmpty ? segment.viewStart >= viewStart && segment.viewStart <= viewEnd : segment.viewEnd > viewStart && segment.viewStart < viewEnd) return true;
    }
    return false;
}

/**
 * Returns the fill segment that is exactly a stretch of the filled text, if one is.
 * @param {ViewSegment[]} map - the map.
 * @param {number} viewStart - where the stretch starts.
 * @param {number} viewEnd - where it ends.
 * @returns {?ViewSegment} the segment, or null when the stretch is not one whole fill.
 */
export function findFillAt(map, viewStart, viewEnd) {
    const index = findViewSegment(map, viewStart);
    const segment = index >= 0 ? map[index] : null;
    return segment && segment.kind === 'fill' && segment.viewStart === viewStart && segment.viewEnd === viewEnd ? segment : null;
}
