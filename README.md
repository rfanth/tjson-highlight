# Text JSON (TJSON) Syntax Highlighting for VS Code / VSCodium

Adds syntax highlighting for `.tjson` files.

[https://github.com/rfanth/tjson-highlight](https://github.com/rfanth/tjson-highlight)

Learn more about TJSON at [textjson.com](https://textjson.com).

## Install - VSCode, VSCodium

This has full coverage for everything in TJSON within the TextMate grammar file.

Copy this folder to your extensions directory:

**VSCodium:**
```
~/.vscode-oss/extensions/tjson-highlight/
```

**VS Code:**
```
~/.vscode/extensions/tjson-highlight/
```

Then reload the window: `Ctrl+Shift+P` → `Developer: Reload Window`.
Disabling and reenabling this extension also seems to have a similar effect if you don't want to reload everything.

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
      {
        "scope": "string.unquoted.fold-continuation.tjson",
        "settings": { "foreground": "#a6e3a1" }
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
        "scope": "constant.language.tjson",
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

      // ── Table pipes ───────────────────────────────────────────────────
      {
        "scope": "keyword.operator.table.pipe.tjson",
        "settings": { "foreground": "#6c7086" }
      }

    ]
  }
}
```

> These colors are based on the [textjson.com](https://textjson.com) demo
> palette (a dark Catppuccin Mocha-inspired scheme). Swap any hex value to
> taste — all rules are scoped to `.tjson` so nothing else changes.

## Install - nano

### Note: The nano highlighter isnt nearly as good as the VSCode/VSCodium one

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

---