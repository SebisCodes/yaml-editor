/**
 * Typst for "Open in another editor": reads Typst markup into the block
 * model of convert-model.js and writes the model as Typst.
 *
 * Reading runs line by line: settings (`#set`, `#show`, `#let`, `#import`, `#include`)
 * are listed as lost, then each line starts a block (page break, rule, heading, code,
 * formula, quote, table, list, paragraph). Quotes and list items are read as documents
 * of their own, and the text of each block is read into inline parts; Typst functions
 * without an equivalent are listed as lost.
 *
 * The reader and writer of one format stay together in this file, so it is longer than
 * the 300 lines of a module.
 */

import { LOSS, createTextPart, getTrimmedParts, formatIndentedLines, getLinkUrl } from './convert-model.js?v=2';
import { getTypstMath } from './convert-math.js?v=3';

/** A line that starts a block of its own and so ends a paragraph. */
const BLOCK_START = /^(=+\s|```|\s*[-+]\s|\$\s|#(pagebreak|table|quote|line|set|show|let|import)\b)/;
/** A list item: indentation, marker and text. */
const LIST_ITEM = /^(\s*)[-+]\s+(.*)$/;
/** The deepest heading level of the block model. */
const MAX_HEADING_LEVEL = 6;
/** The box that marks an open task in a list item. */
const OPEN_BOX = '☐';
/** The box that marks a done task in a list item. */
const DONE_BOX = '☒';
/** A task box at the start of a list item, with the space after it. */
const TASK_BOX = /^([☐☒])\s*/;

/**
 * A rule for one kind of inline markup that starts with a pattern.
 * @typedef {object} TypstInlineRule
 * @property {RegExp} pattern - matches the markup at the start of the rest of the text.
 * @property {function(RegExpExecArray, import('./convert-model.js').LossSet): (import('./convert-model.js').InlinePart|null)} create -
 *     builds the part from the match, or returns null for markup that is left out.
 */

/** The inline markup that a pattern finds, in the order it is tried. */
const INLINE_RULES = [
    { pattern: /^`([^`]*)`/, create: match => ({ t: 'code', v: match[1] }) },
    { pattern: /^\$([^$]*)\$/, create: match => ({ t: 'math', v: match[1].trim(), typst: true }) },
    { pattern: /^#link\("([^"]*)"\)(\[([^\]]*)\])?/, create: (match, lost) => ({ t: 'link', url: match[1], kids: match[3] ? parseTypstInline(match[3], lost) : [createTextPart(match[1])] }) },
    { pattern: /^#image\("([^"]*)"[^)]*\)/, create: match => ({ t: 'img', v: '', url: match[1] }) },
    { pattern: /^#footnote\[([^\]]*)\]/, create: (match, lost) => ({ t: 'note', kids: parseTypstInline(match[1], lost) }) },
    { pattern: /^#strike\[([^\]]*)\]/, create: (match, lost) => ({ t: 's', kids: parseTypstInline(match[1], lost) }) },
    { pattern: /^\*(?=\S)([^*]+)\*/, create: (match, lost) => ({ t: 'b', kids: parseTypstInline(match[1], lost) }) },
    { pattern: /^_(?=\S)([^_]+)_/, create: (match, lost) => ({ t: 'i', kids: parseTypstInline(match[1], lost) }) },
    { pattern: /^#[a-zA-Z][\w.-]*(\([^)]*\))?(\[[^\]]*\])?/, create: (match, lost) => { lost.add(LOSS.typstFunctions); return null; } },
];

/**
 * A position in the lines of a Typst document while it is read.
 * @typedef {object} LineReader
 * @property {string[]} lines - the lines of the document.
 * @property {number} index - the line read next.
 */

/* ---------- Reading ---------- */

/**
 * Reads the inline parts of a Typst text.
 * @param {string} source - the text of one block.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {import('./convert-model.js').InlinePart[]} the parts, white space at both ends trimmed.
 */
function parseTypstInline(source, lost) {
    const parts = [];
    let buffer = '';
    for (let index = 0; index < source.length;) {
        if (source[index] === '\\' && source[index + 1] !== '\n') { buffer += source[index + 1] || ''; index += 2; continue; }
        const found = findTypstInlinePart(source, index, lost);
        if (!found) { buffer += source[index++]; continue; }
        if (buffer) parts.push(createTextPart(buffer));
        buffer = '';
        if (found.part) parts.push(found.part);
        index += found.length;
    }
    if (buffer) parts.push(createTextPart(buffer));
    return getTrimmedParts(parts);
}

/**
 * Finds inline markup (line break, code, formula, link, picture, footnote, emphasis, function) at a position.
 * @param {string} source - the text of one block.
 * @param {number} index - the position to look at.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {{part: (import('./convert-model.js').InlinePart|null), length: number}|null} the part
 *     (null for markup that is left out) and the length of its source, or null when plain text is there.
 */
function findTypstInlinePart(source, index, lost) {
    if (source[index] === '\\' && source[index + 1] === '\n') return { part: { t: 'br' }, length: 2 };
    const rest = source.slice(index);
    for (const rule of INLINE_RULES) {
        const match = rule.pattern.exec(rest);
        if (match) return { part: rule.create(match, lost), length: match[0].length };
    }
    return null;
}

/**
 * Reads a Typst document into blocks.
 * @param {string} source - the Typst text.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {import('./convert-model.js').Block[]} the blocks in order.
 */
export function parseTypst(source, lost) {
    const reader = { lines: source.replace(/\r\n?/g, '\n').split('\n'), index: 0 };
    const blocks = [];
    while (reader.index < reader.lines.length) {
        const block = readTypstBlock(reader, lost);
        if (block) blocks.push(block);
    }
    return blocks;
}

/**
 * Reads the block at the reader's line.
 * @param {LineReader} reader - the lines and position; the position moves past the block.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {import('./convert-model.js').Block|null} the block, or null for an empty line, a comment or a setting.
 */
function readTypstBlock(reader, lost) {
    const line = reader.lines[reader.index];
    if (!line.trim() || line.startsWith('//')) { reader.index++; return null; }
    if (/^#(set|show|let|import|include)\b/.test(line)) { lost.add(LOSS.documentSettings); reader.index++; return null; }
    if (/^#pagebreak\(/.test(line)) { reader.index++; return { t: 'pagebreak' }; }
    if (/^#line\(/.test(line)) { reader.index++; return { t: 'hr' }; }
    const heading = /^(=+)\s+(.*)$/.exec(line);
    if (heading) { reader.index++; return { t: 'heading', level: Math.min(heading[1].length, MAX_HEADING_LEVEL), kids: parseTypstInline(heading[2], lost) }; }
    const fence = /^```(\S*)/.exec(line);
    if (fence) return readTypstCode(reader, fence[1]);
    const math = /^\$\s([\s\S]*?)\s?\$\s*$/.exec(line);
    if (math) { reader.index++; return { t: 'math', v: math[1], typst: true }; }
    const quote = /^#quote(\([^)]*\))?\[(.*)\]\s*$/.exec(line);
    if (quote) { reader.index++; return { t: 'quote', kids: parseTypst(quote[2], lost) }; }
    if (/^#table\(/.test(line)) return readTypstTable(reader, lost);
    const item = /^(\s*)([-+])\s+/.exec(line);
    if (item) return readTypstList(reader, item, lost);
    return readTypstParagraph(reader, lost);
}

/**
 * Reads a fenced code block.
 * @param {LineReader} reader - the lines and position at the opening fence; the position moves past the closing fence.
 * @param {string} language - the language named after the fence.
 * @returns {import('./convert-model.js').Block} the code block.
 */
function readTypstCode(reader, language) {
    const { lines } = reader;
    const body = [];
    for (reader.index++; reader.index < lines.length && !lines[reader.index].startsWith('```'); reader.index++) body.push(lines[reader.index]);
    reader.index++;
    return { t: 'code', lang: language, v: body.join('\n') };
}

/**
 * Returns how far a line opens parentheses: opening minus closing ones.
 * @param {string} line - the line.
 * @returns {number} the difference, negative when more close than open.
 */
function getParenthesisDepth(line) {
    return (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length;
}

/**
 * Reads a `#table(...)` call up to its closing parenthesis; the cells fill rows of `columns` cells.
 * @param {LineReader} reader - the lines and position at the call; the position moves past it.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {import('./convert-model.js').Block} the table block.
 */
function readTypstTable(reader, lost) {
    const { lines } = reader;
    let body = lines[reader.index], depth = getParenthesisDepth(body);
    while (depth > 0 && ++reader.index < lines.length) { body += '\n' + lines[reader.index]; depth += getParenthesisDepth(lines[reader.index]); }
    reader.index++;
    const columns = +(/columns:\s*(\d+)/.exec(body) || [])[1] || 1;
    const cells = [...body.matchAll(/\[([^\]]*)\]/g)].map(match => parseTypstInline(match[1], lost));
    const rows = [];
    for (let start = 0; start < cells.length; start += columns) rows.push(cells.slice(start, start + columns));
    return { t: 'table', rows };
}

/**
 * Reads a list: the items with the same indentation as the first one; `+` numbers them.
 * @param {LineReader} reader - the lines and position at the first item; the position moves past the list.
 * @param {RegExpExecArray} first - the match of the first item: indentation and marker.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {import('./convert-model.js').Block} the list block.
 */
function readTypstList(reader, first, lost) {
    const ordered = first[2] === '+';
    const indentation = first[1].length;   // the items of this list; deeper lines belong to an item
    const items = [];
    while (reader.index < reader.lines.length) {
        const item = LIST_ITEM.exec(reader.lines[reader.index]);
        if (!item || item[1].length !== indentation) break;
        items.push(readTypstListItem(reader, item[2], indentation, lost));
    }
    return { t: 'list', ordered, items };
}

/**
 * Reads one list item with its deeper lines, as a document of its own; a box marks a task.
 * @param {LineReader} reader - the lines and position at the item; the position moves past its last line.
 * @param {string} text - the text after the marker.
 * @param {number} indentation - the indentation of the list's items.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {import('./convert-model.js').ListItem} the blocks of the item.
 */
function readTypstListItem(reader, text, indentation, lost) {
    const { lines } = reader;
    const body = [text];
    for (reader.index++; reader.index < lines.length && /\S/.test(lines[reader.index]) && /^\s*/.exec(lines[reader.index])[0].length > indentation; reader.index++) body.push(lines[reader.index].slice(indentation).replace(/^\s{1,2}/, ''));
    const box = TASK_BOX.exec(body[0]);
    if (box) body[0] = body[0].slice(box[0].length);
    const blocks = parseTypst(body.join('\n'), lost);
    if (box) blocks.task = box[1] === OPEN_BOX ? 'open' : 'done';
    return blocks;
}

/**
 * Reads a paragraph: the lines up to an empty line or the start of another block.
 * @param {LineReader} reader - the lines and position at the first line; the position moves past the paragraph.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {import('./convert-model.js').Block} the paragraph block.
 */
function readTypstParagraph(reader, lost) {
    const { lines } = reader;
    const body = [lines[reader.index]];
    for (reader.index++; reader.index < lines.length && lines[reader.index].trim() && !BLOCK_START.test(lines[reader.index]); reader.index++) body.push(lines[reader.index]);
    return { t: 'para', kids: parseTypstInline(body.join('\n'), lost) };
}

/* ---------- Writing ---------- */

/**
 * Escapes the characters of a text that Typst would read as markup, and line starts
 * that would begin a heading or list.
 * @param {string} text - the plain text.
 * @returns {string} the escaped text.
 */
function escapeTypst(text) {
    return String(text).replace(/[\\#$*_`<>@[\]~]/g, '\\$&').replace(/\/(?=[/*])/g, '\\/').replace(/^(\s*)(=+\s|[-+]\s|\/\s|\d+\.\s)/gm, (match, space, marker) => `${space}\\${marker}`);
}

/**
 * Writes inline parts as Typst.
 * @param {import('./convert-model.js').InlinePart[]} parts - the inline parts.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {string} the Typst text.
 */
function formatTypstInline(parts, lost) {
    return parts.map(part => formatTypstPart(part, lost)).join('');
}

/**
 * Writes one inline part as Typst.
 * @param {import('./convert-model.js').InlinePart} part - the part.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {string} the Typst text, '' for an unknown part.
 */
function formatTypstPart(part, lost) {
    switch (part.t) {
        case 'text': return escapeTypst(part.v);
        case 'b': return `*${formatTypstInline(part.kids, lost)}*`;
        case 'i': return `_${formatTypstInline(part.kids, lost)}_`;
        case 's': return `#strike[${formatTypstInline(part.kids, lost)}]`;
        case 'code': return `\`${part.v.replace(/`/g, "'")}\``;
        case 'math': return `$${getTypstMath(part, lost)}$`;
        case 'link': { const url = getLinkUrl(part, lost); const label = formatTypstInline(part.kids, lost); return url ? `#link(${JSON.stringify(url)})[${label}]` : label; }
        case 'img': { const url = getLinkUrl(part, lost); return url ? `#image(${JSON.stringify(url)})` : ''; }
        case 'br': return '\\\n';
        case 'note': return `#footnote[${formatTypstInline(part.kids, lost)}]`;
        default: return '';
    }
}

/**
 * Writes blocks as Typst, an empty line between them.
 * @param {import('./convert-model.js').Block[]} blocks - the blocks.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {string} the Typst text.
 */
export function formatTypstBlocks(blocks, lost) {
    return blocks.map(block => formatTypstBlock(block, lost)).filter(Boolean).join('\n\n');
}

/**
 * Writes one block as Typst.
 * @param {import('./convert-model.js').Block} block - the block.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {string} the Typst text, '' for an unknown block.
 */
function formatTypstBlock(block, lost) {
    switch (block.t) {
        case 'heading': return `${'='.repeat(block.level)} ${formatTypstInline(block.kids, lost)}`;
        case 'para': return formatTypstInline(block.kids, lost);
        case 'code': return `\`\`\`${block.lang || ''}\n${block.v}\n\`\`\``;
        case 'math': return `$ ${getTypstMath(block, lost)} $`;
        case 'hr': return '#line(length: 100%)';
        case 'pagebreak': return '#pagebreak()';
        case 'quote': return `#quote(block: true)[${formatTypstBlocks(block.kids, lost)}]`;
        case 'list': return formatTypstList(block, lost);
        case 'table': return formatTypstTable(block, lost);
        default: return '';
    }
}

/**
 * Writes a list as Typst, `+` for numbered items, task items with a box.
 * @param {import('./convert-model.js').Block} list - the list block.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {string} the Typst list.
 */
function formatTypstList(list, lost) {
    const marker = list.ordered ? '+ ' : '- ';
    return list.items.map(item => marker + (item.task ? `${item.task === 'done' ? DONE_BOX : OPEN_BOX} ` : '') + formatIndentedLines(formatTypstBlocks(item, lost), '  ')).join('\n');
}

/**
 * Writes a table as a `#table(...)` call, one row per line.
 * @param {import('./convert-model.js').Block} table - the table block.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {string} the Typst table.
 */
function formatTypstTable(table, lost) {
    const columns = Math.max(1, ...table.rows.map(row => row.length));
    return `#table(\n  columns: ${columns},\n${table.rows.map(row => `  ${row.map(cell => `[${formatTypstInline(cell, lost)}]`).join(', ')},`).join('\n')}\n)`;
}

/**
 * Returns the whole Typst document around its body.
 * @param {string} body - the written blocks.
 * @returns {string} the document, ending with a line break.
 */
export function formatTypstDocument(body) {
    return body + '\n';
}
