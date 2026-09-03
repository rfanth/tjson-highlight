# Highlighting TJSON on a web page

Everything you need is in this repo and on npm. There is no TJSON-specific
library to install — the grammar here is an ordinary TextMate grammar, so the
same engine VS Code uses runs it in a browser.

Two pieces, and you may want only the first:

| piece | gives you | comes from |
| --- | --- | --- |
| `tjson.tmLanguage.json` | colouring | this repo |
| `@rfanth/tjson` | error reporting | npm |

## Where the tokenizer runs

Colouring needs a regex engine, a grammar and a tokenizer. That is not free:

| | raw | gzipped |
| --- | --- | --- |
| `onig.wasm` (oniguruma) | 464K | **149K** |
| `vscode-textmate` | 60K | 17K |
| `vscode-oniguruma` | 20K | 7K |
| `tjson.tmLanguage.json` | 40K | 8K |
| **total before a character appears** | **584K** | **181K** |

On a desktop that is a blink. On a phone on mobile data it is a real wait, and
the download is only half of it — the wasm still has to be compiled, on a CPU
with far less to spare.

All of it is ordinary JavaScript, though, and it runs wherever your JavaScript
already runs. So the question is not really *when* to do the work. It is whose
machine does it.

## From the data you already have

If a page is showing something you hold as JSON — a record, an API response, a
config — the TJSON view is one call away, and the reader downloads none of the
machinery above:

```js
import { renderJson } from './scripts/render-html.mjs';

app.get('/thing/:id', async (req, res) => {
  const data = await db.fetch(req.params.id);          // your JSON, as always
  res.send(`<pre class="tjson">${await renderJson(JSON.stringify(data))}</pre>`);
});
```

Nothing about that is build-specific; it is the same call in a request handler,
in a static site generator, or in a script you run by hand.

This works so easily because the two forms carry the same data and convert both
ways. That is a core guarantee of the format rather than anything this script
provides: whichever form you treat as your source of truth, the other is always
one conversion away. So hold the one that suits you and produce the other on
demand.

Deriving the view has two things going for it. Your render settings live in one
place and every page picks them up at once — switch `multilineStyle` from
`bold` to `transparent` and every multiline block on the site changes with it,
with nothing to go back over. And the view is produced by whatever renderer is installed at the moment
it is asked for, so as the format's presentation is refined, pages simply show
the newer rendering. There is nothing to reissue and nothing to migrate, now or
later.

If the data is hot, put an ordinary HTTP cache or CDN in front of the route. The
rendering is cheap, and a cached response is a caching decision — something you
can drop and rebuild whenever you like, rather than anything to keep in step.

The snippet imports this repo's script because that is the copy you can read.
Adapting it for your own service means pointing three things at your own paths:
`tjson.tmLanguage.json`, `scope-classes.json`, and the parser — which for anyone
outside this repo is `@rfanth/tjson` from npm rather than the vendored copy.

## From TJSON you already have

Sometimes the TJSON *is* the artifact — a hand-written example in documentation,
a snippet in a spec, a file someone authored and committed. Then there is no
data behind it to render from, and you highlight the text itself:

```sh
node scripts/render-html.mjs sample.tjson --fragment > sample.html
```

Same result for the reader: spans and a stylesheet, no tokenizer. For the
fixture in this repo the whole highlighted block is **758 bytes gzipped** —
against 181K of machinery to produce the same pixels in the browser.

[`scripts/render-html.mjs`](../scripts/render-html.mjs) does both. It reads the
same [`scope-classes.json`](scope-classes.json) the browser path below uses, so
whichever way you generate it the output agrees. `--options` takes anything the
renderer takes:

```sh
node scripts/render-html.mjs data.json --options '{"wrapWidth":100,"tables":false}'
```

## If the reader types the TJSON: load the engine lazily

An editor or a live demo genuinely needs the tokenizer client-side. Then the
rule is: nothing loads until something is actually going to be highlighted.

Note the `import()` **inside** the function. A top-level `import` would pull the
libraries during page load whether or not the page ever colours anything, which
is the mistake this section exists to prevent.

```js
const SCOPE_CLASSES = /* docs/scope-classes.json -> .classes */;
const UNSTYLED = ['meta', 'punctuation.whitespace.indent'];

const isScope = (scope, prefix) => scope === prefix || scope.startsWith(prefix + '.');

// Walk outward from the innermost scope: it is the most specific thing the
// grammar knows about this text. `null` means "leave it as body text".
// An unstyled scope stops the walk rather than being skipped -- it means "this
// text is deliberately not coloured", which is an answer, and reaching past it
// would paint the indent inside a folded string with the string's own colour.
function classFor(scopes) {
  for (let i = scopes.length - 1; i >= 0; i--) {
    if (UNSTYLED.some((p) => isScope(scopes[i], p))) return null;
    for (const [prefix, cls] of SCOPE_CLASSES) {
      if (isScope(scopes[i], prefix)) return cls;
    }
  }
  return null;
}

// One promise, created on first use and reused. Everything expensive -- both
// libraries, the wasm and the grammar -- is behind it, so a page that never
// highlights never pays, and a page that highlights twice pays once.
let engine = null;
function loadEngine(grammarUrl, onigWasmUrl) {
  if (engine) return engine;
  engine = (async () => {
    const [oniguruma, textmate] = await Promise.all([
      import('https://esm.sh/vscode-oniguruma@2'),
      import('https://esm.sh/vscode-textmate@9'),
    ]);
    await oniguruma.loadWASM(await (await fetch(onigWasmUrl)).arrayBuffer());

    const registry = new textmate.Registry({
      onigLib: Promise.resolve({
        createOnigScanner: (sources) => new oniguruma.OnigScanner(sources),
        createOnigString: (str) => new oniguruma.OnigString(str),
      }),
      loadGrammar: async (scopeName) =>
        scopeName === 'source.tjson'
          ? textmate.parseRawGrammar(await (await fetch(grammarUrl)).text(), 'tjson.tmLanguage.json')
          : null,
    });

    return { textmate, grammar: await registry.loadGrammar('source.tjson') };
  })();
  return engine;
}

const escapeHtml = (s) =>
  s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

export async function highlight(tjson, grammarUrl, onigWasmUrl) {
  const { textmate, grammar } = await loadEngine(grammarUrl, onigWasmUrl);

  const eol = tjson.includes('\r\n') ? '\r\n' : '\n';
  let stack = textmate.INITIAL;
  const out = [];

  for (const line of tjson.split(eol)) {
    // The rule stack MUST carry across lines. A multiline string is one region
    // spanning many lines; tokenizing each line from INITIAL would read its body
    // as ordinary TJSON and colour a fenced document as if it were structure.
    const { tokens, ruleStack } = grammar.tokenizeLine(line, stack);
    stack = ruleStack;

    let html = '';
    let runClass = null;
    let run = '';
    const flush = () => {
      if (!run) return;
      html += runClass ? `<span class="${runClass}">${escapeHtml(run)}</span>` : escapeHtml(run);
    };

    // Adjacent tokens landing on one class are merged. The grammar splits a bare
    // string into its opening quote and its content and both are tjson-bare, so
    // emitting a span each only makes the DOM bigger for an identical result.
    for (const token of tokens) {
      const text = line.slice(token.startIndex, token.endIndex);
      const cls = classFor(token.scopes);
      if (cls === runClass) { run += text; continue; }
      flush();
      runClass = cls;
      run = text;
    }
    flush();
    out.push(html);
  }

  return out.join('\n');
}
```

Better still, do not start even that until the block is about to be seen. On a
page where the TJSON is below the fold, this costs a phone nothing until the
reader scrolls to it:

```js
const watcher = new IntersectionObserver((entries, self) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    self.unobserve(entry.target);
    highlight(entry.target.textContent, GRAMMAR_URL, ONIG_URL)
      .then((html) => { entry.target.innerHTML = html; });
  }
});
document.querySelectorAll('pre.tjson').forEach((el) => watcher.observe(el));
```

Put the plain TJSON in the `<pre>` to begin with. It is readable before the
engine arrives, and stays readable even if it never does, so that a reader with
JavaScript off sees the document rather than nothing.

Whichever path you take: put the result in a `<pre>`. TJSON is
whitespace-significant in a way JSON is not — the single space in `k: true` is
what makes it the string `"true"` rather than the boolean true or the boolean
true in a single element array. Any element that collapses whitespace will
often change what the document appears to say.

## The classes

The mapping lives in [`scope-classes.json`](scope-classes.json) so it can be
checked mechanically: `tests/scopes.js` asserts that every scope the grammar
emits across every fixture resolves to a class, and that no rule is dead. Copy
the `classes` array out of it.

Any palette works; this is the one textjson.com uses (Catppuccin Mocha).

```css
.tjson-key         { color: #89b4fa; }
.tjson-bare        { color: #a6e3a1; }
.tjson-string      { color: #f9e2af; }
.tjson-number      { color: #fab387; }
.tjson-boolean     { color: #cba6f7; }
.tjson-null        { color: #9399b2; }
.tjson-punctuation { color: #6c7086; }
.tjson-pipe        { color: #6c7086; }
.tjson-marker      { color: #74c7ec; }
.tjson-escape      { color: #f5c2e7; }
.tjson-multiline   { color: #f9e2af; }
.tjson-comment     { color: #9399b2; font-style: italic; }
.tjson-invalid     { color: #f38ba8; font-style: italic; }
```

Four of these are worth keeping distinct rather than folding together:

- **`tjson-bare` separate from `tjson-string`.** A bare string and a quoted
  string are different syntax for the same value, and the difference is one
  space at the beginning. Colouring them alike hides a useful secondary cue that
  `  k: is "12" a number` is a bare string containing double quotes.  Double
  quotes at the ends of bare strings are forbidden for being too confusing, but
  intermediate ones are not, making this a useful additional reading cue.
- **`tjson-marker` separate from `tjson-punctuation`.** Markers, fold markers
  and indent glyphs are the format talking about *shape*; brackets and separators
  are structure inside data. One family reads as annotation, the other as
  plumbing.
- **`tjson-escape` separate from `tjson-marker`.** These once shared a colour,
  which painted the `\n` inside a string the same bright blue as a fold marker —
  so a string looked like it had structure in it.
- **`tjson-invalid` at all.** The grammar names three faults a parser would
  refuse — a multiline margin that wanders off its column, a table row whose
  cell edges do not line up, a closing indent glyph away from the column its
  frame opened at. Each is named on the *character* that is in the wrong place
  rather than on the whitespace in front of it, which is what editor themes
  expect: they style `invalid` as a foreground colour and an italic, never a
  background, so a fault sitting on whitespace renders as nothing at all. If you
  drop this rule the markers still render, just without the warning.

## Reporting errors too

The parser is published as WebAssembly, so a page can tell a reader *why* a
document is wrong rather than only colouring it. The `/web` subpath is the build
for this: the wasm is inlined, so there is no second asset to serve and no
initialisation call.

It is a separate 199K gzipped, on top of the colouring, and it is needed only
on a page where the reader is *writing* TJSON. A page that merely displays some
has nothing to validate — the author already knows it parses. Load it the same
way as the engine above, from inside the function that first needs it:

```js
let parser = null;
const loadParser = () => (parser ??= import('https://esm.sh/@rfanth/tjson/web'));
```

Then, when there is something to check:

```js
const { parse } = await loadParser();

try {
  parse(source);
} catch (error) {
  showProblem(error.message);
}
```

Printing `error.message` is not the lazy option, it is usually the right one.
The message already contains the offending line and a caret under the exact
column:

```
invalid TJSON (input must be valid TJSON): line 1, column 3: this line ends with spaces that carry nothing -- delete them
    k: value
    ^
```

Put it in a `<pre>` and it lands aligned; the caret is positioned in characters,
so a proportional font is the one way to break it.

Pull it apart only when something needs the position as a number — placing a
marker in an editor widget, say, rather than showing text:

```js
const at = /line (\d+), column (\d+): ([\s\S]*)$/.exec(error.message);
if (at) {
  const [, line, column, rest] = at;
  // `rest` still carries the caret block. For a one-line tooltip:
  const sentence = rest.split('\n')[0];
  showMarker(Number(line), Number(column), sentence);
}
```

The parser stops at the first fault, so there is exactly one problem to show at
a time. That is not a limitation to work around — it is the whole state there is.

Colouring and reporting are independent, and it is worth knowing they can
disagree. The grammar is in this repo; the parser is a published package. If the
two are from different releases, valid input can end up coloured correctly and
flagged as an error at the same time. Pin them together.

## Things that will bite you

- **Carry the rule stack between lines.** Covered above, and it is the mistake
  that looks like it works: every fixture without a multiline string renders
  perfectly.
- **A bare string's opener may be `_`.** `k: value` and `k:_value` are the same
  string; a generator writes the underscore only when asked. Both are scoped
  `punctuation.definition.string.begin.bare`, so a correct mapping needs no
  special case — but a hand-rolled regex highlighter will miss the second.
- **Do not re-indent or trim.** Leading spaces are the structure and trailing
  spaces are either data in a multiline, or an error the parser reports. A
  template engine that tidies whitespace will silently change the document.
- **`meta.*` scopes are regions, not tokens.** Colouring them paints whole
  lines. They are in the `unstyled` list for that reason.
