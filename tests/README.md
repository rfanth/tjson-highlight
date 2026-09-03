# Grammar tests

Runs `tjson.tmLanguage.json` through the same engine VS Code and VSCodium use
(`vscode-textmate` over Oniguruma), so what these tests report is exactly what
the editor would apply.

```sh
npm install
npm test            # everything below that asserts
npm run update      # accept current output as the new goldens
npm run regen       # rebuild generated fixtures with the tjson CLI

node tokenize.js fixtures/tables.tjson    # inspect one file
node spans.js                             # what scopes exist, with examples
node corpus.js /path/to/tjson-tests       # sweep an external corpus
node check-fixtures.mjs                   # every fixture still reads as TJSON
```


## Layout

The inputs:

| Path | What it is |
| --- | --- |
| `sources/*.json` | JSON inputs for the generated fixtures |
| `regen.sh` | Runs the real `tjson` CLI over `sources/` to produce `fixtures/` |
| `fixtures/*.tjson` | The TJSON actually fed to the grammar |
| `golden/*.txt` | Full token dumps, committed, diffed on every run |
| `expectations.json` | Hand-written claims about what specific tokens must mean |
| `rejections.json` | Illegal lines, and what the grammar must or must not say about them |

What `npm test` runs, in order:

| File | What it asserts |
| --- | --- |
| `run.js` | Goldens, expectations, twins and rejections — the four layers below |
| `patterns.js` | The long regex fragments the grammar repeats have not drifted apart |
| `mechanics.mjs` | The TextMate engine facts the grammar is built on still hold |
| `marker-depth.mjs` | Behaviour past the number of marker cells the grammar can count |
| `language-config.mjs` | The editor behaviours that are not the grammar's |
| `extension.js` | Parser diagnostics reach the right range in the right units |
| `scopes.js` | Every scope resolves to a class, and every stylesheet styles it |
| `classfor.mjs` | The scope-to-CSS-class walk, on its own |
| `snippets.mjs` | The snippets expand to TJSON the parser accepts |
| `shipped-parity.mjs` | Every generated fixture is what the SHIPPED library produces |
| `check-fixtures.mjs` | Every fixture, generated or handwritten, still reads as TJSON |
| `convert.js` | The JSON ↔ TJSON conversion commands |
| `debounce.js` | The preview's debounce |

Tools, run by hand:

| File | What it does |
| --- | --- |
| `tokenize.js` | Dumps one file's tokens; also the engine every other test uses |
| `corpus.js` | Sweeps an external corpus for false positives, silences and runaway regions |
| `spans.js` | Inventory of every scope with real examples of the text it covers |


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

**Corpus sweeps** cover what no fixture set can, because the fixtures here are
chosen to exercise particular rules and so can only find what someone already
thought to look for. `corpus.js` walks a checkout of the TJSON test repository
— hundreds of files — and looks for the three faults that need no hand-written
answer:

| fault | what it means |
| --- | --- |
| false positive | an `invalid.*` scope on a file the corpus calls valid — the grammar is accusing correct input |
| silence | a run of non-whitespace text with no scope at all — the grammar has nothing to say about it |
| unterminated | a multiline fence still open at end of file — it never found its closing glyph and swallowed the rest of the document |

The third is the loudest fault and the one a token dump hides best: the text is
scoped, just as the wrong thing, so neither of the other two sees it. Only the
multiline is checked, because only its closing text is mandatory — an
indent-glyph frame may legitimately end a file unclosed, and a folded value's
rule ends on the first line that does not continue it, which at end of file
does not exist.

The corpus lives in its own checkout, so its path is an argument rather than a
constant, and the sweep is not part of `npm test`.

**Rejections** cover what no fixture can, in both directions. Every fixture is
valid by construction, so nothing above can catch the grammar painting
*illegal* input as though it were correct — and that is the failure mode that actually happened
here twice: a comma-packed bare string array, and bare strings ending in a
comma or a pipe, both rendering as clean valid strings while the parser refused
them. Each entry is checked twice, and the first check is of the test's own
premise: the parser in `vendor/` must genuinely reject the line, so an entry
that becomes legal in some later release fails loudly rather than quietly
asserting nothing.

An entry says one of three things about its `text`:

| field | claim |
| --- | --- |
| *(neither)* | must not carry `string.unquoted.bare` — the default, and the failure mode this corpus was built for |
| `notScope` | must not carry that scope, where what is at risk is not a bare string — an illegal bare *key* coming out as `entity.other.attribute-name.bare`, say |
| `scope` | must carry that scope |

`scope` exists for the `invalid.*` scopes. They live only on broken input, so no
fixture can ever reach them, and this is the only place that can assert they are
emitted at all rather than merely mapped.

**Snippets** are the one part of the extension that WRITES TJSON rather than
reading it, so they are the one part that can produce a document the parser
refuses. `snippets.mjs` expands each one the way the editor would -- the first
line at the cursor, every line after it carrying the current line's indentation
-- at five depths including behind a marker chain, then hands the result to the
vendored parser and checks the string that comes back is exactly the text a
writer typed, with the margin and the indent stripped and no stray space left.

That indentation rule is the whole mechanism a multiline snippet rests on: the
closing fence sits at the construct's indent plus one space at *every* depth, a
constant, so one literal space in the body is right whether the key is at indent
2 or 20 and the snippet never has to know which.

**Shipped parity** is the check a release turns on. The fixtures are written by
the `tjson` CLI, which has at times been a build ahead of the release vendored
in `vendor/` -- and the vendored one is what the extension actually carries: it
parses documents for diagnostics and renders JSON to TJSON for the convert
command. So the question is not whether the fixtures parse but whether the
output a user will SEE is the output the grammar was tested against.

`shipped-parity.mjs` regenerates every fixture from its source through the
vendored library, with the same options `regen.sh` passes the CLI, and requires
them to match byte for byte. `--write` rewrites them from the shipped library
when they do not.

It found a real trap. `fold-opening-value.tjson` existed to cover a shape the
shipped release does not produce at the width its recipe recorded, so its
expectations asserted content nobody could regenerate -- they would have broken
for whoever ran regen next. The recipe is now two fixtures at two widths,
because no single width gives both branches of that rule from this source.

The five handwritten fixtures are outside parity by definition, which is why
`check-fixtures.mjs` runs here too rather than only inside `regen.sh`: nothing
else asks whether they are still valid TJSON.

**Cross-file checks** cover the surfaces the grammar is copied onto, where a
scope goes unstyled without anything failing. `scopes.js` now compares what the
grammar emits against four other files:

| surface | what would go wrong |
| --- | --- |
| `docs/scope-classes.json` | a scope resolves to no class at all |
| `scripts/render-html.mjs` | a class the mapping produces is never styled |
| `docs/web-highlighting.md` | the stylesheet a reader copies is missing one |
| `README.md` | the theme snippet a user pastes is missing one |
| `editors/nano/tjson.nanorc` | a rule cites a scope that no longer exists |

All five had drifted. `tjson-invalid` reached the mapping and the renderer and
never the document; the README's theme list was missing four scopes, one of
which -- the EOL indicator -- could not inherit, because theme scopes match
segment by segment and `constant.character.escape.tjson` does not reach
`constant.character.escape.eol-indicator.tjson`; and the nano file cited two
scopes that had been renamed away.

**Pattern inventory** covers a risk that is neither the grammar's behaviour nor
the mapping's, but the file's. TextMate has no way to name a regex fragment and
reuse it — the repository holds whole rules, and `include` splices rules, not
text — so a character class several rules need is written out in each of them.
The bare-key pattern appears seven times and the three bare-string classes nine
times each: thirty-four places one edit has to land identically. `patterns.js`
records every long class and how many patterns use it, so editing one copy shows
up as a count of six beside a new spelling with a count of one.

That drift is not hypothetical. The bare-key class was once missing twelve
characters, and `  at@sign:2` came out with no scope at all — a whole line, in a
committed fixture, for as long as nobody looked.

## Fixtures are generated, not imagined

Everything except `comments.tjson`, `minimal-json.tjson`, `marker-gap.tjson`,
`bare-strings-mixed.tjson` and `indent-glyph-array.tjson` comes out of the
`tjson` CLI, so the grammar is
tested against output a generator really emits.
`regen.sh` records the flags each fixture needs; rerun it after a `tjson-rs`
upgrade and diff the goldens to see what moved.

It refuses to run when the CLI is not the release vendored in `vendor/`, since a
mismatch can write fixtures in a format the extension itself rejects — which is
exactly how a comma-packed bare string array, forbidden since v0.5.0 of the
specification, sat here being highlighted as valid. A mismatch is sometimes the
right thing to do anyway, so it can be overridden, but only on purpose and
never quietly:

```sh
TJSON_ALLOW_VERSION_MISMATCH=1 npm run regen
```

The version check is only a proxy, though. The property it stands for is that
the fixtures must be readable by the parser the extension ships, and
`check-fixtures.mjs` asks that directly — every fixture back through
`toJson`. Regen runs it at the end, whichever CLI wrote the files. It is
stricter and more permissive than the version number at the same time: a CLI
ahead of the vendored release passes as long as what it wrote still reads, and
a CLI at exactly the right version fails if it wrote something the parser
refuses.

(`toJson` rather than `parse`: parse builds JS values and refuses an integer no
JS number can hold exactly, which is a limit of the host language, not of the
format — and `fold-types.tjson` carries a forty-digit integer on purpose.)

Those four are handwritten because the generator emits none of those
constructs, though the format allows every one of them. Comments and MINIMAL
JSON are legal input only.

`marker-gap.tjson` is the two columns after a colon that open an inline array.
They are a cell, in the sense of the indent — and a cell may be `[ ` as well as
`  `. The generator always writes the spaces, so no generated fixture can
reach the other spelling, and until this fixture existed the grammar read
`k:[ 1, 2` as an embedded JSON fragment. The line worth reading twice is the
second, `bare:[  one, two`: the marker, then one more space that is the bare
string's own opening quote, so the single element is `one, two` and the comma
is content. A comma-packed array admits no bare element at all, which is what
makes that unambiguous — and it is exactly the kind of thing a reader needs the
colouring for, since nothing else on the line says so.

`bare-strings-mixed.tjson` mixes the two bare-string openers in one document
and on one line. The specification requires no consistency between `_` and the
plain leading space, anywhere; the generator picks one per run, so the twins
check can only prove that two whole renderings agree, never that a mixed
document reads.

Handwritten does not mean unchecked: `check-fixtures.mjs` puts every fixture
back through the vendored parser, so a handwritten one that is not valid TJSON
fails like any other.

Fixture coverage: inline key packing, quoted and bare keys, inline scalar
arrays, pipe tables, multiline strings (bold pipe-margin, transparent, and
`folding-quotes`), line folds of every kind a marker can continue, indent glyphs
`/<` `/>`, explicit `[ ` / `{ ` markers from `--force-markers`, bare-string edge
cases, root-level values, MINIMAL JSON in all three places it can appear — after
a colon, on its own line, and in a table cell — including the bare strings that
merely look like it, and the `_` bare-string opener from `--bare-strings
marked`.

The three `multiline-nested-*` fixtures are one source rendered in all three
fence forms, and they are the fixture for two faults at once — plus the first
coverage the minimal `` ` `` form has ever had here.

`--force-markers` puts `[ [ { ` in front of the opening glyph, so the closing
glyph has to be found under four indent cells. The end test rebuilds that width
as a sum of slots, and while the unbounded overflow slot sat ahead of the
object-marker slot it ate that slot's two columns — atomically, so it could not
give them back — and the fence never closed. The multiline then swallowed the
rest of the document, which is why the assertion that line 6 is a *key* matters
as much as the one about the glyph itself.

The `deep` entry holds a CRLF string, so its glyph carries the literal `\r\n`
LOCAL EOL INDICATOR the specification allows; `plain` holds the same shape with
LF, so a plain glyph sits beside it in the same file and the pair shows the
suffix is optional rather than assumed.

`fold-types.tjson` is the one fixture that exists for a single question. A
continuation line says nothing about what it continues: `/ 8` is the tail of a
number, of a double-quoted string, of a bare string, or a line of a multiline
body, and all four are spelled the same. That fixture holds all four at once,
and it is built so that `looksnumeric` folds down to a line that is exactly
`/ 8` two entries below a `number` that folds to digits as well — so a grammar
that reads the continuation line instead of remembering the value above it gets
one of the two wrong and cannot get both right by luck.

`fold-opening-value.tjson` is `folded-keys.json` at a wider wrap, where the
colon *ends* its continuation line and the value opens on the line below. That
is a rule of its own, because the spacing rule that applies after a colon has to
apply after the fold marker instead, and the gap decides which value it is: zero
is a scalar, one is a bare string. The fixture holds both, `42` and
` short value`.

It exists because that shape used to fall out of `folded-keys` at `-w 30` and
stopped when the generator's width calculation changed — which left the rule
with no fixture at all and nothing to notice. A fixture whose coverage is a side
effect of a wrap width is a fixture that can lose its point silently, so this one
says what it is for in its name.

`fold-quoted-key.tjson` is about a tie and the one thing that breaks it. A
folded quoted key and a folded quoted string value are spelled identically — a
`"` at an even column, running on over `/ ` lines — and the `:` that would
separate them lands lines later, after the string has already been tokenized.

The fixture holds every state at once, which is why it is worth reading as a
whole:

| Lines | Shape | What the grammar says |
| --- | --- | --- |
| 1–3 | folded key, no marker anywhere | undecided — scoped as a string |
| 5–8 | folded array elements at the top level | string, and that is correct |
| 10–12 | folded key behind `[ { ` | **key**, settled by the marker on its own line |
| 14–18 | an array nested *inside* that object | string — the memory is shadowed here |
| 19–20 | a sibling key, same object, same column | **key**, resolved from what a sibling proved |

The `{ ` marker opens an object and an object starts with a key, so line 10 is
settled by the line it sits on. Line 19 is the same object one entry later, with
a whole nested array in between, and the marker that settled its sibling is far
behind — it resolves anyway, because the marker opens a region that remembers
what that column holds and the region outlives the nested block.

Lines 14–18 are the reason that is correct rather than merely confident. An
earlier attempt held the object's region open across a nested array exactly like
this and painted its elements as keys — a confident wrong answer, which is worse
than an honest unknown. A block sub-region shadows the memory for precisely the
lines belonging to the nested container, and the expectation on line 16 fails
the moment that shadow is removed.

Lines 1–3 are still undecided, and correctly so: nothing in the document has
proved anything about that column.

The three `*-marked` fixtures are the same sources as their unmarked twins. A
bare string may open with `_` instead of its leading space, the two are
interchangeable, and no consistency is required between them, so the pair proves
the grammar reads both — the two renderings of one document must produce the
same scopes in the same columns.
