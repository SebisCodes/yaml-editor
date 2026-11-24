/**
 * Template placeholders in the data tree (?template= in the editor's address, template-tags.js):
 * a page's server fills the tags in before the data is used, so the tree reads a template as the
 * data it stands for.
 *
 * The editor sets the syntax once (setTemplateSyntax); from then on parse() of datatree.js (and
 * every reader called through readTemplateCode) runs these steps for a code that holds tags:
 * 1. find the role of every tag (text, value, key, section; datatree-template-roles.js, and an
 *    added format's own findTemplateRoles);
 * 2. read the code with every tag escaped by a stand-in of the same length, so every position
 *    of the model is the position in the code as written: a value becomes 0, a key a quoted key
 *    of private-use characters (each one different), a section tag spaces, text stays as written;
 * 3. mark the model: a value written with a placeholder is a string node holding the code as
 *    written (placeholder "value"), a string holding a tag has placeholder "text", a key holding
 *    a tag placeholderKey, a container whose entries a section repeats or leaves out "repeated";
 * 4. add the placeholder errors: the section check of template-tags.js and each placeholder key.
 *
 * The edits of the tree keep every tag outside the changed part (checkTemplateEdit).
 */

import { getTemplateTags, checkTemplateSections, escapeTemplateTags } from './template-tags.js?v=2';
import { getAddedFormat, isContainer } from './datatree-core.js?v=3';
import { findJsonTagRoles, findYamlTagRoles, findJsonTagPlaces, findYamlTagPlaces } from './datatree-template-roles.js?v=1';

/** The message of a tree edit that would change a placeholder. */
export const TEMPLATE_EDIT_MESSAGE = 'This part holds a placeholder - change it in the code';
/** The message of Format, Minify, Sort, Tidy and the conversions while the document holds tags. */
export const TEMPLATE_FORMAT_MESSAGE = 'A template stays as written - Format and conversions work on filled data';
/** The stand-in of a placeholder value: a number, the shortest value of every format. */
const VALUE_STAND_IN = '0';
/** The first private-use character of the key stand-ins, and how many there are. */
const KEY_STAND_IN_FIRST = 0xe000;
const KEY_STAND_IN_COUNT = 6400;
/** The deepest nesting whose nodes are marked. */
const MAX_MARK_DEPTH = 1000;

let templateSyntax = null;

/**
 * Sets the template syntax for every document of the page (null: plain data).
 * @param {?import('./template-tags.js').TemplateSyntax} syntax - the syntax of ?template=, or null.
 * @returns {void}
 */
export function setTemplateSyntax(syntax) { templateSyntax = syntax || null; }

/**
 * Returns the template syntax the page set.
 * @returns {?import('./template-tags.js').TemplateSyntax} the syntax, or null for plain data.
 */
export const getActiveTemplateSyntax = () => templateSyntax;

/**
 * Tells whether a code holds a template tag of the page's syntax.
 * @param {string} src - the code.
 * @returns {boolean} true when a syntax is set and the code holds a tag.
 */
export function hasTemplateTags(src) {
    return !!templateSyntax && getTemplateTags(src, templateSyntax).length > 0;
}

/**
 * A tag with its role in the code.
 * @typedef {object} RoledTag
 * @property {number} start - the offset of the tag.
 * @property {number} end - the offset after it.
 * @property {string} kind - value, section, inverted, close or unknown.
 * @property {string} role - text, value, key or section.
 */

/**
 * The code prepared for the reader.
 * @typedef {object} TemplateCode
 * @property {string} code - the code with the tags escaped by stand-ins of the same length.
 * @property {RoledTag[]} tags - the tags with their roles, in order.
 */

/**
 * Reads a code into a model with the tags escaped for the reader and the model marked (the
 * steps of the header); without syntax or tags the reader gets the code as it is.
 * @param {string} src - the code.
 * @param {function(string, Array<object>): string[]} findRoles - returns the role of each tag of the code.
 * @param {function(string): DataModel} readCode - the format's reader.
 * @returns {DataModel} the model.
 */
export function readTemplateCode(src, findRoles, readCode) {
    const template = escapeTemplateForFormat(src, findRoles);
    const model = readCode(template ? template.code : src);
    if (template) addTemplateParts(model, src, template);
    return model;
}

/**
 * Escapes the tags of a code for the reader of its format (step 2 of the header).
 * @param {string} src - the code.
 * @param {function(string, Array<object>): string[]} findRoles - returns the role of each tag of the code.
 * @returns {?TemplateCode} the code for the reader with its tags, or null without syntax or tags.
 */
function escapeTemplateForFormat(src, findRoles) {
    if (!templateSyntax) return null;
    const found = getTemplateTags(src, templateSyntax);
    if (!found.length) return null;
    const roles = findRoles(src, found);
    const tags = found.map((tag, index) => ({ ...tag, role: roles[index] }));
    const standIns = new Map();
    const keyStandIns = getKeyStandIns(src, tags.filter(tag => tag.role === 'key').length);
    for (const tag of tags) standIns.set(tag.start, getStandIn(src, tag, keyStandIns));
    return { code: escapeTemplateTags(src, templateSyntax, tag => standIns.get(tag.start)), tags };
}

/**
 * Returns the stand-in of a tag by its role.
 * @param {string} src - the code.
 * @param {RoledTag} tag - the tag with its role.
 * @param {string[]} keyStandIns - the key stand-ins not yet given; the first is taken for a key.
 * @returns {string} the tag itself for text, 0 for a value, a key stand-in for a key, empty (spaces) for a section tag.
 */
function getStandIn(src, tag, keyStandIns) {
    if (tag.role === 'text') return src.slice(tag.start, tag.end);
    if (tag.role === 'value') return VALUE_STAND_IN;
    if (tag.role === 'key') return keyStandIns.shift();
    return '';
}

/**
 * Returns the function that finds the role of every tag in the code of a format.
 * @param {string} format - 'json', 'yaml' or an added format.
 * @returns {function(string, Array<object>): string[]} the role finder; an added format without
 *     one reads every tag as text.
 */
export function getTemplateRoleFinder(format) {
    const added = getAddedFormat(format);
    if (added) return added.findTemplateRoles || ((src, tags) => tags.map(() => 'text'));
    return format === 'yaml' ? findYamlTagRoles : findJsonTagRoles;
}

/**
 * Returns the function that finds the place of every tag in the code of a format: its role and,
 * for text, the kind of text (datatree-template-roles.js).
 * @param {string} format - 'json', 'yaml' or an added format.
 * @returns {function(string, Array<object>): import('./datatree-template-roles.js').TagPlace[]} the place finder; an
 *     added format without one gives its roles without a kind of text.
 */
export function getTemplatePlaceFinder(format) {
    const added = getAddedFormat(format);
    if (added && added.findTemplatePlaces) return added.findTemplatePlaces;
    if (added) return (src, tags) => getTemplateRoleFinder(format)(src, tags).map(role => ({ role, style: null }));
    return format === 'yaml' ? findYamlTagPlaces : findJsonTagPlaces;
}

/**
 * Returns the stand-ins of the placeholder keys: quoted keys of one or two private-use characters
 * that the code holds nowhere, each one different, so stand-ins never make two keys the same.
 * @param {string} src - the code.
 * @param {number} count - how many keys need a stand-in.
 * @returns {string[]} the stand-ins, each at most 4 characters (every tag has at least 5).
 */
function getKeyStandIns(src, count) {
    if (!count) return [];
    const used = new Set(src.match(/[\ue000-\uf8ff]/g) || []);
    const free = [];
    for (let code = KEY_STAND_IN_FIRST; code < KEY_STAND_IN_FIRST + KEY_STAND_IN_COUNT; code++) {
        const character = String.fromCharCode(code);
        if (!used.has(character)) free.push(character);
    }
    const standIns = [];
    for (let index = 0; standIns.length < count; index++) {
        const pair = index < free.length ? free[index] : free[Math.floor(index / free.length) - 1] + free[index % free.length];
        standIns.push(`"${pair}"`);
    }
    return standIns;
}

/**
 * Marks a model read from escaped code and adds the placeholder errors (steps 3 and 4 of the header).
 * @param {DataModel} model - the model; changed in place.
 * @param {string} src - the code as written.
 * @param {TemplateCode} template - the escaped code with its tags.
 * @returns {void}
 */
function addTemplateParts(model, src, template) {
    const context = { src, tags: template.tags, sections: getSectionSpans(template.tags, src.length), isYaml: model.format === 'yaml' };
    for (const doc of model.docs) applyNodeMarks(context, doc.root, 0);
    model.problems.push(...getTemplateProblems(src, template.tags));
    model.problems.sort((first, second) => first.pos - second.pos);
    model.template = true;
}

/**
 * What the marking of a model works with.
 * @typedef {object} MarkContext
 * @property {string} src - the code as written.
 * @property {RoledTag[]} tags - the tags with their roles, in order.
 * @property {Array<Array<number>>} sections - the parts [start, end) between the tags of each section outside text.
 * @property {boolean} isYaml - the code is YAML (a plain value folds its line breaks).
 */

/**
 * Marks a node and everything inside it.
 * @param {MarkContext} context - the code and its tags.
 * @param {DataNode|null} node - the node.
 * @param {number} depth - the nesting depth.
 * @returns {void}
 */
function applyNodeMarks(context, node, depth) {
    if (!node || depth > MAX_MARK_DEPTH) return;
    if (!isContainer(node)) { applyScalarMarks(context, node); return; }
    for (const entry of node.entries) {
        applyKeyMarks(context, entry);
        applyNodeMarks(context, entry.node, depth + 1);
    }
    node.end = Math.max(node.end, ...node.entries.map(entry => entry.node.end));
    if (hasSectionEntry(context.sections, node)) node.repeated = true;
}

/**
 * Marks a scalar: a value written with a placeholder, or a string that holds a tag.
 * @param {MarkContext} context - the code and its tags.
 * @param {DataNode} node - a scalar node.
 * @returns {void}
 */
function applyScalarMarks(context, node) {
    const inside = getTagsWithin(context.tags, node.start, node.end);
    const values = inside.filter(tag => tag.role === 'value');
    if (values.length) {
        const end = Math.max(node.end, ...values.map(tag => tag.end));
        const text = context.src.slice(node.start, end);
        Object.assign(node, { type: 'string', value: context.isYaml ? joinYamlLines(text) : text, raw: text, end, placeholder: 'value' });
        delete node.style;
        delete node.tag;
    } else if (node.type === 'string' && inside.length) node.placeholder = 'text';
}

/**
 * Marks the key of an entry that holds a tag; a placeholder key reads as its tag.
 * @param {MarkContext} context - the code and its tags.
 * @param {DataEntry} entry - the entry.
 * @returns {void}
 */
function applyKeyMarks(context, entry) {
    if (entry.keyStart === undefined || entry.keyEnd === undefined) return;
    const inside = getTagsWithin(context.tags, entry.keyStart, entry.keyEnd);
    if (!inside.length) return;
    entry.placeholderKey = true;
    const keys = inside.filter(tag => tag.role === 'key');
    if (!keys.length) return;
    entry.keyEnd = Math.max(entry.keyEnd, ...keys.map(tag => tag.end));
    entry.key = context.src.slice(entry.keyStart, entry.keyEnd);
}

/**
 * Returns the parts of the code between the opening and the end tag of each section outside
 * text; a section left open runs to the end of the code.
 * @param {RoledTag[]} tags - the tags with their roles, in order.
 * @param {number} length - the length of the code.
 * @returns {Array<Array<number>>} the parts [start, end).
 */
function getSectionSpans(tags, length) {
    const spans = [], open = [];
    for (const tag of tags) {
        if (tag.role !== 'section') continue;
        if (tag.kind === 'section' || tag.kind === 'inverted') open.push(tag);
        else if (tag.kind === 'close') {
            const index = open.map(item => item.name).lastIndexOf(tag.name);
            if (index >= 0) spans.push([open.splice(index, 1)[0].end, tag.start]);
        }
    }
    return spans.concat(open.map(tag => [tag.end, length]));
}

/**
 * Tells whether a section of the template holds entries of a container whose own entry (or the
 * document, for a root) starts before it, so the section repeats or leaves out entries of the
 * container. A YAML block collection starts at its first entry, so its key is the place to compare.
 * @param {Array<Array<number>>} sections - the parts between the tags of each section.
 * @param {DataNode} node - the container.
 * @returns {boolean} true when such a section is there.
 */
function hasSectionEntry(sections, node) {
    const ownStart = node.entry ? node.entry.start : -1;
    return sections.some(([start, end]) => ownStart < start && node.entries.some(entry => entry.start >= start && entry.start < end));
}

/**
 * Returns the tags that start inside a part of the code.
 * @param {RoledTag[]} tags - the tags, in order.
 * @param {number} from - the start of the part.
 * @param {number} to - the end of the part.
 * @returns {RoledTag[]} the tags whose start lies in [from, to).
 */
function getTagsWithin(tags, from, to) {
    let low = 0, high = tags.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (tags[middle].start < from) low = middle + 1; else high = middle;
    }
    const inside = [];
    for (let index = low; index < tags.length && tags[index].start < to; index++) inside.push(tags[index]);
    return inside;
}

/**
 * Joins the lines of a YAML plain value as YAML reads them: a line break between two lines
 * becomes a space, an empty line a line break.
 * @param {string} text - the value as written.
 * @returns {string} the value.
 */
function joinYamlLines(text) {
    return text.split(/\r?\n/).map(line => line.trim()).reduce((value, line, index) => {
        if (index === 0) return line;
        if (!line) return value + '\n';
        return value + (value.endsWith('\n') ? '' : ' ') + line;
    }, '');
}

/**
 * Returns the placeholder errors of a code: the section check and every placeholder key.
 * @param {string} src - the code.
 * @param {RoledTag[]} tags - the tags with their roles.
 * @returns {Problem[]} the errors, each marking its tag.
 */
function getTemplateProblems(src, tags) {
    const endsByStart = new Map(tags.map(tag => [tag.start, tag.end]));
    const problems = checkTemplateSections(src, templateSyntax).map(problem => ({ pos: problem.pos, end: endsByStart.get(problem.pos) ?? problem.pos + 1, kind: 'error', msg: problem.msg }));
    for (const tag of tags) {
        if (tag.role === 'key') problems.push({ pos: tag.start, end: tag.end, kind: 'error', msg: `A placeholder key goes in quotes: "${src.slice(tag.start, tag.end)}"` });
    }
    return problems;
}

/**
 * Returns why a key or value cannot be edited in the tree: a value written with a placeholder
 * is changed in the code.
 * @param {string} what - 'key' or 'value'.
 * @param {DataNode|null} node - the node.
 * @returns {?string} the message, or null when the edit may start.
 */
export function getTemplateEditRefusal(what, node) {
    return what === 'value' && node && node.placeholder === 'value' ? TEMPLATE_EDIT_MESSAGE : null;
}

/**
 * Checks that a tree edit keeps every tag outside the part it changes: a value written with a
 * placeholder, and a container that holds tags, are changed in the code; a removed entry takes
 * its own tags along; every other tag of the code is in the new code.
 * @param {string} src - the code before the edit.
 * @param {TreeEdit} op - the edit.
 * @param {string} code - the code after the edit.
 * @returns {void}
 * @throws {Error} TEMPLATE_EDIT_MESSAGE when the edit would change a tag outside its part.
 */
export function checkTemplateEdit(src, op, code) {
    if (!templateSyntax) return;
    const before = getTemplateTags(src, templateSyntax);
    if (!before.length) return;
    const part = getEditedPart(op);
    /**
     * Tells whether a tag lies in the part the edit changes.
     * @param {import('./template-tags.js').TemplateTag} tag - the tag.
     * @returns {boolean} true inside the part.
     */
    const isInPart = tag => !!part && tag.start >= part[0] && tag.end <= part[1];
    if ((op.kind === 'value' || op.kind === 'type') && (op.node.placeholder === 'value' || (isContainer(op.node) && before.some(isInPart)))) throw new Error(TEMPLATE_EDIT_MESSAGE);
    const left = new Map();
    for (const tag of getTemplateTags(code, templateSyntax)) { const text = code.slice(tag.start, tag.end); left.set(text, (left.get(text) || 0) + 1); }
    for (const tag of before) {
        if (isInPart(tag)) continue;
        const text = src.slice(tag.start, tag.end);
        if (!left.get(text)) throw new Error(TEMPLATE_EDIT_MESSAGE);
        left.set(text, left.get(text) - 1);
    }
}

/**
 * Returns the part of the code an edit changes as a whole.
 * @param {TreeEdit} op - the edit.
 * @returns {?Array<number>} [start, end) of the value, the key or the removed entry; null for edits that only add or move.
 */
function getEditedPart(op) {
    if ((op.kind === 'value' || op.kind === 'type') && op.node) return [op.node.start, op.node.end];
    if (op.kind === 'key' && op.entry && op.entry.keyStart !== undefined) return [op.entry.keyStart, op.entry.keyEnd];
    if (op.kind === 'remove' && op.entry) return [op.entry.start, op.entry.node.end];
    return null;
}
