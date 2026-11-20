/**
 * Wrapping long lines in the code view. A line of the
 * code stays one line - its number, the text, what is saved - and is only shown
 * on several rows, as in Notepad. The textarea and the layers drawn over it
 * (highlighting, problem marks) wrap with the same rules at the same width; the
 * rows each line takes are measured here, so the editor can place the line
 * numbers, the band of the cursor's line and anything else drawn per line.
 *
 * createWrap() runs these steps:
 *   1. read the remembered choice (<prefix>.wrap);
 *   2. style the textarea, the layers and the button for that choice;
 *   3. switch on the button and on Alt+Z;
 *   4. measure the rows again whenever the textarea gets a new width.
 *
 * onChange() asks the editor to draw the code again (switched, or a new width).
 * The file holds one topic, the wrapped rows of the code view, and is longer
 * than the guide value of 300 lines because every step documents itself.
 * The same file serves every giit editor.
 */

const WRAPPED_STYLE = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'normal' };
const STORAGE_SUFFIX = '.wrap';
const STORED_ON = '1';
const STORED_OFF = '0';
const DEFAULT_LINE_HEIGHT = 20;          // pixels per row
const PROBE_LENGTH = 200;                // characters measured for the width of one character
const FALLBACK_CHARACTER_WIDTH = 8;      // pixels, when the probe has no width
const ROW_CACHE_LIMIT = 20000;           // measured lines kept; one more empties the cache
const MIRROR_LEFT = '-100000px';         // the measuring box sits far off the screen
const PRESSED_CLASS = 'on';
const SWITCH_KEY_CODE = 'KeyZ';

/**
 * What the editor hands to createWrap().
 * @typedef {Object} WrapOptions
 * @property {string} prefix - the message prefix of the editor ("latexeditor", "svgeditor" …), the start of the storage key.
 * @property {HTMLTextAreaElement} ta - the code's textarea.
 * @property {HTMLElement[]} [layers] - the layers drawn over the textarea (highlighting, problem marks).
 * @property {HTMLElement|null} [gutter] - the element that shows the line numbers, or null when the editor draws them itself.
 * @property {HTMLElement|null} [button] - the Wrap button, or null.
 * @property {number} [lineH] - the height of one row in pixels.
 * @property {function(): void} [onChange] - asks the editor to draw the code again.
 */

/**
 * What createWrap() gives back to the editor.
 * @typedef {Object} LineWrap
 * @property {boolean} on - whether lines are wrapped (read only).
 * @property {function((string|string[])): void} update - measures the rows of every line and writes the gutter.
 * @property {function(number): number} getLineTop - where a line starts, in pixels below the first row.
 * @property {function(number): number} getLineHeight - how high a line is, in pixels.
 * @property {function(number): number} getLineAt - the line at a height in pixels below the first row.
 * @property {function(number, number): string} getLineNumbers - the gutter text of a range of lines.
 * @property {function(boolean): void} set - switches wrapping on or off.
 */

/**
 * Sets up line wrapping for the code view of an editor.
 * @param {WrapOptions} options - the textarea, its layers, gutter and button, the row height and the redraw callback.
 * @returns {LineWrap} the wrapping state and the measures of the lines.
 */
export function createWrap({ prefix, ta, layers = [], gutter = null, button = null, lineH = DEFAULT_LINE_HEIGHT, onChange = () => {} }) {
    const storageKey = prefix + STORAGE_SUFFIX;
    let isOn = readStoredChoice();
    let rowTops = null;                 // while on: rowTops[lineIndex] = rows above that line
    let lineCount = 0;                  // lines at the last update
    let measuredWidth = 0;              // the textarea width the rows were measured for
    let textWidth = 0;                  // the width of the text box inside the padding
    let rowColumns = 0;                 // characters of the probe that fit in one row
    const rowCache = new Map();         // line text -> rows at the measured width
    let mirror = null;
    let gutterText = '';                // what the gutter shows

    showWrapState();
    button?.addEventListener('click', applyWrapSwitch);
    addEventListener('keydown', handleWrapShortcut);
    new ResizeObserver(updateOnResize).observe(ta);
    return {
        get on() { return isOn; },
        update, getLineTop, getLineHeight, getLineAt, getLineNumbers, set,
    };

    /**
     * Returns the remembered choice.
     * @returns {boolean} true when the stored choice is on; false also when storage is blocked.
     */
    function readStoredChoice() {
        try { return localStorage.getItem(storageKey) === STORED_ON; } catch (error) { return false; }
    }

    /**
     * Styles the textarea, the layers and the button for the current choice.
     * The layers take the textarea's width as measured ahead of its own style change.
     * @returns {void}
     */
    function showWrapState() {
        const layerWidth = isOn ? ta.clientWidth + 'px' : '';
        ta.wrap = isOn ? 'soft' : 'off';
        for (const element of [ta, ...layers]) setWrappedStyle(element);
        for (const layer of layers) setLayerBox(layer, layerWidth);
        if (isOn) ta.scrollLeft = 0;
        showButtonState();
    }

    /**
     * Sets or clears the white space rules of wrapped text on one element.
     * @param {HTMLElement} element - the textarea or a layer.
     * @returns {void}
     */
    function setWrappedStyle(element) {
        for (const property in WRAPPED_STYLE) element.style[property] = isOn ? WRAPPED_STYLE[property] : '';
    }

    /**
     * Gives a layer the textarea's width while wrapping, or its own size again.
     * @param {HTMLElement} layer - a layer over the textarea.
     * @param {string} layerWidth - the width as a CSS length, empty when off.
     * @returns {void}
     */
    function setLayerBox(layer, layerWidth) {
        layer.style.boxSizing = isOn ? 'border-box' : '';
        layer.style.width = layerWidth;
        layer.style.minWidth = isOn ? '0' : '';
    }

    /**
     * Shows the choice on the Wrap button, when there is one.
     * @returns {void}
     */
    function showButtonState() {
        if (!button) return;
        button.classList.toggle(PRESSED_CLASS, isOn);
        button.setAttribute('aria-pressed', String(isOn));
    }

    /**
     * Measures the text box of the textarea: its inner width and how many characters fit in a row.
     * @returns {void}
     */
    function updateTextBoxSize() {
        const style = getComputedStyle(ta);
        textWidth = ta.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        if (!mirror) addMirror();
        setMirrorFont(style);
        rowColumns = getRowColumns();
    }

    /**
     * Adds the hidden copy of the textarea's text box: it holds one div per line to measure.
     * @returns {void}
     */
    function addMirror() {
        mirror = document.createElement('div');
        mirror.setAttribute('aria-hidden', 'true');
        mirror.setAttribute('data-no-i18n', '');
        Object.assign(mirror.style, { position: 'absolute', left: MIRROR_LEFT, top: '0', visibility: 'hidden', padding: '0', border: '0', boxSizing: 'content-box', ...WRAPPED_STYLE });
        document.body.append(mirror);
    }

    /**
     * Gives the hidden copy the width and font of the textarea, property by property:
     * the computed shorthand can be empty.
     * @param {CSSStyleDeclaration} style - the computed style of the textarea.
     * @returns {void}
     */
    function setMirrorFont(style) {
        Object.assign(mirror.style, { width: textWidth + 'px', fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight, fontStyle: style.fontStyle,
            fontStretch: style.fontStretch, letterSpacing: style.letterSpacing, wordSpacing: style.wordSpacing, tabSize: style.tabSize,
            fontVariantLigatures: style.fontVariantLigatures, fontKerning: style.fontKerning, lineHeight: lineH + 'px' });
    }

    /**
     * Measures how many characters of the textarea's font fit in one row.
     * @returns {number} the characters per row.
     */
    function getRowColumns() {
        const probe = document.createElement('span');
        probe.textContent = 'x'.repeat(PROBE_LENGTH);
        mirror.replaceChildren(probe);
        const columns = Math.floor(textWidth / (probe.getBoundingClientRect().width / PROBE_LENGTH || FALLBACK_CHARACTER_WIDTH));
        mirror.replaceChildren();
        return columns;
    }

    /**
     * Returns the rows of each line. A line of at most half as many characters as a row
     * holds cannot wrap (even with wide characters); the others are measured once per
     * text and width and kept in the cache.
     * @param {string[]} lines - the lines of the code.
     * @returns {number[]} the rows of each line, at least 1.
     */
    function getRowCounts(lines) {
        if (ta.clientWidth !== measuredWidth) resetMeasures();
        const rows = new Array(lines.length), unmeasured = [];
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];
            if (line.length * 2 <= rowColumns) rows[lineIndex] = 1;
            else {
                const cached = rowCache.get(line);
                if (cached) rows[lineIndex] = cached; else unmeasured.push(lineIndex);
            }
        }
        if (unmeasured.length) addMeasuredRows(lines, unmeasured, rows);
        return rows;
    }

    /**
     * Starts the measures over for the textarea's current width.
     * @returns {void}
     */
    function resetMeasures() {
        measuredWidth = ta.clientWidth;
        rowCache.clear();
        updateTextBoxSize();
    }

    /**
     * Measures the rows of the given lines, writes them into the row list and the cache.
     * @param {string[]} lines - the lines of the code.
     * @param {number[]} lineIndexes - the lines to measure.
     * @param {number[]} rows - the row list to fill in.
     * @returns {void}
     */
    function addMeasuredRows(lines, lineIndexes, rows) {
        const measured = getLineRows(lineIndexes.map(lineIndex => lines[lineIndex]));
        lineIndexes.forEach((lineIndex, position) => {
            rows[lineIndex] = measured[position];
            rowCache.set(lines[lineIndex], measured[position]);
        });
        if (rowCache.size > ROW_CACHE_LIMIT) rowCache.clear();
    }

    /**
     * Measures how many rows each text takes in the hidden copy of the text box.
     * @param {string[]} texts - the line texts.
     * @returns {number[]} the rows of each text, at least 1.
     */
    function getLineRows(texts) {
        const fragment = document.createDocumentFragment();
        for (const text of texts) {
            const lineBox = document.createElement('div');
            lineBox.textContent = text;
            fragment.append(lineBox);
        }
        mirror.replaceChildren(fragment);
        const lineBoxes = mirror.children;
        const rows = texts.map((_, position) => Math.max(1, Math.round(lineBoxes[position].getBoundingClientRect().height / lineH)));
        mirror.replaceChildren();
        return rows;
    }

    /**
     * Measures the rows of every line and writes the line numbers into the gutter, when one is given.
     * @param {string|string[]} code - the code, or its lines.
     * @returns {void}
     */
    function update(code) {
        if (!isOn && !gutter) { rowTops = null; return; }          // nothing to measure or to number
        const lines = typeof code === 'string' ? code.split('\n') : code;
        lineCount = lines.length;
        rowTops = isOn && ta.clientWidth > 0 ? getRowTops(lines) : null;
        if (gutter) showGutterNumbers();
    }

    /**
     * Returns the rows above each line, with one more entry for the end of the last line.
     * @param {string[]} lines - the lines of the code.
     * @returns {number[]} rowTops[lineIndex] = rows above that line.
     */
    function getRowTops(lines) {
        const rows = getRowCounts(lines);
        const tops = new Array(lineCount + 1);
        tops[0] = 0;
        for (let lineIndex = 0; lineIndex < lineCount; lineIndex++) tops[lineIndex + 1] = tops[lineIndex] + rows[lineIndex];
        return tops;
    }

    /**
     * Writes the line numbers of all lines into the gutter when they differ from what it shows.
     * @returns {void}
     */
    function showGutterNumbers() {
        const numbers = getLineNumbers(0, lineCount - 1);
        if (numbers === gutterText) return;
        gutter.textContent = numbers;
        gutterText = numbers;
    }

    /**
     * Returns the line numbers of a range of lines for a gutter: one number per line,
     * followed by an empty row for every further row the line takes.
     * @param {number} firstLine - the first line, 0-based.
     * @param {number} lastLine - the last line, 0-based, included.
     * @returns {string} the numbers, one row per text line.
     */
    function getLineNumbers(firstLine, lastLine) {
        let numbers = '';
        for (let lineIndex = firstLine; lineIndex <= lastLine; lineIndex++) {
            numbers += (lineIndex + 1) + '\n' + (rowTops ? '\n'.repeat(rowTops[lineIndex + 1] - rowTops[lineIndex] - 1) : '');
        }
        return numbers;
    }

    /**
     * Returns where a line starts.
     * @param {number} lineIndex - the line, 0-based.
     * @returns {number} pixels below the first row.
     */
    function getLineTop(lineIndex) {
        return (rowTops ? rowTops[Math.max(0, Math.min(lineIndex, lineCount))] : Math.max(0, lineIndex)) * lineH;
    }

    /**
     * Returns how high a line is.
     * @param {number} lineIndex - the line, 0-based.
     * @returns {number} the height in pixels.
     */
    function getLineHeight(lineIndex) {
        return (rowTops && lineIndex >= 0 && lineIndex < lineCount ? rowTops[lineIndex + 1] - rowTops[lineIndex] : 1) * lineH;
    }

    /**
     * Returns the line shown at a height.
     * @param {number} offsetY - pixels below the first row.
     * @returns {number} the line, 0-based.
     */
    function getLineAt(offsetY) {
        const row = Math.floor(offsetY / lineH);
        if (!rowTops) return Math.max(0, row);
        let low = 0, high = lineCount - 1;
        while (low < high) {
            const middle = (low + high + 1) >> 1;
            if (rowTops[middle] <= row) low = middle; else high = middle - 1;
        }
        return Math.max(0, low);
    }

    /**
     * Switches wrapping on or off, remembers the choice and asks the editor to draw again.
     * @param {boolean} wrapOn - true to wrap long lines.
     * @returns {void}
     */
    function set(wrapOn) {
        isOn = !!wrapOn;
        try { localStorage.setItem(storageKey, isOn ? STORED_ON : STORED_OFF); } catch (error) { /* storage blocked: for this page only */ }
        measuredWidth = 0;
        showWrapState();
        onChange();
    }

    /**
     * Switches wrapping to the other state (the Wrap button).
     * @returns {void}
     */
    function applyWrapSwitch() {
        set(!isOn);
    }

    /**
     * Switches wrapping on Alt+Z.
     * @param {KeyboardEvent} event - the key press.
     * @returns {void}
     */
    function handleWrapShortcut(event) {
        if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.code !== SWITCH_KEY_CODE) return;
        event.preventDefault();
        applyWrapSwitch();
    }

    /**
     * Wraps the lines anew at a new width (window, splitter, scroll bar).
     * @returns {void}
     */
    function updateOnResize() {
        if (!isOn || ta.clientWidth === measuredWidth) return;
        showWrapState();
        onChange();
    }
}
