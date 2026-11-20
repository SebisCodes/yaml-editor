"""Editing in place in the tree: a click on a key or a value opens a field;
Enter writes the change into the code (quoted as YAML needs it, the rest of
the code keeps its formatting and comments, one undo step), Escape cancels.
The buttons above the tree add, duplicate, move and remove entries and
change the type - in block and in flow collections.

    php -S 127.0.0.1:8102 -t src src/php/router.php          (in the project folder)
    python tests/inplace_test.py
"""
import os
import sys

from playwright.sync_api import sync_playwright

EDITOR = os.environ.get('EDITOR_URL', 'http://127.0.0.1:8102/')
HOOK = 'yamlEditor'
CODE = '''# the team
name: Ada   # first name
title: 'Countess'
age: 36
active: true
tags: [a, b]
team:
  lead: Grace
  members:
    - Linus
    - Margaret
note: |
  line one
  line two
'''
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
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(EDITOR + '?lang=en', wait_until='networkidle')
    page.wait_for_timeout(800)
    page.evaluate('c => %s.setCode(c)' % HOOK, CODE)
    page.wait_for_timeout(300)
    code = lambda: page.evaluate('%s.state.code' % HOOK)
    history = lambda: page.evaluate('%s.state.history.length' % HOOK)
    field = page.locator('#tree .trow-edit')
    row = lambda text: page.locator('#tree .trow', has=page.locator('.trow-k', has_text=text)).first
    item = lambda text: page.locator('#tree .trow', has=page.locator('.trow-v', has_text=text)).first

    # A plain value
    row('name').locator('.trow-v').click()
    page.wait_for_timeout(150)
    check_that(field.count() == 1 and field.input_value() == 'Ada', 'a click on a value opens a field with the value')
    sel = page.evaluate('() => { const t = document.querySelector("#code"); return t.value.slice(t.selectionStart, t.selectionEnd); }')
    check_that(sel == 'name: Ada', 'the click also selects the entry in the code: ' + repr(sel))
    n = history()
    field.fill('Ada: "the first" #1')
    field.press('Enter')
    page.wait_for_timeout(300)
    check_that(field.count() == 0, 'Enter closes the field')
    check_that('name: \'Ada: "the first" #1\'   # first name\n' in code() or 'name: "Ada: \\"the first\\" #1"   # first name\n' in code(), 'the value is quoted as YAML needs it, the comment stays: ' + code().split('\n')[1])
    check_that(history() == n + 1, 'one undo step')
    page.evaluate('%s.undo()' % HOOK)
    page.wait_for_timeout(200)
    check_that(code() == CODE, 'one Undo brings the old value back')

    # The quoting style is kept, and Escape cancels
    row('title').locator('.trow-v').click()
    field.fill("Ada's title")
    field.press('Enter')
    page.wait_for_timeout(300)
    check_that("title: 'Ada''s title'\n" in code(), 'a single-quoted value stays single-quoted: ' + code().split('\n')[2])
    row('title').locator('.trow-v').click()
    field.fill('Not this')
    field.press('Escape')
    page.wait_for_timeout(200)
    check_that(field.count() == 0 and "'Ada''s title'" in code(), 'Escape cancels')

    # A string that looks like a number stays a string
    row('lead').locator('.trow-v').click()
    field.fill('123')
    field.press('Enter')
    page.wait_for_timeout(300)
    check_that('  lead: "123"\n' in code(), 'a string that looks like a number is quoted')

    # A number keeps its type
    row('age').locator('.trow-v').click()
    field.fill('thirty')
    field.press('Enter')
    page.wait_for_timeout(200)
    check_that(field.count() == 1 and 'not a number' in page.inner_text('#toast'), 'a number field does not take text')
    field.fill('37')
    field.press('Enter')
    page.wait_for_timeout(300)
    check_that('\nage: 37\n' in code(), 'the number is in the code')

    # A block scalar stays a block scalar
    row('note').locator('.trow-v').click()
    page.wait_for_timeout(150)
    check_that(page.locator('#tree textarea.trow-edit').count() == 1, 'a text with line breaks opens a larger field')
    page.locator('#tree textarea.trow-edit').fill('first\nsecond\nthird\n')
    page.locator('#tree textarea.trow-edit').press('Enter')
    page.wait_for_timeout(300)
    check_that(code().endswith('note: |\n  first\n  second\n  third\n'), 'a block text is written as a block again: ' + repr(code()[-40:]))

    # A key
    row('active').locator('.trow-k').click()
    field.fill('enabled')
    field.press('Enter')
    page.wait_for_timeout(300)
    check_that('\nenabled: true\n' in code() and 'active' not in code(), 'a key is renamed in the code')

    # Flow collections are edited with commas
    row('tags').click()
    page.click('#node-add')
    page.wait_for_timeout(300)
    check_that('tags: [a, b, ""]\n' in code(), 'Add on a flow list adds an entry on the same line: ' + [l for l in code().split('\n') if l.startswith('tags')][0])
    item('"b"').click()
    page.click('#node-del')
    page.wait_for_timeout(300)
    check_that('tags: [a, ""]\n' in code(), 'Remove in a flow list takes the comma along')

    # Block collections are edited as whole lines
    page.evaluate('c => %s.setCode(c)' % HOOK, CODE)
    page.wait_for_timeout(300)
    row('members').click()
    n = history()
    page.click('#node-add')
    page.wait_for_timeout(300)
    check_that('    - Linus\n    - Margaret\n    - ""\n' in code(), 'Add on a block list adds a line with "- " in the same column')
    check_that(history() == n + 1, 'adding is one undo step')
    row('team').click()
    page.click('#node-add')
    page.wait_for_timeout(300)
    check_that(field.count() == 1 and field.input_value() == 'key', 'Add on a mapping adds a key and opens it for typing')
    field.fill('size')
    field.press('Enter')
    page.wait_for_timeout(300)
    check_that('    - ""\n  size: ""\nnote:' in code(), 'the new key is in its own line, indented like the other keys')
    item('Linus').click()
    page.click('#node-dup')
    page.wait_for_timeout(300)
    check_that('    - Linus\n    - Linus\n    - Margaret' in code(), 'Duplicate copies a list item')
    item('Margaret').click()
    page.click('#node-up')
    page.wait_for_timeout(300)
    check_that('    - Linus\n    - Margaret\n    - Linus' in code(), 'Move up swaps two lines')
    row('name').click()
    page.click('#node-dup')
    page.wait_for_timeout(300)
    check_that('name: Ada   # first name\nname copy: Ada\ntitle' in code(), 'Duplicate copies a key (the comment stays with the original)')
    page.locator('#tree').press('Delete')
    page.wait_for_timeout(300)
    check_that('name copy' not in code(), 'the Delete key removes the selected entry with its line')
    row('tags').click()
    page.locator('#tree').press('Alt+ArrowDown')
    page.wait_for_timeout(300)
    check_that('active: true\nteam:' in code() and code().index('tags: [a, b]') > code().index('team:'), 'Alt+Down moves a key with everything below it')
    check_that(code().startswith('# the team\n') and '# first name' in code(), 'the comments are still there after all changes')
    for k in range(8):
        page.evaluate('%s.undo()' % HOOK)
    page.wait_for_timeout(300)
    check_that(code() == CODE, 'Undo takes every change back, step by step')

    # Type change, and a new value with structure
    row('active').click()
    page.select_option('#node-type', 'object')
    page.wait_for_timeout(300)
    check_that('\nactive: {}\n' in code(), 'the type menu turns a value into an empty mapping')
    page.click('#node-add')
    page.wait_for_timeout(300)
    field.fill('on')
    field.press('Enter')
    page.wait_for_timeout(300)
    check_that('\nactive:\n  "on": ""\n' in code() or '\nactive:\n  on: ""\n' in code(), 'adding to an empty mapping writes a block: ' + repr(code().split('active:')[1][:30]))
    row('team').click()
    page.select_option('#node-type', 'string')
    page.wait_for_timeout(300)
    check_that('\nteam: ""\nnote:' in code(), 'a mapping becomes an empty string, its lines are gone')

    # Several documents: one tree each
    page.evaluate('c => %s.setCode(c)' % HOOK, 'a: 1\n---\nb: 2\n')
    page.wait_for_timeout(300)
    check_that(page.locator('#tree .trow-doc').count() == 2, 'every document has its own tree')
    row('b').locator('.trow-v').click()
    field.fill('3')
    field.press('Enter')
    page.wait_for_timeout(300)
    check_that(code() == 'a: 1\n---\nb: 3\n', 'a value in the second document is changed there')

    # With a syntax error, the tree is not edited
    page.evaluate('c => %s.setCode(c)' % HOOK, 'a: 1\n\tb: 2\n')
    page.wait_for_timeout(300)
    row('a').locator('.trow-v').click()
    page.wait_for_timeout(150)
    check_that(field.count() == 0 and 'syntax error' in page.inner_text('#toast'), 'with a syntax error the tree asks to fix it first')

    # German interface: the data itself is not translated
    page.goto(EDITOR + '?lang=de', wait_until='networkidle')
    page.wait_for_timeout(1200)
    page.evaluate('c => %s.setCode(c)' % HOOK, CODE)
    page.wait_for_timeout(300)
    row('name').locator('.trow-v').click()
    page.wait_for_timeout(150)
    check_that(field.count() == 1 and field.input_value() == 'Ada', 'also in the German interface, and the data is not translated')
    check_that(page.locator('#tree .trow-type').first.inner_text() == 'Objekt', 'the type names in the tree are German')
    field.press('Escape')
    page.goto(EDITOR + '?lang=en', wait_until='networkidle')
    check_that(not errors, 'no script errors: ' + '; '.join(errors))
    browser.close()

print()
print('all passed' if not failed else f'{len(failed)} failed')
sys.exit(1 if failed else 0)
