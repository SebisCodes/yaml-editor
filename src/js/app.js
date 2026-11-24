/**
 * YAML editor: the code on the left, the data as a tree in the middle (one tree per document
 * of the file), the selected value, insert, convert and schema in the side panel. This file
 * starts the editor and wires its areas together; each area has its own module (state.js
 * describes the shared state).
 *
 * The code is the single source of truth: the tree is made from it (datatree.js), and every
 * change in the tree is a small edit of the code that keeps the rest of its formatting and its
 * comments. A click in the tree puts the code's cursor on that value; the cursor in the code
 * marks its value in the tree.
 *
 * Start-up steps:
 *   1. the template syntax of ?template= for the data tree, the interface language (the AI
 *      prompt stays English) and the line wrap of the code;
 *   2. connect the areas: storage, code view, tree, problems, side panel, documents, opening
 *      files, keyboard, layout, the Export dialog, the dialogs and the controls of template
 *      placeholders;
 *   3. take the stored settings and open the last document (or the welcome example);
 *   4. once the YAML package is loaded: read and draw the document, again once the language
 *      pack is there, and start the AI Assistant, the WebMCP tools, the AI status, "Open in
 *      another editor" and sync.js (webhook, embedding, ?src=);
 *   5. offer the test hook window.yamlEditor.
 */

import { createI18n } from './i18n.js?v=23';
import { createWrap } from './wrap.js?v=5';
import { createAiStatus } from './aistatus.js?v=9';
import { createSync } from './sync.js?v=24';
import './export-menu.js?v=6';
import { startConvert } from './convert-to.js?v=15';
import { importYamlLibrary, TooManyValues, setTemplateSyntax } from './datatree.js?v=13';
import { getTemplateSyntax, getTemplateNameByAddress } from './template-tags.js?v=2';
import { START } from './samples.js?v=4';
import { store } from './files.js?v=8';
import { createAi } from './ai.js?v=10';
import { createMcp } from './mcp.js?v=5';
import { state, ui, areas, FORMAT, showToast, translate } from './state.js?v=2';
import { startCodeView, renderCode, syncScroll, showCodePosition } from './code-view.js?v=4';
import { setCode, addHistoryStep, undo, redo } from './history.js?v=4';
import { getSettings, startStorageSync } from './storage.js?v=4';
import { updateAnalysis, renderTreeView } from './analysis.js?v=4';
import { startProblems } from './problems.js?v=4';
import { createTreeArea, editCodeFromTree } from './tree-panel.js?v=4';
import { startTreeTools } from './tree-tools.js?v=4';
import { renderValuePanel, startValuePanel } from './value-panel.js?v=4';
import { renderInsertPanel, startInsertPanel } from './insert-panel.js?v=4';
import { startCodeInput } from './code-input.js?v=4';
import { startConversionPanel, getTidyCode, getConvertibleCode } from './conversion-panel.js?v=4';
import { startSchemaPanel } from './schema-panel.js?v=4';
import { startPanelTabs } from './panel-tabs.js?v=4';
import { showFileName, openDocument, createDocumentsDialog, startDocumentButtons } from './documents.js?v=4';
import { startFileImport } from './file-import.js?v=4';
import { startKeyboard } from './keyboard.js?v=4';
import { showSplit, startLayout, startDialogs } from './layout.js?v=4';
import { startExportDialog } from './export-dialog.js?v=4';
import { receiveDocument, importExternalDocument } from './incoming.js?v=4';
import { startTemplateControls } from './template-panel.js?v=1';
import { createTemplateExamples } from './template-examples.js?v=2';
import { getViewMode, getTreeModel } from './tree-views.js?v=1';
import {
    getPromptState, getProblemList, getAgentValue, setAgentValue, getFileList, openFileByName, createFile, updateCodeText, showLine,
} from './agent-api.js?v=4';

startEditor();

/**
 * Starts the editor (the flow of the steps in the header).
 * @returns {void}
 */
function startEditor() {
    setTemplateSyntax(getTemplateSyntax(getTemplateNameByAddress(location.search)));
    startLanguageAndWrap();
    connectAreas();
    openStartDocument();
    importYamlLibrary().then(() => {
        renderStart();
        startAiAndSync();
    });
    window.yamlEditor = createTestHook();
}

/**
 * Starts the interface language (translated at run time, see i18n.js) and the line wrap of
 * the code view (wrap.js).
 * @returns {void}
 */
function startLanguageAndWrap() {
    areas.i18n = createI18n({
        prefix: 'yamleditor',
        roots: '.header, .views, #work, #ai-receive, #toast, .storage-hint, dialog',
        skip: '',
    });
    areas.lineWrap = createWrap({ prefix: FORMAT.prefix, ta: ui.ta, layers: [ui.hl, ui.marks], gutter: ui.gutter, button: document.getElementById('btn-wrap'), onChange: () => { renderCode(); syncScroll(); } });
}

/**
 * Connects the areas of the page, in the order their listeners take events.
 * @returns {void}
 */
function connectAreas() {
    watchValueLimit();
    startStorageSync();
    startCodeView();
    areas.tree = createTreeArea();
    startProblems();
    startTreeTools();
    startValuePanel();
    startInsertPanel();
    startCodeInput();
    startConversionPanel();
    startSchemaPanel();
    startPanelTabs();
    areas.files = createDocumentsDialog();
    startDocumentButtons();
    startFileImport();
    startKeyboard();
    startLayout();
    startExportDialog();
    startDialogs();
    startTemplateControls();
}

/**
 * Stops an action (convert, export, format) on data whose aliases expand past the limit of
 * datatree.js with a message, so the user sees why nothing happened.
 * @returns {void}
 */
function watchValueLimit() {
    addEventListener('error', event => { if (event.error instanceof TooManyValues) { event.preventDefault(); showToast(event.error.message); } });
    addEventListener('unhandledrejection', event => { if (event.reason instanceof TooManyValues) { event.preventDefault(); showToast(event.reason.message); } });
}

/**
 * Takes the stored settings and opens the last document, or the welcome example when
 * "My documents" is empty; with the storage blocked, the example without saving.
 * @returns {void}
 */
function openStartDocument() {
    const settings = getSettings();
    if (settings && settings.split) state.split = settings.split;
    showSplit();
    let code = null;
    try {
        if (!store.list().length) store.create(START.name, START.code);
        const entry = store.getEntry(settings?.file) || store.getSortedEntries()[0];
        code = store.code(entry.id);
        if (code != null) { state.fileId = entry.id; state.name = entry.name; state.savedCode = code; }
    } catch (e) { /* Storage blocked: one document without saving */ }
    if (code == null) { code = START.code; state.name = START.name; }
    state.code = code;
    ui.ta.value = code;
    showFileName();
    renderInsertPanel();
}

/**
 * Reads and draws the start document, makes its first undo step and draws the tree and the
 * side panel again once the language pack is there.
 * @returns {void}
 */
function renderStart() {
    updateAnalysis();
    renderCode();
    areas.tree.select({ doc: 0, path: [] }, { scroll: false });
    renderValuePanel();
    addHistoryStep();
    syncScroll();
    areas.i18n.ready.then(() => { areas.tree.render(); renderValuePanel(); });
}

/**
 * Starts the AI Assistant, the WebMCP tools, the AI status, "Open in another editor" and
 * sync.js. The callbacks reach the areas through `areas`, so each may start after the ones
 * it calls.
 * @returns {void}
 */
function startAiAndSync() {
    areas.ai = createAi({
        getState: getPromptState,
        receiveDocument: async (...args) => { setTimeout(() => areas.aiStatus.addDelivery('link')); await receiveDocument(...args); return state.fileId; },
        tryOpenDocument: id => { if (!store.getEntry(id)) return false; openDocument(id); return true; },
        showToast,
        getRemote: () => areas.sync?.getAiSettings() || null,
        fetchKey: () => (areas.sync ? areas.sync.fetchKey() : Promise.resolve(null)),
        hasValidKey: () => !!areas.sync?.hasValidKey(),
        handleAiClick: openEditorDialog => (areas.sync ? areas.sync.handleAiClick(openEditorDialog) : openEditorDialog()),
        getKeyDecline: () => areas.sync?.getKeyDecline() || '',
    });
    const agent = createMcp({
        onUse: () => areas.aiStatus.addDelivery('agent'),
        getState: getPromptState,
        getProblems: getProblemList,
        getValue: getAgentValue,
        setValue: setAgentValue,
        getFiles: getFileList,
        openFileByName,
        createFile,
        receiveDocument,
        updateText: updateCodeText,
        showLine,
        undo,
    });
    areas.aiStatus = createAiStatus({
        prefix: FORMAT.prefix, btn: document.getElementById('btn-ai'), box: document.getElementById('ai-status'),
        remote: () => areas.sync?.getAiSettings() || null, agent: () => agent,
    });
    startConvert({ editor: FORMAT.editor, code: getConvertibleCode, name: () => state.name, toast: showToast, t: translate });
    areas.sync = createSync(createSyncEditor());
}

/**
 * Creates what sync.js gets from the editor; the property names are sync.js's contract.
 * @returns {object} the adapter.
 */
function createSyncEditor() {
    return {
        viewerAllow: '.trow-toggle',
        onAiResult: () => areas.aiStatus.addDelivery('page'),
        onAiEnd: () => areas.aiStatus.resetDelivery(),
        prefix: FORMAT.prefix, editor: FORMAT.editor, word: 'document',
        tidy: getTidyCode,
        current: () => ({ id: state.fileId, name: state.name, content: state.code, assets: {} }),
        load: importExternalDocument,
        toast: showToast,
        hookFor: id => store.getEntry(id)?.hook || null,
        setHookFor: (id, hook) => { try { store.setEntryFields(id, { hook }); } catch (e) { showToast('The browser storage is full'); } },
        onAi: () => areas.ai?.updateRemote(),
        parseTemplate: message => createTemplateExamples(message),
        onTemplate: () => renderTreeView(),
    };
}

/**
 * Creates the hook for automated UI tests (window.yamlEditor).
 * @returns {object} the state and the functions the tests call.
 */
function createTestHook() {
    return {
        state, store, setCode, undo, redo, receive: receiveDocument, showCodePosition, tree: areas.tree,
        sync: () => areas.sync, updateAnalysis, editCodeFromTree, importYamlLibrary, viewMode: getViewMode, treeModel: getTreeModel,
    };
}
