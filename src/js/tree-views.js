/**
 * The two views of a template's tree (?template=): the example view, the tree of the template
 * filled with the page's examples (the default), and the template view, the tree of the code
 * with its tags as written.
 *
 * updateTreeView() runs these steps after the code is read (state.model):
 *   1. without a template syntax, or in the template view, the tree shows state.model;
 *   2. in the example view, fill the code with the examples and read the filled text
 *      (datatree.js parseExampleView); the tree shows that data;
 *   3. when the filled text cannot be read while the template can, the tree shows the template
 *      with a note.
 * Everything else works on the template: the problems, the schema check, saving and every
 * export. The functions below lead the tree's places, nodes and changes back to the code; a
 * value whose text holds an example is read-only in the example view.
 */

import {
    parseExampleView, getActiveTemplateSyntax, getCodeRangeByViewRange, getViewOffsetByCodeOffset, getNodeAtPosition,
    findTemplateNode, getPath, getDocIndex, getNodeAtPath, isExampleEditable, buildTemplateChange, EXAMPLE_EDIT_MESSAGE,
} from './datatree.js?v=13';
import { state, areas, FORMAT } from './state.js?v=2';

/** The view that shows the template filled with the examples. */
export const EXAMPLE_VIEW = 'example';
/** The view that shows the template with its tags. */
export const TEMPLATE_VIEW = 'template';

/** The state of the views: the view chosen, whether the example view could not be made, and the example view shown. */
const views = { mode: EXAMPLE_VIEW, failed: false, shown: null };

/**
 * Returns the view chosen.
 * @returns {string} EXAMPLE_VIEW or TEMPLATE_VIEW.
 */
export function getViewMode() {
    return views.mode;
}

/**
 * Sets the view chosen.
 * @param {string} mode - EXAMPLE_VIEW or TEMPLATE_VIEW.
 * @returns {void}
 */
export function setViewMode(mode) {
    views.mode = mode === TEMPLATE_VIEW ? TEMPLATE_VIEW : EXAMPLE_VIEW;
}

/**
 * Tells whether the example view was chosen and failed, so the template's tree stands in for it.
 * @returns {boolean} true while the template's tree stands in for the example view.
 */
export function isExampleViewFailed() {
    return Boolean(getActiveTemplateSyntax()) && views.mode === EXAMPLE_VIEW && views.failed;
}

/**
 * Returns the page's examples for the open document.
 * @returns {?import('./template-examples.js').TemplateExamples} the examples, null without a page or away from its document.
 */
export function getTemplateExamples() {
    return areas.sync?.getTemplate() || null;
}

/**
 * Builds the view of the code read last (the steps in the header).
 * @returns {void}
 */
export function updateTreeView() {
    views.shown = null;
    views.failed = false;
    if (!getActiveTemplateSyntax() || views.mode !== EXAMPLE_VIEW || !state.model) return;
    try {
        const view = parseExampleView(FORMAT.editor, state.code, getTemplateExamples());
        if (!hasSyntaxError(view.model)) views.shown = view;
        else views.failed = !hasSyntaxError(state.model);
    } catch (error) {
        views.failed = true;
    }
}

/**
 * Tells whether a model holds a syntax error.
 * @param {DataModel} model - the model.
 * @returns {boolean} true when it is broken or lists an error.
 */
function hasSyntaxError(model) {
    return model.broken || model.problems.some(problem => problem.kind === 'error');
}

/**
 * Returns the model the tree shows.
 * @returns {?DataModel} the example view's data, or the template's.
 */
export function getTreeModel() {
    return views.shown ? views.shown.model : state.model;
}

/**
 * Returns the stretch of the code a stretch of the tree's model stands for.
 * @param {number} start - where it starts in the tree's model.
 * @param {number} end - where it ends.
 * @returns {{start: number, end: number}} the stretch in the code.
 */
export function getTreeCodeRange(start, end) {
    return views.shown ? getCodeRangeByViewRange(views.shown.map, start, end) : { start, end };
}

/**
 * Returns the node of the tree's model at a place in the code.
 * @param {number} codeOffset - the place in the code.
 * @returns {?DataNode} the node, null without data.
 */
export function getTreeNodeAtCode(codeOffset) {
    if (!views.shown) return state.model ? getNodeAtPosition(state.model, codeOffset) : null;
    return getNodeAtPosition(views.shown.model, getViewOffsetByCodeOffset(views.shown.map, codeOffset));
}

/**
 * Returns the path in the template of a node of the tree: in the example view the path of the
 * template's node it comes from, so a key filled with an example stays out of what the AI reads.
 * @param {?{node: DataNode, path: Array<string|number>}} info - the selected node of the tree, or null.
 * @returns {Array<string|number>} the path, empty for none.
 */
export function getTemplatePath(info) {
    if (!info || !info.node) return [];
    if (!views.shown) return info.path;
    const node = findTemplateNode(state.model, views.shown.map, info.node);
    return node ? getPath(node) : [];
}

/**
 * Returns the place in the tree of a place in the template, after a change: in the example view
 * the first node of the example view that comes from the template's node there.
 * @param {number} docIndex - the index of the template's document.
 * @param {Array<string|number>} path - the path in the template's document.
 * @returns {{doc: number, path: Array<string|number>}} the place to select in the tree.
 */
export function getTreePlace(docIndex, path) {
    const place = { doc: docIndex, path };
    const root = state.model?.docs[docIndex]?.root;
    const templateNode = views.shown && root ? getNodeAtPath(root, path) : null;
    if (!templateNode) return place;
    for (let node = getTreeNodeAtCode(templateNode.start); node; node = node.entry ? node.entry.parent : null) {
        if (findTemplateNode(state.model, views.shown.map, node) === templateNode) return { doc: getDocIndex(views.shown.model, node), path: getPath(node) };
    }
    return place;
}

/**
 * Returns why a key or value of the tree cannot be edited in the example view.
 * @param {string} what - 'key' or 'value'.
 * @param {{node: DataNode, entry: ?DataEntry}} info - the node and entry in the tree.
 * @returns {?string} the message, or null when the edit may start.
 */
export function getExampleEditRefusal(what, info) {
    return views.shown && !isExampleEditable(what, info, state.model, views.shown.map) ? EXAMPLE_EDIT_MESSAGE : null;
}

/**
 * Tells whether a node belongs to the example view shown.
 * @param {?DataNode} node - the node.
 * @returns {boolean} true when its document is one of the example view's.
 */
function isExampleNode(node) {
    let current = node;
    while (current && current.entry) current = current.entry.parent;
    return !!current && views.shown.model.docs.some(doc => doc.root === current);
}

/**
 * Returns the change of the template a change stands for: a change of nodes of the example view
 * leads back to the template's own nodes; a change of the template's nodes (the AI tools) stays as
 * it is.
 * @param {object} change - the change, with nodes and entries of the tree's model or of the template.
 * @returns {object} the change with the template's nodes and entries.
 * @throws {Error} EXAMPLE_EDIT_MESSAGE when it would change text of an example.
 */
export function getTemplateChange(change) {
    if (!views.shown || !isExampleNode(change.node || change.entry?.node || change.box)) return change;
    const templateChange = buildTemplateChange(change, state.model, views.shown.map);
    if (!templateChange) throw new Error(EXAMPLE_EDIT_MESSAGE);
    return templateChange;
}
