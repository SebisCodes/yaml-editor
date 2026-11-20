/**
 * Language menu of every page (select.lang-menu, written by the server in src/php/page.php):
 * a choice opens the address of its option (data-href), the same page in that language. The
 * address carries ?setlang=<code>, so the server keeps the pick in the cookie lang. A page
 * inside another page (in a frame, or with embed or viewer in its address) keeps its
 * parameters, takes the language as ?lang=<code> and picks nothing. The same file in every
 * editor.
 *
 * startLanguageMenu() runs these steps:
 *   1. find the language select; without one the page has no menu;
 *   2. on a choice, open the page in that language.
 */

/**
 * Runs the menu in a scope of its own, so its names stay out of the page's global scope.
 * @returns {void}
 */
(function () {
    var LANGUAGE_SELECT = 'select.lang-menu';
    var PAGE_ADDRESS_ATTRIBUTE = 'data-href';
    var EMBEDDING_PARAMETERS = ['embed', 'viewer'];

    startLanguageMenu();

    /**
     * Starts the menu: a choice opens the page in the chosen language.
     * @returns {void}
     */
    function startLanguageMenu() {
        var languageSelect = document.querySelector(LANGUAGE_SELECT);
        if (!languageSelect) return;
        languageSelect.addEventListener('change', function () { openChosenLanguage(languageSelect); });
    }

    /**
     * Opens the page in the language of the chosen option.
     * @param {HTMLSelectElement} languageSelect - the language menu.
     * @returns {void}
     */
    function openChosenLanguage(languageSelect) {
        var chosenOption = languageSelect.options[languageSelect.selectedIndex];
        if (isInsideAnotherPage()) location.href = buildEmbeddedAddress(chosenOption.value);
        else location.href = buildPickAddress(chosenOption.getAttribute(PAGE_ADDRESS_ATTRIBUTE));
    }

    /**
     * Builds the address of a pick: the option's address with the other parameters of this page
     * and its hash.
     * @param {string} optionAddress - the option's address, e.g. "/de/?setlang=de".
     * @returns {string} the address.
     */
    function buildPickAddress(optionAddress) {
        var target = new URL(optionAddress, location.href);
        new URLSearchParams(location.search).forEach(function (value, name) {
            if (name !== 'lang' && name !== 'setlang') target.searchParams.append(name, value);
        });
        return target.pathname + target.search + location.hash;
    }

    /**
     * Tells whether the page runs inside another page: in a frame, or with embed or viewer in the address.
     * @returns {boolean} true inside another page.
     */
    function isInsideAnotherPage() {
        var query = new URLSearchParams(location.search);
        return window.parent !== window || EMBEDDING_PARAMETERS.some(function (name) { return query.has(name); });
    }

    /**
     * Builds the address of this page inside another page in a language: the same path and
     * parameters with ?lang=<code>.
     * @param {string} language - the chosen language code.
     * @returns {string} the address.
     */
    function buildEmbeddedAddress(language) {
        var query = new URLSearchParams(location.search);
        query.set('lang', language);
        return location.pathname + '?' + query.toString() + location.hash;
    }
})();
