/**
 * SHLS (Sebis Hierarchical List Structure): reading and writing exactly as the
 * reference classes SHLSDecoder and SHLSEncoder do
 * (https://github.com/SebisCodes/SHLS-Sebis-Hierarchical-List-Structure),
 * plus the editor's model of an SHLS text and the line helpers its edits use.
 *
 * The format: a section starts with its name (no indentation) and a key block:
 * one key per line, indented; the keys of a nested list one level deeper.
 * After exactly one blank line - or later, under the section name repeated -
 * the records follow: one value per line in the order of the keys, a nested
 * list as a line of its own (any text, the encoder writes the key) with its
 * records one level deeper. All values are strings.
 *
 * Python values keep their Python meaning so that both sides give the same
 * result: a dict is a Map (its keys keep their order), a list an Array, str a
 * string; numbers from JSON are PyNum (int or float, as the JSON text wrote
 * them), true / false / null are True / False / None.
 *
 * Reading, parseShls() (SHLSDecoder step by step):
 * 1. strip the text and split it into lines as Python's strip().splitlines() does;
 * 2. a line without indentation names a section;
 * 3. the first indented lines after it are its key block, which ends at a blank line;
 * 4. the lines after that are records, counted by the keys: a last record with
 *    fewer values keeps the ones it has, a nested key without deeper lines is an
 *    empty list, every data block of a section is kept; blank lines (also with
 *    spaces) are passed over everywhere else;
 * 5. on the way the role of every line is noted (section line, key, value,
 *    nested key, ignored), so the editor can point from the data to the code and
 *    back and report problems with their line.
 *
 * Writing, formatShls() (SHLSEncoder): Python's str() for every value; a dict in
 * a record becomes a list with one record, a plain value in a list a record
 * with the key "Value"; the data passed in stays unchanged.
 *
 * The editor's model, parseModel(): the data, the sections with their key blocks
 * and records (each with its lines; the records of all data blocks), the role of
 * every line, and the problems. The line helpers at the end serve the edits,
 * which change the code line by line.
 *
 * The file is longer than 300 lines: reader, writer, model and line helpers
 * describe one format and share the decoder, so they stay together.
 */

/* ---------- Constants ---------- */

/** The characters of Python's str.isspace(): what strip() removes. */
const PYTHON_WHITESPACE = '\\t\\n\\x0b\\x0c\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const PYTHON_WHITESPACE_CHAR = new RegExp(`[${PYTHON_WHITESPACE}]`);
const PYTHON_LEADING_WHITESPACE = new RegExp(`^[${PYTHON_WHITESPACE}]+`);
/** The line breaks of Python's str.splitlines(). */
const PYTHON_LINE_BREAK = /\r\n|[\n\r\x0b\x0c\x1c\x1d\x1e\x85\u2028\u2029]/g;
/** Characters that Python's repr() writes as an escape (other than a plain space). */
const PYTHON_UNPRINTABLE = /[\p{C}\p{Z}]/u;
/** The short escapes of Python's repr() of a string. */
const PYTHON_SHORT_ESCAPES = new Map([['\n', '\\n'], ['\r', '\\r'], ['\t', '\\t']]);
/** Python's repr() of a float uses fixed notation for exponents from this one ... */
const FLOAT_FIXED_MIN_EXPONENT = -4;
/** ... up to below this one. */
const FLOAT_FIXED_MAX_EXPONENT = 16;
/** Integers below this size are exact in a JavaScript number. */
const SAFE_INTEGER_LIMIT = 2 ** 53;

/** One level of indentation as the encoder writes it. */
const ENCODER_INDENT = ' ';
/** The key of a record the encoder makes from a plain value in a list. */
const PLAIN_VALUE_KEY = 'Value';
/** The value line written for a missing value. */
const MISSING_VALUE = '-';

/** A JSON number at the reading position. */
const JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/;
/** How many characters are looked at to read one JSON number. */
const JSON_NUMBER_LOOKAHEAD = 400;
/** The white space JSON allows between tokens. */
const JSON_WHITESPACE = /[ \t\n\r]/;
/** The JSON escapes besides \u. */
const JSON_ESCAPES = Object.freeze({ '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' });
/** The JSON words and their values. */
const JSON_LITERALS = [['true', true], ['false', false], ['null', null]];
/** The four hex digits after \u in a JSON string. */
const JSON_UNICODE_DIGITS = 4;

/** A key name that looks like a value: a number, true / false or a date. */
const VALUE_LIKE_NUMBER = /^-?\d+([.,]\d+)?$/;
const VALUE_LIKE_BOOLEAN = /^(true|false)$/i;
const VALUE_LIKE_DATE = /^\d{4}-\d{2}-\d{2}/;
/** The spaces and tabs at the start of a code line. */
const LEADING_INDENTATION = /^[ \t]*/;

/** The text of a nested key or value that the editor shows as a placeholder. */
const PLACEHOLDER_TEXT = 'PH';
/** The highlighting class of each line role; other roles are values. */
const ROLE_CLASSES = new Map([['section', 'sec'], ['key', 'key'], ['nested', 'nk'], ['lost', 'ign'], ['ignored', 'ign']]);
const VALUE_CLASS = 'val';
const PLACEHOLDER_CLASS = 'ph';
/** The leading spaces and the rest of a line ([\s\S]: a line may hold U+2028 / U+2029). */
const INDENT_AND_TEXT = /^( *)([\s\S]*)$/;

/** A line break inside a value (it cannot stand in one SHLS line). */
const VALUE_LINE_BREAK = /[\r\n\u2028\u2029\x0b\x0c\x1c-\x1e\x85]/;
/** A run of white space in a value. */
const VALUE_WHITESPACE_RUN = /[\s\x1c-\x1e\x85]+/g;

/**
 * A value as Python sees it: a dict is a Map, a list an Array, str a string,
 * a JSON number a PyNum, True / False / None are true / false / null.
 * @typedef {Map<string, *>|Array<*>|string|PyNum|boolean|null} PyValue
 */

/**
 * One line of the stripped text and where it starts in the original text.
 * @typedef {object} PythonLine
 * @property {string} text - the line without its line break.
 * @property {number} start - the character offset of the line in the original text.
 */

/**
 * A key of a key block. Inside the decoder `line` is the index of a Python
 * line; in the model it is the 0-based line of the code.
 * @typedef {object} ShlsKey
 * @property {string} name - the key, stripped.
 * @property {number} line - the line of the key.
 * @property {number} level - its indentation in spaces.
 * @property {ShlsKey[]|null} sub - the keys of a nested list, null for a plain key.
 */

/**
 * One value line (or nested key line) of a record.
 * @typedef {object} ShlsField
 * @property {string} key - the key the value belongs to.
 * @property {number} line - the line of the value.
 * @property {string} value - the stripped text of the line.
 * @property {ShlsRecord[]|null} sub - the records of a nested list, null for a plain value.
 * @property {number} end - the last line of the field, its nested records included.
 */

/**
 * The lines of one record.
 * @typedef {object} ShlsRecord
 * @property {ShlsField[]} fields - the fields in the order of the lines.
 * @property {number} [short] - the number of keys when the record has fewer values (0 in the model when complete).
 * @property {number|null} [start] - the first line (model only).
 * @property {number|null} [end] - the last line with text (model only).
 */

/**
 * A run of records of one section, as the decoder reads it.
 * @typedef {object} DataBlock
 * @property {string} sec - the section name.
 * @property {number|null} start - the first line of the block.
 * @property {number} base - the indentation of its value lines.
 * @property {ShlsRecord[]} records - the records of the block.
 * @property {number|null} end - the last line read for the block.
 */

/**
 * The key block of a section, as the decoder reads it.
 * @typedef {object} KeyBlock
 * @property {ShlsKey[]} keys - the keys.
 * @property {number} start - the first line of the block.
 * @property {number} end - the last line read for the block.
 */

/**
 * A section of the model.
 * @typedef {object} ShlsSection
 * @property {string} name - the section name.
 * @property {number} line - the first line that names it.
 * @property {number[]} lines - every line that names it.
 * @property {ShlsKey[]|null} keys - its key block, null when it has none.
 * @property {number|null} keyStart - the first line of the key block.
 * @property {number|null} keyEnd - the last line of the key block.
 * @property {{start: number, end: number, records: ShlsRecord[]}[]} blocks - its data blocks.
 * @property {ShlsRecord[]} records - the records of all its data blocks.
 */

/**
 * A problem of the code, shown with its line.
 * @typedef {object} ShlsProblem
 * @property {number} line - the 0-based line of the code.
 * @property {'error'|'warn'} kind - how serious it is.
 * @property {string} msg - the message for the user.
 */

/**
 * The editor's model of an SHLS text. Lines are 0-based line numbers of the
 * code (split at "\n").
 * @typedef {object} ShlsModel
 * @property {Map<string, Array<Map<string, *>>>} data - the sections as SHLSDecoder reads them.
 * @property {null} error - always null: every text can be read.
 * @property {ShlsSection[]} sections - the sections in the order of their first line.
 * @property {string[]} roles - the role of every code line (blank, section, key, value, nested, ignored).
 * @property {ShlsProblem[]} problems - the problems, sorted by line, errors first.
 * @property {number} unit - the spaces per level of indentation.
 * @property {string[]} lines - the code lines.
 */

/**
 * The section or nested key that records belong to, for the problem messages.
 * @typedef {object} RecordOwner
 * @property {string} name - the section name or the nested key.
 * @property {ShlsKey[]|null|undefined} keys - the keys of its records.
 */

/**
 * The code lines of a text and how a Python line maps to one of them.
 * @typedef {object} CodeLineContext
 * @property {string[]} codeLines - the code split at "\n".
 * @property {function(number|null|undefined): (number|null)} toCodeLine - the code line of a Python line index.
 */

/* ---------- Python string helpers ---------- */

/**
 * Returns a text without the white space Python's str.strip() removes, scanning
 * from both ends (linear, also for long runs of spaces inside).
 * @param {string} text - the text to strip.
 * @returns {string} the stripped text (the same string when nothing is removed).
 */
export function getPythonStripped(text) {
    let start = 0, end = text.length;
    while (start < end && PYTHON_WHITESPACE_CHAR.test(text[start])) start++;
    while (end > start && PYTHON_WHITESPACE_CHAR.test(text[end - 1])) end--;
    return start === 0 && end === text.length ? text : text.slice(start, end);
}

/** A number from JSON with the Python type it would have (json.loads). */
export class PyNum {
    /**
     * Makes the number from its JSON text.
     * @param {string} text - the number as the JSON text writes it.
     * @returns {void}
     */
    constructor(text) {
        this.text = text;
        this.float = /[.eE]/.test(text);
        this.value = Number(text);
    }
}

/**
 * Returns Python's repr() of a float: the shortest digits, fixed notation from
 * 1e-4 to below 1e16.
 * @param {number} number - the float.
 * @returns {string} the text Python writes.
 */
function formatPythonFloat(number) {
    if (Number.isNaN(number)) return 'nan';
    if (!Number.isFinite(number)) return number > 0 ? 'inf' : '-inf';
    if (number === 0) return Object.is(number, -0) ? '-0.0' : '0.0';
    const [mantissa, exponentText] = number.toExponential().split('e');
    const exponent = +exponentText;
    const sign = mantissa.startsWith('-') ? '-' : '';
    const digits = mantissa.replace(/^-/, '').replace('.', '');
    const isFixed = exponent >= FLOAT_FIXED_MIN_EXPONENT && exponent < FLOAT_FIXED_MAX_EXPONENT;
    return sign + (isFixed ? formatFixedDigits(digits, exponent) : formatExponentDigits(digits, exponent));
}

/**
 * Returns the significant digits of a float in fixed notation.
 * @param {string} digits - the significant digits without sign and point.
 * @param {number} exponent - the decimal exponent of the first digit.
 * @returns {string} the digits with a decimal point, at least one digit after it.
 */
function formatFixedDigits(digits, exponent) {
    if (exponent < 0) return '0.' + '0'.repeat(-exponent - 1) + digits;
    const integerPart = digits.slice(0, exponent + 1).padEnd(exponent + 1, '0');
    const fraction = digits.slice(exponent + 1);
    return integerPart + '.' + (fraction || '0');
}

/**
 * Returns the significant digits of a float in exponent notation, as Python writes it.
 * @param {string} digits - the significant digits without sign and point.
 * @param {number} exponent - the decimal exponent of the first digit.
 * @returns {string} for example "1.5e+20" or "1e-05".
 */
function formatExponentDigits(digits, exponent) {
    const mantissa = digits.length > 1 ? digits[0] + '.' + digits.slice(1) : digits;
    return mantissa + 'e' + (exponent < 0 ? '-' : '+') + String(Math.abs(exponent)).padStart(2, '0');
}

/**
 * Returns Python's repr() of a string.
 * @param {string} text - the string.
 * @returns {string} the string in quotes with Python's escapes.
 */
function formatPythonStringRepr(text) {
    const quote = text.includes("'") && !text.includes('"') ? '"' : "'";
    let body = '';
    for (const char of text) body += escapePythonChar(char, quote);
    return quote + body + quote;
}

/**
 * Returns one character as Python's repr() writes it inside a string.
 * @param {string} char - one character (a whole code point).
 * @param {string} quote - the quote around the string.
 * @returns {string} the character or its escape.
 */
function escapePythonChar(char, quote) {
    if (char === '\\') return '\\\\';
    if (char === quote) return '\\' + quote;
    if (PYTHON_SHORT_ESCAPES.has(char)) return PYTHON_SHORT_ESCAPES.get(char);
    if (char !== ' ' && PYTHON_UNPRINTABLE.test(char)) return formatPythonCodeEscape(char.codePointAt(0));
    return char;
}

/**
 * Returns the \x, \u or \U escape of a code point as Python's repr() writes it.
 * @param {number} codePoint - the code point.
 * @returns {string} the escape.
 */
function formatPythonCodeEscape(codePoint) {
    if (codePoint < 0x100) return '\\x' + codePoint.toString(16).padStart(2, '0');
    if (codePoint < 0x10000) return '\\u' + codePoint.toString(16).padStart(4, '0');
    return '\\U' + codePoint.toString(16).padStart(8, '0');
}

/**
 * Returns Python's repr() of a value.
 * @param {PyValue} value - the value.
 * @returns {string} the text Python writes.
 */
function formatPythonRepr(value) {
    if (typeof value === 'string') return formatPythonStringRepr(value);
    if (value instanceof Map) return '{' + [...value].map(([key, item]) => formatPythonRepr(key) + ': ' + formatPythonRepr(item)).join(', ') + '}';
    if (Array.isArray(value)) return '[' + value.map(formatPythonRepr).join(', ') + ']';
    return formatPythonStr(value);
}

/**
 * Returns Python's str() of a value, as f"{value}" writes it.
 * @param {PyValue|number|bigint|undefined} value - the value.
 * @returns {string} the text Python writes.
 */
export function formatPythonStr(value) {
    if (typeof value === 'string') return value;
    if (value === true) return 'True';
    if (value === false) return 'False';
    if (value === null || value === undefined) return 'None';
    if (value instanceof PyNum) return formatPythonNumber(value);
    if (typeof value === 'number') return Number.isInteger(value) ? String(value) : formatPythonFloat(value);
    if (typeof value === 'bigint') return value.toString();
    return formatPythonRepr(value);
}

/**
 * Returns Python's str() of a number from JSON: a float as repr(), an int with all its digits.
 * @param {PyNum} number - the number.
 * @returns {string} the text Python writes.
 */
function formatPythonNumber(number) {
    if (number.float) return formatPythonFloat(number.value);
    try { return BigInt(number.text).toString(); } catch (error) { return String(number.value); }
}

/**
 * Tells whether a value is a Python dict.
 * @param {*} value - the value.
 * @returns {boolean} true for a Map.
 */
function isDict(value) {
    return value instanceof Map;
}

/**
 * Tells whether a value is a Python list.
 * @param {*} value - the value.
 * @returns {boolean} true for an Array.
 */
function isList(value) {
    return Array.isArray(value);
}

/* ---------- Lines as Python sees them ---------- */

/**
 * Returns strip().splitlines() of a text with the place of each line in the original text.
 * @param {string} text - the whole text.
 * @returns {PythonLine[]} the lines, none for a text of white space only.
 */
function splitPythonLines(text) {
    const leadLength = (PYTHON_LEADING_WHITESPACE.exec(text) || [''])[0].length;
    const body = getPythonStripped(text);
    const lines = [];
    if (!body) return lines;
    let lineStart = 0;
    PYTHON_LINE_BREAK.lastIndex = 0;
    let lineBreak;
    while ((lineBreak = PYTHON_LINE_BREAK.exec(body))) {
        lines.push({ text: body.slice(lineStart, lineBreak.index), start: leadLength + lineStart });
        lineStart = lineBreak.index + lineBreak[0].length;
    }
    if (lineStart < body.length) lines.push({ text: body.slice(lineStart), start: leadLength + lineStart });
    return lines;
}

/**
 * Returns the indentation of a line: the number of leading spaces.
 * @param {string} text - the line.
 * @returns {number} the leading spaces (tabs do not count).
 */
function getIndentLevel(text) {
    let spaces = 0;
    while (spaces < text.length && text[spaces] === ' ') spaces++;
    return spaces;
}

/**
 * Returns the spaces per level: the indentation of the first indented line with text.
 * @param {PythonLine[]} lines - the lines.
 * @returns {number} the spaces per level, 0 when no line with text is indented.
 */
function getIndentUnit(lines) {
    for (const line of lines) {
        if (getPythonStripped(line.text) === '') continue;
        const level = getIndentLevel(line.text);
        if (level) return level;
    }
    return 0;
}

/* ---------- SHLSDecoder ---------- */

/**
 * SHLSDecoder step by step over the lines of one text. Its read methods consume
 * lines and return what they read, as a reader of a stream does; along the way
 * they note the role of each line, the key blocks and the data blocks.
 */
class ShlsDecoder {
    /**
     * Prepares the decoder for the lines of one text.
     * @param {PythonLine[]} lines - the lines as splitPythonLines() returns them.
     * @returns {void}
     */
    constructor(lines) {
        this.lines = lines;
        /** @type {number} the next line to read. */
        this.position = 0;
        /** @type {number} spaces per level: the indentation of the first indented line with text. */
        this.indentUnit = getIndentUnit(lines);
        /** @type {Map<number, string>} index of a Python line -> role. */
        this.roles = new Map();
        /** @type {number[]} non-empty lines that were not used. */
        this.ignoredLines = [];
        /** @type {Map<string, KeyBlock>} section -> its key block. */
        this.keyBlocks = new Map();
        /** @type {DataBlock[]} the data blocks of the sections. */
        this.dataBlocks = [];
        /** @type {{name: string, line: number}[]} every line that names a section. */
        this.sectionLines = [];
        /** @type {{sec: string, line: number}[]} key blocks that follow blank lines. */
        this.keyBlocksAfterBlank = [];
        /** @type {ShlsRecord[]} the records of the data block read last. */
        this.lastRecords = [];
    }

    /**
     * Returns the next line with text from the reading position (blank lines are passed over).
     * @returns {Array<number|null>} [level, index] of that line, or [null, null] at the end.
     */
    findNextTextLine() {
        let index = this.position;
        while (index < this.lines.length && getPythonStripped(this.lines[index].text) === '') index++;
        return index === this.lines.length ? [null, null] : [getIndentLevel(this.lines[index].text), index];
    }

    /**
     * Marks a line as ignored: SHLS readers pass over it.
     * @param {number} index - the Python line.
     * @returns {void}
     */
    addIgnoredLine(index) {
        this.roles.set(index, 'ignored');
        this.ignoredLines.push(index);
    }

    /**
     * Reads the whole text: SHLSDecoder().decode().
     * @returns {Map<string, Array<Map<string, *>>>} the sections, each a list of records.
     */
    readSections() {
        const data = new Map();
        let section = '';
        while (this.position < this.lines.length) {
            const lineIndex = this.position++;
            const line = this.lines[lineIndex].text;
            const value = getPythonStripped(line);
            if (value === '') continue;
            if (getIndentLevel(line) === 0) {
                section = value;
                this.roles.set(lineIndex, 'section');
                this.sectionLines.push({ name: value, line: lineIndex });
            } else this.addIgnoredLine(lineIndex);
            if (section === '') continue;
            this.readSectionBody(data, section, lineIndex);
        }
        return data;
    }

    /**
     * Reads what follows a section line: the key block when the section has none
     * yet, then the records of one data block.
     * @param {Map<string, Array<Map<string, *>>>} data - the sections read so far; gets the records.
     * @param {string} section - the section name.
     * @param {number} lineIndex - the line just read.
     * @returns {void}
     */
    readSectionBody(data, section, lineIndex) {
        let [nextLevel, nextIndex] = this.findNextTextLine();
        if (!nextLevel) return;
        if (!this.keyBlocks.has(section)) {
            this.readKeyBlock(section, nextLevel, nextIndex, lineIndex);
            if (!data.has(section)) data.set(section, []);
            [nextLevel] = this.findNextTextLine();
            if (!nextLevel) return;
        }
        if (!data.has(section)) data.set(section, []);
        const records = data.get(section);
        // No spread: a block may have 100 000 records.
        for (const record of this.readRecords(this.keyBlocks.get(section).keys, nextLevel, section, true)) records.push(record);
    }

    /**
     * Reads the key block of a section and keeps it.
     * @param {string} section - the section name.
     * @param {number} level - the indentation of the first key.
     * @param {number} firstIndex - the line of the first key.
     * @param {number} lineIndex - the section line just read.
     * @returns {void}
     */
    readKeyBlock(section, level, firstIndex, lineIndex) {
        if (firstIndex > lineIndex + 1) this.keyBlocksAfterBlank.push({ sec: section, line: firstIndex });
        const keys = this.readKeys(level, true);
        this.keyBlocks.set(section, { keys, start: keys.length ? keys[0].line : firstIndex, end: this.position - 1 });
    }

    /**
     * Reads the keys at one level, with the keys nested below them.
     * @param {number} baseLevel - the indentation of the keys.
     * @param {boolean} [isKeyBlock=false] - true for the key block of a section, which ends at a blank line.
     * @returns {ShlsKey[]} the keys read.
     */
    readKeys(baseLevel, isKeyBlock = false) {
        const keys = [];
        for (;;) {
            const [level, index] = this.findNextTextLine();
            if (level === null || level < baseLevel) break;
            if (isKeyBlock && level === baseLevel && index > this.position && keys.length) break;
            if (level > baseLevel) {
                this.addNestedKeys(keys, baseLevel, this.readKeys(level));
                continue;
            }
            this.position = index + 1;
            keys.push({ name: getPythonStripped(this.lines[index].text), line: index, level, sub: null });
            this.roles.set(index, 'key');
        }
        return keys;
    }

    /**
     * Puts nested keys under the last key, or under a key without a name when there is none.
     * @param {ShlsKey[]} keys - the keys read so far at the base level.
     * @param {number} baseLevel - the indentation of those keys.
     * @param {ShlsKey[]} nestedKeys - the keys read one level deeper.
     * @returns {void}
     */
    addNestedKeys(keys, baseLevel, nestedKeys) {
        if (keys.length) keys[keys.length - 1].sub = nestedKeys;
        else keys.push({ name: '', line: nestedKeys[0].line, level: baseLevel, sub: nestedKeys });
    }

    /**
     * Reads the records of a data block; their lines go to the data blocks
     * (top level) or to the nested field. A last record with fewer values than
     * keys is kept and marked short. The line records are left in lastRecords.
     * @param {ShlsKey[]} keys - the keys the values follow.
     * @param {number} baseLevel - the indentation of the value lines.
     * @param {string} section - the section name.
     * @param {boolean} isTopLevel - true for a data block of a section, false for a nested list.
     * @returns {Array<Map<string, *>>} the records as data.
     */
    readRecords(keys, baseLevel, section, isTopLevel) {
        const data = [];
        const records = [];
        let values = new Map();
        let record = { fields: [] };
        let keyIndex = 0;
        const block = { sec: section, start: this.findNextTextLine()[1], base: baseLevel, records, end: null };
        while (keys.length) {
            const [level, index] = this.findNextTextLine();
            if (level === null || level < baseLevel) break;
            this.position = index + 1;
            if (level > baseLevel) { this.addIgnoredLine(index); continue; }
            this.readField(keys[keyIndex], index, baseLevel, section, values, record);
            keyIndex++;
            if (keyIndex < keys.length) continue;
            data.push(values);
            records.push(record);
            values = new Map();
            record = { fields: [] };
            keyIndex = 0;
        }
        if (record.fields.length) {
            record.short = keys.length;
            data.push(values);
            records.push(record);
        }
        block.end = this.position - 1;
        if (isTopLevel) this.dataBlocks.push(block);
        this.lastRecords = records;
        return data;
    }

    /**
     * Reads one value line, or a nested key line with the records below it.
     * @param {ShlsKey} key - the key of the line.
     * @param {number} index - the line.
     * @param {number} baseLevel - the indentation of the value lines.
     * @param {string} section - the section name.
     * @param {Map<string, *>} values - the data of the record; gets the value.
     * @param {ShlsRecord} record - the lines of the record; gets the field.
     * @returns {void}
     */
    readField(key, index, baseLevel, section, values, record) {
        const value = getPythonStripped(this.lines[index].text);
        if (!key.sub) {
            values.set(key.name, value);
            this.roles.set(index, 'value');
            record.fields.push({ key: key.name, line: index, value, sub: null, end: index });
            return;
        }
        this.roles.set(index, 'nested');
        const field = { key: key.name, line: index, value, sub: [], end: index };
        record.fields.push(field);
        const [nextLevel] = this.findNextTextLine();
        if (nextLevel === null || nextLevel <= baseLevel) {
            values.set(key.name, []);
            return;
        }
        values.set(key.name, this.readRecords(key.sub, nextLevel, section, false));
        field.sub = this.lastRecords;
        field.end = this.position - 1;
    }
}

/**
 * Reads an SHLS text as SHLSDecoder().decode(text) does.
 * @param {string} text - the SHLS text.
 * @returns {Map<string, Array<Map<string, *>>>} the sections, each a list of records.
 */
export function parseShls(text) {
    return new ShlsDecoder(splitPythonLines(String(text))).readSections();
}

/* ---------- SHLSEncoder ---------- */

/**
 * Returns a copy of a list as records: a plain value becomes a record with the one key "Value".
 * @param {PyValue[]} items - the list.
 * @returns {Array<Map<string, *>>} the records.
 */
function convertToRecords(items) {
    return items.map(item => convertToRecord(isDict(item) ? item : new Map([[PLAIN_VALUE_KEY, item]])));
}

/**
 * Returns a copy of a record: lists become lists of records, a dict a list with this one record.
 * @param {Map<string, *>} item - the record.
 * @returns {Map<string, *>} the copy.
 */
function convertToRecord(item) {
    const record = new Map();
    for (const [key, value] of item) record.set(key, isList(value) ? convertToRecords(value) : isDict(value) ? convertToRecords([value]) : value);
    return record;
}

/**
 * Returns the data in the shape SHLSEncoder writes: values of a top-level dict
 * that are not lists become lists, lists hold records.
 * @param {*} data - the data passed to the encoder.
 * @returns {*} a copy in records, or the data itself when it is neither dict nor list.
 */
function convertToEncoderInput(data) {
    if (isDict(data)) return new Map([...data].map(([key, value]) => [key, convertToRecords(isList(value) ? value : [value])]));
    if (isList(data)) return convertToRecords(data);
    return data;
}

/**
 * Returns the key block lines of the data, as SHLSEncoder's header.
 * @param {*} data - the sections (dict) or records (list).
 * @param {number} [level=0] - the indentation level.
 * @returns {string} the lines joined by "\n", empty for other data.
 */
function formatKeyBlock(data, level = 0) {
    if (isDict(data)) return formatSectionKeys(data, level);
    if (isList(data)) return formatRecordKeys(data, level);
    return '';
}

/**
 * Returns each section name with the keys of its records below it.
 * @param {Map<string, *>} sections - the sections.
 * @param {number} level - the indentation level of the names.
 * @returns {string} the lines joined by "\n".
 */
function formatSectionKeys(sections, level) {
    const lines = [];
    for (const [key, value] of sections) {
        lines.push(ENCODER_INDENT.repeat(level) + formatPythonStr(key));
        lines.push(formatKeyBlock(value, level + 1));
    }
    return lines.join('\n');
}

/**
 * Returns the keys of the first record that has any, with the keys of nested lists below them.
 * @param {Array<Map<string, *>>} records - the records.
 * @param {number} level - the indentation level of the keys.
 * @returns {string} the lines joined by "\n"; "Value" when no record has keys.
 */
function formatRecordKeys(records, level) {
    const schema = records.find(record => record.size);
    if (!schema) return ENCODER_INDENT.repeat(level) + PLAIN_VALUE_KEY;
    const lines = [];
    for (const [key, value] of schema) {
        lines.push(ENCODER_INDENT.repeat(level) + formatPythonStr(key));
        if (isList(value)) lines.push(formatKeyBlock(records.flatMap(record => (isList(record.get(key)) ? record.get(key) : [])), level + 1));
    }
    return lines.join('\n');
}

/**
 * Returns the value lines of the data, as SHLSEncoder writes them.
 * @param {*} data - the sections (dict) or records (list).
 * @param {number} [level=0] - the indentation level.
 * @returns {string} the lines joined by "\n", empty for other data.
 */
function formatValueLines(data, level = 0) {
    if (isDict(data)) return formatSectionValues(data, level);
    if (isList(data)) return formatRecordValues(data, level);
    return '';
}

/**
 * Returns each section name with the value lines of its records below it.
 * @param {Map<string, *>} sections - the sections.
 * @param {number} level - the indentation level of the records.
 * @returns {string} the lines joined by "\n".
 */
function formatSectionValues(sections, level) {
    const lines = [];
    for (const [key, value] of sections) {
        lines.push(formatPythonStr(key));
        if (value.length) lines.push(formatValueLines(value, level + 1));
    }
    return lines.join('\n');
}

/**
 * Returns the value lines of records: a value per line, a nested list as its key with its records below.
 * @param {Array<Map<string, *>>} records - the records.
 * @param {number} level - the indentation level of the values.
 * @returns {string} the lines joined by "\n".
 */
function formatRecordValues(records, level) {
    const lines = [];
    for (const record of records) {
        for (const [key, value] of record) {
            if (!isList(value)) {
                lines.push(ENCODER_INDENT.repeat(level) + formatPythonStr(value));
                continue;
            }
            lines.push(ENCODER_INDENT.repeat(level) + formatPythonStr(key));
            if (value.length) lines.push(formatValueLines(value, level + 1));
        }
    }
    return lines.join('\n');
}

/**
 * Writes data as SHLSEncoder().encode(data) does, on a copy: values of the
 * top-level dict that are not lists become lists, lists hold records.
 * @param {*} data - the data (a Map of sections, or a list of records).
 * @returns {string} the SHLS text: the key block, a blank line, the values.
 */
export function formatShls(data) {
    const records = convertToEncoderInput(data);
    return `${formatKeyBlock(records)}\n\n${formatValueLines(records)}`;
}

/* ---------- JSON with the order of the keys and Python's number types ---------- */

/**
 * Reads one JSON text as Python's json.loads does, keeping the order of the
 * keys and the number types. Its read methods consume characters and return
 * what they read, as a reader of a stream does.
 */
class JsonReader {
    /**
     * Prepares the reader for one text.
     * @param {string} text - the JSON text.
     * @returns {void}
     */
    constructor(text) {
        this.text = text;
        /** @type {number} the reading position. */
        this.index = 0;
    }

    /**
     * Throws an error with the line of the reading position.
     * @param {string} message - what went wrong.
     * @returns {never}
     * @throws {Error} always: the message with " (line N)".
     */
    stopWithError(message) {
        const line = this.text.slice(0, this.index).split('\n').length;
        throw new Error(`${message} (line ${line})`);
    }

    /**
     * Moves the reading position past white space.
     * @returns {void}
     */
    moveOverWhitespace() {
        while (this.index < this.text.length && JSON_WHITESPACE.test(this.text[this.index])) this.index++;
    }

    /**
     * Reads the whole text: one value and nothing after it.
     * @returns {PyValue} the value.
     * @throws {Error} when the text is not one JSON value.
     */
    readDocument() {
        const value = this.readValue();
        this.moveOverWhitespace();
        if (this.index < this.text.length) this.stopWithError('More text after the JSON value');
        return value;
    }

    /**
     * Reads one value at the reading position.
     * @returns {PyValue} the value.
     * @throws {Error} when no value stands there.
     */
    readValue() {
        this.moveOverWhitespace();
        const char = this.text[this.index];
        if (char === '{') return this.readObject();
        if (char === '[') return this.readArray();
        if (char === '"') return this.readString();
        return this.readNumberOrLiteral();
    }

    /**
     * Reads an object, the reading position at its "{".
     * @returns {Map<string, PyValue>} the object with its keys in order.
     * @throws {Error} when the object is not complete.
     */
    readObject() {
        this.index++;
        const object = new Map();
        this.moveOverWhitespace();
        if (this.text[this.index] === '}') { this.index++; return object; }
        for (;;) {
            this.moveOverWhitespace();
            if (this.text[this.index] !== '"') this.stopWithError('A key in double quotes is expected');
            const key = this.readString();
            this.moveOverWhitespace();
            if (this.text[this.index] !== ':') this.stopWithError('":" is expected');
            this.index++;
            object.set(key, this.readValue());
            this.moveOverWhitespace();
            if (this.text[this.index] === ',') { this.index++; continue; }
            if (this.text[this.index] === '}') { this.index++; return object; }
            this.stopWithError('"," or "}" is expected');
        }
    }

    /**
     * Reads an array, the reading position at its "[".
     * @returns {PyValue[]} the array.
     * @throws {Error} when the array is not complete.
     */
    readArray() {
        this.index++;
        const array = [];
        this.moveOverWhitespace();
        if (this.text[this.index] === ']') { this.index++; return array; }
        for (;;) {
            array.push(this.readValue());
            this.moveOverWhitespace();
            if (this.text[this.index] === ',') { this.index++; continue; }
            if (this.text[this.index] === ']') { this.index++; return array; }
            this.stopWithError('"," or "]" is expected');
        }
    }

    /**
     * Reads a string, the reading position at its opening quote.
     * @returns {string} the string with its escapes resolved.
     * @throws {Error} when the string is never closed or holds an unknown escape.
     */
    readString() {
        let index = this.index + 1, out = '';
        for (;;) {
            if (index >= this.text.length) { this.index = index; this.stopWithError('A string is never closed'); }
            const char = this.text[index];
            if (char === '"') { this.index = index + 1; return out; }
            if (char !== '\\') { out += char; index++; continue; }
            const escape = this.text[index + 1];
            if (escape === 'u') {
                out += String.fromCharCode(parseInt(this.text.slice(index + 2, index + 2 + JSON_UNICODE_DIGITS), 16));
                index += 2 + JSON_UNICODE_DIGITS;
                continue;
            }
            if (!(escape in JSON_ESCAPES)) { this.index = index; this.stopWithError('Unknown escape in a string'); }
            out += JSON_ESCAPES[escape];
            index += 2;
        }
    }

    /**
     * Reads a number or one of the words true, false and null.
     * @returns {PyNum|boolean|null} the value.
     * @throws {Error} when neither stands at the reading position.
     */
    readNumberOrLiteral() {
        const number = JSON_NUMBER.exec(this.text.slice(this.index, this.index + JSON_NUMBER_LOOKAHEAD));
        if (number && number[0]) { this.index += number[0].length; return new PyNum(number[0]); }
        for (const [word, value] of JSON_LITERALS) if (this.text.startsWith(word, this.index)) { this.index += word.length; return value; }
        return this.stopWithError(this.index >= this.text.length ? 'The text ends where a value is expected' : `Unexpected "${this.text[this.index]}"`);
    }
}

/**
 * Reads a JSON text as Map / Array / string / PyNum / true / false / null, like json.loads.
 * @param {string} text - the JSON text.
 * @returns {PyValue} the value.
 * @throws {Error} when the text is not valid JSON; the message names the line.
 */
export function parseJson(text) {
    return new JsonReader(String(text)).readDocument();
}

/**
 * Returns the line breaks and separators of JSON output at one level.
 * @param {number|string} indent - spaces per level, or the indentation text; 0 writes one line.
 * @param {number} level - the nesting level.
 * @returns {{inner: string, outer: string, separator: string}} the text in front of each item, in front of the closing bracket, and between key and value.
 */
function getJsonLayout(indent, level) {
    const pad = typeof indent === 'string' ? indent : ' '.repeat(indent);
    const lineBreak = indent ? '\n' : '';
    return { inner: lineBreak + pad.repeat(level + 1), outer: lineBreak + pad.repeat(level), separator: indent ? ': ' : ':' };
}

/**
 * Returns an ordered value as JSON (indent 0: on one line, like json.dumps
 * without indent but without spaces).
 * @param {PyValue|number} value - the value.
 * @param {number|string} [indent=2] - spaces per level, or the indentation text.
 * @param {number} [level=0] - the nesting level the value stands at.
 * @returns {string} the JSON text.
 */
export function formatJson(value, indent = 2, level = 0) {
    const layout = getJsonLayout(indent, level);
    if (isDict(value)) {
        if (!value.size) return '{}';
        return '{' + [...value].map(([key, item]) => layout.inner + JSON.stringify(formatPythonStr(key)) + layout.separator + formatJson(item, indent, level + 1)).join(',') + layout.outer + '}';
    }
    if (isList(value)) {
        if (!value.length) return '[]';
        return '[' + value.map(item => layout.inner + formatJson(item, indent, level + 1)).join(',') + layout.outer + ']';
    }
    return formatJsonScalar(value);
}

/**
 * Returns a value that is neither dict nor list as JSON.
 * @param {*} value - the value.
 * @returns {string} the JSON text; null for what JSON cannot hold.
 */
function formatJsonScalar(value) {
    if (value instanceof PyNum) return formatJsonNumber(value);
    if (typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
    if (value === true || value === false) return String(value);
    return 'null';
}

/**
 * Returns a number from JSON as Python's json.dumps writes it.
 * @param {PyNum} number - the number.
 * @returns {string} the digits; NaN for a float that is not finite.
 */
function formatJsonNumber(number) {
    if (!number.float) return formatPythonStr(number);
    if (!Number.isFinite(number.value)) return 'NaN';
    return formatPythonFloat(number.value).replace(/^(-?)inf$/, '$1Infinity');
}

/**
 * Returns a plain JavaScript value (from YAML, CSV …) as an ordered Python-like value.
 * @param {*} value - the JavaScript value.
 * @returns {PyValue} the value with Maps for objects and PyNum for numbers.
 */
export function convertFromJs(value) {
    if (value instanceof Map) return new Map([...value].map(([key, item]) => [String(key), convertFromJs(item)]));
    if (Array.isArray(value)) return value.map(convertFromJs);
    if (value instanceof Date) return value.toISOString();
    if (value && typeof value === 'object') return new Map(Object.entries(value).map(([key, item]) => [key, convertFromJs(item)]));
    if (typeof value === 'number') return convertFromJsNumber(value);
    if (typeof value === 'bigint') return new PyNum(value.toString());
    return value === undefined ? null : value;
}

/**
 * Returns a JavaScript number as a PyNum: an int when it is an exact integer, else a float.
 * @param {number} number - the number.
 * @returns {PyNum} the number with its Python type.
 */
function convertFromJsNumber(number) {
    if (Number.isInteger(number) && Math.abs(number) < SAFE_INTEGER_LIMIT) return new PyNum(String(number));
    return new PyNum(Number.isInteger(number) ? number.toExponential() : String(number));
}

/**
 * Returns an ordered value as plain JavaScript (keys that are numbers move first there).
 * @param {PyValue} value - the ordered value.
 * @returns {*} plain objects, arrays, numbers and the other values as they are.
 */
export function convertToJs(value) {
    if (isDict(value)) {
        const object = {};
        for (const [key, item] of value) Object.defineProperty(object, formatPythonStr(key), { value: convertToJs(item), enumerable: true, writable: true, configurable: true });
        return object;
    }
    if (isList(value)) return value.map(convertToJs);
    if (value instanceof PyNum) return value.value;
    return value;
}

/* ---------- The editor's model ---------- */

/**
 * Returns the code line (0-based, lines split at "\n") of each Python line.
 * @param {string} code - the whole code.
 * @param {PythonLine[]} pythonLines - the lines as splitPythonLines() returns them.
 * @returns {number[]} the code line of each Python line.
 */
function getCodeLineNumbers(code, pythonLines) {
    const lineNumbers = new Array(pythonLines.length);
    let line = 0, lineStart = 0;
    for (let index = 0; index < pythonLines.length; index++) {
        const start = pythonLines[index].start;
        while (lineStart < start) {
            const lineBreak = code.indexOf('\n', lineStart);
            if (lineBreak < 0 || lineBreak >= start) break;
            line++;
            lineStart = lineBreak + 1;
        }
        lineNumbers[index] = line;
    }
    return lineNumbers;
}

/**
 * Creates the function that turns a Python line index into a code line.
 * @param {number[]} lineNumbers - the code line of each Python line.
 * @param {number} codeLineCount - the number of code lines.
 * @returns {function(number|null|undefined): (number|null)} null for no line, the last code line past the end.
 */
function createLineMapper(lineNumbers, codeLineCount) {
    return index => (index == null ? null : index < lineNumbers.length ? lineNumbers[index] : codeLineCount - 1);
}

/**
 * Tells whether a key name looks like a value: a number, true / false or a date.
 * @param {string} text - the key name.
 * @returns {boolean} true when it looks like a value.
 */
function isValueLike(text) {
    return VALUE_LIKE_NUMBER.test(text) || VALUE_LIKE_BOOLEAN.test(text) || VALUE_LIKE_DATE.test(text);
}

/**
 * Reads an SHLS text into the editor's model: the data, the sections with their
 * key blocks and records, the role of every line and the problems. A
 * section's records are those of all its data blocks.
 * @param {string} code - the SHLS text.
 * @returns {ShlsModel} the model.
 */
export function parseModel(code) {
    const codeLines = code.split('\n');
    const pythonLines = splitPythonLines(code);
    const context = { codeLines, toCodeLine: createLineMapper(getCodeLineNumbers(code, pythonLines), codeLines.length) };
    const decoder = new ShlsDecoder(pythonLines);
    const data = decoder.readSections();
    const roles = getLineRoles(decoder, context);
    const sections = createModelSections(decoder, context);
    const unit = decoder.indentUnit || 1;
    const problems = getProblems(decoder, sections, roles, unit, context);
    return { data, error: null, sections, roles, problems, unit, lines: codeLines };
}

/**
 * Returns the role of every code line.
 * @param {ShlsDecoder} decoder - the decoder after reading.
 * @param {CodeLineContext} context - the code lines.
 * @returns {string[]} one role per code line, "blank" for lines without one.
 */
function getLineRoles(decoder, context) {
    const roles = new Array(context.codeLines.length).fill('blank');
    for (const [index, role] of decoder.roles) roles[context.toCodeLine(index)] = role;
    return roles;
}

/**
 * Creates the sections of the model with their key blocks and data blocks in code lines.
 * @param {ShlsDecoder} decoder - the decoder after reading.
 * @param {CodeLineContext} context - the code lines.
 * @returns {ShlsSection[]} the sections in the order of their first line.
 */
function createModelSections(decoder, context) {
    const sections = [];
    const sectionsByName = new Map();
    for (const sectionLine of decoder.sectionLines) {
        if (!sectionsByName.has(sectionLine.name)) {
            const section = { name: sectionLine.name, line: context.toCodeLine(sectionLine.line), lines: [], keys: null, keyStart: null, keyEnd: null, blocks: [], records: [] };
            sectionsByName.set(sectionLine.name, section);
            sections.push(section);
        }
        sectionsByName.get(sectionLine.name).lines.push(context.toCodeLine(sectionLine.line));
    }
    addKeyBlocks(sectionsByName, decoder.keyBlocks, context);
    addDataBlocks(sectionsByName, decoder.dataBlocks, context);
    for (const section of sections) section.records = section.blocks.flatMap(block => block.records);
    return sections;
}

/**
 * Sets the keys, keyStart and keyEnd of each section from its key block.
 * @param {Map<string, ShlsSection>} sectionsByName - the sections of the model.
 * @param {Map<string, KeyBlock>} keyBlocks - the key blocks the decoder read.
 * @param {CodeLineContext} context - the code lines.
 * @returns {void}
 */
function addKeyBlocks(sectionsByName, keyBlocks, context) {
    for (const [name, keyBlock] of keyBlocks) {
        const section = sectionsByName.get(name);
        if (!section) continue;
        section.keys = convertKeysToCode(keyBlock.keys, context);
        section.keyStart = context.toCodeLine(keyBlock.start);
        section.keyEnd = section.keys.length ? getKeyEnd(section.keys[section.keys.length - 1]) : context.toCodeLine(keyBlock.end);
    }
}

/**
 * Adds the data blocks the decoder read to their sections.
 * @param {Map<string, ShlsSection>} sectionsByName - the sections of the model.
 * @param {DataBlock[]} dataBlocks - the data blocks the decoder read.
 * @param {CodeLineContext} context - the code lines.
 * @returns {void}
 */
function addDataBlocks(sectionsByName, dataBlocks, context) {
    for (const block of dataBlocks) {
        const section = sectionsByName.get(block.sec);
        if (!section) continue;
        const records = convertRecordsToCode(block.records, context);
        section.blocks.push({ start: context.toCodeLine(block.start), end: context.toCodeLine(block.end), records });
    }
}

/**
 * Returns keys with code lines in place of Python lines.
 * @param {ShlsKey[]} keys - the keys as the decoder read them.
 * @param {CodeLineContext} context - the code lines.
 * @returns {ShlsKey[]} new keys.
 */
function convertKeysToCode(keys, context) {
    return keys.map(key => ({ name: key.name, line: context.toCodeLine(key.line), level: key.level, sub: key.sub ? convertKeysToCode(key.sub, context) : null }));
}

/**
 * Returns records with code lines in place of Python lines, with their first and last line.
 * @param {ShlsRecord[]} records - the records as the decoder read them.
 * @param {CodeLineContext} context - the code lines.
 * @returns {ShlsRecord[]} new records with short, start and end.
 */
function convertRecordsToCode(records, context) {
    return records.map(record => convertRecordToCode(record, context));
}

/**
 * Returns one record with code lines in place of Python lines.
 * @param {ShlsRecord} record - the record as the decoder read it.
 * @param {CodeLineContext} context - the code lines.
 * @returns {ShlsRecord} the new record with short, start and end.
 */
function convertRecordToCode(record, context) {
    const toCodeLine = context.toCodeLine;
    const fields = record.fields.map(field => ({ key: field.key, line: toCodeLine(field.line), value: field.value, sub: field.sub ? convertRecordsToCode(field.sub, context) : null, end: toCodeLine(field.end) }));
    const lastField = fields[fields.length - 1];
    return { fields, short: record.short || 0, start: fields.length ? fields[0].line : null, end: fields.length ? findLastTextLine(context.codeLines, lastField.end, lastField.line) : null };
}

/**
 * Returns the last line with text from a line upward, stopping at a lower bound.
 * @param {string[]} codeLines - the code lines.
 * @param {number} endLine - the line to start from.
 * @param {number} minLine - the line not to go below.
 * @returns {number} the line.
 */
function findLastTextLine(codeLines, endLine, minLine) {
    let line = endLine;
    while (line > minLine && !(codeLines[line] || '').trim()) line--;
    return line;
}

/**
 * Returns the problems of the code, sorted by line (errors first) and without repeats.
 * @param {ShlsDecoder} decoder - the decoder after reading.
 * @param {ShlsSection[]} sections - the sections of the model.
 * @param {string[]} roles - the role of every code line.
 * @param {number} unit - the spaces per level.
 * @param {CodeLineContext} context - the code lines.
 * @returns {ShlsProblem[]} the problems.
 */
function getProblems(decoder, sections, roles, unit, context) {
    const problems = [];
    addIndentationProblems(problems, context.codeLines, unit);
    addDecoderProblems(problems, decoder, roles, context);
    for (const section of sections) addSectionProblems(problems, section, context.codeLines);
    problems.sort(getProblemOrder);
    return getUniqueProblems(problems);
}

/**
 * Creates a problem.
 * @param {number} line - the 0-based code line.
 * @param {'error'|'warn'} kind - how serious it is.
 * @param {string} msg - the message.
 * @returns {ShlsProblem} the problem.
 */
function createProblem(line, kind, msg) {
    return { line, kind, msg };
}

/**
 * Compares two problems for sorting: by line, an error ahead of a warning.
 * @param {ShlsProblem} first - one problem.
 * @param {ShlsProblem} second - the other problem.
 * @returns {number} negative, zero or positive, as Array.prototype.sort needs.
 */
function getProblemOrder(first, second) {
    return first.line - second.line || (first.kind === 'error' ? -1 : 1);
}

/**
 * Returns the problems without a second one with the same line and message.
 * @param {ShlsProblem[]} problems - the sorted problems.
 * @returns {ShlsProblem[]} the first of each line and message.
 */
function getUniqueProblems(problems) {
    const seen = new Set();
    return problems.filter(problem => {
        const key = problem.line + '|' + problem.msg;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * Returns a count with its noun, "1 space" or "4 spaces".
 * @param {number} count - the count.
 * @returns {string} the count and the noun.
 */
function formatSpaces(count) {
    return `${count} ${count === 1 ? 'space' : 'spaces'}`;
}

/**
 * Adds the indentation problems: whole levels of spaces, no tabs, one level at a time.
 * @param {ShlsProblem[]} problems - the list to add to.
 * @param {string[]} codeLines - the code lines.
 * @param {number} unit - the spaces per level.
 * @returns {void}
 */
function addIndentationProblems(problems, codeLines, unit) {
    let previousLevel = 0, hasPreviousText = false;
    for (let line = 0; line < codeLines.length; line++) {
        const text = codeLines[line];
        if (!text.trim()) continue;
        const indentation = LEADING_INDENTATION.exec(text)[0];
        if (indentation.includes('\t')) {
            problems.push(createProblem(line, 'error', 'A tab in the indentation - SHLS counts spaces only, so this line is read as a section name'));
            continue;
        }
        const width = indentation.length;
        if (width % unit) problems.push(createProblem(line, 'warn', `Indented by ${formatSpaces(width)} - not a whole level (${formatSpaces(unit)} per level)`));
        else if (hasPreviousText && width / unit > previousLevel + 1) problems.push(createProblem(line, 'warn', `Indented ${width / unit - previousLevel} levels deeper than the line above - one level at a time`));
        previousLevel = Math.floor(width / unit);
        hasPreviousText = true;
    }
}

/**
 * Adds the problems the decoder noted: ignored lines and key blocks after blank lines.
 * @param {ShlsProblem[]} problems - the list to add to.
 * @param {ShlsDecoder} decoder - the decoder after reading.
 * @param {string[]} roles - the role of every code line.
 * @param {CodeLineContext} context - the code lines.
 * @returns {void}
 */
function addDecoderProblems(problems, decoder, roles, context) {
    const toCodeLine = context.toCodeLine;
    for (const index of decoder.ignoredLines) {
        if (roles[toCodeLine(index)] === 'ignored') problems.push(createProblem(toCodeLine(index), 'warn', 'SHLS readers ignore this line - its indentation does not fit the key block'));
    }
    for (const keyBlock of decoder.keyBlocksAfterBlank) {
        problems.push(createProblem(toCodeLine(keyBlock.line), 'warn', `"${keyBlock.sec}" has no key block yet - these lines are read as its keys (the key block follows the section name directly)`));
    }
}

/**
 * Adds the problems of one section: its key block, the blank lines after it and its records.
 * @param {ShlsProblem[]} problems - the list to add to.
 * @param {ShlsSection} section - the section.
 * @param {string[]} codeLines - the code lines.
 * @returns {void}
 */
function addSectionProblems(problems, section, codeLines) {
    if (section.keys) addKeyProblems(problems, section.keys);
    if (section.keys && section.keyEnd != null) addKeyBlockGapProblem(problems, section, codeLines);
    for (const block of section.blocks) addRecordProblems(problems, block.records, section, section.keys ? section.keys.length : 0, codeLines);
}

/**
 * Adds the problems of keys at one level and below: a key twice, keys that look like values.
 * @param {ShlsProblem[]} problems - the list to add to.
 * @param {ShlsKey[]} keys - the keys.
 * @returns {void}
 */
function addKeyProblems(problems, keys) {
    const seen = new Set();
    for (const key of keys) {
        if (seen.has(key.name)) problems.push(createProblem(key.line, 'error', `The key "${key.name}" is twice in the key block - only one of them keeps its values. Is the blank line between the key block and the records missing?`));
        seen.add(key.name);
        if (isValueLike(key.name)) problems.push(createProblem(key.line, 'warn', `"${key.name}" looks like a value but stands in the key block - records follow the key block after exactly one blank line`));
        if (key.sub) addKeyProblems(problems, key.sub);
    }
}

/**
 * Adds a problem when more than one blank line separates the key block from indented records.
 * @param {ShlsProblem[]} problems - the list to add to.
 * @param {ShlsSection} section - the section with its key block.
 * @param {string[]} codeLines - the code lines.
 * @returns {void}
 */
function addKeyBlockGapProblem(problems, section, codeLines) {
    const afterKeys = section.keyEnd + 1;
    let next = afterKeys;
    while (next < codeLines.length && !codeLines[next].trim()) next++;
    const blankLines = next - afterKeys;
    if (blankLines > 1 && next < codeLines.length && /^ /.test(codeLines[next])) {
        problems.push(createProblem(afterKeys, 'warn', `${blankLines} blank lines after the key block of "${section.name}" - exactly one belongs there`));
    }
}

/**
 * Adds the problems of records and, below them, of their nested lists.
 * @param {ShlsProblem[]} problems - the list to add to.
 * @param {ShlsRecord[]} records - the records of one block or nested list.
 * @param {RecordOwner} owner - the section or nested key they belong to.
 * @param {number} keyCount - the number of keys a record has.
 * @param {string[]} codeLines - the code lines.
 * @returns {void}
 */
function addRecordProblems(problems, records, owner, keyCount, codeLines) {
    for (const record of records) {
        if (record.short) problems.push(createProblem(record.start, 'warn', `This record of "${owner.name}" has ${record.fields.length} of ${keyCount} values - its last keys are missing in the data`));
    }
    addRecordSeparatorProblems(problems, records, owner, keyCount, codeLines);
    for (const record of records) {
        for (const field of record.fields) {
            if (!field.sub) continue;
            const nestedKeys = (findKeyByName(owner.keys, field.key) || {}).sub;
            addRecordProblems(problems, field.sub, { name: field.key, keys: nestedKeys }, nestedKeys ? nestedKeys.length : 0, codeLines);
        }
    }
}

/**
 * Adds problems where records are separated by blank lines but not all of them:
 * a blank line inside a record, or none between two, shows a record with too
 * few or too many values.
 * @param {ShlsProblem[]} problems - the list to add to.
 * @param {ShlsRecord[]} records - the records of one block or nested list.
 * @param {RecordOwner} owner - the section or nested key they belong to.
 * @param {number} keyCount - the number of keys a record has.
 * @param {string[]} codeLines - the code lines.
 * @returns {void}
 */
function addRecordSeparatorProblems(problems, records, owner, keyCount, codeLines) {
    const starts = records.slice(1).map(record => record.start);
    const separated = starts.filter(line => hasBlankLineBefore(codeLines, line)).length;
    if (!(records.length >= 2 && separated >= 1 && separated >= starts.length - 1 && separated < starts.length)) return;
    records.forEach((record, recordIndex) => {
        if (recordIndex && !hasBlankLineBefore(codeLines, record.start)) problems.push(createProblem(record.start, 'warn', `No blank line before this record of "${owner.name}" while the others have one - the record above may have more values than the key block (${keyCount})`));
        record.fields.forEach((field, fieldIndex) => {
            if (fieldIndex && hasBlankLineBefore(codeLines, field.line) && !(record.fields[fieldIndex - 1].sub)) problems.push(createProblem(field.line, 'warn', `A blank line inside a record of "${owner.name}" - the record may have fewer values than the key block (${keyCount})`));
        });
    });
}

/**
 * Tells whether the line above a line is blank.
 * @param {string[]} codeLines - the code lines.
 * @param {number|null} line - the line.
 * @returns {boolean} true when the line is not the first and the one above has no text.
 */
function hasBlankLineBefore(codeLines, line) {
    return line > 0 && !(codeLines[line - 1] || '').trim();
}

/**
 * Returns the first key with a name.
 * @param {ShlsKey[]|null|undefined} keys - the keys to look in.
 * @param {string} name - the key name.
 * @returns {ShlsKey|null|undefined} the key, undefined when none has the name, null without keys.
 */
function findKeyByName(keys, name) {
    return keys ? keys.find(key => key.name === name) : null;
}

/* ---------- Highlighting ---------- */

/**
 * Returns a text with HTML's special characters escaped, for element content and attribute values.
 * @param {*} text - the text (turned into a string).
 * @returns {string} the escaped text.
 */
export function escapeHtml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Returns the code as HTML with a class for each role and a guide line for each level of indentation.
 * @param {ShlsModel} model - the model of the code.
 * @returns {string} the HTML, one line per code line.
 */
export function highlight(model) {
    const unit = model.unit || 1;
    return model.lines.map((line, index) => highlightLine(line, model.roles[index] || 'blank', unit)).join('\n');
}

/**
 * Returns one code line as HTML.
 * @param {string} line - the code line.
 * @param {string} role - the role of the line.
 * @param {number} unit - the spaces per level.
 * @returns {string} the indentation guides and the text in a span with the role's class.
 */
function highlightLine(line, role, unit) {
    const [, spaces, rest] = INDENT_AND_TEXT.exec(line);
    const guides = formatIndentGuides(spaces, unit);
    if (!rest) return guides;
    return `${guides}<span class="${getRoleClass(role, rest)}">${escapeHtml(rest)}</span>`;
}

/**
 * Returns the leading spaces of a line with a guide span for each whole level.
 * @param {string} spaces - the leading spaces.
 * @param {number} unit - the spaces per level.
 * @returns {string} the guides followed by the spaces of a part level.
 */
function formatIndentGuides(spaces, unit) {
    let guides = '';
    const levels = Math.floor(spaces.length / unit);
    for (let level = 0; level < levels; level++) guides += `<span class="ig">${' '.repeat(unit)}</span>`;
    return guides + spaces.slice(levels * unit);
}

/**
 * Returns the highlighting class of a line's text.
 * @param {string} role - the role of the line.
 * @param {string} text - the text after the indentation.
 * @returns {string} the class: placeholder, section, key, nested key, ignored or value.
 */
function getRoleClass(role, text) {
    if (text.trim() === PLACEHOLDER_TEXT && (role === 'nested' || role === 'value')) return PLACEHOLDER_CLASS;
    return ROLE_CLASSES.get(role) || VALUE_CLASS;
}

/* ---------- Edits: whole lines ---------- */

/**
 * Returns the indentation of a level.
 * @param {number} unit - the spaces per level.
 * @param {number} level - the level.
 * @returns {string} the spaces.
 */
export function getIndent(unit, level) {
    return ' '.repeat(unit * level);
}

/**
 * Returns the record lines for keys at a level; missing values are "-". A
 * nested key's line carries the key, as the encoder writes it.
 * @param {ShlsKey[]} keys - the keys of the record.
 * @param {number} unit - the spaces per level.
 * @param {number} level - the level of the value lines.
 * @param {Map<string, *>|object|null} [values=null] - the values by key (nested: a list of them).
 * @returns {string[]} the lines.
 */
export function getRecordLines(keys, unit, level, values = null) {
    const lines = [];
    for (const key of keys) {
        if (!key.sub) {
            const value = getValueOf(values, key.name);
            lines.push(getIndent(unit, level) + (value == null ? MISSING_VALUE : getCleanValue(formatPythonStr(value)).value || MISSING_VALUE));
            continue;
        }
        lines.push(getIndent(unit, level) + key.name);
        let nestedRecords = getValueOf(values, key.name);
        if (!Array.isArray(nestedRecords) || !nestedRecords.length) nestedRecords = [null];
        for (const nestedValues of nestedRecords) for (const line of getRecordLines(key.sub, unit, level + 1, nestedValues)) lines.push(line);
    }
    return lines;
}

/**
 * Returns the value of a key from a Map or a plain object.
 * @param {Map<string, *>|object|null|undefined} values - the values.
 * @param {string} key - the key.
 * @returns {*} the value, undefined when there is none.
 */
function getValueOf(values, key) {
    if (values instanceof Map) return values.get(key);
    return values && typeof values === 'object' ? values[key] : undefined;
}

/**
 * Returns a value as it can stand in SHLS: one line, without spaces around it.
 * @param {*} text - the value (turned into a string).
 * @returns {{value: string, changed: string}} the value and what changed: "lines", "spaces" or "".
 */
export function getCleanValue(text) {
    const value = String(text);
    // A run of white space with a line break in it becomes one space (one pass, linear).
    if (VALUE_LINE_BREAK.test(value)) {
        return { value: getPythonStripped(value.replace(VALUE_WHITESPACE_RUN, run => (VALUE_LINE_BREAK.test(run) ? ' ' : run))), changed: 'lines' };
    }
    const stripped = getPythonStripped(value);
    return { value: stripped, changed: stripped !== value ? 'spaces' : '' };
}

/**
 * Returns the key at a path of key indices.
 * @param {ShlsKey[]|null|undefined} keys - the keys of the section.
 * @param {number[]} path - the index at each level.
 * @returns {ShlsKey|null} the key, null when the path is empty or leads nowhere.
 */
export function getKeyAt(keys, path) {
    let list = keys, key = null;
    for (const index of path) {
        key = list && list[index];
        if (!key) return null;
        list = key.sub;
    }
    return key;
}

/**
 * Returns every record that follows the keys at a path (the section's records,
 * or the records of the nested lists below them), in all data blocks.
 * @param {ShlsSection} section - the section.
 * @param {number[]} keyPath - the key index at each level, empty for the section's records.
 * @returns {ShlsRecord[]} the records.
 */
export function getRecordsAt(section, keyPath) {
    let records = section.blocks.flatMap(block => block.records);
    let keys = section.keys;
    for (const index of keyPath) {
        const key = keys[index];
        records = records.flatMap(record => record.fields.filter(field => field.key === key.name && field.sub).flatMap(field => field.sub));
        keys = key.sub;
    }
    return records;
}

/**
 * Returns the last line of a key and the keys nested below it.
 * @param {ShlsKey} key - the key.
 * @returns {number} the line.
 */
export function getKeyEnd(key) {
    return key.sub && key.sub.length ? getKeyEnd(key.sub[key.sub.length - 1]) : key.line;
}

/**
 * Returns the last line of a field, its nested records included.
 * @param {ShlsField} field - the field.
 * @returns {number} the line.
 */
export function getFieldEnd(field) {
    if (!field.sub || !field.sub.length) return field.line;
    const lastRecord = field.sub[field.sub.length - 1];
    return lastRecord.end ?? field.line;
}
