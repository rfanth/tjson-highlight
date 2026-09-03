// What the grammar actually claims, as an inventory rather than a diff.
//
// The goldens record every token of every fixture, which is the right shape for
// catching drift and the wrong shape for answering "what spans does this
// format have, and where do they start and stop". This walks the same fixtures
// and reports each scope once, with real examples of the text it covers, so the
// set of spans can be read in one screen and compared against what another
// implementation emits.
//
// Reporting only -- it asserts nothing and is not part of `npm test`. Run it
// when you need to know, not to find out whether something broke.
//
//   node spans.js              every scope, with examples
//   node spans.js <scope>      just that scope, with every distinct text

const fs = require('fs');
const path = require('path');
const { tokenizeFile } = require('./tokenize');

const FIXTURES = path.join(__dirname, 'fixtures');
const ROW = /^\s+\| (\S+)\s+("(?:[^"\\]|\\.)*")\s+(.*)$/;

async function collect() {
    // scope -> { count, texts: Map(text -> count), fixtures: Set }
    const byScope = new Map();
    let tokens = 0;

    for (const name of fs.readdirSync(FIXTURES).filter((n) => n.endsWith('.tjson')).sort()) {
        const dump = await tokenizeFile(path.join(FIXTURES, name));

        for (const row of dump.split('\n')) {
            const token = ROW.exec(row);
            if (!token || token[3].trim() === '-') {
                continue;
            }
            tokens += 1;
            const text = JSON.parse(token[2]);
            const scopes = token[3].trim().split(' ');

            // The innermost scope is what this token IS; the ones outside it are
            // the regions it sits in. Reporting on the innermost keeps one token
            // from being counted under every meta.* wrapper above it.
            const scope = scopes[scopes.length - 1];
            let entry = byScope.get(scope);
            if (!entry) {
                entry = { count: 0, texts: new Map(), fixtures: new Set() };
                byScope.set(scope, entry);
            }
            entry.count += 1;
            entry.fixtures.add(name);
            entry.texts.set(text, (entry.texts.get(text) || 0) + 1);
        }
    }

    return { byScope, tokens };
}

// Short and distinct reads better than frequent: the point is to show the shape
// of the text a scope covers, and a long one wraps the table into uselessness.
function examples(texts, limit) {
    return [...texts.keys()]
        .sort((a, b) => a.length - b.length || a.localeCompare(b))
        .slice(0, limit)
        .map((t) => JSON.stringify(t));
}

async function main() {
    const only = process.argv[2];
    const { byScope, tokens } = await collect();
    const names = [...byScope.keys()].sort();

    if (only) {
        const entry = byScope.get(only);
        if (!entry) {
            console.log(`no fixture produces ${only}`);
            console.log('');
            console.log('scopes that do:');
            for (const name of names) {
                console.log(`  ${name}`);
            }
            process.exitCode = 1;
            return;
        }
        console.log(`${only}  --  ${entry.count} token(s) in ${entry.fixtures.size} fixture(s)`);
        console.log('');
        for (const [text, count] of [...entry.texts.entries()].sort((a, b) => b[1] - a[1])) {
            console.log(`  ${String(count).padStart(4)}  ${JSON.stringify(text)}`);
        }
        return;
    }

    const width = names.reduce((n, s) => Math.max(n, s.length), 0);
    let group = null;

    for (const name of names) {
        const top = name.split('.')[0];
        if (top !== group) {
            console.log('');
            group = top;
        }
        const entry = byScope.get(name);
        console.log(
            `${name.padEnd(width)}  ${String(entry.count).padStart(4)}  ` +
            examples(entry.texts, 3).join('  ')
        );
    }

    console.log('');
    console.log(`${names.length} scope(s), ${tokens} scoped token(s), across the fixtures.`);
    console.log('Whitespace carrying no scope at all is not counted: it is not a span.');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
