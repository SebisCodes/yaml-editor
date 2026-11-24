/**
 * The tabs of the side panel: Value, Insert, Convert and Schema. Only the chosen tab is shown;
 * Value, Convert and Schema are drawn when they open.
 */

import { ui, getElements } from './state.js?v=2';
import { renderValuePanel } from './value-panel.js?v=5';
import { renderConvertPanel } from './conversion-panel.js?v=5';
import { renderSchemaPanel } from './schema-panel.js?v=5';

/**
 * Connects the tab buttons of the side panel.
 * @returns {void}
 */
export function startPanelTabs() {
    getElements('[data-itab]').forEach(button => button.addEventListener('click', () => showPanelTab(button)));
}

/**
 * Shows the tab of a tab button and marks the button as selected.
 * @param {HTMLElement} button - the tab button (data-itab: node, insert, convert or schema).
 * @returns {void}
 */
function showPanelTab(button) {
    getElements('[data-itab]').forEach(other => other.setAttribute('aria-selected', String(other === button)));
    const tab = button.dataset.itab;
    ui.node.hidden = tab !== 'node';
    ui.insert.hidden = tab !== 'insert';
    ui.convert.hidden = tab !== 'convert';
    ui.schema.hidden = tab !== 'schema';
    if (tab === 'convert') renderConvertPanel();
    if (tab === 'schema') renderSchemaPanel();
    if (tab === 'node') renderValuePanel();
}
