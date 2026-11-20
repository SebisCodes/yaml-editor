"""The editor in its own window (window.open with ?embed=window).

    php -S 127.0.0.1:8102 -t src src/php/router.php          (in the project folder)
    python tests/window_test.py

A host page opens the editor, hands it a document with "context" (for the
AI prompt) and a "hook" (webhook for that document), and gets "save" and
"closing" messages; a small PHP webhook records the body and can answer
with an error."""

import json
import os
import subprocess
import sys
import tempfile
import time

from playwright.sync_api import sync_playwright

EDITOR = os.environ.get('EDITOR_URL', 'http://127.0.0.1:8102/')
DOC = 'dossier: 17\n'
EDIT = 'edited: true\n'
HOST_PORT = os.environ.get('HOST_PORT', '8096')          # the test's own host page
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


HOST = """<!doctype html><meta charset="utf-8"><title>host</title>
<button id="open">open</button>
<script>
window.log = [];
let win = null;
document.getElementById('open').onclick = () => { win = window.open('EDITOR?embed=window', 'yamleditor-17'); };
addEventListener('message', async e => {
  if (!win || e.source !== win) return;
  log.push(e.data);
  if (e.data.type === 'yamleditor:ready') {
    win.postMessage({ type: 'yamleditor:load', name: 'Dossier 17', content: DOC,
      context: { host: 'bhvpartner.ch Verwaltung', title: 'Verkaufsdossier Villa Zug', rules: 'Keep the [[placeholders]].' },
      hook: { url: location.origin + '/hook.php', token: 'secret' } }, new URL('EDITOR').origin);
  }
});
window.ask = () => win.postMessage({ type: 'yamleditor:get' }, new URL('EDITOR').origin);
</script>"""

HOOK = """<?php
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Private-Network: true');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit;
if (file_exists(__DIR__ . '/fail')) { http_response_code(422); echo '{"ok":false,"error":"Dossier is locked"}'; exit; }
file_put_contents(__DIR__ . '/hook.json', json_encode(['auth' => $_SERVER['HTTP_AUTHORIZATION'] ?? '', 'body' => json_decode(file_get_contents('php://input'), true)]));
echo '{"ok":true}';
"""

with tempfile.TemporaryDirectory() as d:
    with open(os.path.join(d, 'host.html'), 'w') as f:
        f.write(HOST.replace('EDITOR', EDITOR).replace('DOC', json.dumps(DOC)))
    with open(os.path.join(d, 'hook.php'), 'w') as f:
        f.write(HOOK)
    server = subprocess.Popen(['php', '-S', '127.0.0.1:' + HOST_PORT, '-t', d], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel='chrome', headless=True, args=['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights'])
            ctx = browser.new_context(viewport={'width': 1360, 'height': 860})
            ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin=EDITOR.rstrip('/'))
            host = ctx.new_page()
            errors = []
            host.goto('http://127.0.0.1:' + HOST_PORT + '/host.html', wait_until='networkidle')
            with ctx.expect_page() as pi:
                host.click('#open')
            ed = pi.value
            ed.on('pageerror', lambda e: errors.append(str(e)))
            ed.wait_for_load_state('networkidle')
            ed.wait_for_timeout(2500)
            types = lambda: host.evaluate('log.map(m => m.type)')
            check_that(types()[:2] == ['yamleditor:ready', 'yamleditor:loaded'], 'ready to the opener, then loaded')
            check_that(ed.evaluate('yamlEditor.state.name') == 'Dossier 17', 'the document from the page is open')
            check_that(not ed.evaluate('document.documentElement.classList.contains("embedded")'), 'own window: the full editor')
            check_that(ed.locator('#btn-save').is_visible(), 'own window: Save button')

            # The AI prompt speaks about the page, not about building servers
            ed.click('#btn-ai')
            ed.click('#ai-copy')
            ed.wait_for_timeout(300)
            prompt = ed.evaluate('navigator.clipboard.readText()')
            check_that('"bhvpartner.ch Verwaltung"' in prompt and 'Verkaufsdossier Villa Zug' in prompt and 'Keep the [[placeholders]].' in prompt, 'the prompt names the page and its rules')
            check_that('MY OWN SERVER' not in prompt, 'the prompt leaves out how to build a webhook server')
            ed.keyboard.press('Escape')

            # Edit, save: to the opener and to the webhook (without pictures)
            ed.evaluate('s => { const t = document.querySelector("#code"); t.focus(); t.setSelectionRange(0, 0); document.execCommand("insertText", false, s); }', EDIT)
            ed.wait_for_timeout(700)
            check_that('yamleditor:change' in types(), 'an edit is reported to the opener')
            ed.keyboard.press('Control+s')
            ed.wait_for_timeout(1500)
            last = [m for m in host.evaluate('log') if m['type'] == 'yamleditor:save']
            check_that(last and EDIT in last[-1]['content'], 'Save hands the document to the opener')
            try:
                with open(os.path.join(d, 'hook.json')) as f:
                    got = json.load(f)
            except FileNotFoundError:
                got = {'auth': '', 'body': {}}
            check_that(got['auth'] == 'Bearer secret' and EDIT in got['body'].get('content', ''), 'Save also goes to the webhook from "load"')
            check_that('assets' not in got['body'] and got['body'].get('editor') == 'yaml', 'the webhook body has no assets (the editor has no files)')
            check_that(ed.evaluate('localStorage.getItem("yamleditor.hook")') is None and 'hook.php' not in ed.evaluate('JSON.stringify(localStorage)'), 'the webhook from the page is not stored')

            # The server's error text is shown
            open(os.path.join(d, 'fail'), 'w').close()
            ed.evaluate('() => { const t = document.querySelector("#code"); t.focus(); t.setSelectionRange(0, 0); document.execCommand("insertText", false, "x: 1\\n"); }')
            ed.keyboard.press('Control+s')
            ed.wait_for_timeout(1200)
            check_that('Dossier is locked' in ed.inner_text('#toast'), 'the server\'s error text is shown: ' + ed.inner_text('#toast'))
            os.remove(os.path.join(d, 'fail'))

            # get always answers
            n = len(types())
            host.evaluate('ask()')
            host.wait_for_timeout(300)
            check_that(types()[n:] == ['yamleditor:save'], 'get is answered with save')

            # Closing with unsaved changes
            ed.evaluate('() => { const t = document.querySelector("#code"); t.focus(); t.setSelectionRange(0, 0); document.execCommand("insertText", false, "y: 2\\n"); }')
            ed.wait_for_timeout(600)
            ed.close(run_before_unload=True)
            host.wait_for_timeout(500)
            closing = [m for m in host.evaluate('log') if m['type'] == 'yamleditor:closing']
            check_that(closing and EDIT in closing[-1]['content'] and closing[-1]['name'] == 'Dossier 17', 'closing with unsaved changes tells the opener')
            check_that(not errors, 'no script errors' + (': ' + '; '.join(errors) if errors else ''))
            browser.close()
    finally:
        server.terminate()

print(f'\n{len(failures)} failed' if failures else '\nall passed')
sys.exit(1 if failures else 0)
