// The TextMate engine facts this grammar is built on, asserted rather than
// remembered.
//
// Several rules here are shaped the way they are because of how
// vscode-textmate behaves, not because of anything in TJSON. Those facts were
// each established with a throwaway probe and then written into a comment --
// which is exactly how a comment comes to be confidently wrong. Two of them
// already had been: "zero-width begin rules are unusable for regions" was
// measured in a setup where nothing could have scoped the line anyway, and the
// correction unlocked container memory.
//
// So they live here instead, as tiny grammars with assertions. If an engine
// upgrade changes one, this fails and says which belief moved.

import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';
import oniguruma from 'vscode-oniguruma';
import textmate from 'vscode-textmate';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let onigLib;

async function tokenize(grammar, lines) {
    if (!onigLib) {
        const wasm = fs.readFileSync(
            path.join(HERE, 'node_modules', 'vscode-oniguruma', 'release', 'onig.wasm')
        ).buffer;
        await oniguruma.loadWASM(wasm);
        onigLib = Promise.resolve({
            createOnigScanner: (p) => new oniguruma.OnigScanner(p),
            createOnigString: (s) => new oniguruma.OnigString(s),
        });
    }

    const registry = new textmate.Registry({
        onigLib,
        loadGrammar: async (scope) =>
            scope === 'source.t' ? textmate.parseRawGrammar(JSON.stringify(grammar), 'p.json') : null,
    });
    const g = await registry.loadGrammar('source.t');

    const out = [];
    let stack = textmate.INITIAL;
    for (const line of lines) {
        const r = g.tokenizeLine(line, stack);
        stack = r.ruleStack;
        let depth = 0;
        for (let s = stack; s && s.parent; s = s.parent) {
            depth += 1;
        }
        out.push({
            line,
            depth,
            tokens: r.tokens.map((t) => ({
                text: line.substring(t.startIndex, t.endIndex),
                scopes: t.scopes.filter((s) => s !== 'source.t'),
            })),
        });
    }
    return out;
}

const scoped = (row, text, scope) =>
    row.tokens.some((t) => t.text === text && t.scopes.some((s) => s.startsWith(scope)));

let checks = 0;
const check = (what, condition) => {
    checks += 1;
    assert.ok(condition, what);
};

// --- 1. `^` matches only at a TRUE line start.
//
// Never where a begin, while or end branch left off. This is the fact that
// decides the shape of every wrapper region in the grammar: one that consumes a
// line's indent puts every ^-anchored rule out of reach inside it, and in this
// grammar that is nearly all of them.
{
    const rows = await tokenize({
        name: 'T', scopeName: 'source.t',
        patterns: [{ include: '#outer' }],
        repository: {
            outer: {
                begin: '^(  )', while: '^(  )', name: 'meta.outer.t',
                patterns: [
                    { match: '^ANCHORED', name: 'ANCHORED.t' },
                    { match: 'FLOATING', name: 'FLOATING.t' },
                ],
            },
        },
    }, ['  ANCHORED', '  FLOATING']);

    check('^ does not match after a consumed prefix', !scoped(rows[0], 'ANCHORED', 'ANCHORED'));
    check('an unanchored rule does match there', scoped(rows[1], 'FLOATING', 'FLOATING'));
}

// --- 2. A ZERO-WIDTH begin DOES open a region, and does not steal its line.
//
// The older note said zero-width begins were unusable. That was measured with
// patterns that could not have scoped the line anyway. Consuming nothing leaves
// position at 0, so `^` still matches and the rules inside scope the line
// normally -- which is what lets a region wrap a line without taking it over,
// and is why the entry rules did not have to change when container memory was
// added.
{
    const rows = await tokenize({
        name: 'T', scopeName: 'source.t',
        patterns: [{ include: '#shadow' }, { include: '#body' }],
        repository: {
            shadow: {
                begin: '^(?=  \\S)', end: '^(?!  )', name: 'meta.shadow.t',
                patterns: [{ include: '#body' }],
            },
            body: { patterns: [{ match: '^(  )(deeper)', captures: { 2: { name: 'DEEPER.t' } } }] },
        },
    }, ['  deeper', '  deeper', 'top']);

    check('a zero-width begin opens a region', rows[0].depth === 1);
    check('and its own line is still scoped by the rules inside', scoped(rows[0], 'deeper', 'DEEPER'));
    check('and the region ends where it should', rows[2].depth === 0);
}

// --- 3. A child rule cannot see its parent's captures.
//
// `\1` inside a nested rule means that rule's own group 1. This is why a
// region that wants to hold a column has to establish it on its own opening
// line rather than inherit it -- the constraint behind #nested-block and behind
// the minimal multiline's indent run.
{
    const rows = await tokenize({
        name: 'T', scopeName: 'source.t',
        patterns: [{ include: '#outer' }],
        repository: {
            outer: {
                begin: '^(  )(\\{ )', while: '^(?=\\1)', name: 'meta.outer.t',
                patterns: [{ match: '^\\1(x)', captures: { 1: { name: 'INHERITED.t' } } }],
            },
        },
    }, ['  { first', '  x']);

    check('a child rule does not inherit the parent\'s capture', !scoped(rows[1], 'x', 'INHERITED'));
}

// --- 4. `end` is checked only when its rule is innermost; `while` every line.
//
// Both halves bite, in opposite directions. A `while` pops its region AND
// everything nested inside it on any line that fails -- which tore multilines
// open when a floating margin sat left of the region holding them. An `end` is
// masked by an open child, which is what saves it there, and equally what lets
// it mask an enclosing region's own end.
{
    const grammar = (kind) => ({
        name: 'T', scopeName: 'source.t',
        patterns: [{ include: '#outer' }],
        repository: {
            outer: Object.assign(
                { begin: '^OPEN', name: 'meta.outer.t', patterns: [{ include: '#child' }] },
                kind === 'while' ? { while: '^(?!FAR)' } : { end: '^FAR' }
            ),
            child: { begin: '^CHILD', end: '^ENDCHILD', name: 'meta.child.t' },
        },
    });

    const lines = ['OPEN', 'CHILD', 'FAR', 'ENDCHILD'];
    const withWhile = await tokenize(grammar('while'), lines);
    const withEnd = await tokenize(grammar('end'), lines);

    check('both regions are open before the line that would end the outer one',
        withWhile[1].depth === 2 && withEnd[1].depth === 2);
    check('a while pops the region AND the child nested inside it', withWhile[2].depth === 0);
    check('an end is masked while that child is open, so both survive', withEnd[2].depth === 2);
}

// --- 5. Back-references are textual substitution, and the text is ESCAPED.
//
// The engine splices the captured characters into the pattern after escaping
// them, which is why the fences can match an EOL indicator back exactly: a
// captured `\n` becomes a literal backslash-n rather than a newline.
{
    const rows = await tokenize({
        name: 'T', scopeName: 'source.t',
        patterns: [{ include: '#fence' }],
        repository: {
            fence: {
                begin: '^`(\\\\n)?$', end: '^`(\\1)$', name: 'meta.fence.t',
                patterns: [{ match: '.+', name: 'BODY.t' }],
            },
        },
    }, ['`\\n', 'body', '`\\n', 'after']);

    check('a captured backslash-n matches back as literal text', scoped(rows[1], 'body', 'BODY'));
    check('and the fence closes on the identical glyph', rows[3].depth === 0);
}

// --- 6. Scopes only accumulate; a rule inside can add a name, never remove one.
{
    const rows = await tokenize({
        name: 'T', scopeName: 'source.t',
        patterns: [{ include: '#outer' }],
        repository: {
            outer: {
                begin: '^\\(', end: '\\)$', name: 'OUTER.t',
                patterns: [{ match: 'x', name: 'INNER.t' }],
            },
        },
    }, ['(x)']);

    const x = rows[0].tokens.find((t) => t.text === 'x');
    check('an inner scope is added to the outer one, not instead of it',
        x.scopes.includes('OUTER.t') && x.scopes.includes('INNER.t'));
}

// --- 7. And one property of THIS grammar that follows from all of the above:
// no rule may cost a stack level per line.
//
// Section 8's only performance bar. Regions here are opened by lines rather
// than by siblings, so depth tracks nesting; a rule that opened per line would
// grow without bound on a long document. Two shapes have come close: the
// minimal multiline's indent run, which restarts whenever the data steps left,
// and the memory region, which stays open across every sibling of an object.
{
    const GRAMMAR = path.join(HERE, '..', 'tjson.tmLanguage.json');
    const registry = new textmate.Registry({
        onigLib,
        loadGrammar: async (scope) =>
            scope === 'source.tjson'
                ? textmate.parseRawGrammar(fs.readFileSync(GRAMMAR, 'utf8'), GRAMMAR)
                : null,
    });
    const real = await registry.loadGrammar('source.tjson');

    const deepest = (lines) => {
        let stack = textmate.INITIAL;
        let max = 0;
        for (const line of lines) {
            const r = real.tokenizeLine(line, stack);
            stack = r.ruleStack;
            let d = 0;
            for (let s = stack; s && s.parent; s = s.parent) {
                d += 1;
            }
            max = Math.max(max, d);
        }
        return max;
    };

    // A minimal multiline whose data steps one column left on every line, which
    // ends the indent run and opens another, 200 times.
    const stepping = ['  k: `'];
    for (let i = 200; i > 0; i -= 1) {
        stepping.push('    ' + ' '.repeat(i) + 'x');
    }
    stepping.push('   `');
    check(`a restarting indent run stays flat (was ${deepest(stepping)})`, deepest(stepping) <= 4);

    // 400 folded-key siblings of one proved object.
    const siblings = ['  ordinary: 1'];
    for (let i = 0; i < 400; i += 1) {
        siblings.push('  "folded key number ' + i);
        siblings.push('  / and its tail": v');
    }
    check(`400 siblings of one object stay flat (was ${deepest(siblings)})`, deepest(siblings) <= 5);
}

console.log(`engine mechanics: ${checks}/${checks} fact(s) still hold`);
