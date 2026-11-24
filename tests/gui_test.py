"""Browser test of the YAML editor (Playwright, Google Chrome).

    php -S 127.0.0.1:8102 -t src src/php/router.php          (in the project folder)
    python tests/gui_test.py

Checks the tree (types, counts, folding, anchors and aliases, several
documents, path, search), code <-> tree, problems with line and column
(syntax, tabs, duplicate keys, unknown aliases), the JSON Schema check,
format, convert, templates, My documents, opening other formats, AI links,
export and the phone layout."""

import base64
import os
import sys
import tempfile
import zlib

from playwright.sync_api import sync_playwright

URL = os.environ.get('EDITOR_URL', 'http://127.0.0.1:8102/')
HOOK = 'yamlEditor'
failures = []


def check_that(cond, what):
    """Prints one result and notes it when it failed.

    Args:
        cond (bool): True when the check passed.
        what (str): what was checked.

    Returns:
        None: the result goes to standard output and the list of failures.
    """
    print(('ok    ' if cond else 'FAIL  ') + what)
    if not cond:
        failures.append(what)


def show_side_panel(page, is_open):
    """Opens or closes the side panel's drawer (it is closed at the start).

    Args:
        page (Page): the editor's page.
        is_open (bool): True to open it, False to close it.

    Returns:
        None: the side panel is open or closed.
    """
    button = page.locator('#btn-panel')
    if button.count() and button.is_visible() and (button.get_attribute('aria-expanded') == 'true') != is_open:
        button.click()


def set_code(page, text):
    """Sets the code through the test hook and waits until it is read.

    Args:
        page (Page): the editor page.
        text (str): the new code.

    Returns:
        None: the editor holds the code.
    """
    page.evaluate('t => %s.setCode(t)' % HOOK, text)
    page.wait_for_timeout(300)


def get_state(page, expr):
    """Returns the value of an expression on the editor's state (S).

    Args:
        page (Page): the editor page.
        expr (str): a JavaScript expression that reads S.

    Returns:
        Any: the value of the expression.
    """
    return page.evaluate(f'() => {{ const S = {HOOK}.state; return {expr}; }}')


def get_code_selection(page):
    """Returns the text selected in the code.

    Args:
        page (Page): the editor page.

    Returns:
        str: the selected text.
    """
    return page.evaluate('() => { const t = document.querySelector("#code"); return t.value.slice(t.selectionStart, t.selectionEnd); }')


def get_row(page, key):
    """Returns the first row of the tree whose key holds a text.

    Args:
        page (Page): the editor page.
        key (str): the text of the key.

    Returns:
        Locator: the row.
    """
    return page.locator('#tree .trow', has=page.locator('.trow-k', has_text=key)).first


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True)
    ctx = browser.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL + '?lang=en', wait_until='networkidle')
    page.wait_for_timeout(800)

    # --- First visit: the welcome example ---
    check_that(get_state(page, 'S.name') == 'Welcome', 'the first visit opens the welcome example')
    check_that(get_state(page, 'S.problems.length') == 0, 'the example has no problems')
    root = page.locator('#tree .trow').first
    check_that('{8}' in root.inner_text() and 'object' in root.inner_text(), 'the root row shows its type and the number of keys')
    check_that('[4]' in get_row(page, 'features').inner_text(), 'a list shows [4]')
    check_that(get_row(page, 'version').locator('.t-number').count() == 1 and get_row(page, 'free').locator('.t-boolean').count() == 1 and get_row(page, 'account').locator('.t-null').count() == 1, 'numbers, booleans and null have their own type')
    check_that(get_row(page, 'defaults').locator('.trow-anchor').inner_text() == '&defaults', 'an anchor is marked')
    alias = page.locator('#tree .trow', has=page.locator('.t-alias')).first
    check_that('*defaults' in alias.inner_text() and '→ object' in alias.inner_text(), 'an alias is marked with what it points to')
    check_that('"A block of text keeps⏎its line breaks.⏎"' in get_row(page, 'note').inner_text(), 'a block text shows its line breaks')
    check_that(page.locator('#hl .c').count() >= 3 and page.locator('#hl .k').count() >= 8, 'comments and keys are highlighted')

    # --- Folding ---
    n = page.locator('#tree .trow').count()
    get_row(page, 'features').locator('.trow-toggle').click()
    page.wait_for_timeout(150)
    check_that(get_row(page, 'features').get_attribute('aria-expanded') == 'false' and page.locator('#tree .trow').count() == n - 4, 'a click on the arrow folds a list')
    page.click('#tree-close')
    page.wait_for_timeout(150)
    check_that(page.locator('#tree .trow').count() == 9, 'Fold everything leaves the root and its keys')
    page.click('#tree-open')
    page.wait_for_timeout(150)
    check_that(page.locator('#tree .trow').count() == n, 'Unfold everything shows every value again')

    # --- Tree -> code, code -> tree, path ---
    get_row(page, 'defaults').click()
    page.wait_for_timeout(150)
    check_that(get_code_selection(page) == 'defaults: &defaults        # an anchor ...\n  theme: auto\n  indent: 2', 'a click in the tree selects that entry in the code: ' + repr(get_code_selection(page)))
    page.evaluate('() => { const t = document.querySelector("#code"); const i = t.value.indexOf("Ctrl+E"); t.focus(); t.setSelectionRange(i + 2, i + 2); }')
    page.wait_for_timeout(400)
    check_that(page.locator('#tree .trow.active').inner_text().startswith('export'), 'the code cursor marks its value in the tree')
    check_that(page.inner_text('#path').replace('\n', '') == '$.settings.shortcuts.export', 'with its path: ' + page.inner_text('#path').replace('\n', ''))

    # --- Search ---
    page.fill('#tree-search', 'auto')
    page.wait_for_timeout(400)
    check_that(page.inner_text('#tree-hits') == '1 / 1' and 'theme' in page.locator('#tree .trow.active').inner_text(), 'search finds values')
    page.fill('#tree-search', '&defaults')
    page.wait_for_timeout(400)
    check_that(page.inner_text('#tree-hits').endswith('/ 1'), 'search finds anchors')
    page.fill('#tree-search', '')
    page.wait_for_timeout(300)

    # --- Several documents ---
    page.click('#btn-new')
    page.click('[data-new=kubernetes]')
    page.wait_for_timeout(300)
    check_that(get_state(page, 'S.name') == 'Kubernetes' and page.locator('#tree .trow-doc').count() == 2, 'New > Kubernetes: two documents, two trees')
    page.locator('#tree .trow-doc').nth(1).click()
    page.wait_for_timeout(150)
    check_that(page.locator('#tree .trow-doc').nth(1).get_attribute('aria-expanded') == 'false', 'a document folds')
    page.locator('#tree .trow-doc').nth(1).click()
    page.wait_for_timeout(150)
    page.evaluate('() => { const t = document.querySelector("#code"); const i = t.value.lastIndexOf("port: 80"); t.focus(); t.setSelectionRange(i + 1, i + 1); }')
    page.wait_for_timeout(400)
    check_that('Document 2' in page.inner_text('#path') and '$.spec.ports[0].port' in page.inner_text('#path').replace('\n', ''), 'the path names the document: ' + page.inner_text('#path').replace('\n', ' '))

    # --- Problems with line and column ---
    set_code(page, 'a: 1\nb:\n\t- x\n')
    probs = get_state(page, 'S.problems.map(p => p.kind + ":" + p.msg)')
    check_that(any('tab' in p.lower() for p in probs) and 'Line 3, column 1' in page.inner_text('#code-error'), 'a tab used for indentation is reported with line and column: ' + str(probs))
    set_code(page, 'a: 1\nb: 2\na: 3\n')
    check_that(any('twice' in p for p in get_state(page, 'S.problems.map(p => p.msg)')) and 'Line 3, column 1' in page.inner_text('#code-error'), 'a duplicate key is reported')
    set_code(page, 'a: *missing\n')
    check_that(any('no anchor &missing' in p for p in get_state(page, 'S.problems.map(p => p.msg)')), 'an alias without its anchor is reported')
    set_code(page, 'a: [1, 2\nb: 3\n')
    check_that(get_state(page, 'S.problems.filter(p => p.kind === "error").length') >= 1, 'a flow list that is never closed is reported')
    page.locator('#code-error [data-prob]').first.click()
    check_that(page.evaluate('document.activeElement.id') == 'code', 'clicking a problem goes to the code')

    # --- Format keeps comments ---
    set_code(page, '# top\na:    1   # one\nb:\n    - x\n    - y\n')
    page.click('#btn-format')
    page.wait_for_timeout(400)
    check_that(get_state(page, 'S.code') == '# top\na: 1 # one\nb:\n  - x\n  - y\n', 'Format: consistent indentation, comments stay: ' + repr(get_state(page, 'S.code')))

    # --- Convert ---
    set_code(page, '- id: 1\n  name: Apple\n  code: "007"\n- id: 2\n  name: Pear, green\n  code: x\n')
    show_side_panel(page, True)
    page.click('[data-itab=convert]')
    page.wait_for_timeout(300)
    check_that(page.input_value('#cv-out') == '[\n  {\n    "id": 1,\n    "name": "Apple",\n    "code": "007"\n  },\n  {\n    "id": 2,\n    "name": "Pear, green",\n    "code": "x"\n  }\n]\n', 'Convert to JSON')
    check_that(page.locator('#cv-other').is_visible(), 'with "Open in the JSON Editor"')
    page.select_option('#cv-to', 'csv')
    page.wait_for_timeout(300)
    check_that(page.input_value('#cv-out') == 'id,name,code\n1,Apple,007\n2,"Pear, green",x\n', 'Convert to CSV')
    page.select_option('#cv-to', 'xml')
    page.wait_for_timeout(300)
    check_that('<item>\n    <id>1</id>' in page.input_value('#cv-out'), 'Convert to XML')
    set_code(page, 'a: 1\n---\nb: 2\n')
    page.select_option('#cv-to', 'json')
    page.wait_for_timeout(300)
    check_that(page.input_value('#cv-out') == '[\n  {\n    "a": 1\n  },\n  {\n    "b": 2\n  }\n]\n' and 'several documents' in page.inner_text('#cv-note'), 'several documents become one JSON array, with a note')
    set_code(page, 'base: &b\n  x: 1\nchild:\n  <<: *b\n  y: 2\n')
    page.wait_for_timeout(300)
    check_that('"child": {\n    "x": 1,\n    "y": 2\n  }' in page.input_value('#cv-out'), 'merge keys are resolved when converting')

    # --- JSON Schema (a schema written in YAML) ---
    page.click('#btn-new')
    page.click('[data-new=blank]')
    page.wait_for_timeout(200)
    set_code(page, 'type: object\nrequired: [name]\nproperties:\n  name: {type: string}\n  port: {type: integer, maximum: 65535}\n')
    page.evaluate(f'{HOOK}.store.save({HOOK}.state.fileId, {{ name: "Server schema" }})')
    page.click('#btn-new')
    page.click('[data-new=blank]')
    page.wait_for_timeout(200)
    set_code(page, 'port: 70000\n')
    show_side_panel(page, True)
    page.click('[data-itab=schema]')
    page.wait_for_timeout(200)
    page.select_option('#sc-doc', label='Server schema')
    page.wait_for_timeout(400)
    sp = get_state(page, 'S.problems.filter(p => p.kind === "schema").map(p => p.msg)')
    check_that(any('required' in p for p in sp) and any('maximum' in p for p in sp), 'a schema in YAML checks the data: ' + str(sp))
    check_that('Line 1, column 7' in page.inner_text('#code-error'), 'schema problems have line and column')
    set_code(page, 'name: web\nport: 8080\n')
    check_that(get_state(page, 'S.problems.length') == 0 and 'fits the schema' in page.inner_text('#schema-wrap'), 'valid data fits the schema')
    page.click('[data-itab=node]')
    show_side_panel(page, False)

    # --- Templates, My documents ---
    page.click('#btn-new')
    page.click('[data-new=compose]')
    check_that(get_state(page, 'S.name') == 'Docker Compose' and get_state(page, 'S.problems.length') == 0, 'New > Docker Compose')
    page.click('#btn-files')
    check_that(page.locator('#files-grid .file-card').count() >= 4, 'My documents lists the documents')
    page.locator('#files-grid .file-card', has_text='Welcome').locator('.file-open').click()
    check_that(get_state(page, 'S.name') == 'Welcome', 'a document opens from My documents')

    # --- Opening JSON, CSV and XML ---
    d = tempfile.mkdtemp()
    with open(os.path.join(d, 'people.json'), 'w') as f:
        f.write('[{"name": "Ada", "born": 1815}, {"name": "Grace", "born": 1906}]')
    with open(os.path.join(d, 'catalog.xml'), 'w') as f:
        f.write('<catalog><book id="1"><title>A</title></book><book id="2"><title>B</title></book></catalog>')
    page.set_input_files('#file', [os.path.join(d, 'people.json'), os.path.join(d, 'catalog.xml')])
    page.wait_for_timeout(1200)
    docs = page.evaluate(f'{HOOK}.store.list().map(f => [f.name, {HOOK}.store.code(f.id)])')
    check_that(next((c for n_, c in docs if n_ == 'people'), '') == '- name: Ada\n  born: 1815\n- name: Grace\n  born: 1906\n', 'a JSON file is converted to YAML')
    check_that(next((c for n_, c in docs if n_ == 'catalog'), '') == 'book:\n  - "@id": 1\n    title: A\n  - "@id": 2\n    title: B\n', 'an XML file too')

    # --- JSON Lines ---
    with open(os.path.join(d, 'events.jsonl'), 'w') as f:
        f.write('{"id": 1, "level": "info"}\n{"id": 2, "tags": ["a", "b"]}\n')
    page.set_input_files('#file', os.path.join(d, 'events.jsonl'))
    page.wait_for_timeout(800)
    check_that(get_state(page, 'S.name') == 'events' and get_state(page, 'S.code') == '- id: 1\n  level: info\n- id: 2\n  tags:\n    - a\n    - b\n', 'a .jsonl file opens as a sequence: ' + repr(get_state(page, 'S.code')))
    show_side_panel(page, True)
    page.click('[data-itab=convert]')
    page.select_option('#cv-to', 'jsonl')
    page.wait_for_timeout(300)
    check_that(page.input_value('#cv-out') == '{"id":1,"level":"info"}\n{"id":2,"tags":["a","b"]}\n', 'Convert to JSON Lines: one line per entry of the root sequence')
    set_code(page, 'a: 1\n---\n- 2\n- 3\n')
    page.wait_for_timeout(300)
    check_that(page.input_value('#cv-out') == '{"a":1}\n[2,3]\n', 'several documents: one line per document')
    set_code(page, 'a: 1\nb: [2]\n')
    page.wait_for_timeout(300)
    check_that(page.input_value('#cv-out') == '{"a":1,"b":[2]}\n', 'one mapping: one line')
    page.click('[data-itab=node]')
    show_side_panel(page, False)

    # --- AI link to a new document, mode=add merges ---
    data = '# from the AI\nitems: [1, 2]\n'
    z = base64.urlsafe_b64encode(zlib.compress(data.encode())).decode().rstrip('=')
    page.goto(URL + '#z=' + z + '&file=new&name=AI%20data', wait_until='networkidle')
    page.wait_for_timeout(800)
    check_that(get_state(page, 'S.name') == 'AI data' and get_state(page, 'S.code') == data, 'an AI link makes a new document')
    link = 'https://yaml.giit.ch/#b64=' + base64.urlsafe_b64encode('more: true\nitems: [3]\n'.encode()).decode() + '&mode=add'
    answer = 'Here is the link:\n' + link[:40] + '\n' + link[40:] + '\nClick it.'
    page.click('#btn-ai')
    page.fill('#ai-paste', answer)
    page.wait_for_timeout(400)
    check_that(not page.locator('#ask').is_visible(), 'a link changes the document without a question')
    page.wait_for_timeout(400)
    check_that(get_state(page, 'S.code') == '# from the AI\nitems: [3]\nmore: true\n', 'mode=add merges into the root mapping, the comment stays: ' + repr(get_state(page, 'S.code')))
    set_code(page, '- a\n- b\n')
    page.evaluate(f'{HOOK}.receive("- c\\n", "add", {{ direct: true }})')
    page.wait_for_timeout(300)
    check_that(get_state(page, 'S.code') == '- a\n- b\n- c\n', 'and appends to the root sequence')

    # --- Export ---
    set_code(page, 'a:\n  - 1\n  - 2\nb: x\n')
    page.click('#btn-export')
    page.select_option('#ex-format', 'json')
    page.wait_for_timeout(200)
    check_that(page.input_value('#ex-text') == '{\n  "a": [\n    1,\n    2\n  ],\n  "b": "x"\n}\n', 'export: JSON')
    with page.expect_download() as dl:
        page.click('#ex-download')
    check_that(dl.value.suggested_filename == 'AI data.json', 'export: .json download')
    page.select_option('#ex-format', 'yaml')
    page.wait_for_timeout(200)
    with page.expect_download() as dl:
        page.click('#ex-download')
    check_that(dl.value.suggested_filename == 'AI data.yaml', 'export: .yaml as it is')
    page.select_option('#ex-format', 'txt')
    page.wait_for_timeout(200)
    check_that(page.input_value('#ex-text').startswith('$ {2}\n  a: [2]\n    [0]: 1 (number)'), 'export: the tree as plain text')
    with page.expect_download() as dl:
        page.click('#ex-zip')
    check_that(dl.value.suggested_filename.endswith('-all.zip'), 'export: all formats as ZIP')
    page.keyboard.press('Escape')

    # --- Typing help: Tab inserts spaces, Enter after "key:" indents ---
    set_code(page, 'a:')
    page.evaluate('() => { const t = document.querySelector("#code"); t.focus(); t.setSelectionRange(2, 2); }')
    page.keyboard.press('Enter')
    page.keyboard.type('b: 1')
    page.keyboard.press('Enter')
    page.keyboard.press('Tab')
    page.wait_for_timeout(300)
    check_that(get_state(page, 'S.code') == 'a:\n  b: 1\n    ', 'Enter after "key:" indents, Tab inserts spaces: ' + repr(get_state(page, 'S.code')))
    page.keyboard.press('Control+/')
    page.wait_for_timeout(200)

    # --- Phone ---
    page.set_viewport_size({'width': 390, 'height': 800})
    page.wait_for_timeout(300)
    check_that(page.locator('.views').is_visible(), 'phone: Code / Tree / Value tabs')
    check_that(page.evaluate('document.documentElement.scrollWidth') <= 391, 'phone: no sideways scrolling')
    page.click('[data-pane=code]')
    check_that(page.locator('#code').is_visible(), 'phone: the code view')

    check_that(not errors, 'no script errors' + (': ' + '; '.join(errors) if errors else ''))
    browser.close()

print(f'\n{len(failures)} failed' if failures else '\nall passed')
sys.exit(1 if failures else 0)
