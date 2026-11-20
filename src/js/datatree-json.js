/**
 * The JSON reader of the data tree: reads JSON and keeps the place of every
 * key and value in the code. JSON with comments and JSON5 are read too, with
 * a note that they are not plain JSON. JSON Lines (.jsonl, .ndjson) hold one
 * value per line, each line a document of the model.
 *
 * parseJson runs these steps:
 * 1. skip white space and comments, then read one value (string, number,
 *    true / false / null, or an object or array with its entries);
 * 2. note every JSON5 / JSON-with-comments feature once, with its place;
 * 3. on the first syntax error stop, close the containers still open at that
 *    place and mark the model as broken.
 *
 * The reader is one closure over its position in the code, so the file keeps
 * the whole JSON grammar together.
 */

import { MAX_DEPTH, createNode } from './datatree-core.js?v=2';

/** The notes for features that are not plain JSON, each said once per document. */
const NOTES = {
    comment: 'Comments are not part of plain JSON (JSON with comments) - "Format" writes plain JSON without them',
    trailing: 'A comma after the last entry is not allowed in plain JSON - "Format" removes it',
    quote: 'Single quotes are JSON5, not plain JSON - "Format" writes double quotes',
    ident: 'Keys without quotes are JSON5, not plain JSON - "Format" adds the quotes',
    number5: 'This number is written as in JSON5 (hexadecimal, Infinity, NaN, a + sign or a point at the start or end) - plain JSON does not allow it',
    escape5: 'This escape (\\\', \\v, \\0 or \\x) is JSON5, not plain JSON',
    continued: 'A string continued on the next line with \\ is JSON5, not plain JSON',
};
const NOTE_TEXTS = new Set(Object.values(NOTES));
/** The dialects by level: a note of level 1 makes JSON with comments, of level 2 JSON5. */
const DIALECTS = ['json', 'jsonc', 'json5'];
const DIALECT_LEVELS = { json: 0, jsonc: 1, json5: 2 };
const LEVEL_COMMENTS = 1;
const LEVEL_JSON5 = 2;
/** How many lines looksLikeJsonl reads at most, and how many complete lines make JSON Lines. */
const JSONL_PROBE_LINES = 50;
const JSONL_PROBE_HITS = 2;
/** How many characters of a key or word a message quotes. */
const KEY_QUOTE_LENGTH = 60;
const WORD_QUOTE_LENGTH = 40;

const IDENTIFIER = /[A-Za-z_$À-￿][\w$À-￿]*/y;
const NUMBER = /[+-]?(?:Infinity|NaN|0[xX][0-9a-fA-F]+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/y;
/** A number as plain JSON writes it. */
export const STRICT_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const PLAIN_RUN = { '"': /[^"\\\u0000-\u001f]+/y, "'": /[^'\\\u0000-\u001f]+/y };
const ESCAPES = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

/**
 * Options of parseJson.
 * @typedef {object} JsonOptions
 * @property {boolean} [line] - the text is one line of JSON Lines (other messages, no "empty" note).
 */

/**
 * Reads JSON (also with comments and JSON5) into a model with the place of every value.
 * @param {string} src - the code.
 * @param {number} [from] - where to start reading (one line of JSON Lines).
 * @param {number} [to] - where to stop reading.
 * @param {JsonOptions} [opts] - options.
 * @returns {DataModel} the model with one document; `broken` after a syntax error.
 */
export function parseJson(src, from = 0, to = src.length, opts = {}) {
    const end = to;
    let index = from, dialect = 0, comments = 0, count = 0;
    const problems = [], said = new Set(), open = [];
    const STOP = {};

    /**
     * Notes a feature that is not plain JSON, once per kind, and raises the dialect.
     * @param {string} kind - the key in NOTES.
     * @param {number} pos - the offset of the feature.
     * @param {number} level - LEVEL_COMMENTS or LEVEL_JSON5.
     * @returns {void}
     */
    const addNote = (kind, pos, level) => {
        if (level > dialect) dialect = level;
        if (said.has(kind)) return;
        said.add(kind);
        problems.push({ pos, end: pos + 1, kind: 'warn', msg: NOTES[kind] });
    };
    /**
     * Records a syntax error and stops the reading.
     * @param {number} pos - the offset of the error.
     * @param {string} msg - the message.
     * @param {number} [errorEnd] - the offset where the marked part ends.
     * @returns {never} never returns.
     * @throws {object} STOP, caught at the end of parseJson.
     */
    const stopParsing = (pos, msg, errorEnd = pos + 1) => { problems.push({ pos, end: errorEnd, kind: 'error', msg }); throw STOP; };
    /**
     * Describes what stands at a place, for a message.
     * @param {number} pos - the offset.
     * @returns {string} the quoted character, or the end of the line or text.
     */
    const formatFoundToken = pos => (pos >= end ? (opts.line ? 'the end of the line' : 'the end of the text') : `"${String.fromCodePoint(src.codePointAt(pos))}"`);
    /**
     * Tells whether a character is white space between JSON tokens.
     * @param {string} char - one character.
     * @returns {boolean} true for space, line breaks, tab, BOM and no-break space.
     */
    const isSpace = char => char === ' ' || char === '\n' || char === '\t' || char === '\r' || char === '\ufeff' || char === '\u00a0' || char === '\u2028' || char === '\u2029';

    /**
     * Moves past white space and comments.
     * @returns {void}
     */
    function moveOverSpace() {
        for (;;) {
            while (index < end && isSpace(src[index])) index++;
            if (src[index] === '/' && src[index + 1] === '/') { comments++; addNote('comment', index, LEVEL_COMMENTS); while (index < end && src[index] !== '\n') index++; continue; }
            if (src[index] === '/' && src[index + 1] === '*') {
                comments++;
                addNote('comment', index, LEVEL_COMMENTS);
                const close = src.indexOf('*/', index + 2);
                if (close < 0) stopParsing(index, 'This comment /* is never closed with */', end);
                index = close + 2;
                continue;
            }
            return;
        }
    }

    /**
     * Reads a quoted string at the current place.
     * @returns {{value: string, start: number, end: number}} the text and its place with the quotes.
     */
    function readString() {
        const quote = src[index], start = index;
        if (quote === "'") addNote('quote', index, LEVEL_JSON5);
        index++;
        let text = '';
        const run = PLAIN_RUN[quote];
        for (;;) {
            run.lastIndex = index;
            const plain = run.exec(src);
            if (plain) { text += plain[0]; index += plain[0].length; }
            if (index >= end) stopParsing(start, `This string is never closed - a ${quote} is missing`, end);
            const char = src[index];
            if (char === quote) { index++; return { value: text, start, end: index }; }
            if (char === '\\') { text += readEscape(); continue; }
            if (char === '\n' || char === '\r') stopParsing(index, 'A line break inside a string must be written as \\n');
            if (char === '\t') stopParsing(index, 'A tab inside a string must be written as \\t');
            stopParsing(index, 'A control character inside a string must be written as \\u0000 … \\u001f');
        }
    }

    /**
     * Reads one escape sequence at the current backslash.
     * @returns {string} the characters it stands for (empty for a continued line).
     */
    function readEscape() {
        const code = src[index + 1];
        if (code in ESCAPES) { index += 2; return ESCAPES[code]; }
        if (code === 'u') {
            const hex = src.slice(index + 2, index + 6);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) stopParsing(index, '\\u needs four hexadecimal digits, e.g. \\u00e9', index + 2);
            index += 6;
            return String.fromCharCode(parseInt(hex, 16));
        }
        if (code === '\n' || code === '\r' || code === '\u2028' || code === '\u2029') {
            addNote('continued', index, LEVEL_JSON5);
            index += 2;
            if (code === '\r' && src[index] === '\n') index++;
            return '';
        }
        if (code === "'" || code === 'v' || code === '0') { addNote('escape5', index, LEVEL_JSON5); index += 2; return code === 'v' ? '\v' : code === '0' ? '\0' : "'"; }
        if (code === 'x' && /^[0-9a-fA-F]{2}$/.test(src.slice(index + 2, index + 4))) { addNote('escape5', index, LEVEL_JSON5); const char = String.fromCharCode(parseInt(src.slice(index + 2, index + 4), 16)); index += 4; return char; }
        stopParsing(index, `Unknown escape \\${code === undefined ? '' : code} in a string - write \\\\ for a backslash`, index + 2);
    }

    /**
     * Reads one value at the current place (after white space).
     * @returns {DataNode} the value's node.
     */
    function readValue() {
        moveOverSpace();
        const start = index, char = src[index];
        if (index >= end) stopParsing(index, open.length ? `The text ends here - a value and a ${open[open.length - 1].type === 'object' ? '}' : ']'} are missing` : 'A value is missing');
        if (char === '{' || char === '[') return readContainer(char);
        if (char === '"' || char === "'") {
            const text = readString(), node = createNode('string', start);
            node.value = text.value;
            node.end = text.end;
            count++;
            return node;
        }
        return readNumber(start) || readWord(start) || stopParsing(index, `A value is expected here - found ${formatFoundToken(index)}`);
    }

    /**
     * Reads a number at the current place.
     * @param {number} start - the offset of the value.
     * @returns {DataNode|null} the number's node, null when no number stands here.
     */
    function readNumber(start) {
        NUMBER.lastIndex = index;
        const match = NUMBER.exec(src);
        if (!match || /[\w$]/.test(src[index + match[0].length] || '')) return null;
        const text = match[0];
        if (!STRICT_NUMBER.test(text)) {
            if (/^-?0\d/.test(text)) stopParsing(index, 'A number cannot start with 0 - write it without the leading 0', index + text.length);
            addNote('number5', index, LEVEL_JSON5);
        }
        const node = createNode('number', start);
        const sign = text[0] === '-' ? -1 : 1, body = text.replace(/^[+-]/, '');
        node.value = /^0x/i.test(body) ? sign * parseInt(body, 16) : Number(text);
        node.raw = text;
        node.end = index += text.length;
        count++;
        return node;
    }

    /**
     * Reads true, false or null at the current place.
     * @param {number} start - the offset of the value.
     * @returns {DataNode|null} the node, null when no word stands here.
     */
    function readWord(start) {
        IDENTIFIER.lastIndex = index;
        const match = IDENTIFIER.exec(src);
        if (!match) return null;
        const word = match[0];
        if (word !== 'true' && word !== 'false' && word !== 'null') stopParsing(index, `Unexpected "${word.slice(0, WORD_QUOTE_LENGTH)}" - a string needs quotes; other values are numbers, true, false or null`, index + word.length);
        const node = createNode(word === 'null' ? 'null' : 'boolean', start);
        node.value = word === 'null' ? null : word === 'true';
        node.end = index += word.length;
        count++;
        return node;
    }

    /**
     * Reads an object or array with all its entries.
     * @param {string} char - '{' or '['.
     * @returns {DataNode} the container's node.
     */
    function readContainer(char) {
        if (open.length >= MAX_DEPTH) stopParsing(index, `The data is nested more than ${MAX_DEPTH} levels deep - the editor reads at most ${MAX_DEPTH}`, index + 1);
        const node = createNode(char === '{' ? 'object' : 'array', index);
        node.entries = [];
        count++;
        const close = char === '{' ? '}' : ']';
        const keys = char === '{' ? new Map() : null;
        open.push(node);
        index++;
        let comma = -1;
        for (;;) {
            moveOverSpace();
            if (src[index] === close) { if (comma >= 0) addNote('trailing', comma, LEVEL_COMMENTS); index++; break; }
            if (index >= end) stopParsing(node.start, `This ${char} is never closed - a ${close} is missing`, node.start + 1);
            const entry = { key: node.entries.length, start: index, node: null, parent: node, index: node.entries.length };
            if (keys) readEntryKey(entry, keys);
            else if (src[index] === ',') stopParsing(index, 'One comma too many - a value is missing here');
            node.entries.push(entry);
            entry.node = readValue();
            entry.node.entry = entry;
            comma = -1;
            moveOverSpace();
            if (src[index] === ',') { comma = index; index++; continue; }
            if (src[index] === close) { index++; break; }
            if (index >= end) stopParsing(node.start, `This ${char} is never closed - a ${close} is missing`, node.start + 1);
            if (/["'{[\w$+\-.]/.test(src[index])) stopParsing(index, 'A comma is missing between the entries');
            stopParsing(index, `"," or "${close}" is expected here - found ${formatFoundToken(index)}`);
        }
        node.end = index;
        open.pop();
        return node;
    }

    /**
     * Reads the key and the ":" of an object entry; notes a key that is twice in the object.
     * @param {DataEntry} entry - the entry to fill in.
     * @param {Map<string, DataEntry>} keys - the keys of the object so far.
     * @returns {void}
     */
    function readEntryKey(entry, keys) {
        if (src[index] === '"' || src[index] === "'") {
            const text = readString();
            entry.key = text.value;
            entry.keyStart = text.start;
            entry.keyEnd = text.end;
        } else {
            IDENTIFIER.lastIndex = index;
            const word = IDENTIFIER.exec(src);
            if (!word) stopParsing(index, src[index] === ',' ? 'One comma too many - an entry is missing here' : `A key in double quotes is expected here - found ${formatFoundToken(index)}`);
            addNote('ident', index, LEVEL_JSON5);
            entry.key = word[0];
            entry.keyStart = index;
            entry.keyEnd = index += word[0].length;
            entry.bare = true;
        }
        moveOverSpace();
        if (src[index] !== ':') stopParsing(index, `A ":" is missing after the key "${entry.key.slice(0, KEY_QUOTE_LENGTH)}"`);
        index++;
        if (keys.has(entry.key)) problems.push({ pos: entry.keyStart, end: entry.keyEnd, kind: 'warn', msg: `The key "${entry.key.slice(0, KEY_QUOTE_LENGTH)}" is twice in this object - most programs keep only the last one` });
        keys.set(entry.key, entry);
    }

    /**
     * Reads the whole text: one value and nothing after it.
     * @returns {DataNode|null} the root, null for an empty text.
     */
    function readDocument() {
        moveOverSpace();
        if (index >= end) {
            if (!opts.line) problems.push({ pos: 0, end: 0, kind: 'warn', msg: 'The document is empty' });
            return null;
        }
        const node = readValue();
        moveOverSpace();
        if (index < end) { root = node; stopParsing(index, opts.line ? 'Extra text after the value - a line of JSON Lines holds one value' : 'Extra text after the end of the data - a JSON document has one value at the top (usually an object or an array)', end); }
        return node;
    }

    /**
     * Ends the containers still open at the place of the error and drops an entry without value.
     * @returns {void}
     */
    function closeOpenContainers() {
        const at = problems[problems.length - 1].pos;
        for (const node of open) {
            node.end = Math.max(node.start + 1, at);
            const last = node.entries[node.entries.length - 1];
            if (last && !last.node) node.entries.pop();
        }
    }

    let root = null, broken = false;
    try {
        root = readDocument();
    } catch (error) {
        if (error !== STOP) throw error;
        broken = true;
        closeOpenContainers();
        root = root || open[0] || null;
    }
    problems.sort((a, b) => a.pos - b.pos);
    return { format: 'json', docs: [{ root, start: from, end }], problems, broken, dialect: DIALECTS[dialect], comments, count };
}

/**
 * Reads JSON Lines: one JSON value per line, blank lines skipped.
 * @param {string} src - the code.
 * @returns {DataModel} the model with one document per line and `jsonl: true`.
 */
export function parseJsonl(src) {
    const docs = [], problems = [], said = new Set();
    let count = 0, comments = 0, dialect = 0, line = 0, lineStart = 0;
    for (;;) {
        let lineEnd = src.indexOf('\n', lineStart);
        if (lineEnd < 0) lineEnd = src.length;
        line++;
        const textEnd = src[lineEnd - 1] === '\r' ? lineEnd - 1 : lineEnd;
        let first = lineStart;
        while (first < textEnd && (src[first] === ' ' || src[first] === '\t')) first++;
        if (first < textEnd) {
            const lineModel = parseJson(src, lineStart, textEnd, { line: true });
            count += lineModel.count;
            comments += lineModel.comments;
            dialect = Math.max(dialect, DIALECT_LEVELS[lineModel.dialect]);
            for (const problem of lineModel.problems) {
                if (problem.kind === 'warn' && NOTE_TEXTS.has(problem.msg)) { if (said.has(problem.msg)) continue; said.add(problem.msg); }
                problems.push(problem);
            }
            docs.push({ root: lineModel.docs[0].root, start: lineStart, end: textEnd, label: `Line ${line}`, line, broken: lineModel.broken });
        }
        if (lineEnd >= src.length) break;
        lineStart = lineEnd + 1;
    }
    addKeyNote(docs, problems);
    if (!docs.length) problems.push({ pos: 0, end: 0, kind: 'warn', msg: 'The document is empty' });
    problems.sort((a, b) => a.pos - b.pos);
    return { format: 'json', jsonl: true, docs, problems, broken: false, dialect: DIALECTS[dialect], comments, count };
}

/**
 * Adds a note when the records (objects) of JSON Lines do not all have the same keys.
 * @param {DataDocument[]} docs - the lines read.
 * @param {Problem[]} problems - the list that gets the note.
 * @returns {void}
 */
function addKeyNote(docs, problems) {
    const records = docs.filter(doc => doc.root && doc.root.type === 'object' && !doc.broken);
    if (records.length <= 1) return;
    /**
     * Returns the sorted keys of a record as one text.
     * @param {DataDocument} doc - a record.
     * @returns {string} the keys joined.
     */
    const getKeyText = doc => doc.root.entries.map(entry => entry.key).sort().join('\u0000');
    const first = getKeyText(records[0]);
    const other = records.find(doc => getKeyText(doc) !== first);
    if (other) problems.push({ pos: other.start, end: other.start + 1, kind: 'warn', msg: `Not every line has the same keys - line ${other.line} differs from line ${records[0].line}` });
}

/**
 * Tells whether a text looks like JSON Lines: the first two lines with data each hold one complete value.
 * @param {string} src - the code.
 * @returns {boolean} true for JSON Lines.
 */
export function isJsonLines(src) {
    let found = 0, lineStart = 0;
    for (let lines = 0; lines < JSONL_PROBE_LINES && lineStart < src.length; lines++) {
        let lineEnd = src.indexOf('\n', lineStart);
        if (lineEnd < 0) lineEnd = src.length;
        const textEnd = src[lineEnd - 1] === '\r' ? lineEnd - 1 : lineEnd;
        if (src.slice(lineStart, textEnd).trim()) {
            const lineModel = parseJson(src, lineStart, textEnd, { line: true });
            if (lineModel.broken || !lineModel.docs[0].root) return false;
            if (++found === JSONL_PROBE_HITS) return true;
        }
        lineStart = lineEnd + 1;
    }
    return false;
}
