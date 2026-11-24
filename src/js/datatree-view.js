/**
 * The tree view of the data tree: the foldable tree with types, counts, the
 * path line, search and editing of keys and values in place.
 *
 * createTree builds one view on an element:
 * 1. render() lists every visible row as a small descriptor, from the model
 *    and what the user folded or unfolded;
 * 2. drawRows() writes only the rows in sight (and some around them) as HTML,
 *    with spacers for the rest, again on scrolling;
 * 3. clicks, double clicks and keys select rows, fold them and start editing
 *    a key or value in a field over the row;
 * 4. every choice and edit goes to the editor through the callbacks.
 *
 * The view is one closure over its state (model, folds, selection, search,
 * field), so its functions stay together in this file.
 */

import { isContainer } from './datatree-core.js?v=3';
import { getPath, getDocIndex, formatPath, getNodeAtPath, runForEachNode } from './datatree-values.js?v=4';
import { escapeHtml } from './datatree-highlight.js?v=3';

/** The number of entries a large container shows at first, and more on each click. */
const MORE = 200;
/** The height of a row in pixels (style.css .trow). */
const ROW_HEIGHT = 24;
/** Rows drawn above and below the visible ones. */
const ROW_MARGIN = 40;
/** How close to the drawn edge scrolling draws again, in rows. */
const REDRAW_MARGIN = 10;
/** The height assumed for an element that has none yet. */
const FALLBACK_HEIGHT = 800;
/** A model with at most this many values opens completely. */
const SMALL_MODEL = 300;
/** Entries named in the preview of a closed container. */
const PREVIEW_ENTRIES = 4;
/** Characters of a value in the preview of a closed container. */
const PREVIEW_VALUE_LENGTH = 24;
/** Characters of a string shown in its row. */
const SHOWN_STRING_LENGTH = 300;
/** A number shows its code when that is shorter than this. */
const SHOWN_RAW_LENGTH = 60;
/** The widths of an edit field in characters. */
const FIELD_MIN_SIZE = 4;
const FIELD_MAX_SIZE = 60;
/** The most rows of a field for a text with line breaks. */
const FIELD_MAX_ROWS = 8;
/** How close to the tree's edge the selected row may come without scrolling, in pixels. */
const SCROLL_EDGE = 4;
/** A key that the path line writes after a dot. */
const PLAIN_PATH_KEY = /^[A-Za-z_$][\w$]*$/;

/**
 * What the tree tells the editor about a node.
 * @typedef {object} TreeInfo
 * @property {DataNode|null} node - the node.
 * @property {DataEntry|null} entry - its entry, null for a root.
 * @property {number} doc - the index of its document.
 * @property {Array<string|number>} path - its path in the document.
 * @property {number} [docStart] - the offset of the document (for a chosen document head).
 */

/**
 * A place in the model: a document and a path.
 * @typedef {object} TreePlace
 * @property {number} doc - the index of the document.
 * @property {Array<string|number>} path - the keys from its root.
 */

/**
 * How select() selects.
 * @typedef {object} SelectOptions
 * @property {boolean} [scroll] - bring the row into view (default true).
 */

/**
 * The options of createTree; the property names are the contract with the editors.
 * @typedef {object} TreeOptions
 * @property {HTMLElement} el - the tree element (role=tree).
 * @property {HTMLElement|null} pathEl - the line with the path.
 * @property {function(string): string} [t] - the translation of the few interface words inside the tree.
 * @property {function(TreeInfo, string): void} [onPick] - a node is chosen ('click', 'key', 'path', 'search', 'doc').
 * @property {function({what: string, info: TreeInfo, text?: string, phase?: string}): (boolean|string)} [onEdit] - a key or value
 *   is to be edited (phase 'start') or changed (text); returns true when allowed / made, else a reason.
 * @property {function(string, TreeInfo): void} [onAction] - 'remove' (Delete key).
 */

/**
 * Returns the text position under a point inside an element, from the boxes of its characters. Unlike
 * caretPositionFromPoint this also holds in pages shown with CSS zoom. Beside the characters (right of a
 * line's end, in the space between lines) the nearest character within about a line counts, so a click
 * right of a line's end lands at its end.
 * @param {HTMLElement} element - the element with the text.
 * @param {number} x - the point's client x.
 * @param {number} y - the point's client y.
 * @returns {{node: Text, offset: number}|null} the place in front of the character under the point, or after it
 *   on its right half; null when no character of the element is that near.
 */
function getCaretAtPoint(element, x, y) {
    const doc = element.ownerDocument;
    const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const range = doc.createRange();
    let best = null, bestDy = Infinity, bestDx = Infinity;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (let index = 0; index < node.length; index++) {
            range.setStart(node, index);
            range.setEnd(node, index + 1);
            for (const box of range.getClientRects()) {
                const dy = y < box.top ? box.top - y : y > box.bottom ? y - box.bottom : 0;
                if (dy > box.height) continue;                                       // another line
                if (!dy && x >= box.left && x <= box.right) return { node, offset: x < box.left + box.width / 2 ? index : index + 1 };
                const dx = x < box.left ? box.left - x : x > box.right ? x - box.right : 0;
                if (dy < bestDy || (dy === bestDy && dx < bestDx)) { bestDy = dy; bestDx = dx; best = { node, offset: x < box.left + box.width / 2 ? index : index + 1 }; }
            }
        }
    }
    return best;
}

/**
 * Returns how many characters precede the position getCaretAtPoint finds, counted from the start of the element's text.
 * @param {HTMLElement} element - the element with the text.
 * @param {number} x - the point's client x.
 * @param {number} y - the point's client y.
 * @returns {number|null} the character index, null when no character is near.
 */
function getCharIndexAtPoint(element, x, y) {
    const caret = getCaretAtPoint(element, x, y);
    if (!caret) return null;
    const range = element.ownerDocument.createRange();
    range.selectNodeContents(element);
    range.setEnd(caret.node, caret.offset);
    return range.toString().length;
}

/**
 * Returns the label of a document in the tree.
 * @param {DataDocument} doc - the document.
 * @param {number} docIndex - its index.
 * @returns {string} its label, or "Document N".
 */
const getDocLabel = (doc, docIndex) => doc.label || `Document ${docIndex + 1}`;

/**
 * Returns how a scalar is shown in its row.
 * @param {DataNode} node - a scalar node.
 * @returns {string} the shown text: a string in quotes (shortened, line breaks as ⏎), a number as written.
 */
function formatShownValue(node) {
    if (node.placeholder === 'value') return node.value;   // a template placeholder, as written
    if (node.style === 'datetime') return node.value;      // a TOML date or time
    if (node.type === 'string') {
        const value = node.value.length > SHOWN_STRING_LENGTH ? node.value.slice(0, SHOWN_STRING_LENGTH) + '…' : node.value;
        return '"' + value.replace(/\n/g, '⏎') + '"';
    }
    if (node.type === 'null') return 'null';
    if (node.type === 'number') return node.raw && node.raw.length < SHOWN_RAW_LENGTH ? node.raw : String(node.value);
    return String(node.value);
}

/**
 * Returns the type a row names: the node's type, or what stands in its place.
 * @param {DataNode} node - the node.
 * @returns {string} the type word before translation, e.g. "string", "date / time" or "placeholder".
 */
function getTypeLabel(node) {
    if (node.type === 'alias') return 'alias';
    if (node.placeholder === 'value') return 'placeholder';
    return node.style === 'datetime' ? 'date / time' : node.type;
}

/**
 * Returns the text a field starts with when a key or value is edited.
 * @param {string} what - 'key' or 'value'.
 * @param {TreeInfo} info - the node.
 * @returns {string} the key, or the value as the user types it.
 */
function getEditText(what, info) {
    const node = info.node;
    if (what === 'key') return String(info.entry.key);
    if (node.type === 'string') return node.value;
    if (node.type === 'null') return 'null';
    if (node.type === 'number') return node.raw && node.raw.length < SHOWN_RAW_LENGTH ? node.raw : String(node.value);
    return String(node.value);
}

/**
 * Builds the tree view on an element.
 * @param {TreeOptions} options - the elements and callbacks.
 * @returns {object} the view's methods: render, select, selectNode, getSelectedInfo, getSelectedPlace,
 *   openAll, closeAll, find, selectNextHit, getHits, edit, isEditing, stopEdit.
 */
export function createTree({ el, pathEl, t = s => s, onPick = () => {}, onEdit = () => true, onAction = () => {} }) {
    let model = null;
    const fold = new Map();             // place key -> open (true) or closed (false), as the user set it
    let all = null;                     // true / false after "Unfold all" / "Fold all"
    const more = new Map();             // place key -> entries shown
    let selected = null;                // TreePlace
    let infoById = new Map();
    let query = '', hits = [], hit = -1, hitKeys = new Set();
    let editing = null;
    let small = true;
    let rows = [], drawn = [0, 0];      // all rows in order (cheap descriptors); the range drawn
    let drawWait = 0;

    /**
     * Returns the key of a place for the maps of folds and shown entries.
     * @param {number} doc - the document's index.
     * @param {Array<string|number>} path - the path.
     * @returns {string} the key.
     */
    const getPlaceKey = (doc, path) => doc + '|' + JSON.stringify(path);

    /**
     * Tells whether a container is unfolded: as the user set it, else by "Fold all" / "Unfold all", else by size and depth.
     * @param {DataNode} node - the container.
     * @param {number} depth - its depth below the document.
     * @param {string} placeKey - its place key.
     * @returns {boolean} true when its entries are shown.
     */
    const isOpen = (node, depth, placeKey) => {
        if (fold.has(placeKey)) return fold.get(placeKey);
        if (all !== null) return all || (depth === 0 && !model.jsonl);
        if (model.jsonl && depth === 0) return small;
        return small || depth < 2;
    };

    /**
     * Returns a text as HTML with the search match marked.
     * @param {*} text - the text.
     * @returns {string} the HTML.
     */
    function highlightMatch(text) {
        const value = String(text);
        if (!query) return escapeHtml(value);
        const index = value.toLowerCase().indexOf(query);
        if (index < 0) return escapeHtml(value);
        return escapeHtml(value.slice(0, index)) + '<mark>' + escapeHtml(value.slice(index, index + query.length)) + '</mark>' + escapeHtml(value.slice(index + query.length));
    }

    /**
     * Returns the HTML of an entry's key, or of its index in an array.
     * @param {DataEntry|null} entry - the entry.
     * @returns {string} the HTML, empty for a root.
     */
    function renderEntryLabel(entry) {
        if (!entry) return '';
        return entry.parent.type === 'array' ? `<span class="trow-i">${entry.key}</span><span class="trow-p">:</span>` : `<span class="trow-k" data-edit="key">${highlightMatch(entry.key === '' ? '""' : entry.key)}</span><span class="trow-p">:</span>`;
    }

    /**
     * Returns the HTML of a node's row.
     * @param {object} row - the row descriptor of a node.
     * @returns {string} the HTML.
     */
    function renderNodeRow({ node, entry, doc, path, depth, open }) {
        const id = node.id;
        const placeKey = getPlaceKey(doc, path);
        const container = isContainer(node);
        const classes = ['trow'];
        if (selected && selected.doc === doc && getPlaceKey(doc, selected.path) === placeKey) classes.push('active');
        if (hitKeys.has(placeKey)) classes.push(hits[hit] && getPlaceKey(hits[hit].doc, hits[hit].path) === placeKey ? 'hit now' : 'hit');
        let html = `<div class="${classes.join(' ')}" role="treeitem" id="trow-${id}" data-id="${id}" aria-level="${depth + 1}" aria-selected="${classes.includes('active')}" style="--t:${depth}"${container ? ` aria-expanded="${open}"` : ''}>`;
        html += container && node.entries.length ? '<span class="trow-toggle" aria-hidden="true"></span>' : '<span class="trow-toggle empty" aria-hidden="true"></span>';
        html += entry ? renderEntryLabel(entry) : `<span class="trow-root">${model.jsonl ? escapeHtml(t(getDocLabel(model.docs[doc], doc))) : '$'}</span>`;
        if (node.anchor) html += `<span class="trow-anchor" title="${escapeHtml(t('Anchor'))}">&amp;${escapeHtml(node.anchor)}</span>`;
        if (node.tag) html += `<span class="trow-tag">${escapeHtml(node.tag)}</span>`;
        html += renderNodeValue(node, container, open);
        html += `<span class="trow-type">${escapeHtml(t(getTypeLabel(node)))}</span></div>`;
        return html;
    }

    /**
     * Returns the HTML of a node's value: a container's count and preview, an alias, or a scalar.
     * @param {DataNode} node - the node.
     * @param {boolean} container - the node is an object or array.
     * @param {boolean} open - a container is unfolded.
     * @returns {string} the HTML.
     */
    function renderNodeValue(node, container, open) {
        if (container) {
            const count = node.entries.length;
            let html = `<span class="trow-sum">${node.type === 'object' ? '{' + count + '}' : '[' + count + ']'}</span>`;
            if (!open && count) {
                const preview = node.type === 'object' ? node.entries.slice(0, PREVIEW_ENTRIES).map(entry => entry.key).join(', ') : node.entries.slice(0, PREVIEW_ENTRIES).map(entry => (isContainer(entry.node) ? (entry.node.type === 'object' ? '{…}' : '[…]') : formatShownValue(entry.node).slice(0, PREVIEW_VALUE_LENGTH))).join(', ');
                html += `<span class="trow-preview">${escapeHtml(preview)}${count > PREVIEW_ENTRIES ? ', …' : ''}</span>`;
            }
            return html;
        }
        if (node.type === 'alias') {
            const targetType = node.target ? node.target.type : '';
            return `<span class="trow-v t-alias" title="${escapeHtml(t('Alias'))}">*${escapeHtml(node.value)}</span>${targetType ? `<span class="trow-target">→ ${escapeHtml(t(targetType))}</span>` : ''}`;
        }
        return `<span class="trow-v t-${node.placeholder === 'value' ? 'placeholder' : node.type}" data-edit="value">${highlightMatch(formatShownValue(node))}</span>`;
    }

    /**
     * Lists the visible rows anew and draws them (a model given becomes the tree's model); nothing while a field is open.
     * @param {DataModel} [newModel] - the model to show.
     * @returns {void}
     */
    function render(newModel) {
        if (newModel) model = newModel;
        if (!model) return;
        if (editing) return;
        let count = 0;
        runForEachNode(model, () => { count++; });
        small = count <= SMALL_MODEL;
        rows = [];
        const heads = model.docs.length > 1 && !model.jsonl;
        model.docs.forEach((doc, docIndex) => addDocumentRows(doc, docIndex, heads));
        if (!rows.length) rows.push({ t: 'empty' });
        drawRows(true);
        renderPath();
    }

    /**
     * Adds the rows of one document: its head (several documents) and its unfolded nodes.
     * @param {DataDocument} doc - the document.
     * @param {number} docIndex - its index.
     * @param {boolean} heads - documents have a head row.
     * @returns {void}
     */
    function addDocumentRows(doc, docIndex, heads) {
        const docKey = 'doc|' + docIndex;
        const docOpen = !heads || (fold.has(docKey) ? fold.get(docKey) : all !== false);
        if (heads) rows.push({ t: 'doc', di: docIndex, d: doc, open: docOpen });
        if (!doc.root || !docOpen) return;
        /**
         * Adds the row of a node and, when it is unfolded, those of its shown entries.
         * @param {DataNode} node - the node.
         * @param {DataEntry|null} entry - its entry.
         * @param {Array<string|number>} path - its path.
         * @param {number} depth - its depth in rows.
         * @returns {void}
         */
        const addNodeRows = (node, entry, path, depth) => {
            const placeKey = getPlaceKey(docIndex, path);
            const open = isContainer(node) && node.entries.length > 0 && isOpen(node, depth - (heads ? 1 : 0), placeKey);
            rows.push({ t: 'node', node, entry, doc: docIndex, path, depth, open });
            if (!open) return;
            const shown = more.get(placeKey) || MORE;
            for (const child of node.entries.slice(0, shown)) addNodeRows(child.node, child, [...path, child.key], depth + 1);
            if (node.entries.length > shown) rows.push({ t: 'more', pk: placeKey, depth: depth + 1, text: `Show ${Math.min(MORE, node.entries.length - shown)} more of ${node.entries.length}` });
        };
        addNodeRows(doc.root, null, [], heads ? 1 : 0);
    }

    /**
     * Returns the HTML of a row descriptor.
     * @param {object} row - a node, document head, "show more" or empty row.
     * @returns {string} the HTML.
     */
    function renderRow(row) {
        if (row.t === 'node') return renderNodeRow(row);
        if (row.t === 'doc') return `<div class="trow trow-doc" role="treeitem" data-doc="${row.di}" aria-level="1" aria-expanded="${row.open}" style="--t:0"><span class="trow-toggle" aria-hidden="true"></span><span class="trow-doc-name">${escapeHtml(t(getDocLabel(row.d, row.di)))}</span>${row.d.root ? '' : `<span class="trow-preview">${escapeHtml(t('empty'))}</span>`}</div>`;
        if (row.t === 'more') return `<div class="trow trow-more" role="treeitem" data-more="${escapeHtml(row.pk)}" style="--t:${row.depth}"><span class="trow-toggle empty"></span><button type="button" class="link-button" tabindex="-1">${escapeHtml(t(row.text))}</button></div>`;
        return `<div class="trow empty">${escapeHtml(t('No data yet'))}</div>`;
    }

    /**
     * Draws the rows in sight (and some around them); spacers keep the height of the rest.
     * @param {boolean} [force] - draw also while a field is open.
     * @returns {void}
     */
    function drawRows(force) {
        if (editing && !force) return;
        const height = el.clientHeight || FALLBACK_HEIGHT, top = el.scrollTop;
        const first = Math.max(0, Math.floor(top / ROW_HEIGHT) - ROW_MARGIN), last = Math.min(rows.length, Math.ceil((top + height) / ROW_HEIGHT) + ROW_MARGIN);
        infoById = getRowInfos(first, last);
        const parts = [`<div class="trow-space" style="height:${first * ROW_HEIGHT}px"></div>`];
        for (let index = first; index < last; index++) parts.push(renderRow(rows[index]));
        parts.push(`<div class="trow-space" style="height:${(rows.length - last) * ROW_HEIGHT}px"></div>`);
        el.innerHTML = parts.join('');
        el.scrollTop = top;
        drawn = [first, last];
        const rowElement = selected && getRowElement(selected);
        if (rowElement) el.setAttribute('aria-activedescendant', rowElement.id); else el.removeAttribute('aria-activedescendant');
    }

    /**
     * Returns the info of the node rows in a range of rows, by the node's id; the clicks and keys
     * on a drawn row find its node through it.
     * @param {number} first - the index of the first row.
     * @param {number} last - the index after the last row.
     * @returns {Map<number, TreeInfo>} the info of each node row in the range.
     */
    function getRowInfos(first, last) {
        const infos = new Map();
        for (const { t: kind, node, entry, doc, path } of rows.slice(first, last)) {
            if (kind === 'node') infos.set(node.id, { node, entry, doc, path });
        }
        return infos;
    }

    /**
     * Draws again on the next frame when scrolling comes near the edge of the drawn rows.
     * @returns {void}
     */
    function drawOnScroll() {
        if (drawWait || editing) return;
        drawWait = requestAnimationFrame(() => {
            drawWait = 0;
            const first = Math.floor(el.scrollTop / ROW_HEIGHT), last = Math.ceil((el.scrollTop + el.clientHeight) / ROW_HEIGHT);
            if ((first < drawn[0] + REDRAW_MARGIN && drawn[0] > 0) || (last > drawn[1] - REDRAW_MARGIN && drawn[1] < rows.length)) drawRows();
        });
    }

    /**
     * Returns the index of a node's row in the list.
     * @param {DataNode} node - the node.
     * @returns {number} the index, -1 when it has no row.
     */
    const getRowIndex = node => rows.findIndex(row => row.t === 'node' && row.node === node);

    /**
     * Returns the info of the node at a place.
     * @param {TreePlace|null} place - the place.
     * @returns {TreeInfo|null} the info, null when the place holds no node.
     */
    function getInfo(place) {
        if (!model || !place) return null;
        const doc = model.docs[place.doc];
        if (!doc || !doc.root) return null;
        const node = getNodeAtPath(doc.root, place.path);
        if (!node) return null;
        return { node, entry: node.entry, doc: place.doc, path: place.path };
    }

    /**
     * Finds the entry of an open field again by its path when the code changed while the field is open
     * (a button pressed on the way out of it), if it is still there unchanged - otherwise the change is
     * dropped, so it never lands at a place that moved.
     * @param {object} field - the open field's state (info, what, initial).
     * @returns {TreeInfo|null} the current info, null when the entry changed or is gone.
     */
    function getUnchangedInfo(field) {
        const current = getInfo({ doc: field.info.doc, path: field.info.path });
        if (!current) return null;
        if (field.what === 'key') return current.entry && String(current.entry.key) === field.initial ? current : null;
        const old = field.info.node, found = current.node;
        return !isContainer(found) && found.type === old.type && found.value === old.value && found.style === old.style ? current : null;
    }

    /**
     * Returns the drawn row element of a place.
     * @param {TreePlace} place - the place.
     * @returns {HTMLElement|null} the row, null when it is not drawn.
     */
    function getRowElement(place) {
        const info = getInfo(place);
        return info ? el.querySelector(`#trow-${info.node.id}`) : null;
    }

    /**
     * Unfolds every container on the way to a place and shows enough entries to reach it.
     * @param {TreePlace} place - the place.
     * @returns {boolean} true when it unfolds something or shows more entries (the rows need render()).
     */
    function expandTo(place) {
        let changed = false;
        const docKey = 'doc|' + place.doc;
        if (model.docs.length > 1 && fold.get(docKey) === false) { fold.set(docKey, true); changed = true; }
        if (all === false && model.docs.length > 1 && !fold.has(docKey)) { fold.set(docKey, true); changed = true; }
        for (let depth = 0; depth < place.path.length; depth++) {
            const placeKey = getPlaceKey(place.doc, place.path.slice(0, depth));
            const doc = model.docs[place.doc];
            const node = doc && doc.root ? getNodeAtPath(doc.root, place.path.slice(0, depth)) : null;
            if (node && !isOpen(node, depth, placeKey)) { fold.set(placeKey, true); changed = true; }
            const key = place.path[depth];
            if (node && node.type === 'array' && typeof key === 'number' && key >= (more.get(placeKey) || MORE)) { more.set(placeKey, key + 1); changed = true; }
            if (node && node.type === 'object') {
                const index = node.entries.findIndex(entry => entry.key === key);
                if (index >= (more.get(placeKey) || MORE)) { more.set(placeKey, index + 1); changed = true; }
            }
        }
        return changed;
    }

    /**
     * Selects a node (or the nearest parent that still exists) and marks its row.
     * @param {TreePlace|null} place - the place, null to select nothing.
     * @param {SelectOptions} [options] - how to select.
     * @returns {void}
     */
    function select(place, { scroll = true } = {}) {
        if (!model) return;
        selected = place ? { doc: place.doc || 0, path: place.path.slice() } : null;
        if (selected && !getInfo(selected)) {
            const path = selected.path.slice();
            while (path.length && !getInfo({ doc: selected.doc, path })) path.pop();
            selected.path = path;
            if (!getInfo(selected)) selected = null;
        }
        if (selected && expandTo(selected)) render();
        const wanted = selected && getInfo(selected);
        if (wanted && scroll) showRow(wanted.node);
        updateSelectedRow(scroll);
        renderPath();
    }

    /**
     * Scrolls the tree so the row of a node is drawn and in view.
     * @param {DataNode} node - the node.
     * @returns {void}
     */
    function showRow(node) {
        const index = getRowIndex(node);
        if (index >= 0 && (index < drawn[0] || index >= drawn[1] || index * ROW_HEIGHT < el.scrollTop || (index + 1) * ROW_HEIGHT > el.scrollTop + el.clientHeight)) {
            el.scrollTop = Math.max(0, index * ROW_HEIGHT - el.clientHeight / 3);
            drawRows();
        }
    }

    /**
     * Marks the selected row as active and, when asked, scrolls it into view.
     * @param {boolean} scroll - bring the row into view.
     * @returns {void}
     */
    function updateSelectedRow(scroll) {
        el.querySelectorAll('.trow.active').forEach(row => { row.classList.remove('active'); row.setAttribute('aria-selected', 'false'); });
        const row = selected && getRowElement(selected);
        if (!row) return;
        row.classList.add('active');
        row.setAttribute('aria-selected', 'true');
        el.setAttribute('aria-activedescendant', row.id);
        if (scroll) {
            const rowBox = row.getBoundingClientRect(), treeBox = el.getBoundingClientRect();
            if (rowBox.top < treeBox.top + SCROLL_EDGE || rowBox.bottom > treeBox.bottom - SCROLL_EDGE) el.scrollTop += rowBox.top - treeBox.top - treeBox.height / 3;
        }
    }

    /**
     * Writes the path line of the selected node, one button per step.
     * @returns {void}
     */
    function renderPath() {
        if (!pathEl) return;
        const info = getInfo(selected);
        if (!info) { pathEl.innerHTML = '<span class="path-part">$</span>'; return; }
        const doc = model.docs[info.doc];
        let html = model.docs.length > 1 || model.jsonl ? `<span class="path-doc">${escapeHtml(t(getDocLabel(doc, info.doc)))}</span>` : '';
        html += `<button type="button" class="path-part" data-depth="0">$</button>`;
        info.path.forEach((key, depth) => {
            const step = typeof key === 'number' ? `[${key}]` : PLAIN_PATH_KEY.test(key) ? '.' + key : `[${JSON.stringify(key)}]`;
            html += `<button type="button" class="path-part${depth === info.path.length - 1 ? ' now' : ''}" data-depth="${depth + 1}">${escapeHtml(step)}</button>`;
        });
        pathEl.innerHTML = html;
        pathEl.title = formatPath(info.path);
    }

    /**
     * Selects the step of the path line the user clicked.
     * @param {MouseEvent} event - the click.
     * @returns {void}
     */
    function selectPathStep(event) {
        const button = event.target.closest('[data-depth]');
        if (!button || !selected) return;
        const place = { doc: selected.doc, path: selected.path.slice(0, +button.dataset.depth) };
        select(place);
        const info = getInfo(place);
        if (info) onPick(info, 'path');
    }

    /**
     * Folds or unfolds a container and draws the rows again.
     * @param {string} placeKey - its place key.
     * @param {DataNode} node - the container.
     * @param {number} depth - its depth.
     * @returns {void}
     */
    function applyFoldSwitch(placeKey, node, depth) {
        fold.set(placeKey, !isOpen(node, depth, placeKey));
        render();
    }

    /**
     * Handles a click in the tree: "show more", a document head, the fold arrow, or a row (select, then edit a key or value).
     * @param {MouseEvent} event - the click.
     * @returns {void}
     */
    function handleClick(event) {
        if (editing && event.target.closest('.trow-edit')) return;
        const row = event.target.closest('.trow');
        if (!row || !el.contains(row)) return;
        if (row.dataset.more) { showMoreEntries(row.dataset.more); return; }
        if (row.dataset.doc !== undefined) { applyDocumentFoldSwitch(+row.dataset.doc, row.dataset.doc); return; }
        const info = infoById.get(+row.dataset.id);
        if (!info) return;
        const textSelection = getSelection();
        if (textSelection && !textSelection.isCollapsed && el.contains(textSelection.anchorNode)) return;          // the user selects text
        if (event.target.closest('.trow-toggle') && isContainer(info.node) && info.node.entries.length) {
            applyFoldSwitch(getPlaceKey(info.doc, info.path), info.node, +row.style.getPropertyValue('--t') || 0);
            return;
        }
        select({ doc: info.doc, path: info.path }, { scroll: false });
        onPick(info, 'click');
        const editable = event.target.closest('[data-edit]');
        if (editable) startEdit(editable.dataset.edit, event.clientX, event.clientY);
    }

    /**
     * Shows more entries of a large container.
     * @param {string} placeKey - the container's place key.
     * @returns {void}
     */
    function showMoreEntries(placeKey) {
        more.set(placeKey, (more.get(placeKey) || MORE) + MORE);
        render();
    }

    /**
     * Folds or unfolds a document and tells the editor the document is chosen.
     * @param {number} docIndex - the document's index.
     * @param {string} docKeyPart - the index as written in the row's data-doc.
     * @returns {void}
     */
    function applyDocumentFoldSwitch(docIndex, docKeyPart) {
        const docKey = 'doc|' + docKeyPart;
        fold.set(docKey, !(fold.has(docKey) ? fold.get(docKey) : all !== false));
        render();
        const doc = model.docs[docIndex];
        if (doc) onPick({ node: doc.root, entry: null, doc: docIndex, path: [], docStart: doc.start }, 'doc');
    }

    /**
     * Folds or unfolds a container on a double click outside its key and value.
     * @param {MouseEvent} event - the double click.
     * @returns {void}
     */
    function handleDoubleClick(event) {
        const row = event.target.closest('.trow[data-id]');
        if (!row || event.target.closest('[data-edit], .trow-edit')) return;
        const info = infoById.get(+row.dataset.id);
        if (info && isContainer(info.node) && info.node.entries.length) applyFoldSwitch(getPlaceKey(info.doc, info.path), info.node, +row.style.getPropertyValue('--t') || 0);
    }

    /**
     * Opens a field over the selected node's key or value; after a click the cursor goes to the clicked
     * character, from the keyboard the whole text is selected.
     * @param {string} what - 'key' or 'value'.
     * @param {number} [x] - the client x of the click.
     * @param {number} [y] - the client y of the click.
     * @returns {boolean} true when the field opened.
     */
    function startEdit(what, x, y) {
        const info = getInfo(selected);
        if (!info) return false;
        if (what === 'key' && !(info.entry && info.entry.parent.type === 'object')) return false;
        if (what === 'value' && (isContainer(info.node) || info.node.type === 'alias')) return false;
        const allowed = onEdit({ what, info, phase: 'start' });
        if (allowed !== true) return false;
        const row = getRowElement(selected);
        if (!row) return false;
        const target = row.querySelector(what === 'key' ? '.trow-k' : '.trow-v');
        if (!target) return false;
        const node = info.node;
        const initial = getEditText(what, info);
        const multiLine = what === 'value' && node.type === 'string' && /\n/.test(node.value);
        const caret = getFieldCaret(target, what, node, initial, x, y);
        const field = createField(what, node, initial, multiLine);
        target.replaceWith(field);
        field.focus();
        if (caret == null) field.select(); else field.setSelectionRange(caret, caret);
        editing = { f: field, info, what, initial, model };
        watchField(field, what, multiLine);
        return true;
    }

    /**
     * Returns where the cursor of a new field goes: at the clicked character of the text.
     * @param {HTMLElement} target - the key or value span.
     * @param {string} what - 'key' or 'value'.
     * @param {DataNode} node - the node.
     * @param {string} initial - the field's text.
     * @param {number} [x] - the client x of the click.
     * @param {number} [y] - the client y of the click.
     * @returns {number|null} the cursor position, null to select the whole text.
     */
    function getFieldCaret(target, what, node, initial, x, y) {
        let caret = x == null ? null : getCharIndexAtPoint(target, x, y);
        if (caret != null && what === 'value' && node.type === 'string' && /^["']/.test(target.textContent) && target.textContent.length > initial.length) caret -= 1;   // the shown quote is not part of the value
        if (caret != null) caret = Math.max(0, Math.min(initial.length, caret));
        return caret;
    }

    /**
     * Creates the field for a key or value.
     * @param {string} what - 'key' or 'value'.
     * @param {DataNode} node - the node.
     * @param {string} initial - the field's text.
     * @param {boolean} multiLine - a text with line breaks (a textarea).
     * @returns {HTMLInputElement|HTMLTextAreaElement} the field.
     */
    function createField(what, node, initial, multiLine) {
        const field = document.createElement(multiLine ? 'textarea' : 'input');
        field.className = 'trow-edit' + (what === 'key' ? ' trow-edit-k' : '') + ' t-' + (what === 'key' ? 'key' : node.type);
        field.value = initial;
        field.spellcheck = what === 'value' && node.type === 'string';
        field.setAttribute('aria-label', t(what === 'key' ? 'Key' : 'Value'));
        if (multiLine) field.rows = Math.min(FIELD_MAX_ROWS, initial.split('\n').length);
        else field.size = Math.max(FIELD_MIN_SIZE, Math.min(FIELD_MAX_SIZE, initial.length + 2));
        return field;
    }

    /**
     * Connects a field's keys, input and blur to finishing the edit.
     * @param {HTMLInputElement|HTMLTextAreaElement} field - the field.
     * @param {string} what - 'key' or 'value'.
     * @param {boolean} multiLine - a textarea, where Shift+Enter is a line break.
     * @returns {void}
     */
    function watchField(field, what, multiLine) {
        /**
         * Ends the edit: hands a changed text to the editor (to the entry at its place, if it is still unchanged)
         * and closes the field; a refused change keeps the field open, unless the field lost the focus.
         * @param {boolean} keep - take the text.
         * @param {boolean} [fromBlur] - the field lost the focus.
         * @returns {void}
         */
        const stopRenameEdit = (keep, fromBlur) => {
            if (!editing || editing.f !== field) return;
            const state = editing;
            if (keep && field.value !== state.initial) {
                const current = model === state.model ? state.info : getUnchangedInfo(state);
                const result = current ? onEdit({ what, info: current, text: field.value }) : false;
                if (result !== true && !fromBlur) { field.classList.add('invalid'); field.focus(); return; }
            }
            editing = null;
            render();
            if (!fromBlur) el.focus({ preventScroll: true });
        };
        field.addEventListener('keydown', event => {
            event.stopPropagation();
            if (event.key === 'Enter' && !(multiLine && event.shiftKey)) { event.preventDefault(); stopRenameEdit(true); }
            else if (event.key === 'Escape') { event.preventDefault(); stopRenameEdit(false); }
            else if (event.key === 'Tab') { event.preventDefault(); stopRenameEdit(true); }
            else field.classList.remove('invalid');
        });
        field.addEventListener('input', () => { if (!multiLine) field.size = Math.max(FIELD_MIN_SIZE, Math.min(FIELD_MAX_SIZE, field.value.length + 2)); });
        field.addEventListener('blur', () => setTimeout(() => stopRenameEdit(true, true), 0));
    }

    /**
     * Handles the keys of the tree: arrows, Home, End, Enter, F2 and Delete.
     * @param {KeyboardEvent} event - the key.
     * @returns {void}
     */
    function handleTreeKey(event) {
        if (editing || !model) return;
        const nodeRows = rows.filter(row => row.t === 'node');
        const currentInfo = selected ? getInfo(selected) : null;
        const index = currentInfo ? nodeRows.findIndex(row => row.node === currentInfo.node) : -1;
        /**
         * Selects a row and tells the editor.
         * @param {object|undefined} row - the node row.
         * @returns {void}
         */
        const selectRow = row => {
            if (!row) return;
            const rowInfo = { node: row.node, entry: row.entry, doc: row.doc, path: row.path };
            select({ doc: row.doc, path: row.path });
            onPick(rowInfo, 'key');
        };
        const info = index >= 0 ? { node: nodeRows[index].node, entry: nodeRows[index].entry, doc: nodeRows[index].doc, path: nodeRows[index].path } : null;
        const depth = index >= 0 ? nodeRows[index].depth : 0;
        if (event.key === 'ArrowDown') { event.preventDefault(); selectRow(nodeRows[Math.min(nodeRows.length - 1, index + 1)] || nodeRows[0]); }
        else if (event.key === 'ArrowUp') { event.preventDefault(); selectRow(nodeRows[Math.max(0, index - 1)]); }
        else if (event.key === 'Home') { event.preventDefault(); selectRow(nodeRows[0]); }
        else if (event.key === 'End') { event.preventDefault(); selectRow(nodeRows[nodeRows.length - 1]); }
        else if (event.key === 'ArrowRight' && info) {
            event.preventDefault();
            const placeKey = getPlaceKey(info.doc, info.path);
            if (isContainer(info.node) && info.node.entries.length && !isOpen(info.node, depth, placeKey)) applyFoldSwitch(placeKey, info.node, depth);
            else if (isContainer(info.node) && info.node.entries.length) selectRow(nodeRows[index + 1]);
        } else if (event.key === 'ArrowLeft' && info) {
            event.preventDefault();
            const placeKey = getPlaceKey(info.doc, info.path);
            if (isContainer(info.node) && info.node.entries.length && isOpen(info.node, depth, placeKey)) applyFoldSwitch(placeKey, info.node, depth);
            else if (info.path.length) { select({ doc: info.doc, path: info.path.slice(0, -1) }); const parent = getInfo(selected); if (parent) onPick(parent, 'key'); }
        } else if (event.key === 'Enter' && info) {
            event.preventDefault();
            if (isContainer(info.node)) applyFoldSwitch(getPlaceKey(info.doc, info.path), info.node, depth);
            else startEdit('value');
        } else if (event.key === 'F2' && info) { event.preventDefault(); startEdit(info.entry && info.entry.parent.type === 'object' ? 'key' : 'value'); }
        else if ((event.key === 'Delete' || event.key === 'Backspace') && info && info.entry) { event.preventDefault(); onAction('remove', info); }
    }

    /**
     * Searches keys and values: every match is marked and the first one selected. getHits() tells
     * the count and the current match.
     * @param {string} text - the search text.
     * @returns {void}
     */
    function find(text) {
        query = String(text || '').trim().toLowerCase();
        hits = [];
        hitKeys = new Set();
        hit = -1;
        if (query && model) {
            runForEachNode(model, (node, doc, path) => {
                if (!isSearchMatch(node)) return;
                hits.push({ doc, path });
                hitKeys.add(getPlaceKey(doc, path));
            });
        }
        if (hits.length) { hit = 0; showHit(); } else render();
    }

    /**
     * Tells whether a node's key, value or anchor holds the search text.
     * @param {DataNode} node - the node.
     * @returns {boolean} true for a match.
     */
    function isSearchMatch(node) {
        const entry = node.entry;
        const key = entry && entry.parent.type === 'object' ? String(entry.key).toLowerCase() : '';
        const value = !isContainer(node) ? (node.type === 'string' ? node.value : node.type === 'alias' ? '*' + node.value : node.raw ?? String(node.value)).toLowerCase() : '';
        return key.includes(query) || value.includes(query) || !!(node.anchor && ('&' + node.anchor).toLowerCase().includes(query));
    }

    /**
     * Selects the next or previous match; getHits() tells which one it is.
     * @param {number} [step] - 1 for the next match, -1 for the previous one.
     * @returns {void}
     */
    function selectNextHit(step = 1) {
        if (!hits.length) return;
        hit = (hit + step + hits.length) % hits.length;
        showHit();
    }

    /**
     * Unfolds the way to the current match, selects it and tells the editor.
     * @returns {void}
     */
    function showHit() {
        const place = hits[hit];
        expandTo(place);
        render();
        select(place);
        const info = getInfo(place);
        if (info) onPick(info, 'search');
    }

    pathEl?.addEventListener('click', selectPathStep);
    el.addEventListener('scroll', drawOnScroll, { passive: true });
    el.addEventListener('click', handleClick);
    el.addEventListener('dblclick', handleDoubleClick);
    el.addEventListener('keydown', handleTreeKey);

    return {
        /**
         * Shows a model (or the current one again) and repeats an active search, keeping its current match.
         * @param {DataModel} [newModel] - the model to show.
         * @returns {void}
         */
        render(newModel) {
            render(newModel);
            if (!query || !model) return;
            const previous = hits[hit];
            find(query);
            if (!previous) return;
            const index = hits.findIndex(place => getPlaceKey(place.doc, place.path) === getPlaceKey(previous.doc, previous.path));
            if (index >= 0) hit = index;
        },
        select,
        /**
         * Selects the node with this place in the code (the code cursor); nothing while a field is open.
         * @param {DataNode|null} node - the node.
         * @returns {void}
         */
        selectNode(node) {
            if (!model || !node || editing) return;
            select({ doc: getDocIndex(model, node), path: getPath(node) });
        },
        /**
         * Returns the info of the selected node.
         * @returns {TreeInfo|null} the info, null when nothing is selected.
         */
        getSelectedInfo: () => getInfo(selected),
        /**
         * Returns the selected place.
         * @returns {TreePlace|null} a copy of the place, null when nothing is selected.
         */
        getSelectedPlace: () => selected && { doc: selected.doc, path: selected.path.slice() },
        /**
         * Unfolds every container ("Unfold all").
         * @returns {void}
         */
        openAll() { fold.clear(); all = true; more.clear(); render(); },
        /**
         * Folds every container below the documents' roots ("Fold all").
         * @returns {void}
         */
        closeAll() { fold.clear(); all = false; render(); },
        find,
        selectNextHit,
        /**
         * Returns the search state.
         * @returns {{count: number, index: number}} the number of matches and the index of the current one.
         */
        getHits: () => ({ count: hits.length, index: hit }),
        /**
         * Opens a field over the selected node's key or value.
         * @param {string} what - 'key' or 'value'.
         * @param {number} [x] - the client x of a click.
         * @param {number} [y] - the client y of a click.
         * @returns {void}
         */
        edit(what, x, y) { startEdit(what, x, y); },
        /**
         * Tells whether a field is open.
         * @returns {boolean} true while a key or value is edited.
         */
        isEditing: () => !!editing,
        /**
         * Ends an open edit by taking the focus from its field.
         * @returns {void}
         */
        stopEdit() { if (editing) { editing.f.blur(); } },
    };
}
