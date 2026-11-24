/**
 * Template placeholders: tags that a page's server replaces before the document is used, such
 * as {{name}}, {{#name}} … {{/name}} and {{^name}} … {{/name}} (syntax "mustache") or <<name>>,
 * <<?name>> … <</?name>> (syntax "angle"). The page turns them on with ?template= in the
 * editor's address.
 *
 * This module knows the syntaxes, finds the tags, checks that the sections open and close in
 * order, colors the tags in an editor's highlighted code (or puts them back as written there),
 * escapes them for a format checker and escapes them for KaTeX math (as boxed names, or as their
 * text); escapeKatexText() writes any text for KaTeX's \text. Every editor uses this same file
 * and passes the syntax it read from its address; the format-specific parts (stand-ins, previews)
 * stay in the editor. It works on strings only, so it runs in Node as well.
 */

/** The characters a placeholder name may hold after its first character (a letter or _). */
const NAME_PATTERN = '[A-Za-z_][A-Za-z0-9_.-]*';

/**
 * One template syntax.
 * @typedef {object} TemplateSyntax
 * @property {string} name - the value of ?template= that selects it.
 * @property {string} firstCharacter - the character every tag starts with.
 * @property {RegExp} pattern - a tag at one position (sticky): group 1 its sign, group 2 its name.
 * @property {Object<string, string>} kinds - the kind of each known sign ("" for a value): value, section, inverted, close.
 * @property {string} openSign - the sign of a section's opening tag.
 * @property {string} closeSign - the sign of a section's end tag.
 * @property {function(string, string): string} formatTag - writes the tag of a sign and a name.
 */

/** The syntaxes by the value of ?template=. */
const TEMPLATE_SYNTAXES = {
    mustache: {
        name: 'mustache',
        firstCharacter: '{',
        pattern: new RegExp(`\\{\\{([#^/&>!=<$]?)(${NAME_PATTERN})\\}\\}`, 'y'),
        kinds: { '': 'value', '#': 'section', '^': 'inverted', '/': 'close' },
        openSign: '#',
        closeSign: '/',
        formatTag: (sign, name) => `{{${sign}${name}}}`,
    },
    angle: {
        name: 'angle',
        firstCharacter: '<',
        pattern: new RegExp(`<<(\\/\\?|[?/!#^&=]?)(${NAME_PATTERN})>>`, 'y'),
        kinds: { '': 'value', '?': 'section', '/?': 'close' },
        openSign: '?',
        closeSign: '/?',
        formatTag: (sign, name) => `<<${sign}${name}>>`,
    },
};

/**
 * One tag found in the code.
 * @typedef {object} TemplateTag
 * @property {number} start - the offset of its first character.
 * @property {number} end - the offset after its last character.
 * @property {string} sign - the sign before the name ("" for a value).
 * @property {string} name - the placeholder's name.
 * @property {string} kind - value, section, inverted, close, or unknown for a sign outside the syntax.
 */

/**
 * A placeholder error, in the shape of the preview's problems.
 * @typedef {object} TemplateProblem
 * @property {number} pos - the offset of the tag in the code.
 * @property {string} msg - the message for the user.
 * @property {string} kind - always "error".
 */

/**
 * Returns the syntax of a ?template= value.
 * @param {?string} name - the value, e.g. "mustache".
 * @returns {?TemplateSyntax} the syntax, or null for any other value.
 */
export function getTemplateSyntax(name) {
    return Object.prototype.hasOwnProperty.call(TEMPLATE_SYNTAXES, name) ? TEMPLATE_SYNTAXES[name] : null;
}

/**
 * Returns the template syntax the editor's address asks for with ?template=.
 * @param {string} search - the query string of the address, e.g. "?embed=1&template=mustache".
 * @returns {?string} the name of a known syntax, or null.
 */
export function getTemplateNameByAddress(search) {
    const syntax = getTemplateSyntax(new URLSearchParams(search).get('template'));
    return syntax ? syntax.name : null;
}

/** The most characters of a reference a placeholder picture shows. */
const PICTURE_LABEL_LENGTH = 60;
/** A UTF-16 surrogate without its partner, which an address cannot encode. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
/** An HTML character reference: numeric with or without its ";", or a name with its ";", or one of the names HTML also reads without it. */
const CHARACTER_REFERENCE = /&#[xX]([0-9a-fA-F]+);?|&#([0-9]+);?|&([A-Za-z][A-Za-z0-9]*);|&(lt|LT|gt|GT|amp|AMP|quot|QUOT)(?![A-Za-z0-9;])/g;
/** The characters of the named references a reference may spell its delimiters or escapes with. */
const NAMED_CHARACTERS = { lt: '<', gt: '>', lbrace: '{', lcub: '{', rbrace: '}', rcub: '}', percnt: '%', amp: '&', quot: '"', apos: "'", bsol: '\\', Tab: '\t', NewLine: '\n', num: '#', sol: '/' };
/** A CSS escape: up to six hex digits with an optional white space after them, a line break, or any other character. */
const CSS_ESCAPE = /\\([0-9a-fA-F]{1,6})[ \t\n\r\f]?|\\(\r\n|[\n\r\f])|\\([\s\S])/g;
/** A run of percent-encoded bytes. */
const PERCENT_RUN = /(?:%[0-9a-fA-F]{2})+/g;
/** The characters an address parser drops or leaves out of a host: tab, line breaks and the default ignorable characters. */
const DROPPED_IN_REFERENCE = /[\t\n\r]|\p{Default_Ignorable_Code_Point}/gu;

/**
 * Tells whether a reference (a picture address, a link, a file name, a CSS address) holds a
 * placeholder of either syntax. The reference is read as the browser's parsers can read it, in
 * any mix: HTML character references, CSS escapes and percent-encoded bytes decoded, compatibility
 * forms (full-width braces) read as their plain characters, and tabs, line breaks and ignorable
 * characters taken out. A preview shows such a reference as a placeholder and loads nothing for
 * it, with or without a template syntax: the reference is part of the document.
 * @param {string} reference - the reference as written or as a parser normalized it.
 * @returns {boolean} true when it holds {{…}} or <<…>>: an opening pair with a closing pair after it.
 */
export function hasTemplatePlaceholder(reference) {
    const read = readReferenceCharacters(String(reference));
    return hasDelimitedPair(read, '{{', '}}') || hasDelimitedPair(read, '<<', '>>');
}

/**
 * Reads a reference as its characters (the steps of hasTemplatePlaceholder).
 * @param {string} reference - the reference.
 * @returns {string} the reference read: references, escapes and bytes decoded, normalized, dropped characters out.
 */
function readReferenceCharacters(reference) {
    const decoded = expandPercentRuns(expandCssEscapes(expandCharacterReferences(reference.replace(DROPPED_IN_REFERENCE, ''))));
    return decoded.replace(DROPPED_IN_REFERENCE, '').normalize('NFKC').replace(DROPPED_IN_REFERENCE, '');
}

/**
 * Expands the HTML character references of a text; a name outside NAMED_CHARACTERS stays as written.
 * @param {string} text - the text.
 * @returns {string} the text with its references as characters.
 */
function expandCharacterReferences(text) {
    return text.replace(CHARACTER_REFERENCE, (whole, hex, decimal, name, bareName) => {
        if (hex || decimal) return getCharacterByCode(parseInt(hex || decimal, hex ? 16 : 10));
        const key = name || bareName.toLowerCase();
        return Object.hasOwn(NAMED_CHARACTERS, key) ? NAMED_CHARACTERS[key] : whole;
    });
}

/**
 * Expands the CSS escapes of a text.
 * @param {string} text - the text.
 * @returns {string} the text with its escapes as characters, an escaped line break taken out.
 */
function expandCssEscapes(text) {
    return text.replace(CSS_ESCAPE, (whole, hex, lineBreak, character) => (hex ? getCharacterByCode(parseInt(hex, 16)) : lineBreak ? '' : character));
}

/**
 * Expands the percent-encoded bytes of a text as UTF-8; a run that is no UTF-8 keeps its ASCII bytes decoded.
 * @param {string} text - the text.
 * @returns {string} the text with its encoded bytes as characters.
 */
function expandPercentRuns(text) {
    return text.replace(PERCENT_RUN, run => {
        try { return decodeURIComponent(run); } catch (error) { return run.replace(/%([0-7][0-9a-fA-F])/g, (code, byte) => String.fromCharCode(parseInt(byte, 16))); }
    });
}

/**
 * Returns the character of a code point; a code point outside Unicode is the replacement character.
 * @param {number} code - the code point.
 * @returns {string} the character.
 */
function getCharacterByCode(code) {
    return code > 0 && code <= 0x10FFFF && !(code >= 0xD800 && code <= 0xDFFF) ? String.fromCodePoint(code) : '�';
}

/**
 * Tells whether a text holds an opening pair followed later by a closing pair, in one pass each.
 * @param {string} text - the text.
 * @param {string} opening - the opening pair, "{{" or "<<".
 * @param {string} closing - the closing pair, "}}" or ">>".
 * @returns {boolean} true when a closing pair follows the first opening pair.
 */
function hasDelimitedPair(text, opening, closing) {
    const start = text.indexOf(opening);
    return start >= 0 && text.indexOf(closing, start + opening.length) >= 0;
}

/**
 * Builds the picture a preview shows for a reference that holds a placeholder: a light frame
 * with the reference's text.
 * @param {string} label - the text to show, e.g. the placeholder as written; the first 60 characters are shown.
 * @returns {string} the picture as an SVG data address.
 */
export function buildTemplatePicture(label) {
    const shown = Array.from(String(label)).slice(0, PICTURE_LABEL_LENGTH).join('').replace(LONE_SURROGATE, '\uFFFD');
    const text = escapeTagText(shown);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect x="1" y="1" width="238" height="118" rx="6" fill="#e6f4ec" stroke="#b7dcc6" stroke-width="2"/><text x="120" y="66" font-family="monospace" font-size="14" text-anchor="middle" fill="#0b5a38">${text}</text></svg>`;
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

/**
 * Finds the tag that starts at an offset of a text.
 * @param {string} text - the text.
 * @param {number} index - the offset where the tag would start.
 * @param {?TemplateSyntax} syntax - the syntax, or null for plain LaTeX.
 * @returns {?TemplateTag} the tag, or null when the offset holds plain text.
 */
export function findTemplateTagAt(text, index, syntax) {
    if (!syntax || text[index] !== syntax.firstCharacter) return null;
    syntax.pattern.lastIndex = index;
    const match = syntax.pattern.exec(text);
    if (!match) return null;
    const sign = match[1];
    return { start: index, end: index + match[0].length, sign, name: match[2], kind: syntax.kinds[sign] || 'unknown' };
}

/**
 * Returns every tag of a text, in order, comments included.
 * @param {string} text - the text.
 * @param {TemplateSyntax} syntax - the syntax.
 * @returns {TemplateTag[]} the tags.
 */
export function getTemplateTags(text, syntax) {
    const tags = [];
    let index = text.indexOf(syntax.firstCharacter);
    while (index >= 0) {
        const tag = findTemplateTagAt(text, index, syntax);
        if (tag) tags.push(tag);
        index = text.indexOf(syntax.firstCharacter, tag ? tag.end : index + 1);
    }
    return tags;
}

/**
 * Checks that every section of a template closes, in order, and that every tag carries a sign of
 * the syntax. An end tag that closes an outer section while an inner one is open is one error;
 * the inner section counts as closed with it, and its own end tag later counts as matched.
 * @param {string} text - the template.
 * @param {TemplateSyntax} syntax - the syntax.
 * @returns {TemplateProblem[]} the placeholder errors, in the order of the code.
 */
export function checkTemplateSections(text, syntax) {
    const problems = [];
    const openTags = [];
    const closedEarly = [];
    for (const tag of getTemplateTags(text, syntax)) {
        if (tag.kind === 'unknown') problems.push(buildUnknownTagProblem(tag, syntax));
        else if (tag.kind === 'section' || tag.kind === 'inverted') openTags.push(tag);
        else if (tag.kind === 'close') checkEndTag(tag, syntax, openTags, closedEarly, problems);
    }
    for (const tag of openTags) problems.push(buildProblem(tag, `The section ${formatTagText(tag, syntax)} stays open - add ${syntax.formatTag(syntax.closeSign, tag.name)}`));
    return problems.sort((first, second) => first.pos - second.pos);
}

/**
 * Checks one end tag against the open sections and closes what it closes.
 * @param {TemplateTag} tag - the end tag.
 * @param {TemplateSyntax} syntax - the syntax.
 * @param {TemplateTag[]} openTags - the open sections, innermost last; changed in place.
 * @param {string[]} closedEarly - names of sections an outer end tag closed; changed in place.
 * @param {TemplateProblem[]} problems - the errors found so far; changed in place.
 * @returns {void}
 */
function checkEndTag(tag, syntax, openTags, closedEarly, problems) {
    const openIndex = findLastIndex(openTags, open => open.name === tag.name);
    if (openIndex >= 0 && openIndex === openTags.length - 1) { openTags.pop(); return; }
    if (openIndex >= 0) {
        const inner = openTags[openTags.length - 1];
        problems.push(buildProblem(tag, `${formatTagText(tag, syntax)} closes ${formatTagText(openTags[openIndex], syntax)} before the inner section ${formatTagText(inner, syntax)} is closed - add ${syntax.formatTag(syntax.closeSign, inner.name)} first`));
        closedEarly.push(...openTags.splice(openIndex).slice(1).map(open => open.name));
        return;
    }
    const earlyIndex = closedEarly.indexOf(tag.name);
    if (earlyIndex >= 0) { closedEarly.splice(earlyIndex, 1); return; }
    problems.push(buildProblem(tag, `${formatTagText(tag, syntax)} is a stray end tag - remove it or add ${syntax.formatTag(syntax.openSign, tag.name)} before it`));
}

/**
 * Returns the index of the last item of a list that meets a condition.
 * @param {Array<*>} items - the list.
 * @param {function(*): boolean} isMatch - the condition.
 * @returns {number} the index, or -1.
 */
function findLastIndex(items, isMatch) {
    for (let index = items.length - 1; index >= 0; index--) if (isMatch(items[index])) return index;
    return -1;
}

/**
 * Builds the error of a tag whose sign lies outside the syntax.
 * @param {TemplateTag} tag - the tag.
 * @param {TemplateSyntax} syntax - the syntax.
 * @returns {TemplateProblem} the error, naming the tags the syntax knows.
 */
function buildUnknownTagProblem(tag, syntax) {
    const known = Object.keys(syntax.kinds).map(sign => syntax.formatTag(sign, 'name')).join(', ');
    return buildProblem(tag, `Unknown placeholder ${formatTagText(tag, syntax)} - use ${known}`);
}

/**
 * Builds a placeholder error at a tag.
 * @param {TemplateTag} tag - the tag.
 * @param {string} message - the message for the user.
 * @returns {TemplateProblem} the error.
 */
function buildProblem(tag, message) {
    return { pos: tag.start, msg: message, kind: 'error' };
}

/**
 * Formats a tag as it is written.
 * @param {TemplateTag} tag - the tag.
 * @param {TemplateSyntax} syntax - the syntax.
 * @returns {string} the tag's text, e.g. "{{#name}}".
 */
function formatTagText(tag, syntax) {
    return syntax.formatTag(tag.sign, tag.name);
}

/**
 * Formats the label the preview shows for a tag: its sign and name.
 * @param {TemplateTag} tag - the tag.
 * @returns {string} e.g. "name" for a value, "#name" for a section.
 */
export function formatTemplateTagLabel(tag) {
    return tag.sign + tag.name;
}

/**
 * One piece of highlighted HTML: a markup tag, or the HTML of one character of the code.
 * @typedef {object} HighlightPiece
 * @property {string} html - the markup tag, or the character as HTML (an entity or the character).
 * @property {string} text - the character the piece stands for, empty for a markup tag.
 * @property {boolean} isMarkup - true for a markup tag.
 */

/**
 * Colors the template tags in an editor's highlighted code: each tag becomes one span of class
 * "tp". The spans open at the tag are closed before it and opened again after it, so the editor's
 * own highlighting goes on unchanged around the tag.
 * @param {string} html - the highlighted code; its text (entities read as one character) is the code
 *     or a text of the same length with the tags in brace form (convertTemplateTagsToBraces).
 * @param {?TemplateSyntax} syntax - the syntax, or null for plain code.
 * @param {?string} [code=null] - the code as written, when the highlighted text is the brace form; the
 *     tags are found in it and shown as written.
 * @returns {string} the highlighted code with the tags colored; the input as it is when syntax is null.
 */
export function highlightTemplateTags(html, syntax, code = null) {
    if (!syntax) return html;
    const pieces = code === null ? splitHighlightHtml(html) : null;
    const tags = getTemplateTags(code ?? pieces.map(piece => piece.text).join(''), syntax);
    if (!tags.length) return html;
    return removeEmptyMarkup(joinHighlightPieces(pieces ?? splitHighlightHtml(html), tags, code));
}

/**
 * Removes markup pairs that hold no text, which closing and reopening the spans around a tag
 * leaves where a span of the editor ended or started at the tag.
 * @param {string} html - the highlighted code.
 * @returns {string} the highlighted code with every element holding text.
 */
function removeEmptyMarkup(html) {
    const emptyPair = /<(span)(?:\s[^>]*)?><\/\1>/g;
    let result = html, previous;
    do { previous = result; result = result.replace(emptyPair, ''); } while (result !== previous);
    return result;
}

/**
 * Splits highlighted HTML into markup tags and the HTML of single UTF-16 code units (an entity
 * is one piece and stands for its character).
 * @param {string} html - the highlighted code.
 * @returns {HighlightPiece[]} the pieces in order.
 */
function splitHighlightHtml(html) {
    const pieces = [];
    const pattern = /<\/?[A-Za-z][^>]*>|&[#A-Za-z0-9]+;|[\s\S]/g;
    let match;
    while ((match = pattern.exec(html))) {
        const piece = match[0];
        const isMarkup = piece.length > 1 && piece[0] === '<';
        pieces.push({ html: piece, text: isMarkup ? '' : parseHtmlCharacter(piece), isMarkup });
    }
    return pieces;
}

/**
 * Returns the character an HTML character piece stands for.
 * @param {string} html - one code unit or one entity.
 * @returns {string} the character (two code units for a character outside the basic plane).
 */
function parseHtmlCharacter(html) {
    if (html.length === 1 || html[0] !== '&') return html;
    const named = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': '\u00a0' };
    if (named[html]) return named[html];
    const isHex = html[2] === 'x' || html[2] === 'X';
    const code = html[1] === '#' ? parseInt(html.slice(isHex ? 3 : 2, -1), isHex ? 16 : 10) : NaN;
    return Number.isFinite(code) ? String.fromCodePoint(code) : html;
}

/**
 * Joins the pieces of highlighted HTML again, with every tag in one span of class "tp". Markup
 * inside a tag is left out but still tracked, so the spans open at the tag's end are opened again
 * after it.
 * @param {HighlightPiece[]} pieces - the pieces of the highlighted code.
 * @param {TemplateTag[]} tags - the tags, by UTF-16 offsets of the code, in order.
 * @param {?string} code - the code as written, whose tag text the spans show; null to show the
 *     highlighted characters.
 * @returns {string} the HTML.
 */
function joinHighlightPieces(pieces, tags, code) {
    let html = '', offset = 0, tagIndex = 0, tagHtml = '';
    const openSpans = [];
    for (const piece of pieces) {
        const tag = tags[tagIndex];
        if (piece.isMarkup) {
            updateOpenSpans(openSpans, piece.html);
            if (!(tag && offset > tag.start && offset < tag.end)) html += piece.html;
            continue;
        }
        if (tag && offset >= tag.start && offset < tag.end) {
            if (offset === tag.start) html += '</span>'.repeat(openSpans.length);
            tagHtml += piece.html;
            offset += piece.text.length;
            if (offset >= tag.end) {
                const shown = code === null ? tagHtml : escapeTagText(code.slice(tag.start, tag.end));
                html += `<span class="tp">${shown}</span>` + openSpans.join('');
                tagHtml = '';
                tagIndex++;
            }
            continue;
        }
        html += piece.html;
        offset += piece.text.length;
    }
    return html;
}

/**
 * Escapes the text of a tag for HTML.
 * @param {string} text - the tag as written.
 * @returns {string} the text with &, <, > and " as entities.
 */
function escapeTagText(text) {
    return text.replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character]));
}

/**
 * Keeps the list of the markup tags that are open: an opening tag is added, a closing tag
 * removes the last one.
 * @param {string[]} openSpans - the opening tags that are open, innermost last; changed in place.
 * @param {string} markup - one markup tag.
 * @returns {void}
 */
function updateOpenSpans(openSpans, markup) {
    if (markup.startsWith('</')) openSpans.pop();
    else if (!markup.endsWith('/>')) openSpans.push(markup);
}

/**
 * Escapes the tags of a text for a format checker: each tag gives way to a stand-in of the same
 * length, so every offset of the escaped text is the offset of the same place in the text.
 * @param {string} text - the text.
 * @param {?TemplateSyntax} syntax - the syntax, or null for plain text.
 * @param {function(TemplateTag): string} getStandIn - returns the stand-in of a tag, at most as long as
 *     the tag; it is padded with spaces to the tag's length.
 * @returns {string} the escaped text; the input as it is when syntax is null.
 * @throws {RangeError} when a stand-in is longer than its tag.
 */
export function escapeTemplateTags(text, syntax, getStandIn) {
    if (!syntax) return text;
    let result = '', last = 0;
    for (const tag of getTemplateTags(text, syntax)) {
        const length = tag.end - tag.start;
        const standIn = getStandIn(tag);
        if (standIn.length > length) throw new RangeError(`The stand-in "${standIn}" is longer than the tag it stands for`);
        result += text.slice(last, tag.start) + standIn.padEnd(length, ' ');
        last = tag.end;
    }
    return result + text.slice(last);
}

/**
 * Writes every tag of a text in a safe brace form of the same length: {{ and }} around the name,
 * one _ in the place of each sign character ({{#s}} and <<?s>> become {{_s}}, a value {{name}}
 * stays). A format that reads <, > and & as markup (HTML, XML, Markdown) then reads each tag as
 * plain text, at its own offsets. The sign, name and kind of a tag come from getTemplateTags on
 * the text as written.
 * @param {string} text - the text.
 * @param {?TemplateSyntax} syntax - the syntax, or null for plain text.
 * @returns {string} the text with the tags in safe brace form; the input as it is when syntax is null.
 */
export function convertTemplateTagsToBraces(text, syntax) {
    return escapeTemplateTags(text, syntax, tag => `{{${'_'.repeat(tag.sign.length)}${tag.name}}}`);
}

/** The kinds of tags that open or close a section. */
const SECTION_KINDS = new Set(['section', 'inverted', 'close']);

/**
 * Tells whether a text holds section tags only (with spaces around and between them), as a
 * control row or line of a template does.
 * @param {string} text - the text, e.g. one cell or one line.
 * @param {?TemplateSyntax} syntax - the syntax, or null for plain text.
 * @returns {boolean} true when the text holds at least one tag and every tag opens or closes a section.
 */
export function hasOnlySectionTags(text, syntax) {
    const trimmed = text.trim();
    if (!syntax || trimmed[0] !== syntax.firstCharacter) return false;
    const tags = getTemplateTags(trimmed, syntax);
    if (!tags.length || !tags.every(tag => SECTION_KINDS.has(tag.kind))) return false;
    let rest = '', last = 0;
    for (const tag of tags) { rest += trimmed.slice(last, tag.start); last = tag.end; }
    return (rest + trimmed.slice(last)).trim() === '';
}

/**
 * Converts every tag of a text into a run of the letter x of the same length, for a reader that
 * then sees plain text where each tag stands (highlighting under the tag colors, reading the
 * context of a tag).
 * @param {string} text - the text.
 * @param {?TemplateSyntax} syntax - the syntax, or null for plain text.
 * @returns {string} the text with each tag as letters; the input as it is when syntax is null.
 */
export function convertTemplateTagsToLetters(text, syntax) {
    return escapeTemplateTags(text, syntax, tag => 'x'.repeat(tag.end - tag.start));
}

/**
 * Escapes a text for its place in a format and keeps its template tags as written, so a tag in a
 * value or text stays a tag when an editor writes the text back.
 * @param {string} text - the text.
 * @param {?TemplateSyntax} syntax - the syntax, or null for plain text.
 * @param {function(string): string} escape - escapes a piece of text for its place.
 * @returns {string} the escaped text with every tag as written.
 */
export function escapeTextOutsideTemplateTags(text, syntax, escape) {
    if (!syntax) return escape(text);
    let result = '', last = 0;
    for (const tag of getTemplateTags(text, syntax)) {
        result += escape(text.slice(last, tag.start)) + text.slice(tag.start, tag.end);
        last = tag.end;
    }
    return result + escape(text.slice(last));
}

/**
 * Escapes the tags of a math formula for KaTeX: a value becomes its boxed name in a group (so it
 * can stand after ^ or _ like the value would), the other tags an empty group, so the formula
 * holds plain math.
 * @param {string} tex - the math code.
 * @param {?TemplateSyntax} syntax - the syntax, or null for plain math.
 * @returns {string} the math code with every tag replaced; the input as it is when syntax is null.
 */
export function escapeTemplateTagsForKatex(tex, syntax) {
    if (!syntax) return tex;
    let result = '', last = 0;
    for (const tag of getTemplateTags(tex, syntax)) {
        result += tex.slice(last, tag.start) + (tag.kind === 'value' ? `{\\boxed{\\text{${tag.name.replace(/_/g, '\\_')}}}}` : '{}');
        last = tag.end;
    }
    return result + tex.slice(last);
}

/** The characters of a tag that KaTeX's \text reads as commands, written as text. */
const KATEX_TEXT_CHARACTERS = { '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '#': '\\#', '$': '\\$', '%': '\\%', '&': '\\&', '_': '\\_', '^': '\\textasciicircum{}', '~': '\\textasciitilde{}' };

/**
 * Escapes a text for KaTeX's \text: each character that \text reads as a command becomes the
 * command that prints it.
 * @param {string} text - the text.
 * @returns {string} the text as KaTeX code for \text{…}.
 */
export function escapeKatexText(text) {
    return text.replace(/[\\{}#$%&_^~]/g, character => KATEX_TEXT_CHARACTERS[character]);
}

/**
 * Escapes the tags of a math formula for KaTeX as text: every tag becomes its own text as
 * written in a group (so it can stand after ^ or _ like a value would), and the formula holds
 * plain math.
 * @param {string} tex - the math code.
 * @param {?TemplateSyntax} syntax - the syntax, or null for plain math.
 * @returns {string} the math code with every tag as \text{…}; the input as it is when syntax is null.
 */
export function escapeTemplateTagsAsKatexText(tex, syntax) {
    if (!syntax) return tex;
    let result = '', last = 0;
    for (const tag of getTemplateTags(tex, syntax)) {
        result += tex.slice(last, tag.start) + `{\\text{${escapeKatexText(tex.slice(tag.start, tag.end))}}}`;
        last = tag.end;
    }
    return result + tex.slice(last);
}

/**
 * Builds highlighted code with every tag as written: the highlighting was made on a text of the
 * same length with the tags in brace form (convertTemplateTagsToBraces), and the characters of
 * each tag are put back as the code holds them, inside the spans the highlighting gave them.
 * @param {string} html - the highlighted brace form.
 * @param {?TemplateSyntax} syntax - the syntax, or null for plain code.
 * @param {string} code - the code as written.
 * @returns {string} the highlighted code with the tags as written; the input as it is when syntax is null.
 */
export function buildHighlightWithTemplateTags(html, syntax, code) {
    if (!syntax) return html;
    const tags = getTemplateTags(code, syntax);
    if (!tags.length) return html;
    let result = '', offset = 0, tagIndex = 0;
    for (const piece of splitHighlightHtml(html)) {
        if (piece.isMarkup) { result += piece.html; continue; }
        while (tagIndex < tags.length && tags[tagIndex].end <= offset) tagIndex++;
        const tag = tags[tagIndex];
        const isInTag = Boolean(tag) && offset >= tag.start && offset < tag.end;
        result += isInTag ? escapeTagText(code.slice(offset, offset + piece.text.length)) : piece.html;
        offset += piece.text.length;
    }
    return result;
}
