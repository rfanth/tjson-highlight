// Test runner for the TJSON TextMate grammar.
//
// Two independent layers:
//
//   1. Golden dumps. Every fixture in fixtures/ is tokenized and compared
//      against golden/<name>.txt. This catches unintended drift in any part of
//      the grammar, whether or not anyone wrote an assertion for it.
//      Run with --update to accept the current output as the new golden.
//
//   2. Scope expectations (expectations.json). Hand-written claims of the form
//      "on line N of fixture F, the text T must carry scope S". These encode
//      what the highlighting is actually supposed to mean, so a golden file
//      that was blessed while a bug was present still reports the bug.
//
//   3. Marked/unmarked twins. A bare string may open with `_` in place of its
//      non-data leading space, and the specification makes the two
//      interchangeable and equally positioned. So the same document rendered
//      both ways must produce the same scopes at the same offsets, and any
//      `<name>-marked.tjson` fixture is checked against `<name>.tjson`
//      automatically -- no list to keep up to date. This catches a rule that
//      learned one opener and not the other, which no single-fixture golden
//      would show.

//   4. Rejections (rejections.json). Lines the specification forbids. Every
//      fixture is valid by design -- they come out of the generator -- so
//      nothing else here can catch the failure mode where the grammar paints
//      illegal input as though it were correct. That is not theoretical: a
//      comma-packed bare string array rendered as a clean three-element array
//      for as long as the rules for it stayed behind after v0.5.0 removed the
//      construct. Each entry is checked twice, and the first check is of the
//      test's own premise: the bundled parser must actually reject the line, so
//      an entry that becomes legal in a later release fails loudly instead of
//      quietly asserting nothing.

const fs = require('fs');
const path = require('path');
const { tokenizeFile, tokenizeText } = require('./tokenize');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const GOLDEN_DIR = path.join(__dirname, 'golden');
const EXPECTATIONS_PATH = path.join(__dirname, 'expectations.json');
const REJECTIONS_PATH = path.join(__dirname, 'rejections.json');

const UPDATE = process.argv.includes('--update');

function listFixtures() {
    return fs
        .readdirSync(FIXTURES_DIR)
        .filter((name) => name.endsWith('.tjson'))
        .sort();
}

// Reduce a dump back into a lookup of line number -> tokens, so expectations
// can be checked without re-running the tokenizer.
function parseDump(dump) {
    const byLine = new Map();
    let current = null;

    for (const row of dump.split('\n')) {
        const lineHeader = row.match(/^\s*(\d+) \| /);

        if (lineHeader) {
            current = Number(lineHeader[1]);
            byLine.set(current, []);
            continue;
        }

        const tokenRow = row.match(/^\s+\| (\S+)\s+("(?:[^"\\]|\\.)*")\s+(.*)$/);

        if (tokenRow && current !== null) {
            byLine.get(current).push({
                span: tokenRow[1],
                text: JSON.parse(tokenRow[2]),
                scopes: tokenRow[3].trim(),
            });
        }
    }

    return byLine;
}

function diffLines(expected, actual) {
    const a = expected.split('\n');
    const b = actual.split('\n');
    const out = [];

    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
        if (a[i] !== b[i]) {
            if (a[i] !== undefined) {
                out.push(`      - ${a[i]}`);
            }
            if (b[i] !== undefined) {
                out.push(`      + ${b[i]}`);
            }
        }
    }

    return out.slice(0, 40);
}

// A bare string's opener is a space by default and `_` when a generator was
// asked to make it visible. The specification calls them interchangeable and
// notes they occupy the same single column, so two renderings of one document
// differ in exactly those characters and nowhere else -- same token boundaries,
// same scopes. Comparing a `-marked` fixture against its twin tests every rule
// the document happens to exercise at once.
//
// A fold continuation is deliberately not an exception to carve out: what
// follows `/ ` there is data, so a generator never marks it and the twins agree
// there for the same reason they agree on any other content.
function checkMarkedTwins(fixtures, dumps) {
    let failures = 0;

    for (const marked of fixtures) {
        if (!marked.endsWith('-marked.tjson')) {
            continue;
        }
        const plain = marked.replace(/-marked\.tjson$/, '.tjson');
        if (!dumps.has(plain)) {
            console.log('');
            console.log(`TWIN  ${marked} has no unmarked twin ${plain}`);
            failures += 1;
            continue;
        }

        const a = flatten(parseDump(dumps.get(plain)));
        const b = flatten(parseDump(dumps.get(marked)));

        for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
            const x = a[i];
            const y = b[i];
            if (!x || !y) {
                console.log('');
                console.log(`TWIN  ${marked}: token streams differ in length`);
                failures += 1;
                break;
            }
            // Only the opener character itself may differ.
            const openerSwap = x.text === ' ' && y.text === '_';
            if (x.span !== y.span || x.scopes !== y.scopes || (x.text !== y.text && !openerSwap)) {
                console.log('');
                console.log(`TWIN  ${marked}:${y.line}  the two openers must tokenize alike`);
                console.log(`      space: ${JSON.stringify(x.text)} @${x.span}  ${x.scopes}`);
                console.log(`      mark:  ${JSON.stringify(y.text)} @${y.span}  ${y.scopes}`);
                failures += 1;
                break;
            }
        }
    }

    const pairs = fixtures.filter((name) => name.endsWith('-marked.tjson')).length;
    console.log('');
    console.log(`twins: ${pairs - failures}/${pairs} marked fixture(s) match their unmarked twin`);
    return failures;
}

// Illegal input must not be painted as though it were correct. The parser in
// vendor/ is the authority on what is illegal, so it is consulted rather than
// trusted to a hand-kept list -- see the note at the top of this file.
async function checkRejections() {
    const cases = JSON.parse(fs.readFileSync(REJECTIONS_PATH, 'utf8'));
    let failures = 0;

    let tjson;
    try {
        tjson = await import('../vendor/index.js');
    } catch (error) {
        console.log('');
        console.log(`REJECTIONS  could not load the parser in vendor/: ${error}`);
        console.log('            these checks verify their own premise against it, so they');
        console.log('            are reported as failures rather than skipped.');
        return cases.length;
    }

    for (const check of cases) {
        // Premise: the parser really does refuse this line.
        let parsed = false;
        try {
            tjson.parse(check.line + '\n');
            parsed = true;
        } catch {
            // Expected.
        }

        if (parsed) {
            console.log('');
            console.log(`REJECTION STALE  ${JSON.stringify(check.line)}`);
            console.log(`      ${check.note}`);
            console.log('      the parser accepts this now, so the entry asserts nothing');
            failures += 1;
            continue;
        }

        // The grammar must not hand it a bare-string scope.
        const dump = await tokenizeText(check.line + '\n');
        const offenders = [];

        for (const tokens of parseDump(dump).values()) {
            for (const token of tokens) {
                if (
                    token.text === check.text &&
                    // The dump drops the '.tjson' suffix, as expectations.json does.
                    token.scopes.split(' ').includes('string.unquoted.bare')
                ) {
                    offenders.push(token);
                }
            }
        }

        if (offenders.length > 0) {
            console.log('');
            console.log(`REJECTION  ${JSON.stringify(check.line)}`);
            console.log(`      ${check.note}`);
            console.log(
                `      but ${JSON.stringify(check.text)} is scoped "${offenders[0].scopes}"`
            );
            failures += 1;
        }
    }

    console.log('');
    console.log(
        `rejections: ${cases.length - failures}/${cases.length} illegal line(s) refused a bare-string scope`
    );
    return failures;
}

// parseDump keys tokens by line; the twin check wants one flat ordered stream.
function flatten(byLine) {
    const out = [];
    for (const [line, tokens] of [...byLine.entries()].sort((a, b) => a[0] - b[0])) {
        for (const token of tokens) {
            out.push({ ...token, line });
        }
    }
    return out;
}

async function main() {
    const fixtures = listFixtures();
    const dumps = new Map();

    let goldenFailures = 0;
    let goldenUpdated = 0;

    for (const fixture of fixtures) {
        const dump = await tokenizeFile(path.join(FIXTURES_DIR, fixture));
        dumps.set(fixture, dump);

        const goldenPath = path.join(
            GOLDEN_DIR,
            fixture.replace(/\.tjson$/, '.txt')
        );

        if (UPDATE || !fs.existsSync(goldenPath)) {
            fs.writeFileSync(goldenPath, dump);
            goldenUpdated += 1;
            continue;
        }

        const golden = fs.readFileSync(goldenPath, 'utf8');

        if (golden !== dump) {
            goldenFailures += 1;
            console.log(`GOLDEN DIFF  ${fixture}`);
            for (const row of diffLines(golden, dump)) {
                console.log(row);
            }
            console.log('');
        }
    }

    if (goldenUpdated > 0) {
        console.log(`golden: wrote ${goldenUpdated} file(s)`);
    }
    if (goldenFailures === 0 && goldenUpdated === 0) {
        console.log(`golden: ${fixtures.length} fixture(s) match`);
    }

    const expectations = JSON.parse(fs.readFileSync(EXPECTATIONS_PATH, 'utf8'));
    const parsed = new Map();
    const failures = [];

    console.log('');

    for (const check of expectations) {
        if (!dumps.has(check.fixture)) {
            failures.push({
                check,
                reason: `no such fixture: ${check.fixture}`,
            });
            continue;
        }

        if (!parsed.has(check.fixture)) {
            parsed.set(check.fixture, parseDump(dumps.get(check.fixture)));
        }

        const tokens = parsed.get(check.fixture).get(check.line) || [];
        const candidates = tokens.filter((token) => token.text === check.text);

        // Several tokens on a line can share text — the indent and an inline
        // separator are both "  ". `occurrence` (1-based) picks which one.
        const wanted = check.occurrence || 1;
        const match = candidates[wanted - 1];

        if (!match) {
            const seen = tokens.map((token) => JSON.stringify(token.text));
            const found = candidates.length;
            failures.push({
                check,
                reason:
                    `no occurrence ${wanted} of ${JSON.stringify(check.text)} ` +
                    `(found ${found}); line has [${seen.join(', ')}]`,
            });
            continue;
        }

        if (!match.scopes.split(' ').includes(check.scope)) {
            failures.push({
                check,
                reason: `got "${match.scopes}"`,
            });
        }
    }

    const passed = expectations.length - failures.length;
    console.log(`scopes: ${passed}/${expectations.length} expectation(s) pass`);

    for (const failure of failures) {
        const { check, reason } = failure;
        console.log('');
        console.log(`FAIL  ${check.fixture}:${check.line}  ${check.note}`);
        console.log(`      want ${JSON.stringify(check.text)} -> ${check.scope}`);
        console.log(`      ${reason}`);
    }

    const twinFailures = checkMarkedTwins(fixtures, dumps);
    const rejectionFailures = await checkRejections();

    if (failures.length > 0 || goldenFailures > 0 || twinFailures > 0 || rejectionFailures > 0) {
        process.exitCode = 1;
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
