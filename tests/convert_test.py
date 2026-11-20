"""Conversions JSON <-> JSON Lines <-> YAML <-> CSV <-> XML (convert.js, the same file in the
JSON, YAML and TOML editors): every round trip gives the same data back. In the TOML editor also
TOML <-> JSON and YAML (toml.js).

    php -S 127.0.0.1:8108 -t src src/php/router.php          (TOML editor; 8101 in the JSON editor, 8102 in the YAML editor)
    python tests/convert_test.py

The modules run in the browser (XML uses the browser's DOMParser)."""
import json
import os
import sys

from playwright.sync_api import sync_playwright

NAME = os.path.basename(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EDITOR = os.environ.get('EDITOR_URL', 'http://127.0.0.1:%d/' % {'yaml-editor': 8102, 'toml-editor': 8108}.get(NAME, 8101))

RICH = {
    'name': 'Ada Lovelace', 'born': 1815, 'ratio': 0.25, 'big': 1e21, 'neg': -3,
    'active': True, 'retired': False, 'nothing': None,
    'looks like a number': '007', 'looks true': 'true', 'looks null': 'null', 'empty': '',
    'spaces': '  padded  ', 'quotes': 'say "hi" & <bye>', 'lines': 'one\ntwo', 'unicode': 'Zürich – 東京 – 🚀',
    'tags': ['math', 'poetry'], 'one': ['single'], 'mixed': [1, 'two', None, False, {'x': 1}, [2, 3]],
    'emptyObject': {}, 'emptyArray': [], 'nested': {'deep': {'deeper': {'value': 42}}},
    'key with spaces': 1, '123start': 'digit key', 'item': {'item': 1}, 'entry': 'e', '@id': 'on attribute', '@lang': 'en',
}
TABLE = [
    {'id': 1, 'name': 'Apple', 'price': 1.2, 'organic': True, 'code': '007', 'note': None},
    {'id': 2, 'name': 'Pear, green', 'price': 3, 'organic': False, 'code': 'x"y', 'note': ''},
    {'id': 3, 'name': 'Line\nbreak', 'price': -0.5, 'organic': True, 'code': 'true', 'note': {'k': [1, 2]}},
]
failed = []


def check_that(ok, text):
    """Prints one result line and notes a failure.

    Args:
        ok (bool): True when the check holds.
        text (str): what is checked.

    Returns:
        None: the result is printed and a failure is noted.
    """
    print(('ok    ' if ok else 'FAIL  ') + text)
    if not ok:
        failed.append(text)


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True)
    page = browser.new_page(bypass_csp=True)          # the test runs its own snippets with the modules
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(EDITOR + '?lang=en', wait_until='networkidle')
    page.wait_for_timeout(800)
    run = lambda js, arg=None: page.evaluate('''async ([js, arg]) => {
        const D = await import('/js/datatree.js?v=12'), C = await import('/js/convert.js?v=13');
        const T = await import('/js/toml.js?v=6').catch(() => null);
        await D.importYamlLibrary();
        return (new Function('D', 'C', 'T', 'arg', 'return (async () => {' + js + '})()'))(D, C, T, arg);
    }''', [js, arg])

    # JSON -> YAML -> JSON
    y = run('return C.convertToYaml(arg);', RICH)
    check_that(run('return C.convertFromYaml(arg);', y) == RICH, 'JSON -> YAML -> JSON gives the same data')
    check_that('looks like a number: "007"' in y and 'looks true: "true"' in y, 'YAML quotes strings that would read as other types')
    m = run('const m = D.parse("yaml", arg); return [m.problems.length, D.getModelValue(m)];', y)
    check_that(m[0] == 0 and m[1] == RICH, 'the editor\'s own YAML reader reads it back the same')
    j = run('return C.convertToJson(arg, 2);', RICH)
    m = run('const m = D.parse("json", arg); return [m.problems.length, D.getModelValue(m)];', j)
    check_that(m[0] == 0 and m[1] == RICH and json.loads(j) == RICH, 'JSON written and read by the editor gives the same data')

    # JSON -> CSV -> JSON
    c = run('return C.convertToCsv(arg);', TABLE)
    check_that('text' in c and c['text'].split('\n')[0] == 'id,name,price,organic,code,note', 'CSV: the keys are the columns')
    check_that(run('return C.convertFromCsv(arg);', c['text']) == TABLE, 'JSON -> CSV -> JSON gives the same rows (types, null, "", quotes, line breaks, JSON in a cell)')
    check_that(',"007",' not in c['text'] and ',"true",' in c['text'], 'CSV: only texts that would read as another type are in quotes')
    check_that(run('return C.convertFromCsv(arg);', 'a;b\n1;"x;y"\n') == [{'a': 1, 'b': 'x;y'}], 'CSV with ";" is read too')
    check_that('error' in run('return C.convertToCsv(arg);', {'a': 1}), 'CSV: an object that is no table is refused with a reason')

    # JSON -> XML -> JSON
    x = run('return C.convertToXml(arg);', RICH)
    check_that(x.startswith('<?xml version="1.0" encoding="UTF-8"?>\n<root id="on attribute" lang="en">'), 'XML: the data is inside <root>, @keys are its attributes')
    check_that(run('return C.convertFromXml(arg);', x) == RICH, 'JSON -> XML -> JSON gives the same data')
    check_that('<entry key="key with spaces">1</entry>' in x and '<tags>\n    <item>math</item>' in x and 'lang="en"' in x, 'XML: keys that are no XML names, arrays as <item>, @keys as attributes')
    check_that(run('return C.convertFromXml(arg);', '<root><a>1</a></root>') == {'a': 1}, 'XML: plain elements are read with their types')
    check_that(run('return C.convertFromXml(arg);', '<catalog><book id="1"><title>A</title></book><book id="2"><title>B</title></book></catalog>') == {'book': [{'@id': 1, 'title': 'A'}, {'@id': 2, 'title': 'B'}]}, 'XML from elsewhere: repeated elements become an array, attributes @name')
    check_that(run('return C.convertFromXml(C.convertToXml(arg));', TABLE) == TABLE, 'a table survives XML too')

    # YAML with anchors, merge keys and several documents -> JSON
    yy = 'base: &b\n  a: 1\n  b: 2\nchild:\n  <<: *b\n  b: 3\nlist: [*b]\n---\nsecond: true\n'
    check_that(run('return C.convertFromYaml(arg);', yy) == [{'base': {'a': 1, 'b': 2}, 'child': {'a': 1, 'b': 3}, 'list': [{'a': 1, 'b': 2}]}, {'second': True}], 'YAML -> JSON resolves anchors and merge keys, several documents become an array')
    m = run('const m = D.parse("yaml", arg); return [m.docs.length, D.getPlainValue(m.docs[0].root)];', yy)
    check_that(m[0] == 2 and m[1]['child'] == {'a': 1, 'b': 3}, 'the editor\'s tree resolves them the same way')

    # YAML -> JSON -> YAML keeps the data
    check_that(run('return C.convertFromYaml(C.convertToYaml(C.convertFromYaml(arg)));', yy) == run('return C.convertFromYaml(arg);', yy), 'YAML -> JSON -> YAML keeps the data')

    # JSON <-> JSON Lines
    jl = run('return C.convertToJsonl(arg);', TABLE)
    check_that(jl['text'].count('\n') == 3 and jl['text'].split('\n')[0] == json.dumps(TABLE[0], separators=(',', ':'), ensure_ascii=False), 'JSON array -> JSON Lines: one compact line per entry')
    check_that(run('return C.convertFromJsonl(arg);', jl['text']) == TABLE, 'JSON -> JSON Lines -> JSON gives the same data')
    check_that(run('return C.convertFromJsonl(arg);', '{"a": 1}\r\n\n  [2, 3]  \n"x"') == [{'a': 1}, [2, 3], 'x'], 'JSON Lines: CRLF, blank lines and spaces around a value are fine')
    check_that('error' in run('return C.convertToJsonl(arg);', {'a': 1}), 'JSON Lines needs an array (one line per entry)')
    err = run('try { C.convertFromJsonl(arg); return ""; } catch (e) { return e.message; }', '{"a": 1}\n{"a": 2,}\n{"a"\n')
    check_that(err == 'Line 3 is not valid JSON', 'a broken line is named with its number: ' + err)
    m = run('const m = D.parse("json", arg); return [m.jsonl, m.docs.length, m.docs.map(d => d.label), m.problems.map(p => p.msg)];', '{"a": 1}\n{"b": 2}\n')
    check_that(m[0] and m[1] == 2 and m[2] == ['Line 1', 'Line 2'] and any('same keys' in p for p in m[3]), 'JSON Lines are recognized by their content, each line a document, with a note on different keys')
    check_that(not run('return D.parse("json", arg).jsonl;', '{\n  "a": 1\n}\n') and not run('return D.parse("json", arg).jsonl;', '[1]\n'), 'normal JSON (also on one line) is not taken for JSON Lines')
    yl = run('return C.convertToYaml(C.convertFromJsonl(arg));', jl['text'])
    check_that(run('return C.convertFromYaml(arg);', yl) == TABLE, 'JSON Lines -> YAML -> JSON gives the same data')
    cs = run('return C.convertToCsv(C.convertFromJsonl(arg));', jl['text'])
    check_that(len(run('return C.convertFromCsv(arg);', cs['text'])) == 3 and cs['text'].startswith('id,name,price'), 'JSON Lines -> CSV: one row per line')
    check_that(run('return C.convertFromXml(C.convertToXml(C.convertFromJsonl(arg)));', jl['text']) == TABLE, 'JSON Lines -> XML -> JSON gives the same data')

    # A schema from the data fits the data
    sch = run('return C.getInferredSchema(arg);', TABLE)
    probs = run('const m = D.parse("json", JSON.stringify(arg[0])); return D.getSchemaProblems(m.docs[0].root, arg[1]).length;', [TABLE, sch])
    check_that(sch['type'] == 'array' and sch['items']['type'] == 'object' and probs == 0, 'a schema made from the data fits it')

    # TOML (toml.js): data -> TOML -> data; null has no form in TOML and is left out
    if NAME == 'toml-editor':
        no_null = lambda v: {k: no_null(x) for k, x in v.items() if x is not None} if isinstance(v, dict) else [no_null(x) for x in v if x is not None] if isinstance(v, list) else v
        r = run('const w = T.convertToToml(arg); return [T.convertFromToml(w.text), w.lost];', RICH)
        check_that(r[0] == no_null(RICH) and r[1] == ['null'], 'data -> TOML -> data gives the same data, nulls reported as left out')
        r = run('return T.convertFromToml(T.convertToToml(arg).text);', {'rows': TABLE})
        check_that(r == {'rows': no_null(TABLE)}, 'an array of objects becomes [[rows]] tables and reads back the same')
        t = '# keep\n[server]\nport = 8080\nwhen = 2026-11-15T08:30:00Z\n\n[[user]]\nname = "Ada"\n'
        r = run('const v = T.convertFromToml(arg); return [v, T.convertFromToml(T.convertToToml(C.convertFromYaml(C.convertToYaml(v))).text)];', t)
        check_that(r[0] == r[1] == {'server': {'port': 8080, 'when': '2026-11-15T08:30:00Z'}, 'user': [{'name': 'Ada'}]}, 'TOML -> YAML -> TOML keeps the data, dates as text')
        r = run('return T.convertToToml([1, 2]);')
        check_that(r['text'] == 'value = [1, 2]\n' and r['lost'] == ['root'], 'a value that is no table goes under the key "value", reported')

    check_that(not errors, 'no script errors: ' + '; '.join(errors))
    browser.close()

print()
print('all passed' if not failed else f'{len(failed)} failed')
sys.exit(1 if failed else 0)
