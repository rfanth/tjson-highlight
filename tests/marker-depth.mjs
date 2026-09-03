// What a marker chain does as it gets deeper than the grammar can count.
//
// The column tests in this grammar rebuild the opening line's indent as a sum
// of fixed-width slots, one per marker cell, plus one overflow slot for a chain
// longer than the slots. A back-reference substitutes captured TEXT, and the
// line below carries spaces where the opening line carried markers, so the
// width has to be rebuilt rather than matched -- and no regex can repeat a
// group as many times as a capture is long. The slot count is therefore a
// number someone picked, and past it the overflow falls back to "some even
// number of columns". See local/marker-chain-slots.md.
//
// This file exists because past the slot count is NOT the same as within it,
// and the fixtures only reach four. It separates the two:
//
//   guaranteed at ANY depth   markers, keys, values and fences all scope, the
//                             right-column fold is claimed, nothing is left
//                             unscoped, a multiline closes and the entry after
//                             it is a key again. Asserted for every depth.
//   exact only within the     a fold marker at the WRONG column is refused.
//   slot count                Asserted up to the slot count, reported beyond,
//                             because beyond it the answer is incidental --
//                             not a promise, and not a bug either.
//
// Adding slots moves that boundary. It does not remove it, and the assertion on
// the slot count below fails if someone changes it without revisiting this.

import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';
import { fromJson } from '../vendor/index.js';
import oniguruma from 'vscode-oniguruma';
import textmate from 'vscode-textmate';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GRAMMAR = path.join(HERE, '..', 'tjson.tmLanguage.json');
const ROOT = 'source.tjson';

const DEPTHS = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 16, 20];

// The number of fixed slots the grammar actually carries, read rather than
// assumed, so this file cannot drift from it.
function slotCount() {
    const text = fs.readFileSync(GRAMMAR, 'utf8');
    const m = text.match(/\(\?=((?:\(\\\\\[ \)\?)+)\(\(\?:\\\\\[ \)\*\)\)/);
    assert.ok(m, 'could not find the slot lookahead in the grammar');
    return m[1].split('(\\\\[ )?').length - 1;
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
            scope === ROOT
                ? textmate.parseRawGrammar(fs.readFileSync(GRAMMAR, 'utf8'), GRAMMAR)
                : null,
    });
    return registry.loadGrammar(ROOT);
}

function tokenize(grammar, text) {
    const out = [];
    let stack = textmate.INITIAL;

    for (const line of text.split('\n')) {
        const result = grammar.tokenizeLine(line, stack);
        for (const token of result.tokens) {
            out.push({
                line,
                text: line.substring(token.startIndex, token.endIndex),
                scopes: token.scopes.filter((s) => s !== ROOT).map((s) => s.replace(/\.tjson$/, '')),
            });
        }
        stack = result.ruleStack;
    }
    return out;
}

const has = (tokens, text, scope) =>
    tokens.some((t) => t.text === text && t.scopes.includes(scope));

// Nest a value inside `depth` arrays, so --force-markers writes that many
// cells in front of it.
function nest(depth, inner) {
    let value = inner;
    for (let i = 0; i < depth; i += 1) {
        value = [value];
    }
    return value;
}

let checks = 0;
let failures = 0;

function check(what, condition) {
    checks += 1;
    if (!condition) {
        failures += 1;
        console.log(`FAIL  ${what}`);
    }
}

async function main() {
    const grammar = await loadGrammar();
    const SLOTS = slotCount();

    console.log(`marker depth: the grammar carries ${SLOTS} fixed slot(s) plus an overflow`);
    console.log('');
    console.log('depth  markers  key  value  fence  fold@right  fold@wrong');

    const beyond = [];

    for (const depth of DEPTHS) {
        // 1. A chain in front of a key, and in front of a value.
        const keyed = fromJson(
            JSON.stringify({ a: nest(depth, { proof: 1 }) }),
            { forceMarkers: true }
        ) + '\n';
        const keyedTokens = tokenize(grammar, keyed);

        const markers = keyedTokens.filter((t) => t.text === '[ ' && t.scopes.includes('keyword.operator.array-marker')).length;
        check(`depth ${depth}: every marker cell is a marker`, markers === depth);
        check(`depth ${depth}: the object marker is a marker`, has(keyedTokens, '{ ', 'keyword.operator.object-marker'));
        check(`depth ${depth}: the key behind the chain is a key`, has(keyedTokens, 'proof', 'entity.other.attribute-name.bare'));
        check(`depth ${depth}: the value behind the chain is a number`, has(keyedTokens, '1', 'constant.numeric'));

        // Nothing on those lines may be left with no scope at all.
        const silent = keyedTokens.filter((t) => t.text.trim() !== '' && t.scopes.length === 0);
        check(`depth ${depth}: nothing is left unscoped`, silent.length === 0);

        // 2. A multiline behind the chain has to close, and the entry after it
        //    has to come back as a key -- the failure otherwise is a runaway.
        const fenced = fromJson(
            JSON.stringify({ a: nest(depth, { k: 'alpha\nbravo' }), after: 1 }),
            { forceMarkers: true, multilineStyle: 'bold' }
        ) + '\n';
        const fencedTokens = tokenize(grammar, fenced);
        const closes = fencedTokens.some((t) => t.scopes.includes('punctuation.definition.string.end'));
        const recovered = has(fencedTokens, 'after', 'entity.other.attribute-name.bare');
        check(`depth ${depth}: the multiline fence closes`, closes);
        check(`depth ${depth}: the entry after the fence is a key again`, recovered);

        // 3. A folded value behind the chain: the continuation at the column it
        //    belongs at must be claimed by the value above it.
        const folded = fromJson(
            JSON.stringify({ a: nest(depth, { k: 'a value long enough that it has to fold' }) }),
            { wrapWidth: 38, fold: 'fixed', forceMarkers: true }
        ) + '\n';
        const foldedTokens = tokenize(grammar, folded);
        const rightColumn = foldedTokens.some(
            (t) => t.text === '/ ' && t.scopes.includes('meta.bare-string')
        );
        check(`depth ${depth}: a fold at the right column continues its value`, rightColumn);

        // 4. And the same marker two columns left is malformed. Refusing it is
        //    exact only while the chain fits the slots.
        const lines = folded.split('\n');
        const at = lines.findIndex((l) => /^\s+\/ /.test(l));
        lines[at] = lines[at].replace(/^ {2}/, '');
        const wrongTokens = tokenize(grammar, lines.join('\n'));
        const wrongAccepted = wrongTokens.some(
            (t) => t.text === '/ ' && t.scopes.includes('meta.bare-string')
        );

        if (depth <= SLOTS) {
            check(`depth ${depth}: a fold at the wrong column is refused`, !wrongAccepted);
        } else {
            beyond.push(`${depth}:${wrongAccepted ? 'accepted' : 'refused'}`);
        }

        console.log(
            `${String(depth).padStart(5)}  ${String(markers).padStart(7)}  ` +
            `${has(keyedTokens, 'proof', 'entity.other.attribute-name.bare') ? ' ok ' : 'FAIL'}  ` +
            `${has(keyedTokens, '1', 'constant.numeric') ? ' ok  ' : 'FAIL '}  ` +
            `${closes && recovered ? ' ok  ' : 'FAIL '}  ` +
            `${rightColumn ? '    ok    ' : '   FAIL   '}  ` +
            `${depth <= SLOTS ? (wrongAccepted ? 'ACCEPTED!' : 'refused') : (wrongAccepted ? 'accepted*' : 'refused*')}`
        );
    }

    console.log('');
    console.log(`* beyond ${SLOTS} slots the wrong-column answer is not promised either way: ${beyond.join('  ')}`);
    console.log('  Everything else above is guaranteed at every depth, and asserted.');
    console.log('');

    // Phase two, and it costs almost nothing: take every source the fixtures are
    // built from and wrap it in six more layers of array. That turns each of
    // them into the same document behind a chain two cells longer than the
    // slots, which is a far broader test than any hand-built line -- tables,
    // multilines, folds, packed arrays, minimal JSON, all of it, at a depth the
    // grammar cannot count to. The checks are the ones that need no
    // hand-written answer, the same three the corpus sweep uses.
    const SOURCES = path.join(HERE, 'sources');
    let swept = 0;
    let quiet = 0;
    let accused = 0;
    let runaway = 0;

    for (const name of fs.readdirSync(SOURCES).filter((n) => n.endsWith('.json')).sort()) {
        const json = JSON.parse(fs.readFileSync(path.join(SOURCES, name), 'utf8'));

        // Twice: once as the generator would write it, and once squeezed to a
        // narrow wrap with folding forced on, so that folds and their column
        // checks also land behind a chain longer than the slots.
        for (const options of [
            { forceMarkers: true },
            { forceMarkers: true, wrapWidth: 44, fold: 'fixed', stringMultilineFoldStyle: 'fixed' },
        ]) {
        let deep;
        try {
            deep = fromJson(JSON.stringify(nest(6, json)), options) + '\n';
        } catch {
            continue;   // a source the generator will not wrap; nothing to test
        }
        swept += 1;

        let stack = textmate.INITIAL;
        for (const line of deep.split('\n')) {
            const result = grammar.tokenizeLine(line, stack);
            for (const token of result.tokens) {
                const piece = line.substring(token.startIndex, token.endIndex);
                const scopes = token.scopes.filter((s) => s !== ROOT);

                if (piece.trim() !== '' && scopes.length === 0) {
                    if (quiet === 0) {
                        console.log(`  ${name} wrapped six deep: ${JSON.stringify(piece)} has no scope`);
                    }
                    quiet += 1;
                }
                if (scopes.some((s) => s.startsWith('invalid.'))) {
                    if (accused === 0) {
                        console.log(`  ${name} wrapped six deep: ${JSON.stringify(piece)} accused by ${scopes.join(' ')}`);
                    }
                    accused += 1;
                }
            }
            stack = result.ruleStack;
        }

        // A multiline still open at end of file swallowed the rest of the
        // document; nothing else here is required to close.
        for (let frame = stack; frame && frame.parent; frame = frame.parent) {
            const rule = grammar.getRule ? grammar.getRule(frame.ruleId) : null;
            const named = rule && (rule._name || rule._contentName);
            if (named === 'meta.multiline.tjson') {
                console.log(`  ${name} wrapped six deep: a multiline never closed`);
                runaway += 1;
                break;
            }
        }
        }
    }

    console.log(`every source wrapped six arrays deep: ${swept} document(s)`);
    console.log(`  unscoped text:     ${quiet}`);
    console.log(`  false positives:   ${accused}`);
    console.log(`  runaway multiline: ${runaway}`);
    console.log('');

    check('wrapping six deep leaves no text unscoped', quiet === 0);
    check('wrapping six deep accuses nothing', accused === 0);
    check('wrapping six deep leaves no multiline open', runaway === 0);

    assert.strictEqual(
        SLOTS,
        4,
        `the grammar now carries ${SLOTS} fixed slots, not 4 -- the boundary this file ` +
        `documents has moved, so update local/marker-chain-slots.md and this message`
    );

    if (failures > 0) {
        console.log(`marker depth: ${checks - failures}/${checks} check(s) pass`);
        process.exit(1);
    }
    console.log(`marker depth: ${checks}/${checks} check(s) pass across ${DEPTHS.length} depths`);
}

main().catch((e) => { console.error(e); process.exit(1); });
