/**
 * LaTeX for "Open in another editor": reads LaTeX into the block model of
 * convert-model.js and writes the model as a LaTeX article.
 *
 * Reading runs in these steps:
 * 1. the preamble is listed as lost (class, packages), the title is kept for `\maketitle`;
 * 2. the body between `\begin{document}` and `\end{document}` is searched for the
 *    commands that start a block (sections, environments, page breaks, display formulas);
 * 3. the text between them is split into paragraphs at empty lines;
 * 4. environments are read by kind: lists, quotes, code, formulas, tables; frames such
 *    as `figure` give their content, others are listed and give their content too;
 * 5. the text of each paragraph is read into inline parts; every command moves the
 *    reading on, whatever its arguments look like.
 *
 * The reader and writer of one format stay together in this file, so it is longer than
 * the 300 lines of a module.
 */

import { LOSS, createTextPart, getTrimmedParts, getLinkUrl } from './convert-model.js?v=2';
import { getBracedArgument, getTexMath } from './convert-math.js?v=3';

/** The command that starts the body of a document. */
const DOCUMENT_BEGIN = '\\begin{document}';
/** The commands that start a block: sections, environments, page commands, display formulas. */
const BLOCK_START = /\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*(?=\{)|\\begin\{([a-zA-Z*]+)\}|\\(newpage|clearpage|cleardoublepage|maketitle|tableofcontents|hrule)\b|\\\[|\$\$/;
/** The heading level of each sectioning command. */
const HEADING_LEVELS = { part: 1, chapter: 1, section: 1, subsection: 2, subsubsection: 3, paragraph: 4, subparagraph: 5 };
/** The sectioning command written for each heading level, 1 to 6. */
const SECTION_COMMANDS = ['section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph', 'subparagraph'];
/** Text commands and the inline part they stand for. */
const TEXT_WRAP = { textbf: 'b', textit: 'i', emph: 'i', sout: 's', st: 's' };
/** Environments that only frame their content. */
const FRAME_ENVIRONMENTS = ['center', 'figure', 'table', 'flushleft', 'flushright', 'abstract'];
/** Environments whose content is code. */
const CODE_ENVIRONMENTS = ['verbatim', 'lstlisting', 'minted'];
/** Environments whose content is a display formula. */
const MATH_ENVIRONMENT = /^(equation|align|gather|displaymath|multline)$/;
/** Environments whose content is a table. */
const TABLE_ENVIRONMENTS = ['tabular', 'tabularx', 'longtable'];
/** The characters that LaTeX text escapes, and how. */
const TEX_ESCAPES = { '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', $: '\\$', '&': '\\&', '#': '\\#', _: '\\_', '%': '\\%', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}' };

/**
 * The state of reading the inline parts of a LaTeX text.
 * @typedef {object} LatexInlineReader
 * @property {string} text - the text.
 * @property {number} index - the position of the next character.
 * @property {import('./convert-model.js').InlinePart[]} parts - the parts read so far.
 * @property {string} buffer - plain text not yet added as a part.
 */

/**
 * A position in a text while the arguments of a command are read.
 * @typedef {object} TextCursor
 * @property {string} text - the text.
 * @property {number} index - the position of the next character.
 */

/**
 * A block found at a block command, and where reading goes on.
 * @typedef {object} LatexBlockMatch
 * @property {import('./convert-model.js').Block[]} blocks - the blocks it stands for.
 * @property {number} end - the position after it.
 */

/* ---------- Reading ---------- */

/**
 * Reads a LaTeX document into blocks.
 * @param {string} source - the LaTeX text.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {import('./convert-model.js').Block[]} the blocks of the body.
 */
export function parseLatex(source, lost) {
    const begin = source.indexOf(DOCUMENT_BEGIN);
    if (source.slice(0, Math.max(begin, 0)).match(/\\usepackage|\\documentclass/)) lost.add(LOSS.documentSettings);
    const title = /\\title\{([^}]*)\}/.exec(source);
    const body = (begin >= 0 ? source.slice(begin + DOCUMENT_BEGIN.length) : source).replace(/\\end\{document\}[\s\S]*$/, '');
    const blocks = [];
    if (title && /\\maketitle/.test(body)) blocks.push({ t: 'heading', level: 1, kids: parseLatexInline(title[1], lost) });
    blocks.push(...parseLatexBlocks(body, lost));
    return blocks;
}

/**
 * Reads LaTeX body text into blocks.
 * @param {string} text - the text of the body or of an environment.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {import('./convert-model.js').Block[]} the blocks in order.
 */
function parseLatexBlocks(text, lost) {
    const pattern = new RegExp(BLOCK_START.source, 'g');
    const blocks = [];
    let last = 0, match;
    while ((match = pattern.exec(text))) {
        blocks.push(...getLatexParagraphs(text.slice(last, match.index), lost));
        const found = readLatexBlock(text, match, pattern.lastIndex, lost);
        blocks.push(...found.blocks);
        last = found.end;
        pattern.lastIndex = found.end;
    }
    blocks.push(...getLatexParagraphs(text.slice(last), lost));
    return blocks;
}

/**
 * Returns the paragraphs of a LaTeX text without block commands, split at empty lines.
 * @param {string} text - the text.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {import('./convert-model.js').Block[]} the paragraphs that are not empty.
 */
function getLatexParagraphs(text, lost) {
    const paragraphs = [];
    for (const piece of text.split(/\n\s*\n/)) {
        const kids = parseLatexInline(piece, lost);
        if (kids.length) paragraphs.push({ t: 'para', kids });
    }
    return paragraphs;
}

/**
 * Reads the block that a block command starts.
 * @param {string} text - the text being read.
 * @param {RegExpExecArray} match - the match of the block command.
 * @param {number} end - the position after the command.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {LatexBlockMatch} the blocks and the position after them.
 */
function readLatexBlock(text, match, end, lost) {
    if (match[1]) {
        const argument = getBracedArgument(text, end);
        return { blocks: [{ t: 'heading', level: HEADING_LEVELS[match[1]], kids: parseLatexInline(argument.v, lost) }], end: argument.end };
    }
    if (match[2]) return readLatexEnvironment(text, match[2], end, lost);
    if (match[3]) return { blocks: getLatexCommandBlocks(match[3], lost), end };
    const closing = match[0] === '\\[' ? '\\]' : '$$';
    const close = text.indexOf(closing, end);
    return { blocks: [{ t: 'math', v: text.slice(end, close < 0 ? text.length : close).trim() }], end: close < 0 ? text.length : close + closing.length };
}

/**
 * Returns the blocks of a page command: a rule or a page break; the table of contents is listed as lost.
 * @param {string} command - the command name.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {import('./convert-model.js').Block[]} one block or none.
 */
function getLatexCommandBlocks(command, lost) {
    if (command === 'hrule') return [{ t: 'hr' }];
    if (/page/.test(command)) return [{ t: 'pagebreak' }];
    if (command === 'tableofcontents') lost.add(LOSS.tableOfContents);
    return [];
}

/**
 * Reads an environment up to its matching `\end`, nested ones of the same name included.
 * @param {string} text - the text being read.
 * @param {string} name - the environment name as written, with its star.
 * @param {number} start - the position after `\begin{name}`.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {LatexBlockMatch} the blocks and the position after `\end{name}`.
 */
function readLatexEnvironment(text, name, start, lost) {
    const open = `\\begin{${name}}`, close = `\\end{${name}}`;
    let depth = 1, end = start;
    while (depth > 0) {
        const nextOpen = text.indexOf(open, end), nextClose = text.indexOf(close, end);
        if (nextClose < 0) { end = text.length; break; }
        if (nextOpen >= 0 && nextOpen < nextClose) { depth++; end = nextOpen + open.length; } else { depth--; end = nextClose + close.length; }
    }
    const body = text.slice(start, Math.max(start, end - close.length));
    return { blocks: getLatexEnvironmentBlocks(name.replace('*', ''), body, lost), end };
}

/**
 * Returns the blocks of an environment by its kind.
 * @param {string} environment - the environment name without star.
 * @param {string} body - the content of the environment.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {import('./convert-model.js').Block[]} the blocks it stands for.
 */
function getLatexEnvironmentBlocks(environment, body, lost) {
    if (environment === 'itemize' || environment === 'enumerate') return [{ t: 'list', ordered: environment === 'enumerate', items: splitLatexItems(body).map(item => parseLatexListItem(item, lost)) }];
    if (environment === 'quote' || environment === 'quotation') return [{ t: 'quote', kids: parseLatexBlocks(body, lost) }];
    if (CODE_ENVIRONMENTS.includes(environment)) return [{ t: 'code', lang: '', v: body.replace(/^(\[[^\]]*\]|\{[^}]*\})?\n?/, '').replace(/\n$/, '') }];
    if (MATH_ENVIRONMENT.test(environment)) return [getLatexMathBlock(environment, body, lost)];
    if (TABLE_ENVIRONMENTS.includes(environment)) return [getLatexTable(body, lost)];
    if (FRAME_ENVIRONMENTS.includes(environment)) return parseLatexBlocks(body.replace(/^\s*\[[^\]]*\]/, '').replace(/\\caption\{[^}]*\}/, ''), lost);
    lost.add(LOSS.latexCommands);
    return parseLatexBlocks(body, lost);
}

/**
 * Reads one `\item` of a list; a box (`[$\square$]`, `[$\boxtimes$]`) marks a task.
 * @param {string} item - the text after `\item`.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {import('./convert-model.js').ListItem} the blocks of the item.
 */
function parseLatexListItem(item, lost) {
    const box = /^\s*\[\$\\(boxtimes|square)\$\]/.exec(item);
    const blocks = parseLatexBlocks(box ? item.slice(box[0].length) : item, lost);
    if (box) blocks.task = box[1] === 'square' ? 'open' : 'done';
    return blocks;
}

/**
 * Returns the display formula of a math environment; labels and tags are left out and listed.
 * @param {string} environment - the environment name without star.
 * @param {string} body - the formula.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {import('./convert-model.js').Block} the math block; `align` and `gather` keep their
 *     alignment as `aligned` and `gathered`.
 */
function getLatexMathBlock(environment, body, lost) {
    if (/\\(label|tag)\b/.test(body)) lost.add(LOSS.references);
    const formula = body.replace(/\\(label|tag)\*?\{[^}]*\}/g, '').replace(/\\(nonumber|notag)\b/g, '').trim();
    if (environment === 'align') return { t: 'math', v: `\\begin{aligned}\n${formula}\n\\end{aligned}` };
    if (environment === 'gather') return { t: 'math', v: `\\begin{gathered}\n${formula}\n\\end{gathered}` };
    return { t: 'math', v: formula };
}

/**
 * Returns the table of a tabular environment; rules are left out.
 * @param {string} body - the content with its column specification.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {import('./convert-model.js').Block} the table block.
 */
function getLatexTable(body, lost) {
    const rows = body.replace(/^\s*(\{[^}]*\})+/, '').split(/\\\\/).map(row => row.replace(/\\(hline|toprule|midrule|bottomrule)\b/g, '').trim()).filter(Boolean);
    return { t: 'table', rows: rows.map(row => row.split(/(?<!\\)&/).map(cell => parseLatexInline(cell, lost))) };
}

/**
 * Splits the content of a list at its own `\item` commands, not those of nested lists.
 * @param {string} body - the content of the list.
 * @returns {string[]} the text after each `\item`.
 */
function splitLatexItems(body) {
    const items = [];
    let depth = 0, start = -1;
    const pattern = /\\begin\{(itemize|enumerate)\}|\\end\{(itemize|enumerate)\}|\\item\b/g;
    let match;
    while ((match = pattern.exec(body))) {
        if (match[1]) depth++;
        else if (match[2]) depth--;
        else if (depth === 0) { if (start >= 0) items.push(body.slice(start, match.index)); start = pattern.lastIndex; }
    }
    if (start >= 0) items.push(body.slice(start));
    return items;
}

/**
 * Reads the inline parts of a LaTeX text.
 * @param {string} source - the text of one paragraph or argument.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {import('./convert-model.js').InlinePart[]} the parts, white space at both ends trimmed.
 */
function parseLatexInline(source, lost) {
    const reader = { text: source, index: 0, parts: [], buffer: '' };
    while (reader.index < source.length) readLatexInlineStep(reader, lost);
    addLatexBuffer(reader);
    return getTrimmedParts(reader.parts);
}

/**
 * Reads the next character or command of a LaTeX text.
 * @param {LatexInlineReader} reader - the reading state; it moves on and collects the part.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {void}
 */
function readLatexInlineStep(reader, lost) {
    const { text } = reader;
    const char = text[reader.index];
    if (char === '%') { while (reader.index < text.length && text[reader.index] !== '\n') reader.index++; return; }
    if (char === '$') {
        const end = text.indexOf('$', reader.index + 1);
        if (end > 0) { addLatexParts(reader, [{ t: 'math', v: text.slice(reader.index + 1, end) }]); reader.index = end + 1; return; }
    }
    if (char === '~') { reader.buffer += ' '; reader.index++; return; }
    if (char === '{') {
        const argument = getBracedArgument(text, reader.index);
        addLatexParts(reader, parseLatexInline(argument.v, lost));
        reader.index = argument.end;
        return;
    }
    if (char === '}') { reader.index++; return; }
    if (char === '\\' && text[reader.index + 1] === '(') {
        const end = text.indexOf('\\)', reader.index);
        if (end > 0) { addLatexParts(reader, [{ t: 'math', v: text.slice(reader.index + 2, end) }]); reader.index = end + 2; return; }
    }
    if (char !== '\\') { reader.buffer += char; reader.index++; return; }
    readLatexInlineBackslash(reader, lost);
}

/**
 * Reads what follows a backslash in LaTeX text: a line break, an escaped character or a command.
 * @param {LatexInlineReader} reader - the reading state at the backslash; it moves past the command and its arguments.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {void}
 */
function readLatexInlineBackslash(reader, lost) {
    const { text } = reader;
    const next = text[reader.index + 1];
    if (next === '\\') { addLatexParts(reader, [{ t: 'br' }]); reader.index += 2; return; }
    if (/[{}%$&#_~^ ]/.test(next || '')) { reader.buffer += next; reader.index += 2; return; }
    const command = /^\\([a-zA-Z]+)\*?\s*/.exec(text.slice(reader.index));
    if (!command) { reader.index++; return; }
    const cursor = { text, index: reader.index + command[0].length };
    readLatexInlineCommand(reader, command[1], cursor, lost);
    reader.index = Math.max(cursor.index, reader.index + 1);
}

/**
 * Reads a LaTeX text command with its arguments into inline parts.
 * @param {LatexInlineReader} reader - the reading state that collects the parts.
 * @param {string} name - the command name without backslash and star.
 * @param {TextCursor} cursor - the position after the command name; it moves past the arguments.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {void}
 */
function readLatexInlineCommand(reader, name, cursor, lost) {
    if (name === 'textcolor') {
        readLatexArgument(cursor);
        addLatexParts(reader, parseLatexInline(readLatexArgument(cursor), lost));
        lost.add(LOSS.latexCommands);
    } else if (name === 'LaTeX' || name === 'TeX') {
        if (cursor.text.slice(cursor.index, cursor.index + 2) === '{}') cursor.index += 2;
        reader.buffer += name;
    } else if (name === 'today') lost.add(LOSS.latexCommands);
    else if (TEXT_WRAP[name]) addLatexParts(reader, [{ t: TEXT_WRAP[name], kids: parseLatexInline(readLatexArgument(cursor), lost) }]);
    else if (name === 'texttt' || name === 'verb') addLatexParts(reader, [{ t: 'code', v: readLatexArgument(cursor) }]);
    else if (name === 'href') {
        const url = readLatexArgument(cursor);
        addLatexParts(reader, [{ t: 'link', url, kids: parseLatexInline(readLatexArgument(cursor), lost) }]);
    } else if (name === 'url') {
        const url = readLatexArgument(cursor);
        addLatexParts(reader, [{ t: 'link', url, kids: [createTextPart(url)] }]);
    } else if (name === 'includegraphics') {
        if (cursor.text[cursor.index] === '[') { const close = cursor.text.indexOf(']', cursor.index); cursor.index = close < 0 ? cursor.text.length : close + 1; }
        addLatexParts(reader, [{ t: 'img', v: '', url: readLatexArgument(cursor) }]);
    } else if (name === 'footnote') addLatexParts(reader, [{ t: 'note', kids: parseLatexInline(readLatexArgument(cursor), lost) }]);
    else if (name === 'label' || name === 'ref' || name === 'cite') { lost.add(LOSS.references); readLatexArgument(cursor); }
    else {
        lost.add(LOSS.latexCommands);
        if (cursor.text[cursor.index] === '{') reader.buffer += parseLatexInline(readLatexArgument(cursor), lost).map(part => part.v || '').join('');
    }
}

/**
 * Reads a braced argument at the cursor and moves the cursor past it.
 * @param {TextCursor} cursor - the text and position; the position moves past the argument.
 * @returns {string} the argument, '' when no brace is there.
 */
function readLatexArgument(cursor) {
    if (cursor.text[cursor.index] !== '{') return '';
    const argument = getBracedArgument(cursor.text, cursor.index);
    cursor.index = argument.end;
    return argument.v;
}

/**
 * Adds the collected plain text as a text part, white space runs as one space.
 * @param {LatexInlineReader} reader - the reading state.
 * @returns {void}
 */
function addLatexBuffer(reader) {
    if (reader.buffer) reader.parts.push(createTextPart(reader.buffer.replace(/\s+/g, ' ')));
    reader.buffer = '';
}

/**
 * Adds parts after the collected plain text.
 * @param {LatexInlineReader} reader - the reading state.
 * @param {import('./convert-model.js').InlinePart[]} parts - the parts to add.
 * @returns {void}
 */
function addLatexParts(reader, parts) {
    addLatexBuffer(reader);
    reader.parts.push(...parts);
}

/* ---------- Writing ---------- */

/**
 * Escapes the characters of a text that LaTeX would read as commands.
 * @param {string} text - the plain text.
 * @returns {string} the escaped text.
 */
function escapeLatex(text) {
    return String(text).replace(/[\\{}$&#_%~^]/g, char => TEX_ESCAPES[char]);
}

/**
 * Writes inline parts as LaTeX.
 * @param {import('./convert-model.js').InlinePart[]} parts - the inline parts.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {string} the LaTeX text.
 */
function formatLatexInline(parts, lost) {
    return parts.map(part => formatLatexPart(part, lost)).join('');
}

/**
 * Writes one inline part as LaTeX.
 * @param {import('./convert-model.js').InlinePart} part - the part.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {string} the LaTeX text, '' for an unknown part.
 */
function formatLatexPart(part, lost) {
    switch (part.t) {
        case 'text': return escapeLatex(part.v);
        case 'b': return `\\textbf{${formatLatexInline(part.kids, lost)}}`;
        case 'i': return `\\emph{${formatLatexInline(part.kids, lost)}}`;
        case 's': return `\\sout{${formatLatexInline(part.kids, lost)}}`;
        case 'code': return `\\texttt{${escapeLatex(part.v)}}`;
        case 'math': return `$${getTexMath(part, lost)}$`;
        case 'link': { const url = getLinkUrl(part, lost); const label = formatLatexInline(part.kids, lost); return url ? `\\href{${url.replace(/[%#&_]/g, '\\$&')}}{${label}}` : label; }
        case 'img': { const url = getLinkUrl(part, lost); return url ? `\\includegraphics[width=\\linewidth]{${url}}` : ''; }
        case 'br': return '\\\\\n';
        case 'note': return `\\footnote{${formatLatexInline(part.kids, lost)}}`;
        default: return '';
    }
}

/**
 * Writes blocks as LaTeX, an empty line between them.
 * @param {import('./convert-model.js').Block[]} blocks - the blocks.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {string} the LaTeX text.
 */
export function formatLatexBlocks(blocks, lost) {
    return blocks.map(block => formatLatexBlock(block, lost)).filter(Boolean).join('\n\n');
}

/**
 * Writes one block as LaTeX; headings are unnumbered sections.
 * @param {import('./convert-model.js').Block} block - the block.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {string} the LaTeX text, '' for an unknown block.
 */
function formatLatexBlock(block, lost) {
    switch (block.t) {
        case 'heading': return `\\${SECTION_COMMANDS[block.level - 1]}*{${formatLatexInline(block.kids, lost)}}`;
        case 'para': return formatLatexInline(block.kids, lost);
        case 'code': return `\\begin{verbatim}\n${block.v.replace(/\\end\{verbatim\}/g, '\\end {verbatim}')}\n\\end{verbatim}`;
        case 'math': return `\\[\n${getTexMath(block, lost)}\n\\]`;
        case 'hr': return '\\hrule';
        case 'pagebreak': return '\\newpage';
        case 'quote': return `\\begin{quote}\n${formatLatexBlocks(block.kids, lost)}\n\\end{quote}`;
        case 'list': return formatLatexList(block, lost);
        case 'table': return formatLatexTable(block, lost);
        default: return '';
    }
}

/**
 * Writes a list as `itemize` or `enumerate`, task items with a box.
 * @param {import('./convert-model.js').Block} list - the list block.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {string} the list environment.
 */
function formatLatexList(list, lost) {
    const environment = list.ordered ? 'enumerate' : 'itemize';
    const items = list.items.map(item => `\\item${item.task ? `[$\\${item.task === 'done' ? 'boxtimes' : 'square'}$]` : ''} ${formatLatexBlocks(item, lost)}`);
    return `\\begin{${environment}}\n${items.join('\n')}\n\\end{${environment}}`;
}

/**
 * Writes a table as `tabular` with rules; the first row is the bold header.
 * @param {import('./convert-model.js').Block} table - the table block.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {string} the tabular environment.
 */
function formatLatexTable(table, lost) {
    const columns = Math.max(1, ...table.rows.map(row => row.length));
    const rows = table.rows.map((row, position) => `${row.map(cell => (position ? formatLatexInline(cell, lost) : `\\textbf{${formatLatexInline(cell, lost)}}`)).join(' & ')} \\\\${position ? '' : '\n\\hline'}`);
    return `\\begin{tabular}{${'l'.repeat(columns)}}\n\\hline\n${rows.join('\n')}\n\\hline\n\\end{tabular}`;
}

/**
 * Returns the whole LaTeX article around its body, with the packages the body uses.
 * @param {string} body - the written blocks.
 * @returns {string} the document, ending with a line break.
 */
export function formatLatexDocument(body) {
    const packages = (/\\includegraphics/.test(body) ? '\n\\usepackage{graphicx}' : '')
        + (/\\href/.test(body) ? '\n\\usepackage{hyperref}' : '')
        + (/\\sout/.test(body) ? '\n\\usepackage[normalem]{ulem}' : '')
        + (/\\begin\{(aligned|gathered|pmatrix|bmatrix|vmatrix|matrix|cases)\}|\\text\{/.test(body) ? '\n\\usepackage{amsmath}' : '');
    return `\\documentclass{article}\n\\usepackage[utf8]{inputenc}${packages}\n\\begin{document}\n\n${body}\n\n\\end{document}\n`;
}
