// Tests for the JSON <-> TJSON conversion commands.
//
// Two things here are easy to get wrong in ways nothing else would notice.
//
// The first is the settings. A render option the user never touched must not be
// sent to the renderer at all, because the value VS Code would hand back is
// this extension's declared default -- and the library changes its own defaults
// between releases. Forwarding one pins everybody to whatever package.json said
// on the day they installed. There is no way to see that from the outside: the
// output is merely subtly not what the current library would produce.
//
// The second is the preview URI. It carries the source document and the mode in
// its query, and it is the only link between a pane and what it was made from.
// Break it and previews silently stop refreshing.

const assert = require('assert');
const Module = require('module');
const path = require('path');

// ── the vscode stub ──────────────────────────────────────────────────────────

const settings = { inspected: {} };

class Uri {
    constructor(scheme, authority, uriPath, query, fragment) {
        Object.assign(this, { scheme, authority, path: uriPath, query, fragment });
    }
    static from({ scheme, path: p = '', query = '', fragment = '' }) {
        return new Uri(scheme, '', p, query, fragment);
    }
    static parse(value) {
        const m = /^([^:]+):([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/.exec(value);
        return new Uri(m[1], '', m[2], m[3] ?? '', m[4] ?? '');
    }
    toString() {
        return `${this.scheme}:${this.path}${this.query ? `?${this.query}` : ''}`;
    }
}

const vscodeStub = {
    Uri,
    EventEmitter: class { constructor() { this.event = () => ({ dispose() {} }); } fire() {} },
    ViewColumn: { Beside: 2 },
    workspace: {
        textDocuments: [],
        getConfiguration: () => ({ inspect: (key) => settings.inspected[key] }),
        registerTextDocumentContentProvider: () => ({ dispose() {} }),
        onDidChangeTextDocument: () => ({ dispose() {} }),
        openTextDocument: async () => ({ getText: () => '' }),
    },
    window: {
        activeTextEditor: null,
        showWarningMessage: () => {},
        showInformationMessage: () => {},
        showErrorMessage: () => {},
        showTextDocument: async () => {},
    },
    commands: { registerCommand: () => ({ dispose() {} }) },
};

const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
    return request === 'vscode' ? 'vscode' : resolve.call(this, request, ...rest);
};
require.cache.vscode = { id: 'vscode', filename: 'vscode', loaded: true, exports: vscodeStub };

const { renderOptions } = require('../src/render-options');
const { MODES, previewUri, previewOrigin } = require('../src/preview');

// ── cases ────────────────────────────────────────────────────────────────────

const manifest = require('../package.json');
const declared = manifest.contributes.configuration.properties;

function context(inspected) {
    settings.inspected = inspected;
    return { extension: { packageJSON: manifest } };
}

const failures = [];
const check = (label, condition, detail) => {
    if (!condition) failures.push(`${label}${detail ? `\n      ${detail}` : ''}`);
};

function settingsTests() {
    // Nothing set: nothing forwarded. The library decides everything.
    const untouched = Object.fromEntries(
        Object.keys(declared).map((key) => [key, {
            key, defaultValue: declared[key].default,
            globalValue: undefined, workspaceValue: undefined, workspaceFolderValue: undefined,
        }])
    );
    const none = renderOptions(context(untouched));
    check(
        'an untouched configuration must forward no options at all',
        Object.keys(none).length === 0,
        `forwarded ${JSON.stringify(none)}`
    );

    // The trap this file exists for: a declared default must never be forwarded.
    const withDefaults = Object.fromEntries(
        Object.keys(declared).map((key) => [key, {
            key, defaultValue: 'A-DEFAULT-THAT-MUST-NOT-ESCAPE',
            globalValue: undefined, workspaceValue: undefined, workspaceFolderValue: undefined,
        }])
    );
    const leaked = renderOptions(context(withDefaults));
    check(
        'a declared default must never reach the renderer',
        Object.keys(leaked).length === 0,
        `leaked ${JSON.stringify(leaked)}`
    );

    // Explicitly set values are forwarded, under their bare option names.
    const chosen = { ...untouched };
    chosen['tjson.render.bareStrings'] = { ...chosen['tjson.render.bareStrings'], globalValue: 'marked' };
    chosen['tjson.render.wrapWidth'] = { ...chosen['tjson.render.wrapWidth'], workspaceValue: 40 };
    const picked = renderOptions(context(chosen));
    check(
        'explicitly set options are forwarded under their library names',
        picked.bareStrings === 'marked' && picked.wrapWidth === 40 && Object.keys(picked).length === 2,
        `got ${JSON.stringify(picked)}`
    );

    // Narrower scope wins; an explicit null reads as "cleared", not as a value.
    const scoped = { ...untouched };
    scoped['tjson.render.wrapWidth'] = {
        key: 'tjson.render.wrapWidth', defaultValue: null,
        globalValue: 100, workspaceValue: 60, workspaceFolderValue: undefined,
    };
    scoped['tjson.render.tables'] = {
        key: 'tjson.render.tables', defaultValue: null,
        globalValue: null, workspaceValue: undefined, workspaceFolderValue: undefined,
    };
    const narrowed = renderOptions(context(scoped));
    check('the narrower scope wins', narrowed.wrapWidth === 60, `got ${narrowed.wrapWidth}`);
    check('an explicit null means unset', !('tables' in narrowed), `got ${JSON.stringify(narrowed)}`);

    // Every setting must be one the renderer actually has, or it silently does
    // nothing. The generator derives them from the library's own types, so this
    // catches the generator drifting rather than a typo.
    const optionNames = new Set(
        require('fs').readFileSync(path.join(__dirname, '..', 'vendor', 'tjson.d.ts'), 'utf8')
            .split('export interface StringifyOptions')[1].split(/^}/m)[0]
            .matchAll(/^\s+(\w+)\??:/gm)
    );
    const known = new Set([...optionNames].map((m) => m[1]));
    for (const key of Object.keys(declared)) {
        const name = key.replace('tjson.render.', '');
        check(`the setting ${key} names a real render option`, known.has(name));
    }
}

async function conversionTests() {
    const tjson = await import('../vendor/index.js');

    const json = '{"name":"Bob","tags":["rust","wasm"],"n":3}';
    const asTjson = MODES.toTjson.convert(tjson, json, {});
    check('JSON converts to TJSON', asTjson.includes('name'), asTjson);
    check(
        'the result parses as TJSON, so a preview of it is never wrong',
        (() => { try { tjson.parse(asTjson); return true; } catch { return false; } })(),
        asTjson
    );

    const back = MODES.toJson.convert(tjson, asTjson);
    check('TJSON converts back to JSON with the same data',
        JSON.stringify(JSON.parse(back)) === JSON.stringify(JSON.parse(json)),
        `${back} vs ${json}`);

    // Reformatting is the round trip, and must honour the render options.
    const marked = MODES.reformat.convert(tjson, asTjson, { bareStrings: 'marked' });
    check('reformatting applies the render options', marked.includes('_'), marked);
    check('and still produces valid TJSON',
        (() => { try { tjson.parse(marked); return true; } catch { return false; } })(), marked);

    // No options at all must still work -- that is the untouched-settings path.
    check('reformatting with no options works',
        typeof MODES.reformat.convert(tjson, asTjson, {}) === 'string');
}

function uriTests() {
    const source = Uri.parse('file:///tmp/data.json');
    for (const mode of Object.keys(MODES)) {
        const uri = previewUri(source, mode);
        const origin = previewOrigin(uri);
        check(`the ${mode} preview URI round-trips its source`,
            origin && origin.mode === mode && origin.source.toString() === source.toString(),
            JSON.stringify(origin));
        check(`the ${mode} preview URI ends in the extension that picks its language`,
            uri.path.endsWith(MODES[mode].extension), uri.path);
    }
    check('a URI with no usable query is rejected rather than guessed',
        previewOrigin(Uri.parse('tjson-preview:/x.tjson')) === null);
}

async function main() {
    settingsTests();
    await conversionTests();
    uriTests();

    const total = 18;
    console.log(`convert: ${total - failures.length}/${total} case(s) pass`);
    for (const failure of failures) {
        console.log('');
        console.log(`FAIL  ${failure}`);
    }
    if (failures.length > 0) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exit(1); });
