# Grammar tests

Runs `tjson.tmLanguage.json` through the same engine VS Code and VSCodium use
(`vscode-textmate` over Oniguruma), so what these tests report is exactly what
the editor would apply.

```sh
npm install
npm test            # check goldens + scope expectations
npm run update      # accept current output as the new goldens
npm run regen       # rebuild generated fixtures with the tjson CLI
node tokenize.js fixtures/tables.tjson    # inspect one file
```

## Layout

| Path | What it is |
| --- | --- |
| `sources/*.json` | JSON inputs for the generated fixtures |
| `regen.sh` | Runs the real `tjson` CLI over `sources/` to produce `fixtures/` |
| `fixtures/*.tjson` | The TJSON actually fed to the grammar |
| `golden/*.txt` | Full token dumps, committed, diffed on every run |
| `expectations.json` | Hand-written claims about what specific tokens must mean |
| `rejections.json` | Illegal lines that must NOT be highlighted as valid |

## Layers, on purpose

**Goldens** catch drift. Any change anywhere in the grammar shows up as a diff,
including in places nobody wrote an assertion for. They record what the grammar
*does*.

**Expectations** record what the grammar *should* do. Each entry says "on line N
of fixture F, the token whose text is T must carry scope S." This matters
because a golden blessed while a bug was present looks clean forever;
an expectation keeps failing until the bug is actually fixed. Failing
expectations here are a live bug list, not test breakage.

**Twins** check that a `-marked` fixture tokenizes identically to its unmarked
counterpart, so a rule that learned one opener and not the other is caught.

**Rejections** cover what no fixture can. Every fixture is valid by
construction, so nothing above can catch the grammar painting *illegal* input as
though it were correct — and that is the failure mode that actually happened
here twice: a comma-packed bare string array, and bare strings ending in a
comma or a pipe, both rendering as clean valid strings while the parser refused
them. Each entry is checked twice, and the first check is of the test's own
premise: the parser in `vendor/` must genuinely reject the line, so an entry
that becomes legal in some later release fails loudly rather than quietly
asserting nothing.

## Fixtures are generated, not imagined

Everything except `comments.tjson` and `minimal-json.tjson` comes out of the
`tjson` CLI, so the grammar is tested against output a generator really emits.
`regen.sh` records the flags each fixture needs; rerun it after a `tjson-rs`
upgrade and diff the goldens to see what moved. It refuses to run unless the CLI
is the same release as the parser in `vendor/`, since a mismatch writes fixtures
in a format the extension itself rejects — which is exactly how a comma-packed
bare string array, forbidden since v0.5.0 of the specification, sat here being
highlighted as valid.

Those two are handwritten because the generator emits neither construct —
comments and MINIMAL JSON are legal input only. Both were checked against the
real parser (`tjson -j`) before being committed, so they are valid TJSON even
though no generator would produce them.

Fixture coverage: inline key packing, quoted and bare keys, inline scalar
arrays, pipe tables, multiline strings (bold pipe-margin, transparent, and
`folding-quotes`), line folds, indent glyphs `/<` `/>`, explicit `[ ` / `{ `
markers from `--force-markers`, bare-string edge cases, root-level values,
MINIMAL JSON in all three places it can appear — after a colon, on its own line,
and in a table cell — including the bare strings that merely look like it, and
the `_` bare-string opener from `--bare-strings marked`.

The three `*-marked` fixtures are the same sources as their unmarked twins. A
bare string may open with `_` instead of its leading space, the two are
interchangeable, and no consistency is required between them, so the pair proves
the grammar reads both — the two renderings of one document must produce the
same scopes in the same columns.
