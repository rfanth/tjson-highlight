// The snippets, expanded and then parsed.
//
// A snippet is the one part of this extension that writes TJSON rather than
// reading it, so it is the one part that can produce a document the parser
// refuses. Nothing checked that.
//
// What the editor does with a snippet body, and what this reproduces: the first
// line is inserted at the cursor, and every line after it gets the CURRENT
// LINE'S leading whitespace prepended. That is the whole mechanism the closing
// fence relies on -- a multiline's closer sits at the construct's indent plus
// one space at every depth, a constant, so one literal space in the body is
// correct whether the key is at indent 2 or 20 and the snippet never has to
// know which.
//
// So the test is: expand at several depths, fill the placeholders with ordinary
// text, and hand the result to the parser the extension ships.

import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';
import { toJson } from '../vendor/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function readJsonc(file) {
    const text = fs.readFileSync(file, 'utf8');
    return JSON.parse(text.replace(
        /"(?:[^"\\]|\\.)*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
        (m) => (m.startsWith('"') ? m : '')
    ));
}

const snippets = readJsonc(path.join(HERE, '..', 'snippets', 'tjson.json'));

// The editor prepends the current line's indentation to every line but the
// first, and fills placeholders with whatever the writer types.
function expand(body, indent, filler) {
    const lines = (Array.isArray(body) ? body : [body]).map((line) =>
        line.replace(/\$\{?(\d+)\}?/g, (_, n) => (n === '0' ? '' : filler))
    );
    return lines.map((line, i) => (i === 0 ? line : ' '.repeat(indent) + line));
}

let checks = 0;
const check = (what, condition, detail) => {
    checks += 1;
    assert.ok(condition, detail ? `${what}\n${detail}` : what);
};

check('there are snippets to test', Object.keys(snippets).length > 0);

for (const [name, snippet] of Object.entries(snippets)) {
    // Every depth a key can sit at, inside a document that gets it there.
    // A key line does not stand alone: the root's keys begin at indent 2, and
    // every level below needs the container above it to have been opened, or
    // the parser refuses the jump. So each case is a real document with the
    // snippet expanded at the bottom of it.
    for (const [indent, markers] of [[2, ''], [4, ''], [6, ''], [20, ''], [4, '[ { ']]) {
        // A key at indent I needs its container opened at I-2, and so on down
        // to 2, which is where a root object's keys begin. A marker chain is
        // different: it opens its containers on the key's own line, so the
        // parent sits at the SAME column and simply ends with a colon.
        const parents = [];
        const last = markers ? indent : indent - 2;
        for (let column = 2; column <= last; column += 2) {
            parents.push(' '.repeat(column) + `level${column}:`);
        }

        const lead = ' '.repeat(indent) + markers;
        const key = lead + 'k: ';
        const lines = expand(snippet.body, lead.length, 'body text');
        const document = parents.concat([key + lines[0]], lines.slice(1)).join('\n') + '\n';
        const where = `indent ${indent}${markers ? ` behind ${JSON.stringify(markers)}` : ''}`;

        let json = null;
        let error = null;
        try {
            json = toJson(document);
        } catch (e) {
            error = String(e.message || e).split('\n')[0];
        }

        check(
            `${name} expands to valid TJSON at ${where}`,
            json !== null,
            `        ${JSON.stringify(document)}\n        ${error}`
        );

        // And the string it produces has to be the body the writer typed, with
        // the scaffolding gone -- the margin stripped, the indent stripped, no
        // stray space left on the front of a line.
        if (json !== null) {
            let value = JSON.parse(json);
            while (value && typeof value === 'object' && value.k === undefined) {
                value = Array.isArray(value) ? value[0] : Object.values(value)[0];
            }
            check(
                `${name} at ${where} yields only the writer's text`,
                value && value.k === 'body text\nbody text',
                `        got ${JSON.stringify(value)}`
            );
        }
    }

    // A prefix is what the writer types; it must not itself be something the
    // format would read as content on that line.
    const prefixes = Array.isArray(snippet.prefix) ? snippet.prefix : [snippet.prefix];
    check(`${name} declares at least one prefix`, prefixes.length > 0);
    check(`${name} has a description`, typeof snippet.description === 'string' && snippet.description.length > 0);
}

console.log(`snippets: ${checks}/${checks} check(s) pass across ${Object.keys(snippets).length} snippet(s)`);
