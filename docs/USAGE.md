# Using the YAML Editor

The YAML Editor shows your YAML next to a foldable tree of the data. You can change keys and
values right in the tree with comments and formatting kept, see problems with line and
column, check the data against a JSON Schema and convert it to JSON, CSV or XML.

Open it at https://yaml.giit.ch/. It is free, needs no sign-up, and runs in your browser:
your documents stay there unless you send them somewhere yourself.

## What it can do

- YAML 1.2: several documents with `---`, anchors, aliases and merge keys; comments are
  kept.
- A tree of the data: mappings and sequences fold, every value shows its type, `{3}` / `[5]`
  count the entries; one tree per document, anchors (`&name`) and aliases (`*name`) marked.
- Editing in the tree: keys and values (quoting and block style kept where they fit), the
  type of a value, entries added, duplicated, moved and removed.
- Problems with line and column: syntax errors, tabs used for indentation, duplicate keys,
  aliases without their anchor, and what does not fit a chosen JSON Schema.
- **Format**: consistent indentation, flow style (`{a: 1}`, `[1, 2]`) written as block
  style, comments kept.
- Convert to JSON (several documents become an array), JSON Lines, CSV (a sequence of
  mappings is a table) and XML; JSON, JSON Lines, CSV and XML files open as YAML.
- Templates: Docker Compose, GitHub workflow, Kubernetes (two documents), OpenAPI, table.

## Getting started

1. **Start**: choose a template under **New**, open a file or paste YAML.
2. **Edit**: type in the code, or change keys and values in the tree.
3. **Export**: save YAML, JSON, CSV or text.

## Editing in the tree

Click a key or a value in the tree to change it right there. **Enter** or a click elsewhere
writes the change into the code at exactly that place, **Escape** cancels. The buttons above
the tree add, duplicate, move and remove entries and change the type of a value. Each change
is a small edit of the code that keeps comments and formatting, and one step for Undo.

A click in the tree puts the code's cursor on that value; the cursor in the code marks its
value in the tree. The path of the selected value (`$.items[3].name`) is shown below the
tree, and you can search keys and values.

The right side panel has **Value** (the selected key and value), **Insert** (entries and
pieces of code), **Convert** and **Schema**: choose a JSON Schema from your documents and
every place that does not fit is listed as a problem (type, required, properties, enum,
pattern, format, minimum and maximum, items, allOf / anyOf / oneOf, if / then / else, `$ref`
inside the schema and more). A `$schema` address is never fetched.

## Your documents

Your documents are kept only in your browser (in `localStorage`), not on a server, and stay
there after you close the page. **My documents** (the folder button at the top left) lists
every document of this browser: open, rename, duplicate, download (`.yaml`) and delete them.

Clearing the browser's site data removes them, so download the ones you want to keep, or let
the editor send them to your own server: **Save to server** (the cloud button) sets up a
webhook, an address that gets every saved version (see [EMBEDDING.md](EMBEDDING.md#webhook)
for what it receives). Nothing is sent until you enter an address there.

**Opening files:** Open `.yaml` and `.yml` files with the button, by drop or by paste; JSON,
JSON Lines, CSV and XML files open as YAML.

## Export

**Export** saves the `.yaml` as it is, JSON, CSV, the tree as plain text, or all of them as
one ZIP.

**Export > Open in another editor** converts the document in the browser to JSON, TOML,
SHLS, XML or CSV and opens the result as a new document in that editor. Anything the other
format cannot hold is listed first.

## AI Assistant

Any AI can work with you: ChatGPT, Claude, Gemini, Copilot or the AI in your coding tool.
Nothing to install and no key needed. Click **AI Assistant**, then **Copy prompt**, paste it
into your AI and say what it should do. The prompt holds the instructions and the current
document.

The AI answers with a link that carries the document after the `#`; click it and the
document appears in your editor. **Undo** takes every change back. The links look like this:

- `https://yaml.giit.ch/#b64=<base64url of the UTF-8 text>`
- `https://yaml.giit.ch/#yaml=<URL-encoded text>`
- `https://yaml.giit.ch/#z=<base64url of the zlib-compressed text>` (shortest)
- `&mode=add` merges into the first document of the open file: the keys of a mapping go into
  the root mapping (existing keys get the new values), the items of a sequence are added to
  the root sequence; comments stay.
- `&file=new&name=<name>` makes a new document next to your others, `&file=<name>` changes
  that one; without `&file=` the open document changes.
- `&part=N&of=M&id=<name>` sends a long document in several links; the editor collects the
  parts.

A tab opened with such a link hands the document to the editor tab you used last. You can
also paste the AI's whole answer into the editor (Ctrl+V outside the code); links that a
terminal broke over several lines are joined. When the editor is embedded in another
website, links cannot reach it, so paste the answer there. A website that embeds the
editor may give its own instructions for how the AI answers, or show its own AI dialog
when you press the button; the dialog names the website and shows its instructions.

**Browser agents (WebMCP):** in browsers that offer WebMCP, the page registers tools for AI
agents that run in the page itself: `get_document`, `get_problems`, `get_value` and
`set_value` (by a path such as `$.a.b[0]` or a JSON Pointer, optionally in one of several
documents), `set_document`, `replace_text`, `show_line`, `undo`, and `list_files`,
`open_file`, `new_file` for your other documents. Every change is one step for Undo.

## Side panel

The side panel holds **Value**, **Insert**, **Convert** and **Schema**. The button at the top right
of the work area opens it over the tree, below the tree's bar, and closes it again (Escape too);
it is closed when the editor opens. The bar's controls stay in view and usable while it is open.
On a phone it is the view **Edit**.

## Templates with placeholders

A website that edits templates opens the editor with `?template=mustache` or `?template=angle`.
The tree then shows the data filled with the website's examples (when they cannot be filled in, the template's tree with a note); **Template** in the tree's bar
shows the template's tree with the placeholders as written, **Examples** brings the examples back.
A placeholder without an example shows its label in brackets. The **Placeholders** box below the
code lists them: a click puts one at the cursor, a section around the selected text. A value that
comes from an example cannot be changed in the tree. Saving, downloading and exporting keep the
placeholders.

## Languages

The editor speaks English at `/`, German `/de/`, French `/fr/`, Italian `/it/`, Spanish
`/es/`, Portuguese `/pt/`, Dutch `/nl/`, Polish `/pl/`, Turkish `/tr/`, Russian `/ru/`,
Ukrainian `/uk/`, Chinese `/zh/`, Japanese `/ja/` and Korean `/ko/`. Opening
`https://yaml.giit.ch/` leads to the language you picked before in a language menu, or else
to your browser's language. A language picked in the menu holds for every giit.ch site. The
prompt for the AI is always in English.

## Color theme

Light, dark or automatic (following your system): the theme switch in the bar sets it, and
the editor remembers your choice.

## Keyboard shortcuts

On macOS use Cmd instead of Ctrl. The **Help** dialog in the editor lists them as well.

| Keys | Action |
|---|---|
| ↑ ↓ ← → | In the tree: go up and down, fold and unfold |
| Enter | In the tree: change the value (F2: the key) |
| Delete | In the tree: remove the entry |
| Alt + ↑ / ↓ | In the tree: move the entry up / down |
| Ctrl + F | Search keys and values in the tree |
| Ctrl + Shift + F | Format the document |
| Tab / Shift + Tab | Indent / outdent in the code (with spaces) |
| Ctrl + / | Comment lines in or out (`#`) |
| Ctrl + Z / Y | Undo / redo |
| Ctrl + S | Save (download, or to your server) |
| Ctrl + E | Export |
| Ctrl + O | My documents |

Enter after `key:` indents the next line, and Enter in a list starts the next item with `-
`. Quotes and brackets close by themselves around a selection.

## On your own website

The editor can be embedded in other websites with an iframe, opened in a window of its own
or used as a read-only viewer. See [EMBEDDING.md](EMBEDDING.md).
