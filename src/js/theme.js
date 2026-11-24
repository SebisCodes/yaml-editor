/**
 * Color theme: light, dark or following the system setting (auto). Loaded in the page head so
 * the chosen theme applies from the first paint.
 *
 * A page that embeds the editor can fix the theme with ?theme=light|dark|auto: it holds for
 * this page load, the stored choice stays as it is, and the theme switch in the bar is hidden.
 * Any other value is ignored. The viewer (?viewer=1) runs on a storage in memory, set here
 * before any other script: stored documents are neither shown nor changed, nothing is stored.
 * The height of the top bar is kept in --header-height for the work area below it.
 *
 * On the editor page (its script tag carries data-editor-page) it marks how the page is
 * opened, before the first paint: data-opened on the root, which sync.js reads,
 * and the classes embedded (inside a page that embeds the editor, and in the viewer) and
 * own-window (its own window opened by a page), which hide the way back to the overview and
 * the footer. With ?template=mustache or ?template=angle it marks data-template on the root,
 * which shows the controls of template placeholders. The legal pages and the developer page load
 * this file too and stay unmarked.
 *
 * Steps when the file runs:
 *   1. mark how the page is opened, and swap in the storage in memory for the viewer;
 *   2. take a theme the address fixes;
 *   3. show the theme, and again with the buttons once the page is there;
 *   4. store and show a theme the user picks, unless the address fixed one.
 */
(function () {
    var KEY = 'yamleditor.theme';
    var root = document.documentElement;
    var HEADER_HEIGHT = '--header-height';
    var EDITOR_PAGE = 'data-editor-page';
    var OPENED = 'data-opened';
    var OPENED_IN_FRAME = 'frame';
    var OPENED_WITH_EMBED = 'embed';
    var OPENED_AS_WINDOW = 'window';
    var EMBED_PARAMETER = 'embed';
    var EMBED_IN_WINDOW = 'window';
    var VIEWER_PARAMETER = 'viewer';
    var VIEWER_ON = '1';
    var EMBEDDED_CLASS = 'embedded';
    var OWN_WINDOW_CLASS = 'own-window';
    var TEMPLATE_PARAMETER = 'template';
    var TEMPLATE_SYNTAXES = ['mustache', 'angle'];
    var TEMPLATE_ATTRIBUTE = 'data-template';
    var fixed = null;
    var stored = null;
    try { stored = window.localStorage; } catch (e) { /* storage blocked */ }
    try {
        var query = new URLSearchParams(location.search);
        if (document.currentScript && document.currentScript.hasAttribute(EDITOR_PAGE)) { setOpenedState(query); setTemplateState(query); }
        if (query.get(VIEWER_PARAMETER) === VIEWER_ON) {
            root.classList.add('viewer');
            if (!/^#.*=/.test(location.hash)) root.classList.add('viewer-empty');
            Object.defineProperty(window, 'localStorage', { configurable: true, value: createMemoryStorage() });
        }
        var asked = query.get('theme');
        if (asked === 'light' || asked === 'dark' || asked === 'auto') fixed = asked;
    } catch (e) { /* no parameters */ }
    if (fixed) root.setAttribute('data-theme-fixed', fixed);

    /**
     * Creates a storage in memory with the methods of localStorage (the Storage interface):
     * what the viewer stores is gone with the page.
     * @returns {object} the storage.
     */
    function createMemoryStorage() {
        var memory = new Map();
        return {
            /**
             * Returns the value of a key.
             * @param {string} key - the key.
             * @returns {string|null} the value, null when there is none.
             */
            getItem: function (key) { return memory.has(String(key)) ? memory.get(String(key)) : null; },
            /**
             * Sets the value of a key.
             * @param {string} key - the key.
             * @param {string} value - the value.
             * @returns {void}
             */
            setItem: function (key, value) { memory.set(String(key), String(value)); },
            /**
             * Removes a key.
             * @param {string} key - the key.
             * @returns {void}
             */
            removeItem: function (key) { memory.delete(String(key)); },
            /**
             * Removes every key.
             * @returns {void}
             */
            clear: function () { memory.clear(); },
            /**
             * Returns the key at a place.
             * @param {number} index - the place.
             * @returns {string|null} the key, null past the end.
             */
            key: function (index) { return Array.from(memory.keys())[index] || null; },
            /**
             * Returns the number of keys.
             * @returns {number} the number.
             */
            get length() { return memory.size; },
        };
    }

    /**
     * Returns how the editor page is opened; sync.js takes "embed" and "window" from data-opened,
     * so both follow these conditions (the frame it checks itself, as window.parent).
     * @param {URLSearchParams} query - the parameters of the page's address.
     * @returns {string} "frame" inside an iframe, "embed" with ?embed= (any value but window),
     *   "window" as its own window opened by a page (?embed=window with an opener), "" as its own site.
     */
    function getOpenedAs(query) {
        if (window.parent !== window) return OPENED_IN_FRAME;
        if (query.get(EMBED_PARAMETER) === EMBED_IN_WINDOW) return window.opener ? OPENED_AS_WINDOW : '';
        return query.has(EMBED_PARAMETER) ? OPENED_WITH_EMBED : '';
    }

    /**
     * Marks the editor page with the template syntax of ?template= (data-template on the root), so
     * the controls of template placeholders are there from the first paint; any other value
     * leaves the page unmarked.
     * @param {URLSearchParams} query - the parameters of the page's address.
     * @returns {void}
     */
    function setTemplateState(query) {
        var syntax = query.get(TEMPLATE_PARAMETER);
        root.removeAttribute(TEMPLATE_ATTRIBUTE);
        if (TEMPLATE_SYNTAXES.indexOf(syntax) >= 0) root.setAttribute(TEMPLATE_ATTRIBUTE, syntax);
    }

    /**
     * Sets how the editor page is opened: data-opened (only ever from the address and the window,
     * never from the HTML), the class embedded inside a page that embeds the editor and in the
     * viewer, own-window in its own window.
     * @param {URLSearchParams} query - the parameters of the page's address.
     * @returns {void}
     */
    function setOpenedState(query) {
        var openedAs = getOpenedAs(query);
        root.removeAttribute(OPENED);
        if (openedAs) root.setAttribute(OPENED, openedAs);
        if (openedAs === OPENED_IN_FRAME || openedAs === OPENED_WITH_EMBED || query.get(VIEWER_PARAMETER) === VIEWER_ON) root.classList.add(EMBEDDED_CLASS);
        if (openedAs === OPENED_AS_WINDOW) root.classList.add(OWN_WINDOW_CLASS);
    }

    /**
     * Returns the theme in force: the one the page fixed, else the stored choice, else auto.
     * @returns {string} "light", "dark" or "auto".
     */
    function getTheme() {
        if (fixed) return fixed;
        try { return stored.getItem(KEY) || 'auto'; } catch (e) { return 'auto'; }
    }

    /**
     * Shows a theme on the page and marks its button in the theme switch.
     * @param {string} theme - "light", "dark" or "auto" (follows the system setting).
     * @returns {void}
     */
    function showTheme(theme) {
        if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
        else root.removeAttribute('data-theme');
        var buttons = document.querySelectorAll('[data-theme-set]');
        for (var index = 0; index < buttons.length; index++) {
            buttons[index].setAttribute('aria-checked', String(buttons[index].getAttribute('data-theme-set') === theme));
        }
    }

    /**
     * Keeps the height of the top bar in --header-height, so the work area fills the screen
     * below it whether the bar takes one row or more.
     * @returns {void}
     */
    function watchHeaderHeight() {
        var header = document.querySelector('.header');
        if (!header || !window.ResizeObserver) return;
        new ResizeObserver(function () {
            root.style.setProperty(HEADER_HEIGHT, Math.round(header.getBoundingClientRect().height) + 'px');
        }).observe(header);
    }

    showTheme(getTheme());
    document.addEventListener('DOMContentLoaded', startThemeSwitch);

    /**
     * Shows the theme again once the page is read, follows the height of the top bar and
     * connects the theme switch, or hides it when the page fixed the theme.
     * @returns {void}
     */
    function startThemeSwitch() {
        showTheme(getTheme());
        watchHeaderHeight();
        if (fixed) { hideThemeSwitch(); return; }
        document.addEventListener('click', saveChosenTheme);
    }

    /**
     * Hides the theme switch (the page fixed the theme).
     * @returns {void}
     */
    function hideThemeSwitch() {
        var buttons = document.querySelectorAll('[data-theme-set]');
        for (var index = 0; index < buttons.length; index++) (buttons[index].closest('.schema') || buttons[index]).style.display = 'none';
    }

    /**
     * Stores and shows the theme of a clicked theme button (a click handler); without storage
     * the choice lasts until the page is reloaded.
     * @param {MouseEvent} event - the click.
     * @returns {void}
     */
    function saveChosenTheme(event) {
        var button = event.target.closest && event.target.closest('[data-theme-set]');
        if (!button) return;
        var theme = button.getAttribute('data-theme-set');
        try { localStorage.setItem(KEY, theme); } catch (err) { /* the choice lasts until the page is reloaded */ }
        showTheme(theme);
    }
})();
