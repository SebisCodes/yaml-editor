/**
 * Markdown for "Open in another editor": reads Markdown into the block
 * model of convert-model.js and writes the model as Markdown.
 *
 * Reading runs in two steps:
 * 1. footnote definitions (`[^id]: text`) are taken out of the document and kept;
 * 2. the lines are read block by block (heading, page break, code, formula, rule,
 *    quote, table, list, paragraph); quotes and list items are read as documents of
 *    their own, and the text of each block is read into inline parts.
 *
 * The reader and writer of one format stay together in this file, so it is longer than
 * the 300 lines of a module.
 */

import { createTextPart, formatIndentedLines, addNote, getNotes, getLinkUrl } from './convert-model.js?v=2';
import { getTexMath } from './convert-math.js?v=3';

/** A footnote definition on its own line, with its indented continuation lines. */
const NOTE_DEFINITION = /^\[\^([^\]\s]+)\]:[ \t]*(.*(?:\n[ \t]+\S.*)*)\n?/gm;
/** Characters that a backslash escapes in Markdown text. */
const ESCAPABLE = /[\\`*_{}[\]()#+\-.!~$|<>]/;
/** The line under a table header: dashes between pipes, with optional alignment colons. */
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
/** A list item: indentation, marker and text. */
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
/** A thematic break: three or more of the same of `-`, `*`, `_`. */
const THEMATIC_BREAK = /^\s*([-*_])(\s*\1){2,}\s*$/;
/** A line that starts a block of its own and so ends a paragraph. */
const BLOCK_START = /^(#{1,6}\s|```|~~~|>|\s*([-*+]|\d+[.)])\s|\$\$|<div\s[^>]*break-)/;
/** The page break that the Markdown editor writes. */
const PAGE_BREAK = '<div style="page-break-after: always"></div>';

/**
 * A rule for one kind of inline part that starts with a pattern.
 * @typedef {object} InlineRule
 * @property {RegExp} pattern - matches the part at the start of the rest of the text.
 * @property {function(RegExpExecArray): import('./convert-model.js').InlinePart} create - builds the part from the match.
 */

/** The inline parts that a pattern finds, in the order they are tried. */
const INLINE_RULES = [
    { pattern: /^\[\^([^\]\s]+)\]/, create: match => ({ t: 'note', kids: parseMarkdownInline(markdownNotes[match[1]] || '') }) },
    { pattern: /^!\[([^\]]*)\]\(\s*([^)\s]+)[^)]*\)/, create: match => ({ t: 'img', v: match[1], url: match[2] }) },
    { pattern: /^\[([^\]]+)\]\(\s*([^)\s]+)[^)]*\)/, create: match => ({ t: 'link', kids: parseMarkdownInline(match[1]), url: match[2] }) },
    { pattern: /^\$([^$\n]+)\$/, create: match => ({ t: 'math', v: match[1] }) },
    { pattern: /^(\*\*|__)(?=\S)([\s\S]+?)\1/, create: match => ({ t: 'b', kids: parseMarkdownInline(match[2]) }) },
    { pattern: /^~~(?=\S)([\s\S]+?)~~/, create: match => ({ t: 's', kids: parseMarkdownInline(match[1]) }) },
    { pattern: /^([*_])(?=\S)([\s\S]+?)\1/, create: match => ({ t: 'i', kids: parseMarkdownInline(match[2]) }) },
];

/** Footnotes of the Markdown being read: id -> text. */
let markdownNotes = {};

/**
 * A position in the lines of a Markdown document while it is read.
 * @typedef {object} LineReader
 * @property {string[]} lines - the lines of the document.
 * @property {number} index - the line read next.
 */

/* ---------- Reading ---------- */

/**
 * Reads the inline parts of a Markdown text.
 * @param {string} source - the text of one block.
 * @returns {import('./convert-model.js').InlinePart[]} the parts in order.
 */
export function parseMarkdownInline(source) {
    const parts = [];
    let buffer = '';
    for (let index = 0; index < source.length;) {
        if (source[index] === '\\' && ESCAPABLE.test(source[index + 1] || '')) { buffer += source[index + 1]; index += 2; continue; }
        const found = findMarkdownInlinePart(source, index);
        if (!found) { buffer += source[index++]; continue; }
        if (buffer) parts.push(createTextPart(buffer));
        buffer = '';
        parts.push(found.part);
        index += found.length;
    }
    if (buffer) parts.push(createTextPart(buffer));
    return parts;
}

/**
 * Finds an inline part (line break, code, footnote, picture, link, formula, emphasis) at a position.
 * @param {string} source - the text of one block.
 * @param {number} index - the position to look at.
 * @returns {{part: import('./convert-model.js').InlinePart, length: number}|null} the part and
 *     the length of its source, or null when plain text is there.
 */
function findMarkdownInlinePart(source, index) {
    const rest = source.slice(index);
    if (source[index] === '\\' && source[index + 1] === '\n') return { part: { t: 'br' }, length: 2 };
    const spaces = /^ {2,}\n/.exec(rest);
    if (spaces) return { part: { t: 'br' }, length: spaces[0].length };
    const ticks = /^`+/.exec(rest);
    if (ticks) {
        const end = rest.indexOf(ticks[0], ticks[0].length);
        if (end > 0) return { part: { t: 'code', v: rest.slice(ticks[0].length, end) }, length: end + ticks[0].length };
    }
    for (const rule of INLINE_RULES) {
        const match = rule.pattern.exec(rest);
        if (match) return { part: rule.create(match), length: match[0].length };
    }
    return null;
}

/**
 * Reads a Markdown document into blocks.
 * @param {string} source - the Markdown text.
 * @param {boolean} [top=true] - true for the whole document, false for the content of a quote
 *     or list item, which uses the footnotes of the document.
 * @returns {import('./convert-model.js').Block[]} the blocks in order.
 */
export function parseMarkdown(source, top = true) {
    let text = source.replace(/\r\n?/g, '\n');
    if (top) {
        markdownNotes = getMarkdownNotes(text);
        text = text.replace(NOTE_DEFINITION, '');
    }
    const reader = { lines: text.split('\n'), index: 0 };
    const blocks = [];
    while (reader.index < reader.lines.length) {
        const block = readMarkdownBlock(reader);
        if (block) blocks.push(block);
    }
    return blocks;
}

/**
 * Returns the footnote definitions of a Markdown document.
 * @param {string} text - the document with line breaks as `\n`.
 * @returns {Object<string, string>} the text of each footnote by its id, continuation lines joined.
 */
function getMarkdownNotes(text) {
    const notes = {};
    for (const match of text.matchAll(NOTE_DEFINITION)) notes[match[1]] = match[2].replace(/\n[ \t]+/g, ' ');
    return notes;
}

/**
 * Tells whether a table starts at a line: a line with a pipe followed by a header rule.
 * @param {string[]} lines - the lines of the document.
 * @param {number} index - the line to look at.
 * @returns {boolean} true when a table starts there.
 */
function isMarkdownTable(lines, index) {
    return /\|/.test(lines[index] || '') && TABLE_RULE.test(lines[index + 1] || '');
}

/**
 * Tells whether a line starts a block of its own.
 * @param {string} line - the line.
 * @returns {boolean} true for headings, fences, quotes, list items, formulas, page breaks and rules.
 */
function isMarkdownBlockStart(line) {
    return BLOCK_START.test(line) || THEMATIC_BREAK.test(line);
}

/**
 * Reads the block at the reader's line.
 * @param {LineReader} reader - the lines and position; the position moves past the block.
 * @returns {import('./convert-model.js').Block|null} the block, or null for an empty line.
 */
function readMarkdownBlock(reader) {
    const line = reader.lines[reader.index];
    if (!line.trim()) { reader.index++; return null; }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) { reader.index++; return { t: 'heading', level: heading[1].length, kids: parseMarkdownInline(heading[2]) }; }
    if (/^<div\s[^>]*break-[^>]*>\s*<\/div>\s*$/.test(line)) { reader.index++; return { t: 'pagebreak' }; }
    const fence = /^(```+|~~~+)\s*(\S*)/.exec(line);
    if (fence) return readMarkdownCode(reader, fence);
    if (/^\$\$/.test(line)) return readMarkdownMath(reader);
    if (THEMATIC_BREAK.test(line)) { reader.index++; return { t: 'hr' }; }
    if (/^>/.test(line)) return readMarkdownQuote(reader);
    if (isMarkdownTable(reader.lines, reader.index)) return readMarkdownTable(reader);
    const item = LIST_ITEM.exec(line);
    if (item) return readMarkdownList(reader, item);
    return readMarkdownParagraph(reader);
}

/**
 * Reads a fenced code block.
 * @param {LineReader} reader - the lines and position at the opening fence; the position moves past the closing fence.
 * @param {RegExpExecArray} fence - the match of the opening fence: the fence and the language.
 * @returns {import('./convert-model.js').Block} the code block.
 */
function readMarkdownCode(reader, fence) {
    const { lines } = reader;
    const body = [];
    for (reader.index++; reader.index < lines.length && !lines[reader.index].startsWith(fence[1]); reader.index++) body.push(lines[reader.index]);
    reader.index++;
    return { t: 'code', lang: fence[2], v: body.join('\n') };
}

/**
 * Reads a formula block between `$$` marks.
 * @param {LineReader} reader - the lines and position at the opening `$$`; the position moves past the closing one.
 * @returns {import('./convert-model.js').Block} the math block.
 */
function readMarkdownMath(reader) {
    const { lines } = reader;
    const body = [lines[reader.index].replace(/^\$\$/, '')];
    if (!/\$\$\s*$/.test(body[0])) for (reader.index++; reader.index < lines.length && !/\$\$\s*$/.test(lines[reader.index]); reader.index++) body.push(lines[reader.index]);
    if (reader.index < lines.length && body.length > 1) body.push(lines[reader.index]);
    reader.index++;
    return { t: 'math', v: body.join('\n').replace(/\$\$\s*$/, '').trim() };
}

/**
 * Reads a quote: the lines that start with `>`, read as a document of their own.
 * @param {LineReader} reader - the lines and position at the first quote line; the position moves past the quote.
 * @returns {import('./convert-model.js').Block} the quote block.
 */
function readMarkdownQuote(reader) {
    const { lines } = reader;
    const body = [];
    for (; reader.index < lines.length && /^>/.test(lines[reader.index]); reader.index++) body.push(lines[reader.index].replace(/^> ?/, ''));
    return { t: 'quote', kids: parseMarkdown(body.join('\n'), false) };
}

/**
 * Reads a table: the header line, the rule under it and the rows up to an empty line or a line without a pipe.
 * @param {LineReader} reader - the lines and position at the header; the position moves past the table.
 * @returns {import('./convert-model.js').Block} the table block.
 */
function readMarkdownTable(reader) {
    const { lines } = reader;
    const rows = [getMarkdownCells(lines[reader.index])];
    for (reader.index += 2; reader.index < lines.length && /\|/.test(lines[reader.index]) && lines[reader.index].trim(); reader.index++) rows.push(getMarkdownCells(lines[reader.index]));
    return { t: 'table', rows };
}

/**
 * Returns the cells of a table line.
 * @param {string} line - the table line.
 * @returns {import('./convert-model.js').InlinePart[][]} the inline parts of each cell.
 */
function getMarkdownCells(line) {
    return line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(cell => parseMarkdownInline(cell.trim()));
}

/**
 * Reads a list: the items with the same indentation as the first one.
 * @param {LineReader} reader - the lines and position at the first item; the position moves past the list.
 * @param {RegExpExecArray} first - the match of the first item: indentation and marker.
 * @returns {import('./convert-model.js').Block} the list block.
 */
function readMarkdownList(reader, first) {
    const { lines } = reader;
    const ordered = /\d/.test(first[2]);
    const indentation = first[1].length;
    const items = [];
    while (reader.index < lines.length) {
        const item = LIST_ITEM.exec(lines[reader.index]);
        if (!item || item[1].length !== indentation) break;
        items.push(readMarkdownListItem(reader, item));
        while (reader.index < lines.length && !lines[reader.index].trim() && /^\s*([-*+]|\d+[.)])\s/.test(lines[reader.index + 1] || '')) reader.index++;
    }
    return { t: 'list', ordered, items };
}

/**
 * Reads one list item with its indented lines, as a document of its own; `[ ]` and `[x]` mark a task.
 * @param {LineReader} reader - the lines and position at the item; the position moves past its last line.
 * @param {RegExpExecArray} item - the match of the item line: indentation, marker and text.
 * @returns {import('./convert-model.js').ListItem} the blocks of the item.
 */
function readMarkdownListItem(reader, item) {
    const { lines } = reader;
    const task = /^\[([ xX])\]\s+/.exec(item[3]);
    const body = [task ? item[3].slice(task[0].length) : item[3]];
    for (reader.index++; reader.index < lines.length; reader.index++) {
        const line = lines[reader.index];
        if (!line.trim() && !/^\s{2,}\S/.test(lines[reader.index + 1] || '')) break;
        if (line.trim() && !/^\s{2,}/.test(line)) break;
        body.push(line.replace(/^\s{1,4}/, ''));
    }
    const blocks = parseMarkdown(body.join('\n'), false);
    if (task) blocks.task = task[1] === ' ' ? 'open' : 'done';
    return blocks;
}

/**
 * Reads a paragraph: the lines up to an empty line or the start of another block.
 * @param {LineReader} reader - the lines and position at the first line; the position moves past the paragraph.
 * @returns {import('./convert-model.js').Block} the paragraph block.
 */
function readMarkdownParagraph(reader) {
    const { lines } = reader;
    const body = [lines[reader.index]];
    for (reader.index++; reader.index < lines.length && lines[reader.index].trim() && !isMarkdownBlockStart(lines[reader.index]) && !isMarkdownTable(lines, reader.index); reader.index++) body.push(lines[reader.index]);
    return { t: 'para', kids: parseMarkdownInline(body.join('\n')) };
}

/* ---------- Writing ---------- */

/**
 * Escapes the characters of a text that Markdown would read as markup, and line starts
 * that would begin a heading, list or quote.
 * @param {string} text - the plain text.
 * @returns {string} the escaped text.
 */
export function escapeMarkdown(text) {
    return String(text).replace(/[\\`*_[\]<>$~|]/g, '\\$&').replace(/^(\s*)(#{1,6}\s|[-+]\s|\d+[.)]\s|>)/gm, (match, space, marker) => `${space}\\${marker}`);
}

/**
 * Writes inline parts as Markdown; footnotes are collected for the end of the document.
 * @param {import('./convert-model.js').InlinePart[]} parts - the inline parts.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {string} the Markdown text.
 */
export function formatMarkdownInline(parts, lost) {
    return parts.map(part => formatMarkdownPart(part, lost)).join('');
}

/**
 * Writes one inline part as Markdown.
 * @param {import('./convert-model.js').InlinePart} part - the part.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {string} the Markdown text, '' for an unknown part.
 */
function formatMarkdownPart(part, lost) {
    switch (part.t) {
        case 'text': return escapeMarkdown(part.v);
        case 'b': return `**${formatMarkdownInline(part.kids, lost)}**`;
        case 'i': return `*${formatMarkdownInline(part.kids, lost)}*`;
        case 's': return `~~${formatMarkdownInline(part.kids, lost)}~~`;
        case 'code': { const fence = '`'.repeat(Math.max(0, ...(part.v.match(/`+/g) || []).map(ticks => ticks.length)) + 1); return `${fence}${part.v}${fence}`; }
        case 'math': return `$${getTexMath(part, lost)}$`;
        case 'link': { const url = getLinkUrl(part, lost); const label = formatMarkdownInline(part.kids, lost); return url ? `[${label}](${url})` : label; }
        case 'img': { const url = getLinkUrl(part, lost); return url ? `![${escapeMarkdown(part.v)}](${url})` : ''; }
        case 'br': return '\\\n';
        case 'note': { addNote(formatMarkdownInline(part.kids, lost)); return `[^${getNotes().length}]`; }
        default: return '';
    }
}

/**
 * Writes blocks as Markdown, an empty line between them.
 * @param {import('./convert-model.js').Block[]} blocks - the blocks.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {string} the Markdown text.
 */
export function formatMarkdownBlocks(blocks, lost) {
    return blocks.map(block => formatMarkdownBlock(block, lost)).filter(Boolean).join('\n\n');
}

/**
 * Writes one block as Markdown.
 * @param {import('./convert-model.js').Block} block - the block.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {string} the Markdown text, '' for an unknown block.
 */
function formatMarkdownBlock(block, lost) {
    switch (block.t) {
        case 'heading': return `${'#'.repeat(block.level)} ${formatMarkdownInline(block.kids, lost)}`;
        case 'para': return formatMarkdownInline(block.kids, lost);
        case 'code': return `\`\`\`${block.lang || ''}\n${block.v}\n\`\`\``;
        case 'math': return `$$\n${getTexMath(block, lost)}\n$$`;
        case 'hr': return '---';
        case 'pagebreak': return PAGE_BREAK;
        case 'quote': return formatMarkdownBlocks(block.kids, lost).split('\n').map(line => (line ? `> ${line}` : '>')).join('\n');
        case 'list': return formatMarkdownList(block, lost);
        case 'table': return formatMarkdownTable(block, lost);
        default: return '';
    }
}

/**
 * Writes a list as Markdown, task items with a box.
 * @param {import('./convert-model.js').Block} list - the list block.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {string} the Markdown list.
 */
function formatMarkdownList(list, lost) {
    return list.items.map((item, position) => {
        const marker = list.ordered ? `${position + 1}. ` : '- ';
        const box = item.task ? `[${item.task === 'done' ? 'x' : ' '}] ` : '';
        return marker + box + formatIndentedLines(formatMarkdownBlocks(item, lost), ' '.repeat(marker.length));
    }).join('\n');
}

/**
 * Writes a table as Markdown; the first row is the header.
 * @param {import('./convert-model.js').Block} table - the table block.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {string} the Markdown table.
 */
function formatMarkdownTable(table, lost) {
    const header = table.rows[0] || [];
    return [formatMarkdownTableRow(header, lost), `|${header.map(() => ' --- ').join('|')}|`, ...table.rows.slice(1).map(row => formatMarkdownTableRow(row, lost))].join('\n');
}

/**
 * Writes one table row as Markdown, line breaks in a cell as spaces.
 * @param {import('./convert-model.js').InlinePart[][]} row - the cells of the row.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {string} the row between pipes.
 */
function formatMarkdownTableRow(row, lost) {
    return `| ${row.map(cell => formatMarkdownInline(cell, lost).replace(/\n/g, ' ')).join(' | ')} |`;
}

/**
 * Appends the collected footnotes to a Markdown body as definitions.
 * @param {string} body - the written blocks.
 * @param {string[]} notes - the footnotes in order.
 * @returns {string} the body with the definitions, unchanged without footnotes.
 */
export function formatMarkdownNotes(body, notes) {
    if (!notes.length) return body;
    return body + `\n\n${notes.map((note, position) => `[^${position + 1}]: ${note}`).join('\n')}`;
}

/**
 * Returns the whole Markdown document around its body.
 * @param {string} body - the written blocks with their footnotes.
 * @returns {string} the document, ending with a line break.
 */
export function formatMarkdownDocument(body) {
    return body + '\n';
}
