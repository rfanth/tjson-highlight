# Text JSON (TJSON) for VS Code / VSCodium / Web Server / Browser

Syntax highlighting, error checking, language support, web server and/or browser
support, and JSON ↔ TJSON conversion for `.tjson` files.

**Putting TJSON on a web page?** Start at
**[docs/web-highlighting.md](docs/web-highlighting.md)** — the scope-to-CSS
mapping, the palette, and where to run the tokenizer.

[https://github.com/rfanth/tjson-highlight](https://github.com/rfanth/tjson-highlight)

Learn more about TJSON at [textjson.com](https://textjson.com).

The highlighter has full coverage for everything in TJSON within the TextMate grammar
file.

It also has independent highlighting infrastructure usable on its own on a web server
or client — see [docs/web-highlighting.md](docs/web-highlighting.md).

This is also an IDE language support extension with UI conversion actions.

## Install - VSCode, VSCodium, Cursor, etc.

Click on Extensions, search for TJSON (`@id:rfanth.tjson-highlight`), click on
TJSON, and press the install button.

## How to use

Most people will use this extension as a way to let a human view JSON data
comfortably using the **Preview as TJSON** feature on .json files.

People will simply stop reading JSON after a short while or refuse to read it
in the first place because JSON is inherently designed for ease of parsing, not
reading.  TJSON fixes that.  What you cannot or will not read, you cannot audit.

While you can write TJSON, and it is well-supported with guaranteed round
trip data to and from arbitrary JSON, with good error messages and IDE
support, that is not how most people will use TJSON.  TJSON is also excellent
at smoothly embedding JSON in an otherwise readable text document, while being
able to round trip the data later back to JSON, though not everyone needs this.

### Converting between JSON and TJSON

Three commands, on the editor title bar and in the command palette:

| command | on | gives |
| --- | --- | --- |
| **Preview as TJSON** | a `.json` file | that JSON rendered as TJSON |
| **Preview as JSON** | a `.tjson` file | the data as plain JSON |
| **Preview Reformatted with My Render Settings** | a `.tjson` file | the same document re-rendered your way |

A preview opens beside the source, is read-only, and re-renders as you edit the
original. It is a real editor pane rather than a webview, so it is highlighted by
this extension's own grammar in your own theme, and it is checked by this
extension's own error reporting — if a preview ever shows a squiggle, the
renderer produced something the parser will not accept.

**Open Preview as an Editable File** turns the pane you are looking at into an
ordinary untitled document you can edit and save.

Reformatting goes through JSON, and JSON has no comments, so comments do not
survive it. The command warns first when the file actually has any.

### Render settings

Every option the renderer takes is available as `tjson.render.*` — wrap width,
multiline style, whether to use tables and the thresholds for them, string and
key quoting, fold styles, and the rest.

**Anything you do not set is left alone.** Unset settings are not sent to the
renderer at all, so the library's own default applies — including after an
upgrade that changes one. This extension never writes a default into your
settings, and never passes one on your behalf, which is why every setting shows
`null` until you pick something.

The settings are generated from the bundled library's own type definitions, so
their names, their dropdown values and their documentation always describe the
parser actually shipped rather than the one that shipped when this was written.

### Customizing Colors

This extension only adds the grammar — it does not override your color theme.
Most themes will highlight TJSON reasonably well out of the box.

If you want to fine-tune the colors (or reproduce the palette from
[textjson.com](https://textjson.com)), paste the block below into your
`settings.json` (`Ctrl+Shift+P` → `Preferences: Open User Settings (JSON)`).

The `[tjson]` wrapper limits every rule to `.tjson` files only, so your
theme is untouched everywhere else.

```jsonc
"[tjson]": {
  "workbench.colorCustomizations": {
    "editor.background": "#11131d"
  },
  "editor.tokenColorCustomizations": {
    "textMateRules": [

      // ── Comments ──────────────────────────────────────────────────────
      {
        "scope": "comment.line.double-slash.tjson",
        "settings": { "foreground": "#45475a", "fontStyle": "italic" }
      },

      // ── Keys ──────────────────────────────────────────────────────────
      {
        "scope": "entity.other.attribute-name.bare.tjson",
        "settings": { "foreground": "#89b4fa" }
      },
      {
        "scope": "entity.other.attribute-name.quoted.tjson",
        "settings": { "foreground": "#89b4fa" }
      },

      // ── String values ─────────────────────────────────────────────────
      {
        "scope": "string.unquoted.bare.tjson",
        "settings": { "foreground": "#a6e3a1" }
      },
      // The single space that opens a bare string — a one-sided quote.
      // It is the entire type marker: `k:true` is the boolean, `k: true`
      // is the string "true". Dim by default like any other delimiter;
      // see "Making the bare string marker more visible" below to light it up.
      {
        "scope": "punctuation.definition.string.begin.bare.tjson",
        "settings": { "foreground": "#6c7086" }
      },
      {
        "scope": "string.quoted.double.tjson",
        "settings": { "foreground": "#f9e2af" }
      },
      {
        "scope": "markup.raw.block.tjson",
        "settings": { "foreground": "#f9e2af" }
      },

      // ── Numbers ───────────────────────────────────────────────────────
      {
        "scope": "constant.numeric.tjson",
        "settings": { "foreground": "#fab387" }
      },

      // ── Booleans & null ───────────────────────────────────────────────
      {
        "scope": "constant.language.boolean.tjson",
        "settings": { "foreground": "#cba6f7" }
      },
      {
        "scope": "constant.language.null.tjson",
        "settings": { "foreground": "#9399b2" }
      },

      // ── Escape sequences ──────────────────────────────────────────────
      {
        "scope": "constant.character.escape.tjson",
        "settings": { "foreground": "#89dceb" }
      },
      // The LOCAL EOL INDICATOR: the literal `\n` or `\r\n` a multiline
      // string's opening and closing glyphs may carry, saying what the line
      // breaks inside it stand for. It needs its own rule -- theme scopes
      // match segment by segment, so the entry above does not reach it.
      {
        "scope": "constant.character.escape.eol-indicator.tjson",
        "settings": { "foreground": "#89dceb" }
      },

      // ── Structural markers  ([ , { , /< , /> , / fold) ───────────────
      {
        "scope": "keyword.operator.array-marker.tjson",
        "settings": { "foreground": "#74c7ec" }
      },
      {
        "scope": "keyword.operator.object-marker.tjson",
        "settings": { "foreground": "#74c7ec" }
      },
      {
        "scope": "keyword.control.indent-adjustment.tjson",
        "settings": { "foreground": "#74c7ec" }
      },
      {
        "scope": "punctuation.definition.fold-marker.tjson",
        "settings": { "foreground": "#74c7ec" }
      },
      {
        "scope": "punctuation.definition.string.multiline-margin.tjson",
        "settings": { "foreground": "#74c7ec" }
      },

      // ── Punctuation ───────────────────────────────────────────────────
      {
        "scope": "punctuation.separator.key-value.tjson",
        "settings": { "foreground": "#6c7086" }
      },
      {
        "scope": "punctuation.definition.string.begin.tjson",
        "settings": { "foreground": "#6c7086" }
      },
      {
        "scope": "punctuation.definition.string.end.tjson",
        "settings": { "foreground": "#6c7086" }
      },
      {
        "scope": "punctuation.definition.array.begin.tjson",
        "settings": { "foreground": "#6c7086" }
      },
      {
        "scope": "punctuation.definition.array.end.tjson",
        "settings": { "foreground": "#6c7086" }
      },
      {
        "scope": "punctuation.definition.dictionary.begin.tjson",
        "settings": { "foreground": "#6c7086" }
      },
      {
        "scope": "punctuation.definition.dictionary.end.tjson",
        "settings": { "foreground": "#6c7086" }
      },
      {
        "scope": "punctuation.section.embedded.tjson",
        "settings": { "foreground": "#6c7086" }
      },
      {
        "scope": "punctuation.whitespace.indent.tjson",
        "settings": { "foreground": "#6c7086" }
      },

      // ── Faults ────────────────────────────────────────────────────────
      // Three things the grammar can see are wrong on its own: a multiline
      // margin that wanders off its column, a table row whose cell edges do
      // not line up with the header's, and a closing indent glyph away from
      // the column its frame opened at. Each is named on the character that is
      // in the wrong place -- the `|`, the `|`, the `/>` -- and not on the
      // whitespace in front of it, so a plain foreground colour is enough.
      // Most themes already style `invalid`; these only make it explicit.
      {
        "scope": "invalid.illegal.multiline-margin-column.tjson",
        "settings": { "foreground": "#f38ba8", "fontStyle": "italic" }
      },
      {
        "scope": "invalid.illegal.table-row-column.tjson",
        "settings": { "foreground": "#f38ba8", "fontStyle": "italic" }
      },
      {
        "scope": "invalid.illegal.indent-glyph-column.tjson",
        "settings": { "foreground": "#f38ba8", "fontStyle": "italic" }
      },

      // ── Separators ────────────────────────────────────────────────────
      // The gap between inline-packed pairs.
      {
        "scope": "punctuation.separator.inline.tjson",
        "settings": { "foreground": "#6c7086" }
      },
      // Between elements of a packed array.
      {
        "scope": "punctuation.separator.array.tjson",
        "settings": { "foreground": "#6c7086" }
      },
      // Commas inside MINIMAL JSON. Named for what is known: whether one
      // separates array elements or object pairs depends on the enclosing
      // bracket, which the grammar rule cannot see from where it matches.
      {
        "scope": "punctuation.separator.embedded.tjson",
        "settings": { "foreground": "#6c7086" }
      },

      // ── Table pipes ───────────────────────────────────────────────────
      {
        "scope": "punctuation.separator.table.tjson",
        "settings": { "foreground": "#6c7086" }
      }

    ]
  }
}
```

> These colors are based on the [textjson.com](https://textjson.com) demo
> palette (a dark Catppuccin Mocha-inspired scheme). Swap any hex value to
> taste — all rules are scoped to `.tjson` so nothing else changes.


### Making the bare string marker more visible

In TJSON, location is king.  It shows you where something is in the data, and
what type it is.  There are indent markers and bare string markers that you can
print or not, but the space tells you the meaning, not the thing that may or
may not be printed there.  If you don't understand this, it reads fine as text,
but if you do, you can see the type information too without being overwhelmed
by visual noise.  In TJSON, The space is never invisible, you can always see the
gap from the character that follows it, and that's the point.  That being said,
sometimes making the space more obvious is useful.

In TJSON an extra leading space distinguishes between a bare string and other
values — `active:true` is the boolean, `active: true` is the string `"true"`.
That distinction is easy to spot with the naked eye once you know what to look
for.  However, sometimes it's nice to see the space as a character, either to
help you understand what the spaces mean, or because you are doing something
that makes types extra important and justifies the extra visual noise.  Because
location comes first, when we put something in the space to mark it, we simply
replace the space, we never actually move any text.

This can be done on the screen by using the highlighter, or in the text by
using the format itself.

#### Using the highlighter

If you would rather not change the document, but still want to make the marker
jump off the page, the grammar scopes the opener as
`punctuation.definition.string.begin.bare.tjson`, so you can make it show up in
your editor alone. Give it a background instead of a foreground:

```jsonc
{
  "scope": "punctuation.definition.string.begin.bare.tjson",
  "settings": { "background": "#a6e3a133" }
}
```

Every bare string in the file now begins with a faint tinted column, and a
value that looks like `true` but isn't reads as a string at a glance. This is
off by default because it is a preference, not a correction — the highlighting
is right either way.  It can help you see the indent however, and you might
want to give it a shot.

Note there is deliberately no matching `...string.end.bare` scope. A bare
string ends with two spaces or an eol.  In an underpadded table, it can end
with a `|`, but this is not something a generator will ever do on its own —
the spec forbids a pipe inside a bare string in a table precisely so that an
underpadded table still parses deterministically.

#### Using the generator

If you control the generator, `tjson --bare-strings marked` writes that opening
space as `_` — `active:_true` — which puts the distinction in the file itself
for every reader, editor or not. The two openers are interchangeable, occupy
the same column, and can be mixed freely; the grammar treats them identically.

### What the editor does while you type

TJSON is an indentation format with no closing tokens, so most of what an editor
normally does for a bracketed language is wrong here. The extension turns those
things off deliberately, and it is worth knowing which:

| | |
| --- | --- |
| **Nothing auto-closes** | Not `[`, not `{`, not a quote or a backtick. `[ ` and `{ ` at the head of a line are indent cells with no closing counterpart, and that is much the commonest reason to type one, so an inserted `]` would have to be deleted every time. A backtick is worse: pairing it turns ` `` ` into a different multiline style rather than a closed pair. |
| **Nothing is re-indented as you type** | The editor never moves a line you are working on. It is allowed to, through the language's indentation rules, and it used to: a closing indent glyph could not be pushed off its column because every second space typed in front of it snapped the line back. |
| **Enter indents in exactly two places** | After a key whose colon ends the line, because that opens a container; and after a key that opens a MINIMAL `` ` `` multiline, because its body sits one level in and cannot move anywhere else. Everywhere else the new line simply keeps the indentation of the one above it. |
| **Wrapping a selection still works** | Select some text and type a quote or a bracket to wrap it. That only ever happens when you ask for it, so unlike auto-closing it cannot fire by accident. |
| **Tab is two spaces, and trailing whitespace is left alone** | Both are pinned for `.tjson` files. The indentation rules are written for a two-space format and are wrong at any other width, and trailing spaces can be data -- a bare string may end in one. |

An indent glyph is the one place Enter deliberately does nothing clever. `/<`
exists to bring a deeply nested block back to a readable column, so the line
after it moves *left*.

## Install - nano

### Note: The nano highlighter isn't nearly as good as the VSCode/VSCodium one

The textmate grammar file can cover just about anything TJSON can spit out, but
nano's highlighting rules are not that sophisticated, so it is quite possible
that for certain things it simply cannot highlight TJSON correctly.  That does
not mean that this highlighter could not be improved, I'm sure it can be to
a great extent.  It's not nearly as good as the textmate grammar at the moment,
but it's much better than nothing.

Copy `editors/nano/tjson.nanorc` to your nano config directory:

```sh
cp editors/nano/tjson.nanorc ~/.config/nano/tjson.nanorc
```

Then include it in your nano config. Add this line to `~/.config/nano/nanorc`
(or `~/.nanorc` if you use the old location):

```
include "~/.config/nano/tjson.nanorc"
```

Or install system-wide so all users get it:

```sh
sudo cp editors/nano/tjson.nanorc /usr/share/nano/tjson.nanorc
```

System-wide files in `/usr/share/nano/` are loaded automatically — no `include` line needed.

## How to use the highlighter on your own web page

The grammar is an ordinary TextMate grammar, so the engine VS Code runs it with
also runs in a browser. You need no TJSON-specific library: `tjson.tmLanguage.json`
from this repo, plus `vscode-textmate` and `vscode-oniguruma`.

**[docs/web-highlighting.md](docs/web-highlighting.md)** has the scope-to-CSS
mapping, the palette textjson.com uses, and where to run the tokenizer.

Most pages are showing something they already hold as JSON, and for those the
TJSON view is one call — with the reader downloading none of the machinery:

```js
const html = await renderJson(JSON.stringify(data));   // -> highlighted spans
```

The two forms carry the same data and convert both ways, so whichever one is
your source of truth, the other is always one conversion away. Rendering on
demand also means your render settings live in one place and every page picks
them up at once.

Where the TJSON *is* the artifact — an example in documentation, a snippet in a
spec — [`scripts/render-html.mjs`](scripts/render-html.mjs) highlights the text
itself just as well:

```sh
node scripts/render-html.mjs sample.tjson --fragment > sample.html
```

Either way a highlighted block is around 750 bytes gzipped, against roughly 181K
for the tokenizer, grammar and regex engine needed to produce the same pixels in
the browser — which is the whole page-load budget on a phone.

If the reader is *typing* TJSON, the engine has to be client-side. The guide
shows how to load it lazily, behind a dynamic import triggered by an
IntersectionObserver, so a page pays only when something is about to be coloured
and never during load. Parse-error reporting in the browser works the same way,
and is a separate download only pages with an editor need.

The mapping lives in [docs/scope-classes.json](docs/scope-classes.json) rather
than in prose so it can be checked: `tests/scopes.js` asserts that every scope
the grammar emits resolves to a class and that no rule in it is dead. Copy it
as-is.

## Manual installation

### From a GitHub release

CI attaches a `.vsix` to each [GitHub release](https://github.com/rfanth/tjson-highlight/releases/latest).
It is byte for byte identical to the one the extensions bar serves. The file is
named `tjson-highlight-<version>.vsix`.

Download it, then from the directory you saved it in:

**VS Code:**
```
code --install-extension tjson-highlight-<version>.vsix
```

**VSCodium:**
```
codium --install-extension tjson-highlight-<version>.vsix
```

**Cursor:**
```
cursor --install-extension tjson-highlight-<version>.vsix
```

Replace `<version>` with the version in the filename, for example `0.2.1`.

### Locally from this folder

Copy this folder to your extensions directory:

**VSCodium:**
```
~/.vscode-oss/extensions/tjson-highlight/
```

**VS Code:**
```
~/.vscode/extensions/tjson-highlight/
```

**Cursor:**
```
~/.cursor/extensions/tjson-highlight/
```

Then reload the window: `Ctrl+Shift+P` → `Developer: Reload Window`.
Disabling and reenabling this extension also seems to have a similar effect if you don't want to reload everything.

---
