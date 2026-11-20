/**
 * HTML for "Open in another editor": reads HTML into the block model of
 * convert-model.js and writes the model as HTML.
 *
 * A document is untrusted: it is read with DOMParser, which runs no script and loads
 * nothing, and scripts, styles and form fields are listed as lost.
 *
 * Reading walks the body:
 * 1. text and inline elements between blocks are collected into a paragraph;
 * 2. each block element becomes its block (heading, paragraph, code, rule, quote,
 *    list, table, page break); other block elements give the blocks inside them.
 */

import { LOSS, createTextPart, getTrimmedParts, escapeHtml, addNote, getNotes, getLinkUrl } from './convert-model.js?v=2';

/** Elements that start a block of their own. */
const BLOCK_TAGS = /^(address|article|aside|blockquote|body|center|details|div|dl|dd|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|ul)$/;
/** The DOM node type of an element. */
const ELEMENT_NODE = 1;
/** The DOM node type of a text. */
const TEXT_NODE = 3;
/** The page break written into HTML. */
const PAGE_BREAK = '<div style="page-break-after: always"></div>';

/**
 * An element, or an object that holds the nodes to read.
 * @typedef {object} NodeHolder
 * @property {Iterable<Node>} childNodes - the nodes.
 */

/* ---------- Reading ---------- */

/**
 * Reads an HTML document into blocks.
 * @param {string} source - the HTML text.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {import('./convert-model.js').Block[]} the blocks of the body.
 */
export function parseHtml(source, lost) {
    const doc = new DOMParser().parseFromString(source, 'text/html');
    return parseHtmlBlocks(doc.body, lost);
}

/**
 * Reads the inline parts inside a node.
 * @param {NodeHolder} node - the element, or an object that holds the nodes to read.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {import('./convert-model.js').InlinePart[]} the parts in order.
 */
function parseHtmlInline(node, lost) {
    const parts = [];
    for (const child of node.childNodes) {
        if (child.nodeType === TEXT_NODE) {
            const value = child.nodeValue.replace(/\s+/g, ' ');
            if (value) parts.push(createTextPart(value));
            continue;
        }
        if (child.nodeType !== ELEMENT_NODE) continue;
        parts.push(...parseHtmlInlineElement(child, lost));
    }
    return parts;
}

/**
 * Reads one inline element; an element without a part of its own gives the parts inside it.
 * @param {Element} element - the element.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {import('./convert-model.js').InlinePart[]} the parts it stands for.
 */
function parseHtmlInlineElement(element, lost) {
    const tag = element.localName;
    if (tag === 'script' || tag === 'style') { lost.add(LOSS.scripts); return []; }
    if (tag === 'br') return [{ t: 'br' }];
    if (tag === 'b' || tag === 'strong') return [{ t: 'b', kids: parseHtmlInline(element, lost) }];
    if (tag === 'i' || tag === 'em') return [{ t: 'i', kids: parseHtmlInline(element, lost) }];
    if (tag === 's' || tag === 'del' || tag === 'strike') return [{ t: 's', kids: parseHtmlInline(element, lost) }];
    if (tag === 'code' || tag === 'kbd' || tag === 'samp') return [{ t: 'code', v: element.textContent }];
    if (tag === 'a') return [{ t: 'link', kids: parseHtmlInline(element, lost), url: element.getAttribute('href') || '' }];
    if (tag === 'img') return [{ t: 'img', v: element.getAttribute('alt') || '', url: element.getAttribute('src') || '' }];
    return parseHtmlInline(element, lost);
}

/**
 * Reads the blocks inside an element.
 * @param {Element} root - the element whose children are read.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {import('./convert-model.js').Block[]} the blocks in order.
 */
function parseHtmlBlocks(root, lost) {
    const blocks = [];
    let run = [];
    for (const child of root.childNodes) {
        const tag = child.nodeType === ELEMENT_NODE ? child.localName : '';
        if (!tag || !BLOCK_TAGS.test(tag)) {
            if (tag === 'script' || tag === 'style' || tag === 'link') { lost.add(LOSS.scripts); continue; }
            if (child.nodeType === TEXT_NODE || tag) run.push(child);
            continue;
        }
        blocks.push(...getHtmlRunBlocks(run, lost));
        run = [];
        blocks.push(...parseHtmlBlock(child, tag, lost));
    }
    blocks.push(...getHtmlRunBlocks(run, lost));
    return blocks;
}

/**
 * Returns the paragraph made of text and inline elements found between blocks.
 * @param {Node[]} run - the nodes in order.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {import('./convert-model.js').Block[]} one paragraph, or none when the nodes hold only white space.
 */
function getHtmlRunBlocks(run, lost) {
    const kids = run.flatMap(node => parseHtmlInline({ childNodes: [node] }, lost));
    if (!kids.some(kid => kid.t !== 'text' || kid.v.trim())) return [];
    return [{ t: 'para', kids: getTrimmedParts(kids) }];
}

/**
 * Reads one block element.
 * @param {Element} element - the element.
 * @param {string} tag - its local name.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {import('./convert-model.js').Block[]} the blocks it stands for: one, none for an empty
 *     paragraph, the blocks inside it for other block elements.
 */
function parseHtmlBlock(element, tag, lost) {
    if (/^h[1-6]$/.test(tag)) return [{ t: 'heading', level: +tag[1], kids: getTrimmedParts(parseHtmlInline(element, lost)) }];
    if (tag === 'p') {
        const kids = getTrimmedParts(parseHtmlInline(element, lost));
        return kids.length ? [{ t: 'para', kids }] : [];
    }
    if (tag === 'pre') return [{ t: 'code', lang: (/language-(\S+)/.exec(element.querySelector('code')?.className || '') || [])[1] || '', v: element.textContent.replace(/\n$/, '') }];
    if (tag === 'hr') return [{ t: 'hr' }];
    if (tag === 'blockquote') return [{ t: 'quote', kids: parseHtmlBlocks(element, lost) }];
    if (tag === 'ul' || tag === 'ol') return [{ t: 'list', ordered: tag === 'ol', items: [...element.children].filter(child => child.localName === 'li').map(item => parseHtmlListItem(item, lost)) }];
    if (tag === 'table') return [{ t: 'table', rows: [...element.querySelectorAll('tr')].map(row => [...row.children].map(cell => getTrimmedParts(parseHtmlInline(cell, lost)))) }];
    if (tag === 'div' && !element.childNodes.length && /break-/.test(element.getAttribute('style') || '')) return [{ t: 'pagebreak' }];
    if (tag === 'form' || tag === 'fieldset') lost.add(LOSS.formFields);
    return parseHtmlBlocks(element, lost);
}

/**
 * Reads one list item; a checkbox at its start marks a task.
 * @param {Element} item - the `li` element.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {import('./convert-model.js').ListItem} the blocks of the item.
 */
function parseHtmlListItem(item, lost) {
    const blocks = parseHtmlBlocks(item, lost);
    const box = item.querySelector(':scope > input[type=checkbox], :scope > p > input[type=checkbox]');
    if (box) blocks.task = box.hasAttribute('checked') ? 'done' : 'open';
    return blocks;
}

/* ---------- Writing ---------- */

/**
 * Writes inline parts as HTML; footnotes are collected for the end of the document.
 * @param {import('./convert-model.js').InlinePart[]} parts - the inline parts.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {string} the HTML text.
 */
function formatHtmlInline(parts, lost) {
    return parts.map(part => formatHtmlPart(part, lost)).join('');
}

/**
 * Writes one inline part as HTML; formulas become code.
 * @param {import('./convert-model.js').InlinePart} part - the part.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {string} the HTML text, '' for an unknown part.
 */
function formatHtmlPart(part, lost) {
    switch (part.t) {
        case 'text': return escapeHtml(part.v);
        case 'b': return `<strong>${formatHtmlInline(part.kids, lost)}</strong>`;
        case 'i': return `<em>${formatHtmlInline(part.kids, lost)}</em>`;
        case 's': return `<s>${formatHtmlInline(part.kids, lost)}</s>`;
        case 'code': return `<code>${escapeHtml(part.v)}</code>`;
        case 'math': lost.add(LOSS.formulasAsCode); return `<code>${escapeHtml(part.v)}</code>`;
        case 'link': { const url = getLinkUrl(part, lost); const label = formatHtmlInline(part.kids, lost); return url ? `<a href="${escapeHtml(url)}">${label}</a>` : label; }
        case 'img': { const url = getLinkUrl(part, lost); return url ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(part.v)}">` : ''; }
        case 'br': return '<br>';
        case 'note': { addNote(formatHtmlInline(part.kids, lost)); return `<sup>${getNotes().length}</sup>`; }
        default: return '';
    }
}

/**
 * Writes blocks as HTML, one per line.
 * @param {import('./convert-model.js').Block[]} blocks - the blocks.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {string} the HTML text.
 */
export function formatHtmlBlocks(blocks, lost) {
    return blocks.map(block => formatHtmlBlock(block, lost)).filter(Boolean).join('\n');
}

/**
 * Writes one block as HTML.
 * @param {import('./convert-model.js').Block} block - the block.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {string} the HTML text, '' for an unknown block.
 */
function formatHtmlBlock(block, lost) {
    switch (block.t) {
        case 'heading': return `<h${block.level}>${formatHtmlInline(block.kids, lost)}</h${block.level}>`;
        case 'para': return `<p>${formatHtmlInline(block.kids, lost)}</p>`;
        case 'code': return `<pre><code>${escapeHtml(block.v)}</code></pre>`;
        case 'math': lost.add(LOSS.formulasAsCode); return `<pre><code>${escapeHtml(block.v)}</code></pre>`;
        case 'hr': return '<hr>';
        case 'pagebreak': return PAGE_BREAK;
        case 'quote': return `<blockquote>\n${formatHtmlBlocks(block.kids, lost)}\n</blockquote>`;
        case 'list': return formatHtmlList(block, lost);
        case 'table': return `<table>\n${block.rows.map((row, position) => `<tr>${row.map(cell => `<${position ? 'td' : 'th'}>${formatHtmlInline(cell, lost)}</${position ? 'td' : 'th'}>`).join('')}</tr>`).join('\n')}\n</table>`;
        default: return '';
    }
}

/**
 * Writes a list as HTML, task items with a disabled checkbox.
 * @param {import('./convert-model.js').Block} list - the list block.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {string} the `ul` or `ol` element.
 */
function formatHtmlList(list, lost) {
    const tag = list.ordered ? 'ol' : 'ul';
    const items = list.items.map(item => `<li>${item.task ? `<input type="checkbox" disabled${item.task === 'done' ? ' checked' : ''}> ` : ''}${removeParagraphWrap(formatHtmlBlocks(item, lost))}</li>`);
    return `<${tag}>\n${items.join('\n')}\n</${tag}>`;
}

/**
 * Removes the `p` element around a list item that holds a single paragraph.
 * @param {string} html - the written blocks of the item.
 * @returns {string} the content of the paragraph, or the blocks unchanged.
 */
function removeParagraphWrap(html) {
    return /^<p>((?:(?!<\/?p>)[\s\S])*)<\/p>$/.test(html) ? html.slice(3, -4) : html;
}

/**
 * Appends the collected footnotes to an HTML body as a numbered list under a rule.
 * @param {string} body - the written blocks.
 * @param {string[]} notes - the footnotes in order.
 * @returns {string} the body with the footnotes, unchanged without footnotes.
 */
export function formatHtmlNotes(body, notes) {
    if (!notes.length) return body;
    return body + `\n<hr>\n<ol>\n${notes.map(note => `<li>${note}</li>`).join('\n')}\n</ol>`;
}

/**
 * Returns the whole HTML document around its body.
 * @param {string} body - the written blocks with their footnotes.
 * @param {string} name - the document name, used as the title.
 * @returns {string} the document, ending with a line break.
 */
export function formatHtmlDocument(body, name) {
    return `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>${escapeHtml(name)}</title>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
}
