// Sweeps an external corpus of .tjson files through the grammar and reports
// what the grammar fails to say about them.
//
// The fixtures in `fixtures/` are chosen to exercise particular rules, so they
// answer "does this rule still do what it did". A corpus answers a different
// question -- "is there input in the wild the grammar has nothing to say
// about" -- and it takes hundreds of files to answer it. The TJSON test
// repository is such a corpus, and it lives in its own checkout, so the path
// is an argument rather than a constant here.
//
// Two faults are looked for, and neither needs to know what the right answer
// is, which is what makes this cheap to run against input nobody has scoped by
// hand:
//
//   false positive  a file the corpus calls valid carries an `invalid.*`
//                   scope. The grammar is accusing correct input.
//   silence         a run of non-whitespace text carries no scope at all. The
//                   grammar did not recognise it, so it renders as plain text
//                   and the reader is told nothing.
//   unterminated    a region the specification requires to be closed is still
//                   on the rule stack at end of file. It opened and never
//                   closed, so it swallowed everything after it. This is the
//                   loudest fault of the three and the least visible in a
//                   token dump -- the text is scoped, just as the wrong
//                   thing, so neither check above sees it.
//
// Only one construct is checked for the third: the multiline fence, whose
// closing glyph the specification makes REQUIRED and pins to the opening
// indent. Plenty of other regions are open at end of file for a good reason --
// a folded value's rule ends on the first line that does not continue it, and
// at end of file there is no such line -- so a blanket check reports about a
// third of the corpus and means nothing. An indent-glyph frame is deliberately
// not on the list either: the specification says the closing `/>` is "allowed
// but not required" when no more data follows, and `indent_offset_start_glyph`
// in the corpus is a valid file that ends with two frames open.
//
//   node corpus.js <corpus-root>            summary and every finding
//   node corpus.js <corpus-root> --quiet    summary only
//
// Everything outside `parse/invalid` is taken as valid: `parse/valid`,
// `parse/optional`, `render/` and `roundtrip/` are all input a conforming
// parser accepts.

const fs = require('fs');
const path = require('path');
const oniguruma = require('vscode-oniguruma');
const textmate = require('vscode-textmate');

const GRAMMAR_PATH = path.join(__dirname, '..', 'tjson.tmLanguage.json');
const ROOT_SCOPE = 'source.tjson';
const INVALID_DIR = path.join('parse', 'invalid');

function loadOnigLib() {
    const wasmPath = path.join(
        __dirname,
        'node_modules',
        'vscode-oniguruma',
        'release',
        'onig.wasm'
    );
    const wasmBin = fs.readFileSync(wasmPath).buffer;

    return oniguruma.loadWASM(wasmBin).then(() => ({
        createOnigScanner(patterns) {
            return new oniguruma.OnigScanner(patterns);
        },
        createOnigString(s) {
            return new oniguruma.OnigString(s);
        },
    }));
}

// One registry for the whole sweep. Building it per file loads and compiles the
// grammar again each time, which turns a few seconds into a few minutes.
async function loadGrammar() {
    const registry = new textmate.Registry({
        onigLib: loadOnigLib(),
        loadGrammar: async (scopeName) => {
            if (scopeName !== ROOT_SCOPE) {
                return null;
            }
            const raw = fs.readFileSync(GRAMMAR_PATH, 'utf8');
            return textmate.parseRawGrammar(raw, GRAMMAR_PATH);
        },
    });

    const grammar = await registry.loadGrammar(ROOT_SCOPE);

    if (!grammar) {
        throw new Error(`Failed to load grammar for ${ROOT_SCOPE}`);
    }
    return grammar;
}

function findTjsonFiles(root) {
    const found = [];

    function walk(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const full = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                walk(full);
                continue;
            }
            if (entry.isFile() && entry.name.endsWith('.tjson')) {
                found.push(full);
            }
        }
    }

    walk(root);
    return found;
}

// A scope list always carries the root scope; anything beyond it is something
// the grammar chose to say.
function isSilent(scopes) {
    return scopes.filter((scope) => scope !== ROOT_SCOPE).length === 0;
}

function invalidScopes(scopes) {
    return scopes.filter((scope) => scope.startsWith('invalid.'));
}

// Regions whose closing text the specification makes mandatory. Anything else
// may legitimately still be open when the lines run out.
const MUST_CLOSE = ['meta.multiline.tjson'];

// The mandatory-terminator regions still on the stack at end of file, outermost
// first. `INITIAL` is the root and is not a region anyone opened, so a file
// that ends there is clean.
function stillOpen(ruleStack, grammar) {
    const names = [];

    for (let frame = ruleStack; frame && frame.parent; frame = frame.parent) {
        const rule = grammar.getRule ? grammar.getRule(frame.ruleId) : null;
        const name = rule && (rule._name || rule._contentName);

        if (MUST_CLOSE.includes(name)) {
            names.unshift(name);
        }
    }

    return names;
}

function inspect(grammar, text) {
    const lines = text.split(/\r?\n/);
    const falsePositives = [];
    const silences = [];
    let ruleStack = textmate.INITIAL;

    lines.forEach((line, index) => {
        const result = grammar.tokenizeLine(line, ruleStack);

        for (const token of result.tokens) {
            const piece = line.substring(token.startIndex, token.endIndex);
            const where = {
                line: index + 1,
                column: token.startIndex,
                text: piece,
            };

            const accused = invalidScopes(token.scopes);

            if (accused.length > 0) {
                falsePositives.push({ ...where, scopes: accused });
            }

            // Whitespace with no scope is structural filler -- the gaps between
            // table cells and around separators. Text is different: an
            // unscoped run of real characters is the grammar saying nothing.
            if (piece.trim() !== '' && isSilent(token.scopes)) {
                silences.push(where);
            }
        }

        ruleStack = result.ruleStack;
    });

    return { falsePositives, silences, unterminated: stillOpen(ruleStack, grammar) };
}

async function main() {
    const root = process.argv[2];
    const quiet = process.argv.includes('--quiet');

    if (!root) {
        console.error('usage: node corpus.js <corpus-root> [--quiet]');
        console.error('');
        console.error('<corpus-root> is a checkout of the TJSON test repository.');
        process.exit(2);
    }

    if (!fs.existsSync(root)) {
        console.error(`no such directory: ${root}`);
        process.exit(2);
    }

    const grammar = await loadGrammar();
    const files = findTjsonFiles(root);
    const valid = files.filter((file) => !path.relative(root, file).startsWith(INVALID_DIR));

    let filesWithFalsePositives = 0;
    let filesWithSilences = 0;
    let filesUnterminated = 0;
    let falsePositiveCount = 0;
    let silenceCount = 0;

    for (const file of valid) {
        const text = fs.readFileSync(file, 'utf8');
        const { falsePositives, silences, unterminated } = inspect(grammar, text);

        if (falsePositives.length === 0 && silences.length === 0 && unterminated.length === 0) {
            continue;
        }

        if (falsePositives.length > 0) {
            filesWithFalsePositives += 1;
            falsePositiveCount += falsePositives.length;
        }
        if (silences.length > 0) {
            filesWithSilences += 1;
            silenceCount += silences.length;
        }
        if (unterminated.length > 0) {
            filesUnterminated += 1;
        }

        if (quiet) {
            continue;
        }

        console.log(path.relative(root, file));

        for (const fault of falsePositives) {
            console.log(
                `  false positive  ${String(fault.line).padStart(4)}:${String(fault.column).padEnd(3)} ` +
                `${JSON.stringify(fault.text).padEnd(30)} ${fault.scopes.join(' ')}`
            );
        }
        for (const fault of silences) {
            console.log(
                `  silence         ${String(fault.line).padStart(4)}:${String(fault.column).padEnd(3)} ` +
                `${JSON.stringify(fault.text)}`
            );
        }
        if (unterminated.length > 0) {
            console.log(`  unterminated    still open at EOF: ${unterminated.join(' > ')}`);
        }
        console.log('');
    }

    console.log(
        `corpus: ${valid.length} valid file(s) swept ` +
        `(${files.length - valid.length} under ${INVALID_DIR} skipped)`
    );
    console.log(
        `  false positives: ${falsePositiveCount} token(s) in ${filesWithFalsePositives} file(s)`
    );
    console.log(
        `  silences:        ${silenceCount} token(s) in ${filesWithSilences} file(s)`
    );
    console.log(
        `  unterminated:    ${filesUnterminated} file(s) left a mandatory region open at EOF`
    );

    if (falsePositiveCount > 0 || silenceCount > 0 || filesUnterminated > 0) {
        process.exitCode = 1;
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
