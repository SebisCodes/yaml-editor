"""Language pages (/de/, /fr/, /it/ … one per language pack): every visible text of the
interface is translated, the page text and head are in that language with
hreflang links, the AI prompt stays English, no language is stored in the browser, the
language menu switches pages with ?setlang= and ?lang=xx serves the page in that language
(for embedding).

Start the editor first (php -S 127.0.0.1:8102 -t src src/php/router.php), then run this file from the
editor's folder. SHOW=1 lists every untranslated text; LANGS=fr,it tests only those."""
import os
import sys

from playwright.sync_api import sync_playwright

NAME = os.path.basename(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PORTS = {'latex-editor': 8094, 'svg-editor': 8093, 'html-editor': 8095, 'md-editor': 8192, 'json-editor': 8101,
         'yaml-editor': 8102, 'xml-editor': 8103, 'csv-editor': 8104, 'typst-editor': 8105, 'shls-editor': 8106}
# The interface is tested in English and in one other language; the packs of all languages share their
# keys (checked in giit-editors-lang). LANGS=fr,it tests other languages.
LANGS = [l for l in os.environ.get('LANGS', 'de').split(',') if l]
# Words that are the same in a language and in English (besides SAME below).
SAME_LANG = {'de': set(), 'fr': {'Type', 'https://example.com/api/yaml', 'webhook'}, 'it': {'Alt', 'File', 'Output', 'Schema', 'webhook'}, 'es': {'webhook'}, 'ru': {'Alt', 'Escape', 'https://example.com/api/yaml'}, 'zh': {'Alt', 'Escape', 'Schema', 'https://example.com/api/yaml'}, 'tr': {'Alt', 'Escape', 'https://example.com/api/yaml', 'webhook'}, 'ja': {'Alt', 'Escape', 'https://example.com/api/yaml'}, 'pt': {'Escape', 'Schema', 'https://example.com/api/yaml', 'webhook'}, 'ko': {'Alt', 'Escape', 'https://example.com/api/yaml'}, 'pl': {'Alt', 'Escape', 'https://example.com/api/yaml', 'webhook'}, 'nl': {'Alt', 'Escape', 'Help', 'Schema', 'Type', 'https://example.com/api/yaml', 'webhook'}, 'uk': {'Alt', 'Escape', 'https://example.com/api/yaml'}}
EDITOR = os.environ.get('EDITOR_URL', f'http://127.0.0.1:{PORTS.get(NAME, 8094)}/')

# The same in both languages: names, formats, keys, units, numbers.
SAME = {
    'AI', 'PDF', 'PNG', 'JPG', 'JPEG', 'WebP', 'SVG', 'HTML', 'ZIP', 'CSS', 'JSX', 'LaTeX', 'TeX', 'Markdown', 'MD',
    'React', 'Ctrl', 'Esc', 'Tab', 'Enter', 'OK', 'WebMCP', 'Webhook', 'Token', 'Text', 'Layout', 'Logo', 'Name',
    'Export', 'Zoom', 'Grid', 'pt', 'px', 'mm', 'cm', 'in', 'em', 'dpi', 'A4', 'A5', 'Letter', 'Legal', 'B5',
    'Latin Modern', 'Helvetica', 'Times', 'Palatino', 'KaTeX', 'ChatGPT', 'Claude', 'Gemini', 'Copilot', 'x', '×',
    'Grünwald Innovation', 'giit.ch', 'http://', 'https://', 'Design', 'Format', 'Status', 'Portrait', 'Info',
    'Code', 'Link', 'Shift', 'online', 'llms.txt', '192 dpi', '384 dpi', '\\today', 'https://example.com/api/latex',
}
# The same in every language: the Alt key, words written alike (Schema, Integral, Unicode).
SAME_ANY = {'Alt', 'Schema', '∫ Integral', 'Unicode (UTF-8)'}
IGNORE_CHARS = set('0123456789 .,:;!?%×x()+-–—/·•…#@*=<>"\'[]{}|\\_~^`$&')


def get_visible_texts(page):
    """Returns the visible interface texts and titles (outside the page text, code, preview and user content).

    Args:
        page (Page): the editor page.

    Returns:
        list[str]: the texts, each once.
    """
    return page.evaluate("""() => {
      const roots = '.header, .views, #work, #ai-receive, #toast, dialog';
      const skip = '[data-no-i18n], textarea, code, pre, [contenteditable="true"], .page-text, .footer';
      const out = new Set();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      let n;
      while ((n = walker.nextNode())) {
        const el = n.nodeType === 1 ? n : n.parentElement;
        if (!el || !el.closest(roots) || el.closest(skip)) continue;
        const shown = el.closest('dialog') ? true : !!(el.offsetParent || el.getClientRects().length);
        if (!shown) continue;
        if (n.nodeType === 3) { const t = n.nodeValue.trim(); if (t) out.add(t); }
        else for (const a of ['title', 'aria-label', 'placeholder']) { const v = n.getAttribute(a); if (v) v.split('\\n').forEach(l => l.trim() && out.add(l.trim())); }
      }
      return [...out];
    }""")


def open_all(page):
    """Opens every dialog, so that their texts are in the DOM and counted.

    Args:
        page (Page): the editor page.

    Returns:
        None: the dialogs are open.
    """
    page.evaluate("document.querySelectorAll('dialog').forEach(d => { if (!d.open) d.show(); })")
    page.wait_for_timeout(300)


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


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True)
    ctx = browser.new_context(viewport={'width': 1400, 'height': 900})
    ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
    errors = []

    en = ctx.new_page()
    en.on('pageerror', lambda e: errors.append(str(e)))
    en.goto(EDITOR, wait_until='load')
    en.wait_for_timeout(1500)
    en_page_text = en.evaluate("document.querySelector('.page-text') ? document.querySelector('.page-text').innerText : ''")
    en_title = en.title()
    open_all(en)
    english = set(get_visible_texts(en))
    en.close()
    check_that(len(english) > 50, f'the interface has texts ({len(english)} in English)')

    tested = []
    for lang in LANGS:
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: errors.append(str(e)))
        r = pg.goto(EDITOR + lang + '/', wait_until='load')
        if not r or r.status != 200:
            print(f'      no page /{lang}/ - skipped')
            pg.close()
            continue
        tested.append(lang)
        pg.wait_for_timeout(2000)
        check_that(pg.evaluate('document.documentElement.lang') == lang, f'{lang}: the page is <html lang="{lang}">')
        check_that(pg.evaluate("document.querySelector('.header').getAttribute('lang')") == lang, f'{lang}: the interface is marked lang="{lang}"')
        check_that(pg.title() != en_title, f'{lang}: the title is translated: {pg.title()[:60]}')
        page_text = pg.evaluate("document.querySelector('.page-text') ? document.querySelector('.page-text').innerText : ''")
        check_that(page_text and page_text != en_page_text, f'{lang}: the page text is translated')
        check_that(pg.evaluate(f"[...document.querySelectorAll('link[rel=alternate][hreflang]')].some(l => l.hreflang === '{lang}')"), f'{lang}: hreflang names this page')
        check_that(pg.evaluate("document.querySelector('link[rel=canonical]').getAttribute('href')").endswith(f'/{lang}/'), f'{lang}: its own canonical address')
        check_that(pg.evaluate("document.querySelector('.lang-menu') && document.querySelector('.lang-menu').value") == lang, f'{lang}: the language menu shows the language')
        open_all(pg)
        here = set(get_visible_texts(pg))
        left = sorted(t for t in here & english
                      if t not in SAME and t not in SAME_LANG.get(lang, set()) and t not in SAME_ANY and not t.startswith('https://example.com/') and not set(t) <= IGNORE_CHARS and any(c.isalpha() for c in t) and len(t) > 1)
        if os.environ.get('SHOW'):
            for t in left:
                print(f'      {lang} untranslated: ' + repr(t))
        check_that(not left, f'{lang}: every interface text is translated ({len(left)} left: {left[:8]})')
        if lang == 'de':
            check_that('ß' not in ' '.join(here) + page_text, 'de: Swiss spelling (ss, no ß)')
        # The AI prompt stays English; the message about it is in the language
        pg.evaluate("document.querySelectorAll('dialog[open]').forEach(d => d.close())")
        pg.click('#btn-ai')
        pg.wait_for_timeout(300)
        pg.click('#ai-copy')
        pg.wait_for_timeout(500)
        prompt = pg.evaluate('navigator.clipboard.readText()')
        check_that(len(prompt) > 200 and ' the ' in prompt, f'{lang}: the AI prompt stays English')
        toast = pg.inner_text('#toast')
        check_that(toast and not toast.startswith('Prompt copied'), f'{lang}: the message after copying is translated: {toast[:60]}')
        pg.close()

    # Nothing stored, the menu picks with ?setlang=, and ?lang= links
    if tested:
        lang = tested[-1]
        again = ctx.new_page()
        again.goto(EDITOR + lang + '/', wait_until='load')
        again.wait_for_timeout(800)
        check_that(again.evaluate("Object.keys(localStorage).filter(k => k.endsWith('.lang')).length") == 0, 'a language page stores no language in the browser')
        again.select_option('.lang-menu', 'en')
        again.wait_for_timeout(1500)
        check_that(again.url in (EDITOR, EDITOR + '?setlang=en'), f'the menu switches to English with ?setlang=en: {again.url}')
        again.goto(EDITOR, wait_until='load')
        again.wait_for_timeout(1000)
        check_that(again.url == EDITOR, 'the English page is not led anywhere by the script')
        again.goto(EDITOR + f'?lang={lang}&embed=1#test', wait_until='load')
        again.wait_for_timeout(1500)
        check_that(again.url == EDITOR + f'?lang={lang}&embed=1#test', f'?lang={lang} is served in place, with the other parameters: {again.url}')
        check_that(again.evaluate('document.documentElement.lang') == lang, f'?lang={lang} serves the page in that language')
        again.goto(EDITOR + '?lang=en', wait_until='load')
        again.wait_for_timeout(800)
    check_that(not errors, 'no script errors: ' + '; '.join(errors))
    browser.close()

print()
print('all passed' if not failed else f'{len(failed)} failed')
sys.exit(1 if failed else 0)
