/**
 * Interface language: English (the language of the code) or one of the
 * language packs. The server (src/php/page.php) serves each page in its
 * language, with its <html lang> and the language menu, from the shared
 * language packs (giit-editors-lang); this file translates the interface of
 * the editor in the browser.
 *
 * The interface is written in English. In the other languages, the visible
 * texts of the interface are translated at run time from dictionaries:
 *   text      exact texts (a text node, a title, a placeholder …), also each
 *             line of a multi-line title
 *   html      whole elements with markup (help, steps), keyed by their
 *             innerHTML with runs of white space as one space; an element
 *             that holds such a translation already is left as it is
 *   patterns  [regular expression, replacement] for texts with names or
 *             numbers in them ("Saved on example.com at HH:MM")
 * The packs of a language are served from /lang/<code>/: common.js holds what
 * all editors share (sync.js, aistatus.js, dialogs), <editor>.js what only
 * this editor has.
 *
 * Only the interface is translated: the bar, the work area, the dialogs and
 * the messages (roots). Never translated: code, the preview, form fields,
 * anything inside [data-no-i18n] (the user's documents, file names, what a
 * page tells the AI) and the page text below the editor, which the server
 * brings translated. The AI prompt is built in JavaScript and copied, so it
 * stays English.
 *
 * createI18n() runs these steps:
 *   1. find the language: the page's <html lang>;
 *   2. remove a language stored in the browser (<prefix>.lang): it is not a pick;
 *   3. on a page in another language than English, load the dictionaries,
 *      translate the interface and keep translating what the scripts change.
 *
 * The file holds one topic, the interface language, and is longer than the
 * guide value of 300 lines: the language choice and the translation share the
 * page's language and stay one shared file, loaded by app.js as i18n.js.
 * The same file serves every giit editor.
 */

/** The attributes whose texts are translated. */
const TRANSLATED_ATTRIBUTES = ['title', 'aria-label', 'placeholder', 'data-title', 'alt', 'label'];
const NEVER_SELECTOR = '[data-no-i18n]';                                                     // nothing in there, not even titles
const NO_TEXT_SELECTOR = 'script, style, textarea, code, pre, [contenteditable="true"]';    // their titles and placeholders, not their text
/** Relative links in an element: a language page one folder down writes them with ../ in front. */
const RELATIVE_LINK = /\b(href|src)="(?!https?:|\/|#|mailto:|data:|javascript:)/g;
const PARENT_LINK = /\b(href|src)="\.\.\//g;
const SPACE_RUN = /\s+/g;
const BUTTON_INPUT_TYPE = /^(button|submit)$/;
const DEFAULT_LANGUAGE = 'en';
/** The languages of the packs; another <html lang> is taken as English. */
const LANGUAGES = ['en', 'de', 'fr', 'it', 'es', 'pt', 'nl', 'pl', 'tr', 'ru', 'uk', 'zh', 'ja', 'ko'];
const LANGUAGE_CODE_LENGTH = 2;
/** The end of the storage key of a language stored in the browser; it is not a pick and is removed. */
const STORAGE_SUFFIX = '.lang';
/** The end of the message prefix; the rest is the editor's key, the name of its pack file. */
const PREFIX_SUFFIX = 'editor';
/** Where the server serves the packs: /lang/<code>/<file>.js. */
const PACK_FOLDER = '/lang/';
const TRANSLATING_CLASS = 'translate';                     // on <html> while the dictionaries load
const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

/**
 * What the editor hands to createI18n().
 * @typedef {Object} I18nOptions
 * @property {string} prefix - the message prefix of the editor ("latexeditor" …), the start of the storage key.
 * @property {string} roots - CSS selector of the interface to translate.
 * @property {string} [skip] - further selectors with the user's content, never translated.
 */

/**
 * What createI18n() gives back at once; the translated texts arrive with the dictionaries a moment later.
 * @typedef {Object} I18n
 * @property {string} lang - the language code of the page.
 * @property {function(string): string} translate - translates an interface text, or returns it as it is.
 * @property {Promise<void>} ready - settles when the dictionaries are loaded and applied (or could not be loaded).
 */

/**
 * A language pack file: the default export of /lang/<code>/common.js or <editor>.js.
 * @typedef {Object} Dictionary
 * @property {Object<string, string>} [text] - exact texts.
 * @property {Object<string, string>} [html] - whole elements with markup, keyed by their innerHTML.
 * @property {Array<Array<string>>} [patterns] - [regular expression, replacement] pairs.
 */

/**
 * Sets up the interface language of an editor page.
 * @param {I18nOptions} options - the editor's prefix, the interface roots and the selectors to skip.
 * @returns {I18n} the language, the translation function and the promise of the dictionaries.
 */
export function createI18n({ prefix, roots, skip = '' }) {
    const language = getPageLanguage();
    removeStoredLanguage(prefix + STORAGE_SUFFIX);
    const i18n = { lang: language, translate: text => text, ready: Promise.resolve() };
    if (language === DEFAULT_LANGUAGE) return i18n;
    const translator = createTranslator(language, prefix.slice(0, -PREFIX_SUFFIX.length), roots, skip);
    i18n.translate = translator.translate;
    i18n.ready = translator.ready;
    return i18n;
}

/**
 * Returns the language of the page from its <html lang>.
 * @returns {string} the language code, English for a language without a pack.
 */
function getPageLanguage() {
    const pageLanguage = (document.documentElement.lang || DEFAULT_LANGUAGE).toLowerCase().slice(0, LANGUAGE_CODE_LENGTH);
    return LANGUAGES.includes(pageLanguage) ? pageLanguage : DEFAULT_LANGUAGE;
}

/**
 * Removes a language stored in the browser under the editor's key: such a value is
 * not a pick, the cookie lang the server sets on a pick is. Removing it is harmless anywhere, so
 * it runs in a page inside another page too.
 * @param {string} storageKey - the storage key of the stored language.
 * @returns {void}
 */
function removeStoredLanguage(storageKey) {
    try { localStorage.removeItem(storageKey); } catch (error) { /* storage blocked */ }
}

/**
 * Returns a text with every run of white space as one space, trimmed.
 * @param {string} text - the text.
 * @returns {string} the tidied text.
 */
function formatSpace(text) {
    return text.replace(SPACE_RUN, ' ').trim();
}

/**
 * Returns markup with its relative links as the English page writes them (without ../ in front).
 * @param {string} markup - HTML text.
 * @returns {string} the markup with the links of the English page.
 */
function convertToEnglishLinks(markup) {
    return markup.replace(PARENT_LINK, '$1="');
}

/**
 * Sets up the translation of the interface of a page in another language than English: loads
 * the dictionaries, translates what is there and keeps translating what the scripts add or
 * change. Like every initializeX function it returns the object the editor talks to it through.
 * @param {string} language - the language code of the page.
 * @param {string} editor - the editor's key, the name of its pack file ("latex" …).
 * @param {string} roots - CSS selector of the interface.
 * @param {string} skip - further selectors never translated, may be empty.
 * @returns {{translate: function(string): string, ready: Promise<void>}} the translation function and the promise of the dictionaries.
 */
function createTranslator(language, editor, roots, skip) {
    const neverSelector = skip ? NEVER_SELECTOR + ', ' + skip : NEVER_SELECTOR;
    const isLanguageFolder = location.pathname.split('/').filter(Boolean).length > 0 && location.pathname.endsWith('/');   // a language page in /<code>/
    const noTextSelector = NO_TEXT_SELECTOR + ', ' + neverSelector;
    const exactTexts = new Map(), markupTexts = new Map(), patterns = [];
    const translatedMarkup = new Set();       // the html translations: an element holding one is translated
    const translatedTexts = new Set();        // translated texts: translating them again does nothing
    document.documentElement.classList.add(TRANSLATING_CLASS);
    const ready = importDictionaries();
    return { translate, ready };

    /**
     * Translates an interface text: exact texts first, then the patterns; each line of a
     * multi-line text on its own. The white space around the text is kept. Each translation
     * given is noted, so a translated text passed again comes back as it is (a cache no caller
     * sees).
     * @param {string} text - the text.
     * @returns {string} the translation, or the text as it is when there is none.
     */
    function translate(text) {
        if (typeof text !== 'string' || !text) return text;
        if (text.includes('\n')) return text.split('\n').map(translate).join('\n');
        const core = text.trim();
        if (!core || translatedTexts.has(core)) return text;
        const translation = getTranslation(core);
        if (translation === undefined) return text;
        translatedTexts.add(translation);
        return text.replace(core, () => translation);
    }

    /**
     * Returns the dictionary translation of a trimmed text.
     * @param {string} core - the text without surrounding white space.
     * @returns {string|undefined} the translation, undefined when no exact text or pattern matches.
     */
    function getTranslation(core) {
        const exact = exactTexts.get(core);
        if (exact !== undefined) return exact;
        for (const [pattern, replacement] of patterns) if (pattern.test(core)) return core.replace(pattern, replacement);
        return undefined;
    }

    /**
     * Tells whether an element is inside a part that is never translated.
     * @param {Element} element - the element.
     * @returns {boolean} true inside [data-no-i18n] or a skipped selector.
     */
    function isSkipped(element) {
        return !!element.closest(neverSelector);
    }

    /**
     * Tells whether an element belongs to the interface.
     * @param {Element} element - the element.
     * @returns {boolean} true inside one of the roots.
     */
    function isInInterface(element) {
        return !!element.closest(roots);
    }

    /**
     * Translates an element of the interface with its attributes, its markup or its text nodes and children.
     * @param {Node} element - the element; other nodes are left alone.
     * @returns {void}
     */
    function translateElement(element) {
        if (!(element instanceof Element) || isSkipped(element) || !isInInterface(element)) return;
        if (element.matches(roots) && !element.hasAttribute('lang')) element.setAttribute('lang', language);
        for (const name of TRANSLATED_ATTRIBUTES) translateAttribute(element, name);
        translateButtonValue(element);
        if (markupTexts.size && element.firstElementChild && translateMarkup(element)) return;
        if (element.closest(NO_TEXT_SELECTOR)) return;
        for (const child of [...element.childNodes]) {
            if (child.nodeType === TEXT_NODE) translateTextNode(child);
            else if (child.nodeType === ELEMENT_NODE) translateElement(child);
        }
    }

    /**
     * Translates one attribute of an element when it has a text.
     * @param {Element} element - the element.
     * @param {string} name - the attribute name.
     * @returns {void}
     */
    function translateAttribute(element, name) {
        const value = element.getAttribute(name);
        if (!value) return;
        const translation = translate(value);
        if (translation !== value) element.setAttribute(name, translation);
    }

    /**
     * Translates the label of a button input (type button or submit).
     * @param {Element} element - the element.
     * @returns {void}
     */
    function translateButtonValue(element) {
        if (element.tagName !== 'INPUT' || !BUTTON_INPUT_TYPE.test(element.type) || !element.value) return;
        const translation = translate(element.value);
        if (translation !== element.value) element.value = translation;
    }

    /**
     * Gives an element the markup translation of its content, when the dictionaries have one.
     * @param {Element} element - an element with child elements.
     * @returns {boolean} true when the element holds a markup translation (it had one or got one);
     *     the caller then leaves its content alone.
     */
    function translateMarkup(element) {
        const inner = convertToEnglishLinks(formatSpace(element.innerHTML));
        if (translatedMarkup.has(inner)) return true;
        const translation = markupTexts.get(inner);
        if (translation === undefined) return false;
        element.innerHTML = isLanguageFolder ? translation.replace(RELATIVE_LINK, '$1="../') : translation;
        translatedTexts.add(formatSpace(element.textContent));
        return true;
    }

    /**
     * Translates a text node of the interface.
     * @param {Text} node - the text node.
     * @returns {void}
     */
    function translateTextNode(node) {
        const parent = node.parentElement;
        if (!parent || parent.closest(noTextSelector) || !isInInterface(parent)) return;
        const value = node.nodeValue, translation = translate(value);
        if (translation !== value) node.nodeValue = translation;
    }

    /**
     * Loads the language pack of the page, translates the interface and watches it for changes.
     * The dictionaries carry the version of this file (app.js imports i18n.js?v=N), so a new
     * version reaches them too. Without the dictionaries the interface stays English.
     * @returns {Promise<void>} settles when the interface is translated or the pack could not be loaded.
     */
    function importDictionaries() {
        const version = new URL(import.meta.url).search;
        return Promise.all([import(`${PACK_FOLDER}${language}/common.js` + version), import(`${PACK_FOLDER}${language}/${editor}.js` + version)])
            .then(modules => {
                for (const { default: dictionary } of modules) addDictionary(dictionary);
                document.querySelectorAll(roots).forEach(translateElement);
                watchInterface();
            })
            .catch(() => { /* without the dictionaries the interface stays English */ })
            .finally(() => document.documentElement.classList.remove(TRANSLATING_CLASS));
    }

    /**
     * Adds the texts, markup and patterns of one language pack file.
     * @param {Dictionary} dictionary - the pack file's default export.
     * @returns {void}
     */
    function addDictionary(dictionary) {
        for (const [key, value] of Object.entries(dictionary.text || {})) exactTexts.set(formatSpace(key), value);
        for (const [key, value] of Object.entries(dictionary.html || {})) addMarkupText(key, value);
        for (const [pattern, replacement] of dictionary.patterns || []) patterns.push([new RegExp(pattern), replacement]);
    }

    /**
     * Adds one markup translation, and the translation as the browser writes it back,
     * which is the way it is compared with innerHTML.
     * @param {string} key - the English markup.
     * @param {string} value - the translated markup.
     * @returns {void}
     */
    function addMarkupText(key, value) {
        markupTexts.set(convertToEnglishLinks(formatSpace(key)), convertToEnglishLinks(value));
        const parsed = document.createElement('template');
        parsed.innerHTML = convertToEnglishLinks(value);
        translatedMarkup.add(convertToEnglishLinks(formatSpace(parsed.innerHTML)));
    }

    /**
     * Translates whatever the scripts add to the page or change in it from here on.
     * @returns {void}
     */
    function watchInterface() {
        new MutationObserver(translateMutations).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: TRANSLATED_ATTRIBUTES });
    }

    /**
     * Translates the nodes and attributes of a batch of changes.
     * @param {MutationRecord[]} mutations - the changes.
     * @returns {void}
     */
    function translateMutations(mutations) {
        for (const mutation of mutations) {
            if (mutation.type === 'characterData') translateTextNode(mutation.target);
            else if (mutation.type === 'attributes') { if (mutation.target instanceof Element) translateAttribute(mutation.target, mutation.attributeName); }
            else for (const node of mutation.addedNodes) { if (node.nodeType === TEXT_NODE) translateTextNode(node); else translateElement(node); }
        }
    }
}
