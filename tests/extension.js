// Tests for the diagnostics half of the extension.
//
// The grammar tests next door check what TJSON is *coloured* as. This checks
// what it is *reported* as, which is a different mechanism with a different way
// of going wrong: the colouring comes from tjson.tmLanguage.json in this repo,
// the reporting comes from the parser vendored under vendor/.
//
// That split is the bug this file exists to catch. Those two can disagree —
// vendor/ once held a parser predating the `_` bare-string marker, so a marked
// document was colored correctly and squiggled red at the same time. Nothing in
// the grammar tests could see that, because nothing in the grammar was wrong.
//
// src/extension.js is loaded for real, with only `vscode` replaced, so the
// module resolution, the dynamic import of the ES module in vendor/, and
// toDiagnostic's parsing of the error text are all under test rather than
// reimplemented here.

const Module = require('module');
const assert = require('assert');

// ── the vscode stub ──────────────────────────────────────────────────────────

const state = { diagnostics: new Map(), errorMessages: [], handlers: {} };

const vscodeStub = {
    languages: {
        createDiagnosticCollection: () => ({
            set: (uri, list) => state.diagnostics.set(String(uri), list),
            delete: (uri) => state.diagnostics.delete(String(uri)),
            dispose: () => {},
        }),
    },
    window: {
        showErrorMessage: (message) => state.errorMessages.push(message),
        // The slow-work cue. Recorded rather than ignored so a test can assert
        // it is not left spinning; see the status bar cases below.
        createStatusBarItem: () => (state.statusBar = {
            text: '', tooltip: '', name: '', visible: false,
            show() { this.visible = true; }, hide() { this.visible = false; },
            dispose() {},
        }),
    },
    StatusBarAlignment: { Left: 1, Right: 2 },
    workspace: {
        onDidOpenTextDocument: (fn) => ((state.handlers.open = fn), { dispose: () => {} }),
        onDidSaveTextDocument: () => ({ dispose: () => {} }),
        onDidChangeTextDocument: () => ({ dispose: () => {} }),
        onDidCloseTextDocument: () => ({ dispose: () => {} }),
        textDocuments: [],
        // activate() also registers the conversion preview. Its own behaviour is
        // covered by convert.js; here it only has to not throw, because a
        // failure while wiring it up would take the diagnostics down with it.
        registerTextDocumentContentProvider: () => ({ dispose: () => {} }),
        getConfiguration: () => ({ inspect: () => undefined }),
    },
    Diagnostic: class {
        constructor(range, message, severity) {
            Object.assign(this, { range, message, severity });
        }
    },
    Range: class {
        constructor(startLine, startCharacter, endLine, endCharacter) {
            Object.assign(this, { startLine, startCharacter, endLine, endCharacter });
        }
    },
    DiagnosticSeverity: { Error: 0 },
    EventEmitter: class {
        constructor() {
            this.event = () => ({ dispose: () => {} });
        }
        fire() {}
    },
    ViewColumn: { Beside: 2 },
    Uri: { from: (parts) => parts, parse: (value) => ({ toString: () => value }) },
    commands: { registerCommand: () => ({ dispose: () => {} }) },
};

const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
    return request === 'vscode' ? 'vscode' : resolve.call(this, request, ...rest);
};
require.cache.vscode = { id: 'vscode', filename: 'vscode', loaded: true, exports: vscodeStub };

// ── documents ────────────────────────────────────────────────────────────────

let counter = 0;
function makeDocument(text) {
    const lines = text.split('\n');
    return {
        languageId: 'tjson',
        uri: `file:///doc-${(counter += 1)}.tjson`,
        lineCount: lines.length,
        getText: () => text,
        lineAt: (n) => ({
            lineNumber: n,
            text: lines[n] ?? '',
            range: { end: { character: (lines[n] ?? '').length } },
        }),
    };
}

// ── cases ────────────────────────────────────────────────────────────────────

// Valid TJSON that an older parser would reject. Each of these was refused by
// the parser vendor/ carried before it was pulled from the published package.
const VALID = [
    ['a marked bare string', '  k:_value\n'],
    ['a marked bare string packed with a pair', '  a:_x y    b:_p q\n'],
    ['a marked table cell', '  r:\n    |n     |v  |\n    |_Bob  |1  |\n    |_Cal  |2  |\n    |_Dan  |3  |\n'],
    ['a marked packed array', '  plain:  _rust  _wasm  _json\n'],
    ['an unmarked bare string', '  k: value\n'],
    ['MINIMAL JSON after a key', '  k:[1,2]\n'],
    ['a multiline string as an array element', '  list:\n     ```\nhello\nthere\n     ```\n'],
];

// Genuinely broken input, with where the report must land -- and what the
// squiggle must cover, which is the half that used to go unchecked. The parser
// counts a column in Unicode scalar values and a vscode.Range counts UTF-16
// code units, so the emoji case below is the one that tells them apart: its
// fault is at scalar column 7 and UTF-16 offset 8, and handing the parser's
// number straight to the Range underlined ": abc," instead of " abc,".
//
// A parser that accepted everything would pass the block above and fail this
// one.
const INVALID = [
    ['a line that is not an entry', '  k: aaa\n  bad\n', 1, 2, 'bad'],
    ['a bare string opening with the marker character', '  k: _x\n', 0, 4, ' _x'],
    ['a fault behind a character outside the BMP', '  "\u{1F600}k": abc,\n', 0, 8, ' abc,'],
];

async function main() {
    const extension = require('../src/extension.js');
    extension.activate({ subscriptions: [] });

    const check = state.handlers.open;
    assert.ok(check, 'activate() must register an open handler');

    const failures = [];

    for (const [label, text] of VALID) {
        state.diagnostics.clear();
        const document = makeDocument(text);
        await check(document);
        const reported = state.diagnostics.get(String(document.uri));
        if (reported && reported.length > 0) {
            failures.push(
                `${label}: valid TJSON was reported as an error\n` +
                `      ${reported[0].message.split('\n')[0]}`
            );
        }
    }

    for (const [label, text, line, character, underlined] of INVALID) {
        state.diagnostics.clear();
        const document = makeDocument(text);
        await check(document);
        const reported = state.diagnostics.get(String(document.uri));
        if (!reported || reported.length === 0) {
            failures.push(`${label}: broken TJSON produced no diagnostic`);
            continue;
        }
        if (reported[0].range.startLine !== line) {
            failures.push(
                `${label}: reported on line ${reported[0].range.startLine}, expected ${line}`
            );
        }
        if (reported[0].range.startCharacter !== character) {
            failures.push(
                `${label}: reported at character ${reported[0].range.startCharacter}, ` +
                `expected ${character}`
            );
        }
        // The character offset is only meaningful against the text it indexes,
        // so the run it actually covers is asserted rather than the number
        // alone -- an off-by-one in the conversion shows up here as the wrong
        // words even where the number looks plausible.
        {
            const faulted = text.split('\n')[line] ?? '';
            const covered = faulted.slice(
                reported[0].range.startCharacter,
                reported[0].range.endCharacter
            );
            if (covered !== underlined) {
                failures.push(
                    `${label}: underlined ${JSON.stringify(covered)}, ` +
                    `expected ${JSON.stringify(underlined)}`
                );
            }
        }
        // toDiagnostic strips the "line N, column M: " prefix; if it ever stops
        // matching, the whole raw string ends up in the squiggle.
        if (/^line \d+, column \d+:/.test(reported[0].message)) {
            failures.push(`${label}: the position prefix was not stripped from the message`);
        }
    }

    if (state.errorMessages.length > 0) {
        failures.push(`the parser failed to load: ${state.errorMessages[0]}`);
    }

    const total = VALID.length + INVALID.length;
    console.log(`extension: ${total - failures.length}/${total} diagnostic case(s) pass`);
    for (const failure of failures) {
        console.log('');
        console.log(`FAIL  ${failure}`);
    }
    if (failures.length > 0) {
        process.exitCode = 1;
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
