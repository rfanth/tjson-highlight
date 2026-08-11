// Tokenizes a .tjson file with the TJSON TextMate grammar and renders the
// result as a stable, diffable text dump.
//
// This runs the same engine VS Code / VSCodium use (vscode-textmate over
// Oniguruma), so what comes out here is exactly what the editor would apply.

const fs = require('fs');
const path = require('path');
const oniguruma = require('vscode-oniguruma');
const textmate = require('vscode-textmate');

const GRAMMAR_PATH = path.join(__dirname, '..', 'tjson.tmLanguage.json');
const ROOT_SCOPE = 'source.tjson';

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

function createRegistry() {
    return new textmate.Registry({
        onigLib: loadOnigLib(),
        loadGrammar: async (scopeName) => {
            if (scopeName !== ROOT_SCOPE) {
                return null;
            }
            const raw = fs.readFileSync(GRAMMAR_PATH, 'utf8');
            return textmate.parseRawGrammar(raw, GRAMMAR_PATH);
        },
    });
}

// The root scope is on every token and the `.tjson` suffix is on nearly every
// scope; dropping both keeps the dump narrow enough to read in a diff.
function formatScopes(scopes) {
    const trimmed = scopes
        .filter((scope) => scope !== ROOT_SCOPE)
        .map((scope) => scope.replace(/\.tjson$/, ''));

    if (trimmed.length === 0) {
        return '-';
    }
    return trimmed.join(' ');
}

// Whitespace runs that carry no scope at all are structural filler (the gaps
// between table cells, the spaces around inline separators). Listing them adds
// a lot of noise and nothing a reviewer would act on.
function isUnscopedWhitespace(text, scopes) {
    return text.trim() === '' && formatScopes(scopes) === '-';
}

async function tokenizeFile(filePath) {
    return tokenizeText(fs.readFileSync(filePath, 'utf8'));
}

async function tokenizeText(text) {
    const registry = createRegistry();
    const grammar = await registry.loadGrammar(ROOT_SCOPE);

    if (!grammar) {
        throw new Error(`Failed to load grammar for ${ROOT_SCOPE}`);
    }

    const lines = text.split(/\r?\n/);
    const out = [];
    let ruleStack = textmate.INITIAL;

    lines.forEach((line, index) => {
        const result = grammar.tokenizeLine(line, ruleStack);
        out.push(`${String(index + 1).padStart(4)} | ${line}`);

        for (const token of result.tokens) {
            const piece = line.substring(token.startIndex, token.endIndex);

            if (isUnscopedWhitespace(piece, token.scopes)) {
                continue;
            }

            const span = `${token.startIndex}-${token.endIndex}`;
            out.push(
                `     | ${span.padEnd(8)} ${JSON.stringify(piece).padEnd(34)} ` +
                    formatScopes(token.scopes)
            );
        }

        ruleStack = result.ruleStack;
    });

    return out.join('\n') + '\n';
}

module.exports = { tokenizeFile, tokenizeText };

if (require.main === module) {
    const target = process.argv[2];

    if (!target) {
        console.error('usage: node tokenize.js <file.tjson>');
        process.exit(2);
    }

    tokenizeFile(target).then(
        (dump) => process.stdout.write(dump),
        (err) => {
            console.error(err);
            process.exit(1);
        }
    );
}
