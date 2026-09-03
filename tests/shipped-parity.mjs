// Would the version we SHIP produce the fixtures we test against?
//
// The fixtures are written by the `tjson` CLI, and that has been a build ahead
// of the release vendored in `vendor/`. The extension carries the vendored one:
// it parses a document for diagnostics, and it renders JSON into TJSON when
// someone runs the convert command. So the question a release turns on is not
// whether the fixtures parse -- check-fixtures.mjs asks that -- but whether the
// output a user will actually SEE is the output the grammar was tested against.
//
// This regenerates every fixture from its source through the vendored library,
// with the same options regen.sh passes the CLI, and compares. Where the two
// differ it goes further and tokenizes both, because a difference only matters
// if the grammar treats them differently.
//
//   node shipped-parity.mjs            report
//   node shipped-parity.mjs --write    rewrite the fixtures from the shipped
//                                      library, so the two cannot disagree

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fromJson, version } from '../vendor/index.js';
import oniguruma from 'vscode-oniguruma';
import textmate from 'vscode-textmate';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GRAMMAR = path.join(HERE, '..', 'tjson.tmLanguage.json');

// regen.sh speaks CLI flags; the library takes an options object.
const FLAGS = {
    '-w': ['wrapWidth', (v) => Number(v)],
    '-k': ['kvPackMultiple', (v) => Number(v)],
    '--fold': ['fold', (v) => v],
    '--fold-multiline': ['stringMultilineFoldStyle', (v) => v],
    '--bare-keys': ['bareKeys', (v) => v],
    '--bare-strings': ['bareStrings', (v) => v],
    '--multiline-style': ['multilineStyle', (v) => (v === 'folding-quotes' ? 'foldingQuotes' : v)],
    '--indent-glyph-style': ['indentGlyphStyle', (v) => v],
};
const SWITCHES = { '--force-markers': 'forceMarkers' };

function recipes() {
    const script = fs.readFileSync(path.join(HERE, 'regen.sh'), 'utf8');
    const out = [];

    for (const raw of script.split('\n')) {
        const m = /^generate(_as)?\s+(.*)$/.exec(raw.trim());
        if (!m) {
            continue;
        }
        const words = m[2].split(/\s+/).filter(Boolean);
        const source = words.shift();
        const name = m[1] ? words.shift() : source;

        const options = {};
        while (words.length) {
            const flag = words.shift();
            if (SWITCHES[flag]) {
                options[SWITCHES[flag]] = true;
                continue;
            }
            const spec = FLAGS[flag];
            if (!spec) {
                throw new Error(`shipped-parity does not know the flag ${flag}`);
            }
            options[spec[0]] = spec[1](words.shift());
        }
        out.push({ source, name, options });
    }
    return out;
}

async function loadGrammar() {
    const wasm = fs.readFileSync(
        path.join(HERE, 'node_modules', 'vscode-oniguruma', 'release', 'onig.wasm')
    ).buffer;
    await oniguruma.loadWASM(wasm);
    const registry = new textmate.Registry({
        onigLib: Promise.resolve({
            createOnigScanner: (p) => new oniguruma.OnigScanner(p),
            createOnigString: (s) => new oniguruma.OnigString(s),
        }),
        loadGrammar: async (scope) =>
            scope === 'source.tjson'
                ? textmate.parseRawGrammar(fs.readFileSync(GRAMMAR, 'utf8'), GRAMMAR)
                : null,
    });
    return registry.loadGrammar('source.tjson');
}

// Every non-blank token, with the innermost scope -- what a reader sees.
function readingOf(grammar, text) {
    const out = [];
    let stack = textmate.INITIAL;
    for (const line of text.split('\n')) {
        const r = grammar.tokenizeLine(line, stack);
        for (const t of r.tokens) {
            const piece = line.substring(t.startIndex, t.endIndex);
            if (piece.trim() !== '') {
                const scopes = t.scopes.filter((s) => s !== 'source.tjson');
                out.push([piece, scopes[scopes.length - 1] || '-']);
            }
        }
        stack = r.ruleStack;
    }
    return out;
}

const WRITE = process.argv.includes('--write');
const grammar = await loadGrammar();

let same = 0;
const differing = [];
const risky = [];

for (const { source, name, options } of recipes()) {
    const json = fs.readFileSync(path.join(HERE, 'sources', `${source}.json`), 'utf8');
    const shipped = fromJson(json, options) + '\n';
    const committed = fs.readFileSync(path.join(HERE, 'fixtures', `${name}.tjson`), 'utf8');

    if (shipped === committed) {
        same += 1;
        continue;
    }

    if (WRITE) {
        fs.writeFileSync(path.join(HERE, 'fixtures', `${name}.tjson`), shipped);
        console.log(`  rewrote ${name}.tjson from the shipped library`);
        same += 1;
        continue;
    }

    // The text differs. Does the grammar read the shipped output any worse?
    const reading = readingOf(grammar, shipped);
    const unscoped = reading.filter(([, s]) => s === '-');
    const accused = reading.filter(([, s]) => s.startsWith('invalid.'));

    differing.push({ name, unscoped, accused });
    if (unscoped.length || accused.length) {
        risky.push({ name, unscoped, accused });
    }
}

console.log(`shipped parity: the vendored library is ${version()}`);
console.log(`  ${same} fixture(s) reproduce byte for byte from it`);
console.log(`  ${differing.length} differ`);
for (const d of differing) {
    console.log(`     ${d.name}: ${d.unscoped.length} unscoped, ${d.accused.length} falsely accused`);
}

if (risky.length) {
    console.log('');
    console.log('The output a user would SEE highlights worse than the committed fixture:');
    for (const r of risky) {
        for (const [text] of r.unscoped.slice(0, 4)) {
            console.log(`  ${r.name}  unscoped ${JSON.stringify(text)}`);
        }
        for (const [text] of r.accused.slice(0, 4)) {
            console.log(`  ${r.name}  accused  ${JSON.stringify(text)}`);
        }
    }
    process.exitCode = 1;
} else if (differing.length) {
    console.log('');
    console.log('Every difference is a layout choice: the shipped output has no unscoped');
    console.log('text and nothing falsely accused, so the grammar reads it as well as it');
    console.log('reads the committed fixture.');
} else {
    console.log('  every fixture is the output the shipped release produces');
}
