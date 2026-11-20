"""AI status at the AI button and in the AI dialog: AI through the page,
browser agent (WebMCP) and AI links.

The button is green with a check mark only while an AI is connected: the page's AI from
its first result until the page ends the session ("clear"), a browser agent until 5
minutes after its last call (a Playwright test clock jumps over them). A document from an
AI link, in this tab or handed over from another, shows the check mark alone for about
3 seconds, then the normal button.

Start the editor first (php -S 127.0.0.1:8102 -t src src/php/router.php), then run this file from
the editor's folder. A second PHP server on 127.0.0.1:8097 (HOST_PORT2 overrides it),
started by the test, plays the page around the editor."""
import base64
import json
import os
import subprocess
import sys
import tempfile
import time

from playwright.sync_api import TimeoutError as PlaywrightTimeout, sync_playwright

P = 'yamleditor'
EDITOR = os.environ.get('EDITOR_URL', 'http://127.0.0.1:8102/')
CONTENT = 'hello: world\n'

HOST_PORT2 = os.environ.get('HOST_PORT2', '8097')          # the test's own host page
NOTICE_WAIT_MS = 6000                   # longer than the 3 seconds the check mark of an AI link shows
failed = []


def check_that(ok, text):
    """Prints one result and notes it when it failed.

    Args:
        ok (bool): True when the check passed.
        text (str): what was checked.

    Returns:
        None: the result goes to standard output and the list of failures.
    """
    print(('ok    ' if ok else 'FAIL  ') + text)
    if not ok:
        failed.append(text)


HOST = """<!doctype html><meta charset="utf-8"><title>Host</title>
<iframe id="f" src="EDITOR?embed=1" style="width:1200px;height:800px;border:0"></iframe>
<script>
const P = 'PFX', ORIGIN = new URL('EDITOR').origin;
const frame = document.getElementById('f');
const send = m => frame.contentWindow.postMessage(m, ORIGIN);
addEventListener('message', e => {
  if (e.source !== frame.contentWindow || e.data.type !== P + ':ready') return;
  send({ type: P + ':load', name: 'Page document', content: CONTENT,
         ai: { label: 'Example Admin', prompt: 'Be short.', endpoint: location.origin + '/result' } });
});
</script>"""

# A stand-in for WebMCP: the tools land in window.tools, a test calls one like an agent would.
FAKE_MCP = "window.tools = []; document.modelContext = { registerTool(t) { window.tools.push(t); } };"

def wait_for_button(page, state, timeout=NOTICE_WAIT_MS):
    """Waits until the AI button shows a state; on a timeout the check that follows reports it.

    Args:
        page (Page | Frame): the editor.
        state (str): "on", "delivered", "waiting" or "" for the normal button.
        timeout (int): the longest wait in milliseconds.

    Returns:
        None: it only waits.
    """
    try:
        page.wait_for_function('state => (document.getElementById("btn-ai").dataset.ai || "") === state', arg=state, timeout=timeout)
    except PlaywrightTimeout:
        pass


def get_state(pg):
    """Return the AI state shown at the AI button.

    Args:
        pg (Page | Frame): the editor.

    Returns:
        str: the button's data-ai, "" for none.
    """
    return pg.evaluate('document.getElementById("btn-ai").dataset.ai || ""')


def get_title(pg):
    """Return the tooltip of the AI button.

    Args:
        pg (Page | Frame): the editor.

    Returns:
        str: the title.
    """
    return pg.evaluate('document.getElementById("btn-ai").title')


def get_status_lines(pg):
    """Return the lines of the AI status in the dialog.

    Args:
        pg (Page | Frame): the editor.

    Returns:
        list[str]: each line's state and text.
    """
    return pg.evaluate('[...document.querySelectorAll("#ai-status li")].map(li => (li.dataset.ai || "-") + " " + li.textContent)')

with tempfile.TemporaryDirectory() as d:
    with open(os.path.join(d, 'host.html'), 'w') as f:
        f.write(HOST.replace('EDITOR', EDITOR).replace('PFX', P).replace('CONTENT', json.dumps(CONTENT)))
    server = subprocess.Popen(['php', '-S', f'127.0.0.1:{HOST_PORT2}', '-t', d], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel='chrome', headless=True)
            ctx = browser.new_context(viewport={'width': 1360, 'height': 860})
            errors = []

            # Top level, no WebMCP, one tab: nothing delivered yet
            a = ctx.new_page()
            a.on('pageerror', lambda e: errors.append(str(e)))
            a.goto(EDITOR, wait_until='load')
            a.wait_for_timeout(1200)
            check_that(get_state(a) == '', 'a new page: the AI button is normal')
            s = get_status_lines(a)
            check_that(len(s) == 4 and s[0] == '- AI in this session: nothing received yet - copy the prompt for your AI', 'dialog: nothing received yet: ' + str(s[:1]))
            check_that(s[1] == '- AI through a website: not connected', 'dialog: no AI through a website')
            check_that(s[2] == '- Browser agent (WebMCP): not offered by this browser', 'dialog: no WebMCP in this browser')
            check_that(s[3] == 'on AI links: arrive in this tab', 'dialog: links arrive in the only tab')
            check_that('AI links: arrive in this tab' in get_title(a) and 'nothing received yet' in get_title(a), 'the button title lists the state and the ways')

            # A document from an AI link: the check mark for about 3 seconds, not green (no lasting connection)
            b64 = base64.urlsafe_b64encode(CONTENT.encode()).decode().rstrip('=')
            a.goto(EDITOR + '#b64=' + b64, wait_until='load')
            wait_for_button(a, 'delivered')
            shown_at = time.monotonic()
            check_that(get_state(a) == 'delivered', 'a document from an AI link: the check mark shows, the button is not green')
            check_that(get_status_lines(a)[0] == 'on AI in this session: a document from an AI link, just now', 'dialog: delivered by a link: ' + get_status_lines(a)[0])
            check_that(a.evaluate("getComputedStyle(document.getElementById('btn-ai'), '::after').content") == '"✓"', 'with a check mark')
            wait_for_button(a, '')
            shown_for = time.monotonic() - shown_at
            check_that(get_state(a) == '' and 1.5 < shown_for < 5, f'the button is normal again after about 3 seconds ({shown_for:.1f} s)')
            check_that('a document from an AI link' in get_status_lines(a)[0], 'the dialog still names the delivery')
            a.goto(EDITOR, wait_until='load')
            a.wait_for_timeout(1200)
            check_that(get_state(a) == '', 'a new page starts normal again (nothing is stored)')
            # The usual way: the AI's link opens a new tab, which hands the document to the open editor tab
            a.evaluate('dispatchEvent(new Event("focus"))')
            c = ctx.new_page()
            c.goto(EDITOR + '#b64=' + b64, wait_until='load')
            wait_for_button(a, 'delivered', NOTICE_WAIT_MS + 2000)
            check_that(get_state(a) == 'delivered' and 'a document from an AI link' in get_status_lines(a)[0], 'a link opened in another tab shows the check mark in the open editor')
            wait_for_button(a, '')
            check_that(get_state(a) == '', '... and then the normal button')
            c.close()
            a.goto(EDITOR, wait_until='load')
            a.wait_for_timeout(1200)

            # A second editor tab with WebMCP takes the focus: links go there; an agent call turns it green
            b = ctx.new_page()
            b.on('pageerror', lambda e: errors.append(str(e)))
            b.add_init_script(FAKE_MCP)
            b.clock.install()
            b.goto(EDITOR, wait_until='load')
            b.wait_for_timeout(800)
            b.evaluate('dispatchEvent(new Event("focus"))')
            a.wait_for_timeout(500)
            check_that(get_status_lines(a)[3] == '- AI links: go to another editor tab (the one used last)', 'the other tab knows links go to the tab used last')
            check_that(get_status_lines(b)[3] == 'on AI links: arrive in this tab', 'the focused tab says links arrive there')
            check_that(get_status_lines(b)[2] == '- Browser agent (WebMCP): available, not used yet', 'WebMCP offered, not used yet')
            check_that(get_state(b) == '', 'WebMCP offered but not used: the button is normal')
            b.evaluate('window.tools.find(t => t.name === "undo").execute({})')
            b.wait_for_timeout(300)
            check_that(get_state(b) == 'on' and get_status_lines(b)[0] == 'on AI in this session: a browser agent (WebMCP), just now', 'an agent call turns it green: ' + get_status_lines(b)[0])
            check_that(get_state(a) == '', 'the other tab stays normal')
            b.clock.fast_forward('05:01')
            b.wait_for_timeout(300)
            check_that(get_state(b) == '' and get_status_lines(b)[2] == '- Browser agent (WebMCP): available, last used 5 min ago', '5 minutes after the last agent call the button is normal again: ' + get_status_lines(b)[2])
            a.evaluate('dispatchEvent(new Event("focus"))')
            b.wait_for_timeout(500)
            check_that(get_status_lines(b)[3] == '- AI links: go to another editor tab (the one used last)', 'back in the first tab, links go there again')
            b.close()
            a.wait_for_timeout(500)
            check_that(get_status_lines(a)[3] == 'on AI links: arrive in this tab', 'a closed tab no longer counts')

            # Inside a page: the page's AI without a key, with the key, then a result from the AI
            h = ctx.new_page()
            h.on('pageerror', lambda e: errors.append(str(e)))
            h.goto(f'http://127.0.0.1:{HOST_PORT2}/host.html', wait_until='load')
            h.wait_for_timeout(2500)
            fr = next(x for x in h.frames if x.url.startswith(EDITOR))
            check_that(get_state(fr) == 'waiting', 'endpoint without a key: yellow dot')
            s = get_status_lines(fr)
            check_that(s[1] == f'waiting AI through Example Admin (127.0.0.1:{HOST_PORT2}): connected, waiting for the key', 'dialog: waiting for the key: ' + s[1])
            check_that(s[3] == "- AI links: cannot reach the editor inside this website - paste the AI's answer here", 'inside a website links cannot reach the editor')
            h.evaluate("document.getElementById('f').contentWindow.postMessage({ type: '%s:ai', key: 'k'.repeat(48) }, new URL('%s').origin)" % (P, EDITOR))
            h.wait_for_timeout(2500)
            check_that(get_state(fr) == '', 'with the key but nothing delivered yet: the button is normal')
            check_that(get_status_lines(fr)[1] == f'on AI through Example Admin (127.0.0.1:{HOST_PORT2}): connected', 'dialog: connected')
            h.evaluate("document.getElementById('f').contentWindow.postMessage({ type: '%s:load', name: 'Page document', content: %s, from: 'ai' }, new URL('%s').origin)" % (P, json.dumps(CONTENT), EDITOR))
            h.wait_for_timeout(1500)
            check_that(get_state(fr) == 'on' and get_status_lines(fr)[0] == 'on AI in this session: a result through the page, just now', 'a result from the AI through the page turns it green: ' + get_status_lines(fr)[0])
            h.wait_for_timeout(4000)
            check_that(get_state(fr) == 'on', 'still green 4 seconds later: the page\'s AI stays connected')
            # A new document from the AI is a document of its own: the session goes on, the button stays green
            h.evaluate("document.getElementById('f').contentWindow.postMessage({ type: '%s:load', name: 'Other', content: %s, from: 'ai', target: 'new' }, new URL('%s').origin)" % (P, json.dumps(CONTENT), EDITOR))
            h.wait_for_timeout(2500)
            check_that(get_state(fr) == 'on', 'a new document from the AI: still green')
            # The page ends its AI session (popup closed): normal again; a new key alone does not make it green
            h.evaluate("document.getElementById('f').contentWindow.postMessage({ type: '%s:ai', clear: true }, new URL('%s').origin)" % (P, EDITOR))
            h.wait_for_timeout(500)
            check_that(get_state(fr) == '' and get_status_lines(fr)[0] == '- AI in this session: nothing received yet - copy the prompt for your AI', 'the page ends the session: the button is normal again: ' + get_status_lines(fr)[0])
            h.evaluate("document.getElementById('f').contentWindow.postMessage({ type: '%s:ai', label: 'Example Admin', prompt: 'Be short.', endpoint: location.origin + '/result', key: 'm'.repeat(48) }, new URL('%s').origin)" % (P, EDITOR))
            h.wait_for_timeout(2500)
            check_that(get_state(fr) == '', 'a new session with a new key: normal until the AI delivers')
            h.reload(wait_until='load')
            h.wait_for_timeout(2500)
            fr = next(x for x in h.frames if x.url.startswith(EDITOR))
            check_that(get_state(fr) == 'waiting', 'after reloading the page: no longer green')

            check_that(not errors, 'no script errors: ' + '; '.join(errors))
            browser.close()
    finally:
        server.terminate()

print()
print('all passed' if not failed else f'{len(failed)} failed')
sys.exit(1 if failed else 0)
