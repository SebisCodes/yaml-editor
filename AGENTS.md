# AGENTS - YAML Editor

A short guide for AI coding agents working on this repository. People start with
[README.md](README.md).

## What it is

The YAML Editor (yaml.giit.ch) is a static web app. Edit YAML in the browser next to a
foldable tree of the data. All editing runs in the browser as plain ES modules in `src/js/`,
without a build step and without loading anything from other servers. PHP only renders the
pages (`src/index.php`, `src/embed/index.php` with the templates in `src/templates/`), opens
a document sent by POST (`src/post.php`) and counts page views. What the editor does is
described in [docs/USAGE.md](docs/USAGE.md); the interface for websites that embed it (URL
parameters, postMessage with the prefix `yamleditor:`, webhook) in
[docs/EMBEDDING.md](docs/EMBEDDING.md).

## Layout

```
src/          the website
  index.php   the editor page; src/embed/index.php is the developer page
  templates/  the page templates (editor, developer page, footer)
  js/         the editor, as ES modules (app.js starts it)
  css/        styles, light and dark
  php/        page rendering, language choice, page counter, router for php -S
  img/        logo and preview image
  vendor/     bundled third-party libraries (see NOTICE)
  post.php    opens a document sent by HTTP POST
  lang.php    serves the interface language packs
  llms.txt    the editor and its protocol, described for AI assistants
tests/        browser tests (Python, Playwright)
docs/         USAGE.md and EMBEDDING.md
```

`src/js/app.js` starts the editor and wires its areas together; each area has a module of
its own, and every file starts with a comment that says what it does. `sync.js` (webhook and
embedding), `prompt-parts.js` (the parts of the AI prompt), `i18n.js`, `dialogs.js`, `zip.js`,
`wrap.js`, `post.php` and `src/php/` are the same files in every giit editor. The template
placeholders (`?template=`) use the shared `template-tags.js`, and `template-examples.js`,
`template-pictures.js`, `template-expansion.js` and `template-controls.js` for the page's
examples, the filling with its map back to the code, the view switch and the "Placeholders"
box; `datatree-examples.js` writes the examples for their places and reads the example view,
`tree-views.js` chooses the view and `template-panel.js` connects the controls.

## Languages

The page texts and the interface texts of every language, English included, live in the
separate repository [giit-editors-lang](https://github.com/SebisCodes/giit-editors-lang),
which must be cloned next to this repository. `src/php/page.php` fills the templates from
it, and `src/js/i18n.js` translates the interface at run time. Code, comments and the AI
prompt are English.

## Run and test

```
php -S 127.0.0.1:8102 -t src src/php/router.php
```

serves the site at http://127.0.0.1:8102/. The tests are Python scripts that drive the
installed Google Chrome with Playwright for Python (`pip install playwright`). Run them from
the editor folder while the server runs (`EDITOR_URL` sets another address), one at a time:

```
python tests/gui_test.py       # the editor's features
python tests/aistatus_test.py  # the AI status at the button and in the dialog
python tests/convert_test.py   # round trips of the conversions
python tests/embed_test.py     # embedding with postMessage and the webhook
python tests/i18n_test.py      # the language pages
python tests/inplace_test.py   # editing in place
python tests/remote_test.py    # AI through the page's server, one key per session
python tests/security_test.py  # what a hostile page or link must not do
python tests/window_test.py    # the editor in its own window opened by a page
python tests/template_test.py  # template placeholders (?template=), in Node; --browser also in the editor
```

`window.yamlEditor` is a hook the tests use. After changing a script, raise the `?v=` of
`app.js` in `src/templates/editor.php` (and of a changed module where the importing file
carries one) so browsers load the new code.
