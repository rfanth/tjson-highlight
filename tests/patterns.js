// An inventory of the long patterns the grammar repeats, so a copy cannot
// quietly drift from its siblings.
//
// TextMate has no way to name a regex fragment and reuse it. The repository
// holds whole rules, and `include` splices rules, not text -- so a character
// class that several rules need is written out in each of them. The bare-key
// pattern appears seven times and the three bare-string classes nine times
// each: thirty-four places where one edit has to land identically.
//
// That is not hypothetical drift. The bare-key class was once missing twelve
// characters, so `  at@sign:2` came out with no scope at all -- a whole line,
// in a committed fixture, for as long as nobody looked.
//
// This is a golden like the token dumps: it records what the grammar repeats
// and how often. Editing one copy of a shared pattern and not the others shows
// up as a new spelling with a count of one beside the old spelling with a count
// of six, which is exactly what drift looks like. Changing a pattern on purpose
// moves the file, and the diff is the review.
//
//   node patterns.js            check against golden/patterns.txt
//   node patterns.js --update   accept the current inventory

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const GRAMMAR = path.join(__dirname, '..', 'tjson.tmLanguage.json');
const GOLDEN = path.join(__dirname, 'golden', 'patterns.txt');
const UPDATE = process.argv.includes('--update');

// Long enough that repeating it by hand is a real risk, and that two of them
// differing by one character is hard to see.
const MIN_LENGTH = 25;

// Character classes have to be scanned rather than matched: `\[` is an escaped
// literal bracket -- the grammar is full of them, since `[ ` is a marker cell --
// and a regex that treats it as an opening bracket runs off into the next `]`
// and reports nonsense. So walk the pattern, honour escapes, and remember that
// a `]` immediately after `[` or `[^` is a literal member of the class.
function classesIn(pattern) {
    const found = [];

    for (let i = 0; i < pattern.length; i++) {
        if (pattern[i] === '\\') {
            i += 1;
            continue;
        }
        if (pattern[i] !== '[') {
            continue;
        }

        // Classes nest: Oniguruma writes a subtraction as `[a-z&&[^x]]`, so
        // count brackets rather than stopping at the first `]`. A `]` directly
        // after `[` or `[^` is a literal member and does not close anything.
        let j = i + 1;
        let depth = 1;
        if (pattern[j] === '^') {
            j += 1;
        }
        if (pattern[j] === ']') {
            j += 1;
        }

        while (j < pattern.length && depth > 0) {
            if (pattern[j] === '\\') {
                j += 2;
                continue;
            }
            if (pattern[j] === '[') {
                depth += 1;
            } else if (pattern[j] === ']') {
                depth -= 1;
                if (depth === 0) {
                    break;
                }
            }
            j += 1;
        }

        if (j < pattern.length) {
            found.push(pattern.slice(i, j + 1));
            i = j;
        }
    }

    return found;
}

function everyPattern(node, out) {
    if (Array.isArray(node)) {
        for (const item of node) {
            everyPattern(item, out);
        }
        return out;
    }
    if (node && typeof node === 'object') {
        for (const key of ['match', 'begin', 'end', 'while']) {
            if (typeof node[key] === 'string') {
                out.push(node[key]);
            }
        }
        for (const value of Object.values(node)) {
            everyPattern(value, out);
        }
    }
    return out;
}

function inventory() {
    const grammar = JSON.parse(fs.readFileSync(GRAMMAR, 'utf8'));
    const counts = new Map();

    for (const pattern of everyPattern(grammar, [])) {
        for (const found of classesIn(pattern)) {
            if (found.length < MIN_LENGTH) {
                continue;
            }
            counts.set(found, (counts.get(found) || 0) + 1);
        }
    }

    // Sorted by the text itself, so near-identical spellings land next to each
    // other and a drifted copy is adjacent to the one it drifted from.
    const rows = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));

    const lines = [
        '# Long character classes in tjson.tmLanguage.json, and how many patterns',
        '# use each. Two spellings that differ slightly, sitting next to each other,',
        '# mean one copy of a shared class was edited and the others were not.',
        '#',
        `# ${rows.length} distinct class(es) of ${MIN_LENGTH}+ characters.`,
        '',
    ];

    for (const [text, count] of rows) {
        lines.push(`${String(count).padStart(3)}  ${text}`);
    }

    return lines.join('\n') + '\n';
}

function main() {
    const current = inventory();

    if (UPDATE) {
        fs.writeFileSync(GOLDEN, current);
        console.log(`patterns: wrote ${path.relative(__dirname, GOLDEN)}`);
        return;
    }

    assert.ok(
        fs.existsSync(GOLDEN),
        `${GOLDEN} is missing -- run: node patterns.js --update`
    );

    const golden = fs.readFileSync(GOLDEN, 'utf8');

    if (golden !== current) {
        const a = golden.split('\n');
        const b = current.split('\n');
        console.log('');
        console.log('PATTERN INVENTORY MOVED');
        for (let i = 0; i < Math.max(a.length, b.length); i++) {
            if (a[i] !== b[i]) {
                if (a[i] !== undefined) console.log(`  -${a[i]}`);
                if (b[i] !== undefined) console.log(`  +${b[i]}`);
            }
        }
        console.log('');
        console.log('  A count that fell by one beside a new spelling with a count of one');
        console.log('  is a shared class edited in one place and not the others.');
        console.log('  If the change is deliberate: node patterns.js --update');
        process.exit(1);
    }

    const distinct = current.split('\n').filter((row) => /^\s*\d+  /.test(row)).length;
    const shared = current
        .split('\n')
        .filter((row) => /^\s*\d+  /.test(row))
        .filter((row) => Number(row.trim().split('  ')[0]) > 1).length;

    console.log(
        `patterns: ${distinct} long class(es), ${shared} of them repeated across rules`
    );
}

main();
