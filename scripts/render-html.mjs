#!/usr/bin/env node
//
// Render data as highlighted TJSON, wherever your JavaScript already runs.
//
// `renderJson` is the usual entry point: give it the JSON you already have and
// it returns the HTML for a highlighted TJSON view of it. Nothing about that is
// build-specific -- it is the same call in a request handler, so a page can show
// TJSON that is always current with the data behind it.
//
// `renderHtml` takes TJSON text instead, for the cases where the TJSON itself is
// the thing you have.
//
// Either way the reader downloads no tokenizer: colouring needs a regex engine,
// a grammar and roughly 180K gzipped of wasm, and none of that has to cross the
// wire if the tokens were worked out on your side. See docs/web-highlighting.md
// for when the browser really does need it.
//
//   node scripts/render-html.mjs data.json                  # data -> highlighted TJSON
//   node scripts/render-html.mjs sample.tjson               # TJSON -> highlighted
//   node scripts/render-html.mjs data.json --fragment       # no <style>, just spans
//   node scripts/render-html.mjs data.json --options '{"wrapWidth":100}'
//
// Needs the two tokenizer packages. This repo already has them under tests/, so
// `cd tests && npm install` is enough; elsewhere, `npm i vscode-textmate
// vscode-oniguruma`.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const GRAMMAR = join(REPO, 'tjson.tmLanguage.json');
const MAPPING = join(REPO, 'docs', 'scope-classes.json');

// Resolve the tokenizer from tests/ first so a plain clone works with no extra
// install, then fall back to wherever the caller has it.
function load(name) {
    for (const from of [join(REPO, 'tests', 'package.json'), join(REPO, 'package.json')]) {
        try {
            return createRequire(from)(name);
        } catch {
            /* try the next one */
        }
    }
    throw new Error(`${name} is not installed. Run: cd tests && npm install`);
}

const oniguruma = load('vscode-oniguruma');
const textmate = load('vscode-textmate');

const { classes, unstyled } = JSON.parse(readFileSync(MAPPING, 'utf8'));
const isScope = (scope, prefix) => scope === prefix || scope.startsWith(`${prefix}.`);

function classFor(scopes) {
    for (let i = scopes.length - 1; i >= 0; i -= 1) {
        if (unstyled.prefixes.some((prefix) => isScope(scopes[i], prefix))) {
            continue;
        }
        for (const [prefix, cls] of classes) {
            if (isScope(scopes[i], prefix)) {
                return cls;
            }
        }
    }
    return null;
}

const escapeHtml = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

const STYLE = `<style>
.tjson { background: #11131d; color: #cdd6f4; padding: 1rem; overflow-x: auto; }
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
</style>`;

export async function renderHtml(source) {
    const wasm = createRequire(join(REPO, 'tests', 'package.json')).resolve(
        'vscode-oniguruma/release/onig.wasm'
    );
    await oniguruma.loadWASM(readFileSync(wasm).buffer);

    const registry = new textmate.Registry({
        onigLib: Promise.resolve({
            createOnigScanner: (sources) => new oniguruma.OnigScanner(sources),
            createOnigString: (str) => new oniguruma.OnigString(str),
        }),
        loadGrammar: async (scopeName) =>
            scopeName === 'source.tjson'
                ? textmate.parseRawGrammar(readFileSync(GRAMMAR, 'utf8'), 'tjson.tmLanguage.json')
                : null,
    });
    const grammar = await registry.loadGrammar('source.tjson');

    const eol = source.includes('\r\n') ? '\r\n' : '\n';
    let stack = textmate.INITIAL;
    const lines = [];

    for (const line of source.split(eol)) {
        // Carried across lines on purpose: a multiline string is one region
        // spanning several of them, and restarting would read its body as TJSON.
        const { tokens, ruleStack } = grammar.tokenizeLine(line, stack);
        stack = ruleStack;

        let html = '';
        let runClass = null;
        let run = '';
        const flush = () => {
            if (!run) return;
            html += runClass ? `<span class="${runClass}">${escapeHtml(run)}</span>` : escapeHtml(run);
        };

        for (const token of tokens) {
            const text = line.slice(token.startIndex, token.endIndex);
            const cls = classFor(token.scopes);
            if (cls === runClass) {
                run += text;
                continue;
            }
            flush();
            runClass = cls;
            run = text;
        }
        flush();
        lines.push(html);
    }

    return lines.join('\n');
}

/**
 * Highlighted HTML for a TJSON view of some JSON.
 *
 * The parser is imported here rather than at the top of the file so the
 * TJSON-in, HTML-out path does not pay for loading it.
 *
 * @param {string} json  the data, as JSON text
 * @param {Record<string, unknown>} [options]  renderer options; anything omitted
 *   is left to the library, which is what keeps this current with its defaults
 */
export async function renderJson(json, options = {}) {
    const { fromJson } = await import('../vendor/index.js');
    return renderHtml(fromJson(json, options));
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
    const args = process.argv.slice(2);
    const file = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--options');
    if (!file) {
        console.error('usage: node scripts/render-html.mjs <file.json|file.tjson> [--fragment] [--options JSON]');
        process.exit(2);
    }

    const optionsAt = args.indexOf('--options');
    const options = optionsAt === -1 ? {} : JSON.parse(args[optionsAt + 1]);
    const source = readFileSync(file, 'utf8');

    // JSON in is the common case, so it is what an unflagged .json file means.
    const fromData = args.includes('--from-json') || /\.json$/i.test(file);
    const body = fromData ? await renderJson(source, options) : await renderHtml(source);

    const fragment = args.includes('--fragment');
    process.stdout.write(
        fragment ? `<pre class="tjson">${body}</pre>\n` : `${STYLE}\n<pre class="tjson">${body}</pre>\n`
    );
}
