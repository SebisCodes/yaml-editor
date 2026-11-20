/**
 * Formulas for "Open in another editor": LaTeX notation (also used in
 * Markdown) and Typst notation differ, so a formula is turned from one into the other.
 * What has no equivalent is kept as quoted text and listed as lost, so the user checks it.
 *
 * LaTeX to Typst reads the formula token by token:
 * 1. a backslash starts a command, an escaped character or a spacing;
 * 2. a brace group is turned on its own;
 * 3. `^` and `_` take the next group as their argument;
 * 4. letters in a row are single names in LaTeX, so they are spaced apart for Typst.
 *
 * Typst to LaTeX replaces the common parts (fractions, roots, scripts, symbols) by
 * patterns and lists the formula for checking.
 */

import { LOSS } from './convert-model.js?v=2';

/** LaTeX symbol commands and their Typst names; the Greek letters are added below. */
const TEX_SYMBOLS = { int: 'integral', iint: 'integral.double', oint: 'integral.cont', sum: 'sum', prod: 'product', infty: 'infinity', partial: 'diff', nabla: 'nabla',
    cdot: 'dot', times: 'times', div: 'div', pm: 'plus.minus', mp: 'minus.plus', le: '<=', leq: '<=', ge: '>=', geq: '>=', ne: '!=', neq: '!=', approx: 'approx', equiv: 'equiv',
    sim: 'tilde.op', to: '->', rightarrow: '->', leftarrow: '<-', Rightarrow: '=>', Leftarrow: '<=', Leftrightarrow: '<=>', leftrightarrow: '<->', in: 'in', notin: 'in.not', subset: 'subset',
    subseteq: 'subset.eq', cup: 'union', cap: 'sect', forall: 'forall', exists: 'exists', emptyset: 'emptyset', ldots: 'dots', dots: 'dots', cdots: 'dots.c', quad: 'quad', qquad: 'wide',
    sin: 'sin', cos: 'cos', tan: 'tan', log: 'log', ln: 'ln', exp: 'exp', lim: 'lim', max: 'max', min: 'min', det: 'det', varepsilon: 'epsilon.alt', varphi: 'phi.alt', vartheta: 'theta.alt', ell: 'ell', circ: 'compose', neg: 'not', land: 'and', lor: 'or', prime: 'prime', degree: 'degree' };
/** Greek letters: the same name in LaTeX and Typst. */
const GREEK_LETTERS = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi pi rho sigma tau upsilon phi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega'.split(' ');
for (const letter of GREEK_LETTERS) TEX_SYMBOLS[letter] = letter;
/** LaTeX commands with one argument and the Typst function that wraps it. */
const TEX_WRAP = { mathbf: 'bold', boldsymbol: 'bold', mathit: 'italic', mathcal: 'cal', hat: 'hat', bar: 'overline', overline: 'overline', underline: 'underline', vec: 'arrow', tilde: 'tilde', dot: 'dot' };
/** LaTeX commands that only size or space a formula: left out in Typst. */
const TEX_DROP = /^(left|right|big|Big|bigg|Bigg|displaystyle|textstyle|limits|nolimits|nonumber|mathrm$)$/;
/** LaTeX matrix environments and the start of their Typst function call. */
const TEX_ENV = { matrix: 'mat(delim: #none, ', pmatrix: 'mat(', bmatrix: 'mat(delim: "[", ', vmatrix: 'mat(delim: "|", ', cases: 'cases(' };
/** LaTeX spacing after a backslash and the Typst space that stands for it. */
const TEX_SPACES = { ',': ' thin ', ';': ' med ', ':': ' med ', '!': '', ' ': ' ' };
/** LaTeX commands whose argument is plain text in a formula. */
const TEX_TEXT_COMMANDS = ['text', 'mathrm', 'operatorname', 'textbf', 'textit'];
/** LaTeX fraction commands. */
const TEX_FRACTIONS = ['frac', 'dfrac', 'tfrac'];
/** Typst names and the LaTeX command for each; the first LaTeX name of a Typst name wins. */
const TYP_TO_TEX = Object.fromEntries(Object.entries(TEX_SYMBOLS).filter(([, name]) => /^[a-zA-Z.]+$/.test(name)).map(([command, name]) => [name, `\\${command}`]).reverse());
/** A Typst argument in parentheses, one level of inner parentheses allowed. */
const TYPST_ARGUMENT = '\\(((?:[^()]|\\([^()]*\\))*)\\)';
/** How often the Typst patterns run, so that nested fractions and roots are reached. */
const TYPST_NESTING_PASSES = 4;

/**
 * A math part or block: its formula and the notation it is written in.
 * @typedef {object} MathSource
 * @property {string} v - the formula without its delimiters.
 * @property {boolean} [typst] - true for Typst notation, else LaTeX notation.
 */

/**
 * A position in a LaTeX formula while it is read.
 * @typedef {object} TexReader
 * @property {string} text - the formula.
 * @property {number} index - the position of the next character.
 */

/**
 * Returns the argument after an opening brace, up to its matching closing brace.
 * @param {string} text - the LaTeX text.
 * @param {number} start - the position of the opening brace.
 * @returns {{v: string, end: number}} the text between the braces and the position after the closing one
 *     (the rest of the text and its length when the brace is not closed).
 */
export function getBracedArgument(text, start) {
    let depth = 0;
    for (let position = start; position < text.length; position++) {
        if (text[position] === '\\') { position++; continue; }
        if (text[position] === '{') depth++;
        else if (text[position] === '}' && --depth === 0) return { v: text.slice(start + 1, position), end: position + 1 };
    }
    return { v: text.slice(start + 1), end: text.length };
}

/**
 * Converts a formula in LaTeX notation to Typst notation.
 * @param {string} tex - the formula without its delimiters.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {string} the formula in Typst notation.
 */
export function convertTexMathToTypst(tex, lost) {
    const reader = { text: tex, index: 0 };
    const out = [];
    while (reader.index < tex.length) out.push(readTexMathToken(reader, lost));
    return out.join('').replace(/ {2,}/g, ' ').trim();
}

/**
 * Reads the next token of a LaTeX formula and returns it in Typst notation.
 * @param {TexReader} reader - the formula and position; the position moves past the token.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {string} the token in Typst notation, '' when it has none.
 */
function readTexMathToken(reader, lost) {
    const char = reader.text[reader.index];
    if (char === '\\') return readTexMathBackslash(reader, lost);
    if (char === '{') {
        const argument = getBracedArgument(reader.text, reader.index);
        reader.index = argument.end;
        return convertTexMathToTypst(argument.v, lost);
    }
    if (char === '^' || char === '_') {
        reader.index++;
        const argument = readTexMathGroup(reader, lost);
        return `${char}${/^[\w.]$/.test(argument) ? argument : `(${argument})`}`;
    }
    const letters = /^[a-zA-Z]+/.exec(reader.text.slice(reader.index));
    if (letters) {
        reader.index += letters[0].length;
        // In Typst several letters in a row are one name; in LaTeX they are single letters.
        return letters[0].length > 1 ? ` ${letters[0].split('').join(' ')} ` : letters[0];
    }
    reader.index++;
    if (char === '"' || char === '#') return `\\${char}`;
    return char;
}

/**
 * Reads the argument of a LaTeX command or script: a brace group, a command or one character.
 * @param {TexReader} reader - the formula and position; the position moves past the argument.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {string} the argument in Typst notation.
 */
function readTexMathGroup(reader, lost) {
    const text = reader.text;
    while (text[reader.index] === ' ') reader.index++;
    if (text[reader.index] === '{') {
        const argument = getBracedArgument(text, reader.index);
        reader.index = argument.end;
        return convertTexMathToTypst(argument.v, lost);
    }
    if (text[reader.index] === '\\') {
        const command = /^\\[a-zA-Z]+/.exec(text.slice(reader.index));
        if (command) {
            reader.index += command[0].length;
            return TEX_SYMBOLS[command[0].slice(1)] || command[0].slice(1);
        }
    }
    return text[reader.index++] || '';
}

/**
 * Reads what follows a backslash in a LaTeX formula: a line break, a spacing, an
 * escaped character or a command.
 * @param {TexReader} reader - the formula and position at the backslash; the position moves past it.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {string} the Typst notation, '' when there is none.
 */
function readTexMathBackslash(reader, lost) {
    const next = reader.text[reader.index + 1];
    if (next === '\\') { reader.index += 2; return ' \\ '; }
    if (/[,;:! ]/.test(next || '')) { reader.index += 2; return TEX_SPACES[next]; }
    if (/[{}%$&#_]/.test(next || '')) { reader.index += 2; return /[%&]/.test(next) ? `"${next}"` : `\\${next}`; }
    const command = /^\\([a-zA-Z]+)\*?/.exec(reader.text.slice(reader.index));
    if (!command) { reader.index++; return ''; }
    reader.index += command[0].length;
    return readTexMathCommand(reader, command[1], lost);
}

/**
 * Reads the arguments of a LaTeX command in a formula and returns the command in Typst notation.
 * @param {TexReader} reader - the formula and position after the command name; the position moves past its arguments.
 * @param {string} name - the command name without backslash and star.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {string} the Typst notation, '' for commands that are left out.
 */
function readTexMathCommand(reader, name, lost) {
    if (TEX_FRACTIONS.includes(name)) {
        const numerator = readTexMathGroup(reader, lost), denominator = readTexMathGroup(reader, lost);
        return ` (${numerator})/(${denominator}) `;
    }
    if (name === 'sqrt') return readTexMathRoot(reader, lost);
    if (TEX_TEXT_COMMANDS.includes(name)) return readTexMathText(reader);
    if (name === 'mathbb') {
        const letter = readTexMathGroup(reader, lost);
        return ` ${letter}${letter} `;
    }
    if (TEX_WRAP[name] && (name !== 'dot' || reader.text[reader.index] === '{')) return ` ${TEX_WRAP[name]}(${readTexMathGroup(reader, lost)}) `;
    if (name === 'begin') return readTexMathEnvironment(reader, lost);
    if (name === 'end') { readTexMathGroup(reader, lost); return ''; }
    if (TEX_DROP.test(name)) return '';
    if (TEX_SYMBOLS[name]) return ` ${TEX_SYMBOLS[name]} `;
    lost.add(LOSS.formulas);
    return ` "${name}" `;
}

/**
 * Reads the arguments of `\sqrt`, with an optional index in brackets.
 * @param {TexReader} reader - the formula and position after `\sqrt`; the position moves past its arguments.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {string} `sqrt(...)` or `root(index, ...)` in Typst notation.
 */
function readTexMathRoot(reader, lost) {
    let rootIndex = '';
    if (reader.text[reader.index] === '[') {
        const close = reader.text.indexOf(']', reader.index);
        const end = close < 0 ? reader.text.length : close;
        rootIndex = reader.text.slice(reader.index + 1, end);
        reader.index = Math.min(end + 1, reader.text.length);
    }
    const radicand = readTexMathGroup(reader, lost);
    return rootIndex ? ` root(${rootIndex}, ${radicand}) ` : ` sqrt(${radicand}) `;
}

/**
 * Reads the argument of a text command (`\text`, `\mathrm` and the like) as quoted Typst text.
 * @param {TexReader} reader - the formula and position after the command; the position moves past its argument.
 * @returns {string} the text in quotes.
 */
function readTexMathText(reader) {
    const text = reader.text;
    while (text[reader.index] === ' ') reader.index++;
    const argument = text[reader.index] === '{' ? getBracedArgument(text, reader.index) : { v: text[reader.index] || '', end: reader.index + 1 };
    reader.index = argument.end;
    return ` "${argument.v.replace(/\\/g, '').replace(/"/g, '\\"')}" `;
}

/**
 * Reads a `\begin{...}` environment up to its `\end`; matrices and cases become Typst
 * functions, other environments give their content.
 * @param {TexReader} reader - the formula and position after `\begin`; the position moves past `\end{...}`.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {string} the environment in Typst notation.
 */
function readTexMathEnvironment(reader, lost) {
    const environment = readTexMathGroup(reader, lost).replace(/ /g, '');
    const close = reader.text.indexOf(`\\end{${environment}}`, reader.index);
    const body = reader.text.slice(reader.index, close < 0 ? reader.text.length : close).replace(/^\{[^}]*\}/, '');
    reader.index = close < 0 ? reader.text.length : close + `\\end{${environment}}`.length;
    if (!TEX_ENV[environment]) return convertTexMathToTypst(body, lost);
    const rows = body.split(/\\\\/).map(row => row.split('&').map(cell => convertTexMathToTypst(cell, lost).trim()).join(', ')).filter(Boolean);
    return ` ${TEX_ENV[environment]}${rows.join(environment === 'cases' ? ', ' : '; ')}) `;
}

/**
 * Converts a formula in Typst notation to LaTeX notation, for the common parts; the
 * formula is always listed for checking.
 * @param {string} typst - the formula without its delimiters.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {string} the formula in LaTeX notation.
 */
export function convertTypstMathToTex(typst, lost) {
    lost.add(LOSS.formulas);
    let tex = typst;
    for (let pass = 0; pass < TYPST_NESTING_PASSES; pass++) {
        tex = tex.replace(new RegExp(`${TYPST_ARGUMENT}\\s*/\\s*${TYPST_ARGUMENT}`, 'g'), '\\frac{$1}{$2}')
            .replace(new RegExp(`\\bsqrt${TYPST_ARGUMENT}`, 'g'), '\\sqrt{$1}')
            .replace(new RegExp(`([\\^_])${TYPST_ARGUMENT}`, 'g'), '$1{$2}');
    }
    return tex.replace(/"([^"]*)"/g, '\\text{$1}')
        .replace(/<=/g, '\\le ').replace(/>=/g, '\\ge ').replace(/!=/g, '\\ne ').replace(/->/g, '\\to ')
        .replace(/(?<![\\a-zA-Z.])[a-zA-Z]+(?:\.[a-zA-Z]+)*(?![a-zA-Z])/g, word => (TYP_TO_TEX[word] ? `${TYP_TO_TEX[word]} ` : word));
}

/**
 * Returns the formula of a math part or block in Typst notation.
 * @param {MathSource} math - the math part or block.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {string} the formula in Typst notation.
 */
export function getTypstMath(math, lost) {
    return math.typst ? math.v : convertTexMathToTypst(math.v, lost);
}

/**
 * Returns the formula of a math part or block in LaTeX notation.
 * @param {MathSource} math - the math part or block.
 * @param {import('./convert-model.js').LossSet} lost - the loss texts of this conversion.
 * @returns {string} the formula in LaTeX notation.
 */
export function getTexMath(math, lost) {
    return math.typst ? convertTypstMathToTex(math.v, lost) : math.v;
}
