<?php
/**
 * The editor page: markup and keys of the shared language packs (src/php/page.php).
 */
?>
<!DOCTYPE html>
<html <?= build_html_attributes() ?>>
<head>
<meta charset="utf-8">
<!-- The same policy as the server header (.htaccess), in case the header is ever missing; frame-ancestors only works as a header. -->
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' data: blob: https: http://localhost:* http://127.0.0.1:*; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'self'; form-action 'self'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= get_text('title') ?></title>
<meta name="description" content="<?= get_text('description') ?>">
<meta name="author" content="Sebastian Grünwald, Grünwald Innovation">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="theme-color" content="#2b59c3">
<link rel="canonical" href="<?= escape_html(get_page_url()) ?>">
<?= build_hreflang_links() ?>
<meta property="og:type" content="website">
<meta property="og:locale" content="<?= get_page_locale() ?>">
<meta property="og:site_name" content="YAML Editor">
<meta property="og:title" content="<?= get_text('og_title') ?>">
<meta property="og:description" content="<?= get_text('og_description') ?>">
<meta property="og:url" content="<?= escape_html(get_page_url()) ?>">
<meta property="og:image" content="https://yaml.giit.ch/img/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/svg+xml" href="/img/logo.svg">
<link rel="stylesheet" href="/css/style.css?v=28">
<script src="/js/lang-menu.js?v=1" defer></script>
<script src="/js/theme.js?v=10" data-editor-page></script>
<script type="application/ld+json"><?= get_json_ld('jsonld') ?></script>
</head>
<body>

<header class="header">
    <div class="header-brand">
        <a class="back-to-editors" href="<?= escape_html(get_site_url('https://editors.giit.ch/')) ?>" title="All giit editors" aria-label="All giit editors"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg></a>
        <a class="brand" href="<?= escape_html(get_language_path(get_template_language(), '')) ?>" aria-label="YAML Editor - home">
            <img src="/img/logo.svg" alt="" width="28" height="28">
            <h1>YAML Editor <span>online</span></h1>
        </a>
        <a class="by-giit" href="https://giit.ch/"><img src="/img/giit.svg" alt="" width="16" height="18">by giit.ch</a>
    </div>
    <div class="toolbar file" role="toolbar" aria-label="File">
        <button type="button" class="button with-symbol file-button" id="btn-files" title="My documents (Ctrl+O)" aria-label="My documents"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg><span id="file-name" class="file-title" data-no-i18n></span><svg class="arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>
        <span class="menu-anchor">
            <button type="button" class="button with-symbol" id="btn-new" title="New document, or start this one over" aria-haspopup="menu" aria-expanded="false" aria-controls="new-menu"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span class="txt">New</span></button>
            <span id="new-menu" class="menu" role="menu" aria-label="New" hidden>
                <button type="button" role="menuitem" data-new="blank"><b>New blank document</b><span>An empty document - your other documents stay as they are</span></button>
                <button type="button" role="menuitem" data-new="compose"><b>Docker Compose</b><span>Two services with ports and a volume</span></button>
                <button type="button" role="menuitem" data-new="workflow"><b>GitHub workflow</b><span>Run the tests on every push</span></button>
                <button type="button" role="menuitem" data-new="kubernetes"><b>Kubernetes</b><span>A deployment and a service: two documents</span></button>
                <button type="button" role="menuitem" data-new="openapi"><b>OpenAPI</b><span>The start of an API description</span></button>
                <button type="button" role="menuitem" data-new="table"><b>Table</b><span>A list of mappings - converts to CSV</span></button>
                <button type="button" role="menuitem" data-new="example"><b>The welcome example</b><span>Shows what the editor can do</span></button>
                <button type="button" role="menuitem" data-new="restart" id="new-restart"><b>Start this document over</b><span>Empties the data - "Undo" brings it back</span></button>
            </span>
        </span>
        <button type="button" class="button" id="btn-open" title="Open a YAML file from your computer (JSON, JSON Lines, CSV and XML files are converted; you can also drag a file into the window)">Open file…</button>
        <input type="file" id="file" accept=".yaml,.yml,.txt,.json,.jsonc,.json5,.geojson,.jsonl,.ndjson,.csv,.tsv,.xml,application/yaml,text/yaml,text/plain,application/json,text/csv,application/xml,text/xml" multiple hidden>
        <span class="divider" aria-hidden="true"></span>
        <button type="button" class="button with-symbol" id="btn-undo" title="Undo the last change (Ctrl+Z)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg><span class="txt">Undo</span></button>
        <button type="button" class="button with-symbol" id="btn-redo" title="Redo the change you just undid (Ctrl+Y)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg><span class="txt">Redo</span></button>
    </div>
    <div class="toolbar output" role="toolbar" aria-label="Output">
        <span class="languages" data-languages><?= build_language_menu(get_text('language')) ?></span>
        <div class="schema" role="radiogroup" aria-label="Color theme">
            <button type="button" role="radio" data-theme-set="light" aria-checked="false" title="Light theme" aria-label="Light theme"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg></button>
            <button type="button" role="radio" data-theme-set="dark" aria-checked="false" title="Dark theme" aria-label="Dark theme"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/></svg></button>
            <button type="button" role="radio" data-theme-set="auto" aria-checked="true" title="Same as your system setting" aria-label="Automatic theme (system setting)"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg></button>
        </div>
        <button type="button" class="button with-symbol ai-button" id="btn-ai" title="Let any AI write in this editor"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 4.9L19 9.5l-5.2 1.7L12 16l-1.8-4.8L5 9.5l5.2-1.6z"/><path d="M19 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/></svg><span class="txt">AI Assistant</span></button>
        <button type="button" class="button symbol" id="btn-sync" title="Save to your own server and embed the editor in your website" aria-label="Save to server"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 8.5a4 4 0 0 1-.5 9.5"/><path d="M12 12v8m-3-3 3 3 3-3"/></svg></button>
        <button type="button" class="button" id="btn-help" title="How it works and keyboard shortcuts (?)">Help</button>
        <button type="button" class="button" id="btn-download" title="Save the document as a .yaml file (Ctrl+S)">Download .yaml</button>
        <button type="button" class="button primary save" id="btn-save" hidden>Save</button>
        <button type="button" class="button primary" id="btn-export" title="JSON, CSV and more (Ctrl+E)">Export…</button>
    </div>
</header>

<nav class="views" role="tablist" aria-label="View">
    <button type="button" role="tab" data-pane="code" aria-selected="false">Code</button>
    <button type="button" role="tab" data-pane="draw" aria-selected="true">Tree</button>
    <button type="button" role="tab" data-pane="properties" aria-selected="false">Edit</button>
</nav>

<main id="work" class="workspace" data-show="draw">
    <section class="pane code-pane" aria-label="YAML code">
        <div class="pane-header">
            <b>Code</b>
            <span id="code-status" class="muted"></span>
            <span class="right">
                <button type="button" class="button small" id="btn-wrap" aria-pressed="false" title="Wrap long lines in the view - each line of the code stays one line (Alt+Z)">Wrap</button>
                <button type="button" class="button small with-symbol" id="btn-copy" title="Copy the code to the clipboard" aria-label="Copy code"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg><span class="txt">Copy</span></button>
                <button type="button" class="button small" id="btn-format" title="The same indentation everywhere; comments stay (Ctrl+Shift+F)">Format</button>
            </span>
        </div>
        <div id="code-error" class="error problems" hidden role="status"></div>
        <div class="editor">
            <div class="gutter" aria-hidden="true"><div id="gutter"></div></div>
            <div class="code-field" id="code-layers">
                <pre class="layer marks" id="marks" aria-hidden="true"></pre>
                <pre class="layer hl" id="hl" aria-hidden="true"></pre>
                <textarea id="code" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off" aria-label="YAML code"></textarea>
            </div>
        </div>
        <div id="placeholder-box" class="placeholder-box template-control">
            <div id="placeholder-list" class="placeholder-list" data-placeholder-list role="group" aria-label="Placeholders" hidden></div>
            <button type="button" class="placeholder-header" data-placeholder-toggle aria-expanded="false" aria-controls="placeholder-list" title="The placeholders of the template - a click on one puts its tag at the cursor"><svg class="arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg><span>Placeholders</span><span class="placeholder-count" data-placeholder-count data-no-i18n></span></button>
        </div>
    </section>

    <div id="splitter" class="splitter" role="separator" aria-orientation="vertical" aria-label="Drag to change the width of the code area" title="Drag to change the width" tabindex="0"></div>

    <section class="pane draw-pane" aria-label="Tree">
        <div class="pane-header tools tree-toolbar" role="toolbar" aria-label="Tree">
            <div class="group">
                <button type="button" class="tool" id="tree-open" title="Unfold everything" aria-label="Unfold everything"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 9 5 5 5-5M7 4l5 5 5-5M5 19h14"/></svg></button>
                <button type="button" class="tool" id="tree-close" title="Fold everything" aria-label="Fold everything"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 15 5-5 5 5M7 20l5-5 5 5M5 5h14"/></svg></button>
                <span class="divider" aria-hidden="true"></span>
                <button type="button" class="tool" id="node-add" title="Add an entry: into the selected object or array, otherwise after the selected entry" aria-label="Add an entry"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
                <button type="button" class="tool" id="node-dup" title="Duplicate the selected entry" aria-label="Duplicate"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg></button>
                <button type="button" class="tool" id="node-up" title="Move the selected entry up (Alt+Up)" aria-label="Move up"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg></button>
                <button type="button" class="tool" id="node-down" title="Move the selected entry down (Alt+Down)" aria-label="Move down"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"/></svg></button>
                <button type="button" class="tool" id="node-del" title="Remove the selected entry (Delete)" aria-label="Remove"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></button>
                <select id="node-type" title="The type of the selected value - choosing another one changes it" aria-label="Type">
                    <option value="string">string</option><option value="number">number</option><option value="boolean">boolean</option><option value="null">null</option><option value="object">object</option><option value="array">array</option>
                </select>
            </div>
            <div id="view-switch" class="view-switch template-control" role="radiogroup" aria-label="View of the tree">
                <button type="button" role="radio" data-view-set="example" aria-checked="true" title="The data filled with the examples">Examples</button>
                <button type="button" role="radio" data-view-set="template" aria-checked="false" tabindex="-1" title="The template with its placeholders as written">Template</button>
            </div>
            <div class="tree-search" role="search">
                <input id="tree-search" type="search" placeholder="Search keys and values" aria-label="Search keys and values" spellcheck="false">
                <span id="tree-hits" class="muted" aria-live="polite"></span>
                <button type="button" class="tool" id="tree-prev" title="Previous match (Shift+Enter)" aria-label="Previous match"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg></button>
                <button type="button" class="tool" id="tree-next" title="Next match (Enter)" aria-label="Next match"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>
            </div>
        </div>
        <div class="tree-surface">
            <div id="tree" class="data-tree" role="tree" tabindex="0" aria-label="The data as a tree: click a key or a value to change it" data-no-i18n></div>
            <div class="path-footer">
                <div id="path" class="path-row" data-no-i18n></div>
                <button type="button" class="button small" id="path-copy" title="Copy the path of the selected value">Copy path</button>
            </div>
            <div id="view-note" class="view-note template-control" role="status" hidden>The examples could not be filled in - the tree shows the template</div>
        </div>
    </section>

    <button type="button" class="tool panel-toggle" id="btn-panel" aria-controls="side-panel" aria-expanded="false" title="Show or hide the side panel" aria-label="Side panel"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></svg></button>

    <aside class="pane inspector" id="side-panel" aria-label="Side panel">
        <div class="pane-header tabs" role="tablist">
            <button type="button" role="tab" data-itab="node" aria-selected="true" title="The selected key and value">Value</button>
            <button type="button" role="tab" data-itab="insert" aria-selected="false" title="New entries and pieces of code">Insert</button>
            <button type="button" role="tab" data-itab="convert" aria-selected="false" title="Format the document, or convert it to another format">Convert</button>
            <button type="button" role="tab" data-itab="schema" aria-selected="false" title="Check the data against a JSON Schema">Schema</button>
        </div>
        <div id="node-wrap" class="inspector-body"></div>
        <div id="insert-wrap" class="inspector-body" hidden></div>
        <div id="convert-wrap" class="inspector-body convert" hidden></div>
        <div id="schema-wrap" class="inspector-body schema-form" hidden></div>
    </aside>
</main>

<div id="ai-receive" class="receive" role="status" hidden>
    <div class="receive-box"><img src="/img/logo.svg" alt="" width="40" height="40"><h2></h2><p></p>
        <div class="receive-buttons"><button type="button" class="button primary" data-here>Open it here</button></div>
    </div>
</div>

<div id="toast" class="toast" role="status" aria-live="polite"></div>
<div class="storage-hint" aria-hidden="true"><span>Drop the file here</span></div>

<dialog id="export" class="dialog" aria-labelledby="ex-title">
    <form method="dialog" class="dialog-header"><h2 id="ex-title">Export</h2><button class="close" data-close aria-label="Close" title="Close">✕</button></form>
    <div class="dialog-content">
        <div class="ex-row">
            <label class="field"><span>File name</span><input id="ex-name" spellcheck="false"></label>
            <label class="field"><span>Format</span>
                <select id="ex-format">
                    <option value="yaml">YAML file as it is (.yaml)</option>
                    <option value="json">JSON file (.json)</option>
                    <option value="csv">CSV table (.csv)</option>
                    <option value="txt">The tree as plain text (.txt)</option>
                </select>
            </label>
        </div>
        <label class="box sync-choice"><input type="checkbox" id="ex-guard" checked> Protect the CSV export against spreadsheet formulas; plain signed numbers remain unchanged.</label>
        <textarea id="ex-text" class="ex-text" readonly spellcheck="false" aria-label="Result"></textarea>
        <div class="dialog-footer">
            <span id="ex-info" class="muted"></span>
            <button type="button" class="button" id="ex-zip" title="Download every format at once">All formats (ZIP)</button>
            <button type="button" class="button" id="ex-copy">Copy</button>
            <button type="button" class="button primary" id="ex-download">Download</button>
        </div>
    </div>
</dialog>

<dialog id="files" class="dialog files" aria-labelledby="files-title">
    <form method="dialog" class="dialog-header"><h2 id="files-title">My documents</h2><button class="close" data-close aria-label="Close" title="Close">✕</button></form>
    <div class="dialog-content">
        <div class="files-toolbar">
            <input id="files-search" type="search" placeholder="Search by name" aria-label="Search your documents" spellcheck="false">
            <button type="button" class="button" id="files-import" title="Open a file from your computer as a new document">Open file…</button>
            <button type="button" class="button primary" id="files-new">New document</button>
        </div>
        <ul id="files-grid" class="file-grid"></ul>
        <p class="muted">Click a document to open it. They are stored only in this browser - nothing is uploaded. Clearing the browser's site data removes them, so download the ones you want to keep.</p>
        <div class="dialog-footer"><span id="files-info" class="muted"></span><button type="button" class="button" id="files-zip" title="Download every document as a .yaml file in one ZIP">Download all (ZIP)</button></div>
    </div>
</dialog>

<dialog id="ask" class="dialog question" aria-labelledby="ask-title">
    <div class="dialog-header"><h2 id="ask-title"></h2></div>
    <div class="dialog-content"><p id="ask-text"></p>
        <div class="dialog-footer"><span class="muted"></span><button type="button" class="button" id="ask-cancel">Cancel</button><button type="button" class="button primary" id="ask-ok">OK</button></div>
    </div>
</dialog>

<dialog id="ai" class="dialog ai-dialog" aria-labelledby="ai-title">
    <form method="dialog" class="dialog-header"><h2 id="ai-title">AI Assistant</h2><button class="close" data-close aria-label="Close" title="Close">✕</button></form>
    <div class="dialog-content">
        <p>Any AI can work with you - ChatGPT, Claude, Gemini, Copilot.</p>
        <ul id="ai-status" class="ai-status" aria-label="Connected AI"></ul>
        <ol class="steps">
            <li>Click <b>Copy prompt</b>.</li>
            <li>Paste it into your AI and say what it should change.</li>
            <li id="ai-step-link">The AI answers with a link: click it, or paste the whole answer below. <b>Undo</b> takes it back.</li>
        </ol>
        <div id="ai-remote" class="ai-remote" hidden>
            <p><b>Connected to <span id="ai-remote-host" data-no-i18n></span>:</b> the AI sends its result there, and it opens here. <span id="ai-key-exp" class="muted"></span></p>
            <details id="ai-remote-details" hidden><summary>What <span data-no-i18n></span> tells the AI</summary><pre id="ai-remote-prompt" class="ai-remote-prompt" data-no-i18n></pre></details>
        </div>
        <fieldset class="ai-target">
            <legend>The AI should</legend>
            <label><input type="radio" name="ai-target" value="change" checked><span><b>Change “<span id="ai-cur" data-no-i18n></span>”</b></span></label>
            <label><input type="radio" name="ai-target" value="new"><span><b>Make a new document</b></span></label>
        </fieldset>
        <label class="field ai-insert"><span id="ai-paste-label">The AI's answer (or press Ctrl+V anywhere):</span><textarea id="ai-paste" rows="2" spellcheck="false" placeholder="https://yaml.giit.ch/#…"></textarea></label>
        <p class="muted" id="ai-privacy">The document travels in the link after the “#”, which no server sees. What you paste into your AI is handled by its provider.</p>
        <textarea id="ai-prompt-text" class="ai-prompt-text" rows="6" readonly hidden aria-label="The prompt - copy it with Ctrl+C"></textarea>
        <div class="dialog-footer"><span class="muted"></span><button type="button" class="button primary" id="ai-copy">Copy prompt</button></div>
    </div>
</dialog>

<dialog id="sync" class="dialog" aria-labelledby="sync-title">
    <form method="dialog" class="dialog-header"><h2 id="sync-title">Save to your server</h2><button class="close" data-close aria-label="Close" title="Close">✕</button></form>
    <div class="dialog-content">
        <p>The editor can send each saved version to your own server (a <b>webhook</b>), so your work is kept where you want it. Nothing is sent until you enter an address here.</p>
        <div class="sync-fields">
            <label class="field"><span>Webhook address</span><input id="sync-url" type="url" placeholder="https://example.com/api/yaml" spellcheck="false" autocomplete="off"></label>
            <label class="field"><span>Token <small>(optional, sent as "Authorization: Bearer …"; kept until this tab is closed)</small></span><input id="sync-token" type="password" spellcheck="false" autocomplete="off"></label>
        </div>
        <label class="box sync-choice"><input type="checkbox" id="sync-auto"> Send automatically a few seconds after each change (otherwise only when you click <b>Save</b> or press Ctrl+S)</label>
        <label class="box sync-choice"><input type="checkbox" id="sync-doc"> Only for “<span id="sync-docname" data-no-i18n></span>” (other documents use the general address)</label>
        <details class="sync-help">
            <summary>What your server receives</summary>
            <p class="muted">A POST request with JSON (your server must allow CORS from https://yaml.giit.ch); content is the document as a string:</p>
            <pre class="code-example">{ "editor": "yaml", "event": "save", "id": "…", "name": "Settings",
  "content": "debug: false\nport: 8080\n",
  "updated": "2026-01-15T09:30:00.000Z" }</pre>
        </details>
        <details class="sync-help">
            <summary>Embed the editor in your website</summary>
            <pre class="code-example">&lt;iframe src="https://yaml.giit.ch/?embed=1" style="width:100%;height:80vh;border:0"&gt;&lt;/iframe&gt;
&lt;script&gt;
const frame = document.querySelector('iframe');
addEventListener('message', e =&gt; {
  if (e.origin !== 'https://yaml.giit.ch' || e.source !== frame.contentWindow) return;
  if (e.data.type === 'yamleditor:ready')
    frame.contentWindow.postMessage({ type: 'yamleditor:load', name: 'Settings',
      content: settingsYaml }, 'https://yaml.giit.ch');
  if (e.data.type === 'yamleditor:save') saveOnYourServer(e.data.content);
});
&lt;/script&gt;</pre>
            <p class="muted">Also possible: <code>?src=&lt;URL of a .yaml file&gt;</code> opens a file, <code>&amp;webhook=&lt;URL&gt;</code> saves this document there. The editor can also open in a window of its own (<code>?embed=window</code>), and your page can hand it its own AI prompt and a session key so the AI sends its result to your server (<code>yamleditor:ai</code>, <code>yamleditor:key-request</code>) - see "Use the editor on your own website" below the editor. Details are in <a href="/llms.txt">llms.txt</a>.</p>
        </details>
        <div class="dialog-footer"><span id="sync-status" class="muted"></span><button type="button" class="button" id="sync-test">Send now</button><button type="button" class="button primary" id="sync-ok">Save setting</button></div>
    </div>
</dialog>

<dialog id="help" class="dialog" aria-labelledby="help-title">
    <form method="dialog" class="dialog-header"><h2 id="help-title">Help</h2><button class="close" data-close aria-label="Close" title="Close">✕</button></form>
    <div class="dialog-content shortcuts">
        <h3>How it works</h3>
        <ol class="steps">
            <li><b>Write</b> YAML on the left - or start with <b>New</b> and one of the templates. The tree in the middle shows the data as you type: mappings and lists fold, every value shows its type, <code>{3}</code> and <code>[5]</code> count the entries, every document after <code>---</code> has its own tree.</li>
            <li><b>Click a key or a value in the tree</b> to change it right there. <b>Enter</b> or a click elsewhere writes the change into the code at exactly that place - comments and formatting stay (one step for Undo), <b>Escape</b> cancels. The buttons above the tree add, duplicate, move and remove entries and change the type of a value.</li>
            <li>A click in the tree puts the code's cursor on that value; the cursor in the code marks its value in the tree. The path of the selected value (<code>$.items[3].name</code>) is below the tree. Anchors (<code>&amp;name</code>) and aliases (<code>*name</code>) are marked.</li>
            <li>Problems (wrong indentation, a tab, a duplicate key, an alias without its anchor, what does not fit the schema) are listed above the code with line and column - click one to go there.</li>
            <li><b>Value</b> on the right shows the selected key and value; <b>Insert</b> adds entries and pieces of code; <b>Convert</b> formats the document or converts it to JSON, CSV or XML; <b>Schema</b> checks it against a JSON Schema from your documents.</li>
            <li><b>My documents</b> (the folder button at the top left) lists every document kept in this browser. <b>Export</b> saves it as YAML, JSON, CSV or text.</li>
            <li><b>Export</b> also has <b>Open in another editor</b>: it converts the document and opens it as a new document there. Anything the other format cannot hold is listed first.</li>
        </ol>
        <h3>Keyboard shortcuts</h3>
        <dl>
            <dt><kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd></dt><dd>In the tree: go up and down, fold and unfold</dd>
            <dt><kbd>Enter</kbd></dt><dd>In the tree: change the value (F2: the key)</dd>
            <dt><kbd>Delete</kbd></dt><dd>In the tree: remove the entry</dd>
            <dt><kbd>Alt</kbd> + <kbd>↑</kbd> / <kbd>↓</kbd></dt><dd>In the tree: move the entry up / down</dd>
            <dt><kbd>Ctrl</kbd> + <kbd>F</kbd></dt><dd>Search keys and values in the tree</dd>
            <dt><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>F</kbd></dt><dd>Format the document</dd>
            <dt><kbd>Tab</kbd> / <kbd>Shift</kbd> + <kbd>Tab</kbd></dt><dd>Indent / outdent in the code (with spaces)</dd>
            <dt><kbd>Ctrl</kbd> + <kbd>/</kbd></dt><dd>Comment lines in or out (<code>#</code>)</dd>
            <dt><kbd>Ctrl</kbd> + <kbd>Z</kbd> / <kbd>Y</kbd></dt><dd>Undo / redo</dd>
            <dt><kbd>Ctrl</kbd> + <kbd>S</kbd> / <kbd>E</kbd></dt><dd>Save (download, or to your server) / export</dd>
            <dt><kbd>Ctrl</kbd> + <kbd>O</kbd></dt><dd>My documents</dd>
        </dl>
        <p class="muted">Enter after <code>key:</code> indents the next line, Enter in a list starts the next item with <code>- </code>. Quotes and brackets close by themselves around a selection.</p>
    </div>
</dialog>

<div class="page-text">
<?= get_html('page_text') ?>
</div>

<?php include __DIR__ . '/footer.php'; ?>

<script type="module" src="/js/app.js?v=46"></script>
</body>
</html>
