"""AI through the page's own server: prompt and session key from the page.

    php -S 127.0.0.1:8102 -t src src/php/router.php          (in the project folder)
    python tests/remote_test.py

A host page embeds the editor and hands it its own prompt, an endpoint on
its site and a key for this editor session. The test copies the prompt like
a user, plays the AI (POSTs the result with the key to the host's small PHP
backend), the host page opens the result in the editor; a second result as a
new document stays local. Then the user edits and saves. Also checks what
must not work."""

import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

from playwright.sync_api import sync_playwright

P = 'yamleditor'
EDITOR = os.environ.get('EDITOR_URL', 'http://127.0.0.1:8102/')
START = '# keep me\ntext: Old text.\n'
RESULT = '# keep me\ntext: "Written by the AI: \\"quotes\\" & more."\n'
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
<iframe id="f" src="EDITOR?embed=1" allow="clipboard-write" style="width:1300px;height:820px;border:0"></iframe>
<script>
const P = 'PFX', ORIGIN = new URL('EDITOR').origin;
const frame = document.getElementById('f');
window.log = [];
const send = m => frame.contentWindow.postMessage(m, ORIGIN);
const newKey = async () => (await fetch('api.php?a=key')).json();
window.keyAnswers = 0;
addEventListener('message', async e => {
  if (e.source !== frame.contentWindow || e.origin !== ORIGIN) return;
  log.push(e.data);
  if (e.data.type === P + ':ready') {
    const k = await newKey();
    send({ type: P + ':load', name: 'Dossier 17', content: START, ai: {
      label: 'Example Admin', prompt: 'Write in German. Keep the [[placeholders]].',
      endpoint: location.origin + '/api.php?a=submit', key: k.key } });
  }
  if (e.data.type === P + ':key-request') { keyAnswers++; const k = await newKey(); send({ type: P + ':ai', key: k.key }); }
});
// The page learns from its server that the AI sent a result and opens it.
setInterval(async () => {
  const r = await (await fetch('api.php?a=poll')).json();
  if (!r.content) return;
  send({ type: P + ':load', name: r.name, content: r.content, from: 'ai', target: r.target });
}, 400);
</script>"""

API = """<?php
// A tiny customer backend: one-time keys, the AI's submission, the page's poll.
$db = __DIR__ . '/keys.json';
$keys = file_exists($db) ? json_decode(file_get_contents($db), true) : [];
$a = $_GET['a'] ?? '';
header('Content-Type: application/json');
if ($a === 'key') {
    $k = bin2hex(random_bytes(24));
    $keys[hash('sha256', $k)] = ['exp' => time() + 600, 'used' => false];
    file_put_contents($db, json_encode($keys));
    echo json_encode(['key' => $k, 'expires' => (time() + 600) * 1000]);
} elseif ($a === 'submit') {
    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    $h = hash('sha256', preg_replace('/^Bearer\\s+/', '', $auth));
    if (!isset($keys[$h]) || $keys[$h]['exp'] < time()) { http_response_code(401); echo '{"ok":false,"error":"key not valid"}'; exit; }
    $d = json_decode(file_get_contents('php://input'), true);
    file_put_contents(__DIR__ . '/result.json', json_encode(['name' => 'Dossier 17', 'content' => $d['content'], 'target' => $d['target'] ?? 'current']));
    echo '{"ok":true}';
} elseif ($a === 'poll') {
    $f = __DIR__ . '/result.json';
    if (file_exists($f)) { echo file_get_contents($f); unlink($f); } else echo '{}';
}
"""


def send_result(url, key, content, target='current'):
    """Sends a result to the host's backend as the AI would.

    Args:
        url (str): the endpoint.
        key (str): the session key.
        content (str): the YAML document.
        target (str): "current" or "new".

    Returns:
        int: the HTTP status of the answer.
    """
    body = json.dumps({'editor': 'yaml', 'target': target, 'name': 'x', 'content': content}).encode()
    req = urllib.request.Request(url, data=body, method='POST', headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
    try:
        return urllib.request.urlopen(req).status
    except urllib.error.HTTPError as e:
        return e.code


with tempfile.TemporaryDirectory() as d:
    with open(os.path.join(d, 'host.html'), 'w') as f:
        f.write(HOST.replace('EDITOR', EDITOR).replace('PFX', P).replace('START', json.dumps(START)))
    with open(os.path.join(d, 'api.php'), 'w') as f:
        f.write(API)
    server = subprocess.Popen(['php', '-S', '127.0.0.1:' + HOST_PORT, '-t', d], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel='chrome', headless=True)
            ctx = browser.new_context(viewport={'width': 1360, 'height': 860})
            ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
            page = ctx.new_page()
            errors, editor_requests = [], []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('request', lambda r: editor_requests.append(r.url) if 'api.php?a=submit' in r.url else None)
            page.goto('http://127.0.0.1:' + HOST_PORT + '/host.html', wait_until='load')
            page.wait_for_timeout(3000)
            frame = next(fr for fr in page.frames if fr.url.startswith(EDITOR))

            # The dialog shows the connection, with the real origin and what the page tells the AI
            frame.click('#btn-ai')
            check_that(frame.locator('#ai-remote').is_visible() and frame.inner_text('#ai-remote-host') == 'Example Admin (127.0.0.1:' + HOST_PORT + ')', 'AI dialog: connected to the page, with its real origin')
            check_that(frame.locator('#ai-remote-details').is_visible() and 'Keep the [[placeholders]]' in frame.evaluate('document.querySelector("#ai-remote-prompt").textContent'), 'the dialog shows what the page tells the AI')
            check_that(frame.locator('#ai-key-copy').count() == 0 and frame.locator('.ai-target').is_visible(), 'only "Copy prompt", with the choice current / new')
            if os.environ.get('SHOT'):
                frame.locator('#ai').screenshot(path=os.environ['SHOT'])

            # Copy the prompt
            frame.click('#ai-copy')
            page.wait_for_timeout(300)
            prompt = page.evaluate('navigator.clipboard.readText()')
            m = re.search(r'POST (\S+)\n\s+Authorization: Bearer (\S+)', prompt)
            check_that(m is not None and m.group(1) == 'http://127.0.0.1:' + HOST_PORT + '/api.php?a=submit', 'the prompt says where to POST')
            check_that('INSTRUCTIONS FROM THE WEBSITE 127.0.0.1:' + HOST_PORT + ' ("Example Admin")\n```text\nWrite in German. Keep the [[placeholders]].\n```' in prompt, 'the page\'s prompt is in it, fenced and with its real origin')
            check_that('Write the complete YAML document (spaces for indentation' in prompt and '"editor":"yaml"' in prompt, 'the prompt asks for a complete YAML document, with editor "yaml"')
            check_that('"target":"current"' in prompt and 'Change my document "Dossier 17"' in prompt, 'the prompt asks to change the current document')
            check_that('Old text.' in prompt and 'WHAT THE EDITOR SHOWS' in prompt and 'MY OWN SERVER' not in prompt, 'with the document and the editor\'s knowledge, without the webhook part')
            key = m.group(2) if m else ''
            host_id = frame.evaluate('yamlEditor.state.fileId')
            loaded = [x for x in page.evaluate('log') if x['type'] == P + ':loaded']
            check_that(loaded and loaded[0].get('id') == host_id, '"loaded" names the id of the document')

            # Play the AI: POST the result with the key
            check_that(send_result(m.group(1), key, RESULT) == 200, 'the AI sends its result with the key')
            page.wait_for_timeout(1500)
            check_that(frame.evaluate('yamlEditor.state.code') == RESULT and frame.evaluate('yamlEditor.state.fileId') == host_id, 'the page opens the result in its document')
            check_that('result from Example Admin is open' in frame.inner_text('#toast'), 'the user is told the AI\'s result is open')

            # A new document from the AI: separate and local
            frame.click('#btn-ai')
            frame.click('.ai-target label:has([value=new])')
            frame.click('#ai-copy')
            page.wait_for_timeout(300)
            p2 = page.evaluate('navigator.clipboard.readText()')
            check_that('"target":"new"' in p2 and 'Make a NEW' in p2, 'the prompt asks for a new document')
            check_that(send_result(m.group(1), key, RESULT.replace('Written by the AI', 'A second one'), 'new') == 200, 'the same session key delivers a second result')
            page.wait_for_timeout(1500)
            check_that(frame.evaluate('yamlEditor.state.name') == 'Dossier 17 (AI)' and frame.evaluate('yamlEditor.state.fileId') != host_id, 'target new opens a separate document')
            check_that('not saved to Example Admin' in frame.inner_text('#toast'), 'the user is told it stays in the browser')
            n = len(page.evaluate('log'))
            frame.evaluate('() => { const t = document.querySelector("#code"); t.focus(); t.setSelectionRange(0, 0); document.execCommand("insertText", false, "x: 1\\n"); }')
            page.wait_for_timeout(700)
            frame.click('#btn-save')
            page.wait_for_timeout(400)
            later = [x['type'] for x in page.evaluate('log')[n:]]
            check_that(P + ':save' not in later and P + ':change' not in later, 'edits and Save of that document do not go to the page')
            page.evaluate("send({ type: P + ':get' })")
            page.wait_for_timeout(300)
            got = page.evaluate('log[log.length - 1]')
            check_that(got['type'] == P + ':save' and got['id'] == host_id and got['content'] == RESULT, 'get answers with the page\'s document, not the open one')
            frame.click('#btn-ai')
            check_that(frame.locator('#ai-remote').is_hidden(), 'the AI connection applies only to the page\'s document')
            page.keyboard.press('Escape')

            # Back to the page's document; one key for the whole session
            page.evaluate("send({ type: P + ':load', name: 'Dossier 17', content: " + json.dumps(RESULT) + " })")
            page.wait_for_timeout(800)
            check_that(frame.evaluate('yamlEditor.state.fileId') == host_id, 'a load from the page goes into its own document again')
            before = page.evaluate('keyAnswers')
            page.evaluate("send({ type: P + ':ai', key: 'b'.repeat(48), expires: Date.now() - 1000 })")
            page.wait_for_timeout(200)
            frame.click('#btn-ai')
            check_that('valid while the editor is open' in frame.inner_text('#ai-key-exp'), 'the key is shown as valid while the editor is open')
            frame.click('#ai-copy')
            page.wait_for_timeout(1200)
            p3 = page.evaluate('navigator.clipboard.readText()')
            check_that(page.evaluate('keyAnswers') == before and ('Bearer ' + key) in p3, 'the session keeps its key: no key-request, no expiry, no second key')
            check_that(send_result(m.group(1), key, RESULT) == 200, 'the session key still delivers later')
            page.wait_for_timeout(1500)
            # After "clear" the session has no key; the editor asks once, with reason "missing"
            page.evaluate("send({ type: P + ':ai', clear: true }); send({ type: P + ':ai', label: 'Example Admin', prompt: 'Write in German.', endpoint: location.origin + '/api.php?a=submit' })")
            page.wait_for_timeout(200)
            n = len(page.evaluate('log'))
            frame.click('#btn-ai')
            frame.click('#ai-copy')
            page.wait_for_timeout(1200)
            reqs = [x for x in page.evaluate('log')[n:] if x['type'] == P + ':key-request']
            p4 = page.evaluate('navigator.clipboard.readText()')
            check_that(len(reqs) == 1 and reqs[0].get('reason') == 'missing' and 'Authorization: Bearer' in p4 and ('Bearer ' + key) not in p4, 'without a key the editor asks once ("missing") and uses the new key')

            # Edit and save as usual
            frame.evaluate('() => { const t = document.querySelector("#code"); t.focus(); t.setSelectionRange(0, 0); document.execCommand("insertText", false, "checked: true\\n"); }')
            frame.click('#btn-save')
            page.wait_for_timeout(400)
            last = page.evaluate('log[log.length - 1]')
            check_that(last['type'] == P + ':save' and last['content'] == 'checked: true\n' + RESULT, 'after editing, Save hands it to the page')

            # What must not work
            check_that(not editor_requests, 'the editor itself never calls the endpoint (only the AI does)')
            stored = frame.evaluate('JSON.stringify(localStorage)')
            check_that(key not in stored and 'api.php' not in stored, 'key and endpoint are not stored in the browser')
            page.evaluate("send({ type: P + ':ai', endpoint: 'https://evil.example/collect' })")
            page.wait_for_timeout(200)
            check_that('must be https:// on the site' in frame.inner_text('#toast'), 'an endpoint on another site is refused: ' + frame.inner_text('#toast'))
            frame.click('#btn-ai')
            check_that(frame.inner_text('#ai-key-exp') == '', 'then there is no address for the AI')
            frame.click('#ai-copy')
            page.wait_for_timeout(300)
            check_that('evil.example' not in page.evaluate('navigator.clipboard.readText()'), 'and the prompt does not contain it')
            page.evaluate("send({ type: P + ':ai', clear: true }); send({ type: P + ':ai', endpoint: location.origin + '/api.php?a=submit', key: 'short' })")
            page.wait_for_timeout(200)
            check_that('key from the page is not valid' in frame.inner_text('#toast'), 'a weak key is refused')
            # A message from another window (not the parent) is ignored
            other = ctx.new_page()
            other.goto('http://127.0.0.1:' + HOST_PORT + '/api.php?a=poll')
            frame.evaluate("() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'PFX:ai', key: 'x'.repeat(40) }, origin: 'https://evil.example', source: window }))".replace('PFX', P))
            page.wait_for_timeout(200)
            check_that(frame.evaluate('yamlEditor.sync().getAiSettings().key') != 'x' * 40, 'messages not from the page around the editor are ignored')
            check_that(not errors, 'no script errors' + (': ' + '; '.join(errors) if errors else ''))
            browser.close()
    finally:
        server.terminate()

print(f'\n{len(failures)} failed' if failures else '\nall passed')
sys.exit(1 if failures else 0)
