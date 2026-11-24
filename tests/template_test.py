"""Template placeholders (?template=mustache, angle): how the YAML Editor reads them.

    python3 tests/template_test.py            the checks in Node
    python3 tests/template_test.py --browser  also the checks in the editor (php -S on port 8102 first)

  order     an order confirmation template (tests/order-template.yaml) with placeholder values,
            placeholders in quoted and plain text, in a block scalar and in a comment, a list
            section, a flag section and an inverted section has 0 errors with "mustache"; with the
            option off the code is a YAML error and the code view is the plain YAML highlighting
  model     a placeholder value is a string node holding its tag (placeholder "value"), also a
            plain value that starts with a tag and in a flow sequence; text with a tag has
            placeholder "text"; a list a section repeats is "repeated"; the data holds every tag
  keys      a bare placeholder key is one error at the tag; a quoted one, and one in the middle
            of a plain key, is a key; two placeholder keys make no duplicate key
  places    a real YAML error is reported at the same place as in the filled document
  schema    a placeholder value matches every schema, a string with a tag is checked for its type,
            the other values are checked as before
  edits     a tree edit keeps every tag outside the changed part; a placeholder value and a
            collection holding tags are changed in the code
  view      the code view shows every tag as written, without a color of its own
  examples  the example view: values typed as YAML reads them, strings escaped, sections and list
            rows applied, the label in brackets without an example, every kind of string; a node
            leads to its place in the code, text with an example is read-only, a change of copied
            text changes the template, the code cursor finds its node; filled text that is no YAML
            is reported, filling past a limit stops
  angle     the order template in the syntax "angle" (tests/order-template-angle.yaml) has 0 errors
  documents several documents with placeholders, one per ---
  edge      a mapping reaches to the end of its placeholder (duplicate, remove); an alias of a
            mapping with a placeholder holds a template part for the schema
  browser   with --browser: through a page around the editor, the example view is the default and
            shows the examples, the switch shows the template view with the tags, the code view has
            no placeholder color, the "Placeholders" box is closed and puts a tag at the cursor as
            one undo step, the side panel is closed, "get" carries the template; Format and Tidy
            keep the template as written, an edit of a placeholder value in the tree is refused
            with a message; with the option off nothing of this is there
Needs Node; --browser needs Playwright with Chrome."""
import json
import html
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.join(os.path.dirname(HERE), 'src', 'js')
URL = os.environ.get('EDITOR_URL', 'http://127.0.0.1:8102/')
HOOK = 'yamlEditor'
EDIT_MESSAGE = 'This part holds a placeholder - change it in the code'
FORMAT_MESSAGE = 'A template stays as written - Format and conversions work on filled data'
failed = []


def check_that(ok, text):
    """Prints one result line and notes a failure.

    Args:
        ok (bool): True when the check holds.
        text (str): what is checked.

    Returns:
        None: the result is printed and a failure is noted.
    """
    print(('ok    ' if ok else 'FAIL  ') + text, flush=True)
    if not ok:
        failed.append(text)


def run_report(cases):
    """Runs tests/template/report.mjs in Node on the cases.

    Args:
        cases (list[dict]): each with `code` (str), `format` (str), `template` (str or None) and
            optionally `schema` and `edits`.

    Returns:
        list[dict]: one result per case, in order.
    """
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8') as file:
        json.dump(cases, file)
    try:
        run = subprocess.run(['node', os.path.join(HERE, 'template', 'report.mjs'), SCRIPTS, file.name],
                             capture_output=True, text=True, timeout=120)
    finally:
        os.unlink(file.name)
    if run.returncode:
        print(run.stderr)
        sys.exit('report.mjs failed')
    return json.loads(run.stdout)


def get_messages(result, kind):
    """Returns the messages of the problems of one kind.

    Args:
        result (dict): one case result of report.mjs.
        kind (str): "error" or "warn".

    Returns:
        list[str]: the messages.
    """
    return [problem['msg'] for problem in result['problems'] if problem['kind'] == kind]


def get_plain_text(highlighted):
    """Returns the plain text of highlighted HTML.

    Args:
        highlighted (str): the HTML of the code view.

    Returns:
        str: the text with the tags removed and the entities decoded.
    """
    return html.unescape(re.sub(r'<[^>]+>', '', highlighted))


def get_node(result, path):
    """Returns a marked node of a result by its path.

    Args:
        result (dict): one case result of report.mjs.
        path (str): the keys joined by dots.

    Returns:
        dict | None: the node, or None when it is not marked.
    """
    return next((node for node in result['nodes'] if node['path'] == path), None)


def read_fixture(name):
    """Reads a fixture of the tests folder.

    Args:
        name (str): the file name.

    Returns:
        str: the file's text.
    """
    with open(os.path.join(HERE, name), encoding='utf-8') as fixture:
        return fixture.read()


ORDER = read_fixture('order-template.yaml')
ANGLE = read_fixture('order-template-angle.yaml')
KEYS = '{{first}}: 1\n{{second}}: 2\n"{{quoted}}": 3\nuser_{{id}}: 4\n'
PLACES = 'name: {{name}}\nport: {{port}}\nlist: [1, 2\nopen: true\n'
FILLED = 'name: xxxxxxxx\nport: xxxxxxxx\nlist: [1, 2\nopen: true\n'
SCHEMA_CODE = 'orderNumber: {{orderNumber}}\nemail: "{{email}}"\nage: ten\nstatus: {{status}}\n'
SCHEMA = {'type': 'object', 'properties': {'orderNumber': {'type': 'integer', 'minimum': 1}, 'email': {'type': 'string', 'format': 'email'},
          'age': {'type': 'integer'}, 'status': {'enum': ['open', 'paid']}}, 'required': ['orderNumber']}
EDIT_CODE = 'name: "{{name}}" # {{comment}}\nport: {{port}}\ncity: Springfield\nitems:\n{{#items}}\n  - {{title}}\n{{/items}}\n  - Shipping\n'
EDITS = [
    {'kind': 'value', 'path': ['city'], 'value': 'Shelbyville'},
    {'kind': 'value', 'path': ['port'], 'value': 8080},
    {'kind': 'type', 'path': ['port'], 'type': 'number'},
    {'kind': 'value', 'path': ['items'], 'value': []},
    {'kind': 'key', 'path': ['city'], 'key': 'town'},
    {'kind': 'add', 'path': [], 'key': 'country', 'value': 'US'},
    {'kind': 'remove', 'path': ['port']},
    {'kind': 'value', 'path': ['name'], 'value': 'Dear {{name}}'},
]
PLAIN = 'name:   John Doe\ncity:    Springfield\n'
DOCUMENTS = 'name: {{name}}\n---\nname: {{other}}\nquantity: {{quantity}}\n'

order, order_off, keys, places, filled, schema, edits, angle, documents = run_report([
    {'code': ORDER, 'format': 'yaml', 'template': 'mustache'},
    {'code': ORDER, 'format': 'yaml', 'template': None},
    {'code': KEYS, 'format': 'yaml', 'template': 'mustache'},
    {'code': PLACES, 'format': 'yaml', 'template': 'mustache'},
    {'code': FILLED, 'format': 'yaml', 'template': None},
    {'code': SCHEMA_CODE, 'format': 'yaml', 'template': 'mustache', 'schema': SCHEMA},
    {'code': EDIT_CODE, 'format': 'yaml', 'template': 'mustache', 'edits': EDITS},
    {'code': ANGLE, 'format': 'yaml', 'template': 'angle'},
    {'code': DOCUMENTS, 'format': 'yaml', 'template': 'mustache'},
])

print('-- the order template')
check_that(get_messages(order, 'error') == [] and not order['broken'], f'mustache: 0 errors (got {get_messages(order, "error")})')
check_that(get_messages(order, 'warn') == [], f'mustache: no notes (got {get_messages(order, "warn")})')
check_that(len(order['tags']) == 22, f'every tag of the template is found ({len(order["tags"])})')
check_that(order_off['broken'] and len(get_messages(order_off, 'error')) > 0, f'option off: the plain YAML check reports errors ({get_messages(order_off, "error")[:2]})')
check_that(order_off['highlighted'] == order_off['plainHighlighted'] and order_off['nodes'] == [], 'option off: plain highlighting, nothing marked')

print('-- model')
order_number = get_node(order, 'orderNumber')
check_that(order_number and order_number['placeholder'] == 'value' and order_number['type'] == 'string' and order_number['value'] == '{{orderNumber}}'
           and ORDER[order_number['start']:order_number['end']] == '{{orderNumber}}', f'a placeholder value is its tag, with the tag\'s place: {order_number}')
check_that(get_node(order, 'address')['placeholder'] == 'value' and get_node(order, 'address')['value'] == '{{street}} {{postalCode}}', 'a plain value that starts with a tag is a placeholder value')
check_that(all(get_node(order, path)['placeholder'] == 'text' for path in ('customer.street', 'customer.postalCode', 'greeting', 'letter')),
           'quoted text, plain text with a tag inside and a block scalar have placeholder "text"')
check_that(get_node(order, 'tags.1')['placeholder'] == 'value', 'a placeholder in a flow sequence is a placeholder value')
check_that(get_node(order, 'items')['repeated'] and get_node(order, 'items.0.price')['placeholder'] == 'value', 'a list a section repeats is "repeated"')
check_that(order['value']['paid'] == '{{paid}}' and order['value']['letter'].startswith('Dear {{name}},\n{{^hasNote}}'), 'the data holds every placeholder as its tag')

print('-- keys')
key_errors = [(problem['pos'], problem['msg']) for problem in keys['problems'] if problem['kind'] == 'error']
check_that(key_errors == [(KEYS.index('{{first}}'), 'A placeholder key goes in quotes: "{{first}}"'), (KEYS.index('{{second}}'), 'A placeholder key goes in quotes: "{{second}}"')],
           f'a bare placeholder key is one error at its tag: {key_errors}')
check_that(get_messages(keys, 'warn') == [], 'placeholder keys make no duplicate key')
check_that([key['key'] for key in keys['keys']] == ['{{first}}', '{{second}}', '{{quoted}}', 'user_{{id}}'], 'every placeholder key reads as its tag')

print('-- places')
place_errors = [(problem['pos'], problem['msg']) for problem in places['problems'] if problem['kind'] == 'error']
filled_errors = [(problem['pos'], problem['msg']) for problem in filled['problems'] if problem['kind'] == 'error']
check_that(place_errors and place_errors == filled_errors, f'a real YAML error is reported where the filled document has it: {place_errors}')

print('-- schema')
check_that(schema['schema'] == ['Schema: the type must be integer (it is string)'], f'only the filled value is checked against the schema: {schema["schema"]}')

print('-- edits')
city, port, port_type, items_value, key_edit, added, removed, quoted = edits['edits']
check_that(city.get('tagsKept') and 'city: Shelbyville' in city['code'], 'a value edit keeps every tag elsewhere')
check_that(port.get('error') == EDIT_MESSAGE and port_type.get('error') == EDIT_MESSAGE, 'a placeholder value is changed in the code')
check_that(items_value.get('error') == EDIT_MESSAGE, 'a collection holding tags is changed in the code')
check_that(key_edit.get('tagsKept') and added.get('tagsKept'), 'renaming a key and adding an entry keep every tag')
check_that(removed.get('code') is not None and '{{port}}' not in removed['code'] and '{{comment}}' in removed['code'], 'removing an entry takes its own tags along')
check_that(quoted.get('code') is not None and 'Dear {{name}}' in quoted['code'] and '{{comment}}' in quoted['code'], 'a string with a tag is edited in the tree')

print('-- view')
check_that(get_plain_text(order['highlighted']) == ORDER, 'the highlighted text is the code')
check_that('class="tp"' not in order['highlighted'], 'a tag has no color of its own')

print('-- angle')
check_that(get_messages(angle, 'error') == [] and get_node(angle, 'paid')['value'] == '<<paid>>', f'angle: 0 errors (got {get_messages(angle, "error")})')
check_that(get_plain_text(angle['highlighted']) == ANGLE and 'class="tp"' not in angle['highlighted'], 'angle: the code view shows every tag as written')

print('-- documents')
check_that(documents['docs'] == 2 and get_messages(documents, 'error') == [] and documents['value'][1]['quantity'] == '{{quantity}}', 'several documents with placeholders, 0 errors')


print('-- examples')
EXAMPLES = {'placeholders': [
    {'name': 'orderNumber', 'example': '1001'}, {'name': 'name', 'label': 'Name', 'example': 'John Doe'},
    {'name': 'street', 'example': '1 Main Street'}, {'name': 'postalCode', 'example': '8000'},
    {'name': 'hasNote', 'kind': 'section', 'shown': True}, {'name': 'note', 'example': 'Ring "twice"\nthen wait'},
    {'name': 'items', 'kind': 'list', 'fields': [{'name': 'title', 'label': 'Title'}, {'name': 'quantity'}, {'name': 'price'}],
     'rows': [{'title': 'Chair', 'quantity': '2', 'price': '49.5'}, {'title': 'Table', 'quantity': 'two', 'price': '120'}]},
    {'name': 'paid', 'example': 'true'}, {'name': 'tag', 'example': 'urgent'}]}
MORE = 'first: {{a}}\nsecond: \'{{b}}\'\nthird: "{{c}}"\nfourth: |\n  {{d}}\nfifth: [x, {{e}}]\n"{{k}}": 1\n# {{d}}\n'
BROKEN = 'greeting: Dear {{name}}\n'
TWICE = '{{#items}}\n- {{title}}\n{{/items}}\nb: 1\n'
TRICKY = 'a: [pre {{x}} post]\nb: {{q}}\nc:\n  d: 1\n  {{#hidden}}\n  e: 2\n  {{/hidden}}\n'
DEEP = '{{#a}}' * 40 + 'x: 1\n' + '{{/a}}' * 40
twice, tricky, injected = run_report([
    {'code': TWICE, 'format': 'yaml', 'template': 'mustache', 'example': {'message': {'placeholders': [
        {'name': 'items', 'kind': 'list', 'fields': [{'name': 'title'}], 'rows': [{'title': 'A'}, {'title': 'B'}]}]}}},
    {'code': TRICKY, 'format': 'yaml', 'template': 'mustache', 'example': {'message': {'placeholders': [
        {'name': 'x', 'example': 'middle'}, {'name': 'q', 'example': '"quoted"'}, {'name': 'hidden', 'kind': 'section', 'shown': False}]},
        'edits': [{'kind': 'add', 'path': ['c'], 'key': 'f', 'value': 3}]}},
    {'code': TRICKY, 'format': 'yaml', 'template': 'mustache', 'example': {'message': {'placeholders': [{'name': 'x', 'example': 'x, injected'}]}}},
])
filled, unlisted, more, broken, deep = run_report([
    {'code': ORDER, 'format': 'yaml', 'template': 'mustache', 'example': {
        'message': EXAMPLES, 'paths': [['items', 1, 'title'], ['items', 2, 'title'], ['customer', 'city']],
        'edits': [{'kind': 'value', 'path': ['items', 2, 'title'], 'value': 'Postage'},
                  {'kind': 'value', 'path': ['customer', 'name'], 'value': 'Jane Roe'},
                  {'kind': 'key', 'path': ['customer', 'city'], 'key': 'town'},
                  {'kind': 'remove', 'path': ['note']},
                  {'kind': 'add', 'path': ['customer'], 'key': 'country', 'value': 'US'}],
        'cursors': [ORDER.index('Shipping'), ORDER.index('{{title}}')]}},
    {'code': ORDER, 'format': 'yaml', 'template': 'mustache', 'example': {'message': None}},
    {'code': MORE, 'format': 'yaml', 'template': 'mustache', 'example': {'message': {'placeholders': [
        {'name': 'a', 'example': '1e3'}, {'name': 'b', 'example': "O'Neil"}, {'name': 'c', 'example': 'say "hi"\nnow'},
        {'name': 'd', 'example': 'line one\nline two'}, {'name': 'e', 'example': '~'}, {'name': 'k', 'example': 'key: x'}]}}},
    {'code': BROKEN, 'format': 'yaml', 'template': 'mustache', 'example': {'message': {'placeholders': [{'name': 'name', 'example': 'Doe: John'}]}}},
    {'code': DEEP, 'format': 'yaml', 'template': 'mustache', 'example': {'message': None}},
])
value = filled['example']['value']
check_that(filled['example']['errors'] == [] and value['orderNumber'] == 1001 and value['paid'] is True and value['tags'] == ['order', 'urgent'],
           f'a bare value takes a YAML literal, also in a flow sequence: {value.get("orderNumber")!r}, {value.get("paid")!r}, {value.get("tags")!r}')
check_that(value['customer']['name'] == 'John Doe' and value['greeting'] == 'Dear John Doe,' and value['customer']['postalCode'] == '8000' and value['address'] == '1 Main Street 8000',
           'text in quoted and plain values takes the example; a value that starts with a tag stays one plain value')
check_that(value['note'] == 'Ring "twice"\nthen wait' and value['letter'] == 'Dear John Doe,\n', 'a shown section is there, its inverted section left out, quotes and line breaks escaped')
check_that([item['title'] for item in value['items']] == ['Chair', 'Table', 'Shipping'] and value['items'][1]['quantity'] == 'two' and value['items'][0]['quantity'] == 2,
           'a list repeats its entry per row; an example that is no YAML literal is a string')
check_that('{{' not in filled['example']['text'], 'no tag is left in the example view')
check_that(value['customer']['city'] == '[city]', 'a placeholder the page did not list shows its name in brackets')
labels = unlisted['example']['value']
check_that(labels['orderNumber'] == '[orderNumber]' and labels['items'][0]['title'] == '[title]' and len(labels['items']) == 2 and labels['note'] == '[note]',
           'without examples: labels in brackets, a list shows one entry, a section is shown once')
check_that(unlisted['example']['errors'] == [] and labels['address'] == '\u2060[street] [postalCode]', f'a label that starts a longer plain value reads as text: {labels.get("address")!r}')
row, shipping, city_place = filled['example']['places']
check_that(row['code'] == '{{title}}' and not row['valueEditable'], f'a filled value leads to its tag and is read-only: {row}')
check_that(shipping['code'] == 'Shipping' and shipping['valueEditable'] and shipping['keyEditable'], f'copied text leads to its own place and may be edited: {shipping}')
check_that(city_place['code'] == '{{city}}' and city_place['keyEditable'] and not city_place['valueEditable'], 'the key of a filled value may be edited, its value not')
postage, refused, town, removed_note, country = filled['example']['edits']
check_that(postage.get('code') == ORDER.replace('title: Shipping', 'title: Postage'), f'a change of copied text changes the template there: {postage.get("error")}')
check_that(refused.get('error') == 'This part shows an example - change it in the template view or in the code', f'a change of an example is refused: {refused}')
check_that(town.get('code') == ORDER.replace('city: {{city}}', 'town: {{city}}'), f'a key renamed in the example view is renamed in the template: {town.get("error")}')
check_that(removed_note.get('code') is not None and 'note: {{note}}' not in removed_note['code'] and '{{#hasNote}}' in removed_note['code'], f'an entry removed in the example view is removed from the template: {removed_note.get("error")}')
check_that(country.get('code') is not None and 'country: US' in country['code'] and '{{city}}' in country['code'], f'an entry added in the example view goes into the template: {country.get("error")}')
check_that(filled['example']['cursors'] == ['$.items[2].title', '$.items[0].title'], f'the code cursor finds its node in the example view: {filled["example"]["cursors"]}')
extra = more['example']
check_that(extra['errors'] == [] and extra['value'] == {'first': 1000, 'second': "O'Neil", 'third': 'say "hi"\nnow', 'fourth': 'line one\nline two\n', 'fifth': ['x', None], 'key: x': 1},
           f'single and double quotes, a block scalar, a flow sequence, a key and a comment take the example in their escaping: {extra.get("value")} {extra.get("errors")}')
ADDRESS = 'John Doe\n1 Main Street\n\n8000 Springfield'
FOLDS = "single: 'Dear {{n}},'\nplain: Dear {{n}}, hello\nfolded: >\n  Dear {{n}}\nlist:\n  - 'to {{n}}'\n  - key: 'to {{n}}'\nflow: [a {{n}}]\nindented: >\n  {{m}}\n'k {{n}}': 1\n"
folds = run_report([{'code': FOLDS, 'format': 'yaml', 'template': 'mustache', 'example': {'message': {'placeholders': [
    {'name': 'n', 'example': ADDRESS}, {'name': 'm', 'example': 'text\n  indented\nback'}]}}}])[0]['example']
check_that(folds.get('errors') == [] and folds.get('value') == {
    'single': f'Dear {ADDRESS},', 'plain': f'Dear {ADDRESS}, hello', 'folded': f'Dear {ADDRESS}\n', 'list': [f'to {ADDRESS}', {'key': f'to {ADDRESS}'}], 'k John Doe 1 Main Street  8000 Springfield': 1,
    'flow': [f'a {ADDRESS}'], 'indented': 'text\n  indented\nback\n'},
    f'line breaks of an example: single quotes, plain text and a folded block scalar read back the example: {folds.get("value")} {folds.get("errors")}')
tabbed = run_report([{'code': BROKEN, 'format': 'yaml', 'template': 'mustache', 'example': {'message': {'placeholders': [{'name': 'name', 'example': example}]}}}
                     for example in ('John\t#Doe', 'Doe:\tJohn')])
check_that(all(result['example'].get('error') == 'TemplateExpansionError' for result in tabbed), 'a tab before "#" or after ":" in an example of a plain value stops the filling too')
check_that(broken['example'].get('error') == 'TemplateExpansionError' and injected['example'].get('error') == 'TemplateExpansionError',
           'an example that would change the structure of a plain value stops the filling (the tree then shows the template)')
check_that(twice['example']['errors'] != [], 'filled text that is no YAML is reported (the tree then shows the template)')
check_that(tricky['example']['value'] == {'a': ['pre middle post'], 'b': 'quoted', 'c': {'d': 1}}, f'a quoted example of a whole value is a YAML literal: {tricky["example"].get("value")}')
check_that((tricky['example']['edits'][0].get('code') or '').count('f: 3') == 1, f'an entry added to a mapping whose last entries a hidden section holds goes into the template: {tricky["example"]["edits"][0]}')
check_that(deep['example'].get('error') == 'TemplateExpansionError', f'filling past a limit stops: {deep["example"]}')


print('-- edge cases')
NESTED = 'a:\n  x: {{x}}\nz: 2\n'
ALIAS = 'a: &a {v: {{v}}}\nb: *a\n'
nested, alias = run_report([
    {'code': NESTED, 'format': 'yaml', 'template': 'mustache', 'edits': [{'kind': 'duplicate', 'path': ['a']}, {'kind': 'remove', 'path': ['a']}]},
    {'code': ALIAS, 'format': 'yaml', 'template': 'mustache', 'schema': {'properties': {'b': {'not': {'type': 'object'}}}}},
])
duplicate, remove = nested['edits']
check_that(duplicate.get('code') == 'a:\n  x: {{x}}\na copy:\n  x: {{x}}\nz: 2\n', 'a mapping reaches to the end of its placeholder: a duplicate copies the whole tag')
check_that(remove.get('code') == 'z: 2\n', 'removing a mapping takes its tags along')
check_that(alias['schema'] == [], 'an alias of a mapping with a placeholder counts as holding a template part')


HOST = """<!doctype html><meta charset="utf-8"><body style="margin:0">
<iframe id="ed" src="%s" style="width:1200px;height:800px;border:0"></iframe>
<script>
window.msgs = [];
addEventListener('message', e => { if (e.data && typeof e.data.type === 'string') msgs.push(e.data); });
window.send = m => document.getElementById('ed').contentWindow.postMessage(m, '*');
</script>"""
PREFIX = HOOK.lower()
# The code of the entry "orderNumber", which a click on its key in the tree selects.
PICKED_ENTRY = 'orderNumber: {{orderNumber}}'


def open_hosted_editor(browser, query):
    """Opens the editor inside a page around it (on another origin) and waits for its ready message.

    Args:
        browser (Browser): the browser.
        query (str): the editor's address parameters after ?embed=1, e.g. "&template=mustache".

    Returns:
        tuple: the browser context and the page around the editor.
    """
    context = browser.new_context(viewport={'width': 1400, 'height': 900})
    page = context.new_page()
    page.route('http://localhost:8199/**', lambda route: route.fulfill(status=200, content_type='text/html', body=HOST % (URL + '?embed=1&lang=en' + query)))
    page.goto('http://localhost:8199/', wait_until='load')
    page.wait_for_function(f"msgs.some(m => m.type === '{PREFIX}:ready')", timeout=15000)
    return context, page


def send_and_wait(page, message, answer):
    """Sends a message to the editor and waits for its answer of a type.

    Args:
        page (Page): the page around the editor.
        message (dict): the message.
        answer (str): the type of the answer without the prefix, e.g. "loaded".

    Returns:
        dict: the answer.
    """
    page.evaluate('m => { msgs.length = 0; send(m); }', message)
    page.wait_for_function(f"msgs.some(m => m.type === '{PREFIX}:{answer}')", timeout=15000)
    return page.evaluate(f"msgs.find(m => m.type === '{PREFIX}:{answer}')")


def get_tidied_load(browser, query, content, extra=None):
    """Loads a document into the editor inside a page (the load message) and returns the code it holds then.

    Args:
        browser (Browser): the browser.
        query (str): the editor's address parameters after ?embed=1, e.g. "&tidy=1&template=mustache".
        content (str): the document.
        extra (dict | None): further fields of the load message, e.g. {"tidy": True}.

    Returns:
        str: the code the editor answers to get.
    """
    context, page = open_hosted_editor(browser, query)
    send_and_wait(page, {'type': f'{PREFIX}:load', 'name': 'Order', 'content': content, **(extra or {})}, 'loaded')
    code = send_and_wait(page, {'type': f'{PREFIX}:get'}, 'save')['content']
    context.close()
    return code


def get_box(frame, selector):
    """Returns the place and size of an element.

    Args:
        frame (Frame): the editor's frame.
        selector (str): the element's selector.

    Returns:
        dict: x, y, width and height, rounded.
    """
    return frame.evaluate("s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; }", selector)


def get_tree_text(frame):
    """Returns the text of the tree.

    Args:
        frame (Frame): the editor's frame.

    Returns:
        str: the tree's text.
    """
    return frame.inner_text('#tree')


def run_view_checks(browser):
    """Checks the example view, the template view, the "Placeholders" box and the side panel through
    a page around the editor that sends examples.

    Args:
        browser (Browser): the browser.

    Returns:
        None: the results are printed and failures are noted.
    """
    context, page = open_hosted_editor(browser, '&template=mustache')
    frame = page.frames[1]
    send_and_wait(page, {'type': f'{PREFIX}:load', 'name': 'Order', 'content': ORDER, 'template': EXAMPLES}, 'loaded')
    frame.wait_for_function("document.querySelector('#tree').innerText.includes('John Doe')", timeout=10000)
    tree = get_tree_text(frame)
    check_that('{{' not in tree and 'Chair' in tree and '1001' in tree, 'the example view is the default: the examples, the list rows, no tag')
    check_that(frame.locator('#hl .tp').count() == 0 and frame.inner_text('#hl').startswith(ORDER[:ORDER.index('{{orderNumber}}') + 15]), 'the code view shows the tags as written, without a color of their own')
    switch_before = [get_box(frame, '#view-switch [data-view-set=example]'), get_box(frame, '#view-switch [data-view-set=template]')]
    check_that(switch_before[0]['width'] == switch_before[1]['width'], f'the two buttons of the switch have one width: {switch_before}')
    frame.locator('#tree .trow-v', has_text='"Chair"').first.dblclick()
    page.wait_for_timeout(200)
    check_that(frame.inner_text('#toast') == 'This part shows an example - change it in the template view or in the code' and frame.locator('#tree input, #tree textarea').count() == 0,
               'a value with an example is read-only in the tree, with a message')
    frame.locator('#tree .trow-k', has_text='orderNumber').first.click()
    page.wait_for_timeout(300)
    selection = frame.evaluate('() => { const ta = document.querySelector("#code"); return ta.value.slice(ta.selectionStart, ta.selectionEnd); }')
    check_that(selection.startswith(PICKED_ENTRY), f'a click in the example view selects its place in the code: {selection!r}')
    frame.click('#view-switch [data-view-set=template]')
    page.wait_for_timeout(300)
    check_that(frame.locator('#tree .t-placeholder', has_text='{{orderNumber}}').count() == 1 and 'John Doe' not in get_tree_text(frame), 'the switch shows the template view with the tags')
    switch_after = [get_box(frame, '#view-switch [data-view-set=example]'), get_box(frame, '#view-switch [data-view-set=template]')]
    check_that(switch_after == switch_before, 'the switch keeps its place and size')
    frame.click('#view-switch [data-view-set=example]')
    editor_before = get_box(frame, '.code-pane .editor')
    check_that(frame.locator('#placeholder-list').is_hidden() and frame.inner_text('[data-placeholder-count]') == str(len(EXAMPLES['placeholders'])), 'the "Placeholders" box is closed and counts the page\'s placeholders')
    frame.click('[data-placeholder-toggle]')
    check_that(frame.locator('#placeholder-list').is_visible() and get_box(frame, '.code-pane .editor') == editor_before, 'the box opens over the code without moving it')
    cursor = ORDER.index('Dear {{name}}')
    frame.evaluate('c => { const ta = document.querySelector("#code"); ta.focus(); ta.setSelectionRange(c, c + 4); }', cursor)
    frame.locator('.placeholder-entry', has_text='hasNote').click()
    code = frame.evaluate(f'{HOOK}.state.code')
    check_that(code == ORDER[:cursor] + '{{#hasNote}}Dear{{/hasNote}}' + ORDER[cursor + 4:], 'a section goes around the selection')
    frame.evaluate(f'{HOOK}.undo()')
    check_that(frame.evaluate(f'{HOOK}.state.code') == ORDER, 'one undo step takes it back')
    check_that(send_and_wait(page, {'type': f'{PREFIX}:get'}, 'save')['content'] == ORDER, '"get" carries the template as written')
    panel_button = get_box(frame, '#btn-panel')
    check_that(frame.evaluate("getComputedStyle(document.querySelector('#side-panel')).display") == 'none', 'the side panel is closed at the start')
    frame.click('#btn-panel')
    check_that(frame.evaluate("getComputedStyle(document.querySelector('#side-panel')).display") != 'none' and get_box(frame, '#btn-panel') == panel_button, 'its button opens it and stays in its place')
    page.evaluate(f"() => {{ document.querySelector('#ed').contentWindow.postMessage({{ type: '{PREFIX}:template', clear: true }}, '*'); }}")
    frame.wait_for_function("document.querySelector('#tree').innerText.includes('[name]')", timeout=10000)
    check_that('[orderNumber]' in get_tree_text(frame), 'clear ends the examples: labels in brackets')
    context.close()


def run_browser_checks():
    """Checks the option in the editor: code view, views of the tree, box, side panel, Format, Tidy
    and tree edits of placeholders.

    Returns:
        None: the results are printed and failures are noted.
    """
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        # The page around the editor is served by the browser itself; these flags let it frame the local editor.
        browser = pw.chromium.launch(channel='chrome', headless=True, args=['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights'])
        print('-- browser')
        run_view_checks(browser)
        page = browser.new_page(viewport={'width': 1400, 'height': 900})
        page.goto(URL + '?lang=en&template=mustache', wait_until='networkidle')
        page.evaluate('t => %s.setCode(t)' % HOOK, ORDER)
        page.wait_for_timeout(500)
        check_that(page.locator('#tree .t-placeholder').count() == 0 and '[orderNumber]' in page.inner_text('#tree'), 'without a page: the example view shows the labels in brackets')
        page.click('#view-switch [data-view-set=template]')
        page.wait_for_timeout(200)
        row = page.locator('#tree .t-placeholder', has_text='{{orderNumber}}')
        check_that(row.count() == 1, 'the template view shows a placeholder value as its tag')
        page.click('#btn-format')
        page.wait_for_timeout(200)
        check_that(page.inner_text('#toast') == FORMAT_MESSAGE and page.evaluate('%s.state.code' % HOOK) == ORDER, 'Format keeps the template as written, with the message')
        row.dblclick()
        page.wait_for_timeout(200)
        check_that(page.inner_text('#toast') == EDIT_MESSAGE and page.locator('#tree input, #tree textarea').count() == 0, 'a placeholder value is refused for editing in the tree, with the message')
        page.goto(URL + '?lang=en', wait_until='networkidle')
        page.evaluate('t => %s.setCode(t)' % HOOK, ORDER)
        page.wait_for_timeout(500)
        check_that(page.locator('#hl .tp').count() == 0 and page.locator('#tree .t-placeholder').count() == 0, 'option off: no placeholder colors, no placeholder rows')
        check_that(page.locator('#view-switch').is_hidden() and page.locator('#placeholder-box').is_hidden() and page.locator('#view-note').is_hidden(), 'option off: no switch, no box, no note')
        page.close()
        check_that(get_tidied_load(browser, '&tidy=1&template=mustache', ORDER) == ORDER, '?tidy=1 loads the template as written')
        check_that(get_tidied_load(browser, '&template=mustache', ORDER, {'tidy': True}) == ORDER, 'a load with tidy: true keeps the template as written')
        check_that(get_tidied_load(browser, '&tidy=1', PLAIN) != PLAIN, 'option off: ?tidy=1 tidies plain data as before')
        browser.close()


if '--browser' in sys.argv:
    run_browser_checks()

print(f'\n{len(failed)} failed' if failed else '\nall passed')
sys.exit(1 if failed else 0)
