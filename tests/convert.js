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
    const block = require('fs')
        .readFileSync(path.join(__dirname, '..', 'vendor', 'tjson.d.ts'), 'utf8')
        .split('export interface StringifyOptions')[1]
        .split(/^}/m)[0];

    const optionNames = new Set(block.matchAll(/^\s+(\w+)\??:/gm));
    const known = new Set([...optionNames].map((m) => m[1]));
    for (const key of Object.keys(declared)) {
        const name = key.replace('tjson.render.', '');
        check(`the setting ${key} names a real render option`, known.has(name));
    }

    // An option the library calls experimental has to say so where someone will
    // read it, which is the settings UI and nowhere else. The generator lifts
    // the `@experimental` JSDoc tag into a warning and a `tags` entry; this is
    // what notices if it stops, since the block in package.json is regenerated
    // on every vendor pull and a description that quietly reverted would look
    // exactly like one that was never written.
    const experimental = new Set(
        [...block.matchAll(/\/\*\*([\s\S]*?)\*\/\s*(\w+)\??:/g)]
            .filter(([, doc]) => doc.includes('@experimental'))
            .map(([, , name]) => name)
    );
    check(
        'the library still marks some options experimental',
        experimental.size > 0,
        'none found in vendor/tjson.d.ts -- has the tag been renamed?'
    );

    // Kept here rather than imported from the generator, so that this is a
    // second statement of the same fact and not a restatement of whatever the
    // generator happens to hold. The generator throws if a name here stops
    // being experimental; this catches the two lists disagreeing.
    const LOSSY = new Set(['tableFold']);
    for (const name of LOSSY) {
        check(
            `the lossy option ${name} is still an experimental option`,
            experimental.has(name),
            `not marked @experimental in vendor/tjson.d.ts`
        );
    }

    for (const name of experimental) {
        const setting = declared[`tjson.render.${name}`];
        check(`the experimental option ${name} is declared as a setting`, setting !== undefined);
        if (!setting) continue;

        check(
            `the experimental option ${name} is tagged experimental`,
            Array.isArray(setting.tags) && setting.tags.includes('experimental'),
            `tags: ${JSON.stringify(setting.tags)}`
        );
        // "Other than the default" says nothing unless the default is on the
        // page. It cannot be read off the setting itself -- that one is `null`,
        // meaning unset -- so it has to come from the library's own doc.
        check(
            `the experimental option ${name} names its default`,
            /The default is `[^`]+`\./.test(setting.markdownDescription),
            `no stated default in vendor/tjson.d.ts for ${name}: ${setting.markdownDescription}`
        );

        // The round-trip warning is the strong one and belongs only on the
        // options that cannot round trip, or it stops being read. Both halves
        // matter: absent where it is needed is a missing warning, present
        // everywhere else is what makes the needed one invisible.
        const lossy = LOSSY.has(name);
        check(
            lossy
                ? `the lossy option ${name} warns that it may not round trip`
                : `the experimental option ${name} does not cry wolf about round-tripping`,
            /round trip/i.test(setting.markdownDescription) === lossy,
            setting.markdownDescription
        );
    }

    // The tag itself is not prose. Rendered verbatim it reads as a stray
    // annotation, and an unmarked option is better served by the warning above.
    for (const [key, setting] of Object.entries(declared)) {
        check(
            `the description of ${key} does not leak the raw @experimental tag`,
            !setting.markdownDescription.includes('@experimental'),
            setting.markdownDescription
        );
    }
}

const loadTjson = () => import('../vendor/index.js');

// Every library function this extension calls, and whether the vendored
// package actually has it.
//
// @rfanth/tjson 0.10.0 declared toJsonPretty in its types and did not export
// it: the package's zero-setup entry re-exported a hardcoded list of names
// that predated the function. A typecheck passed and the call threw. Types
// are a claim about a package; this is the check that the claim is true of
// the copy in vendor/, which is the only copy that ships.
async function vendoredApiTests() {
    const tjson = await loadTjson();
    const used = ['parse', 'toJson', 'toJsonPretty', 'fromJson', 'version'];
    const absent = used.filter((name) => typeof tjson[name] !== 'function');
    check('vendor/ exports every library function the extension calls',
        absent.length === 0,
        `missing: ${absent.join(', ')} -- present: ${Object.keys(tjson).join(', ')}`);
}

async function conversionTests() {
    const tjson = await loadTjson();

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

// Strip every byte the indenter is allowed to add. What is left has to be the
// input, exactly.
//
// This is the check that matters, and it is deliberately stronger than parsing
// both sides and comparing the values: an f64 round trip produces JSON that
// still parses, and still compares equal to itself, while holding a different
// number than the document did. Byte identity is the only comparison that
// notices.
function stripAddedWhitespace(text) {
    let out = '';
    let inString = false;
    let escaped = false;

    for (const ch of text) {
        if (inString) {
            out += ch;
            if (escaped) {
                escaped = false;
            } else if (ch === '\\') {
                escaped = true;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }
        if (ch === '"') {
            inString = true;
            out += ch;
            continue;
        }
        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
            continue;
        }
        out += ch;
    }
    return out;
}

async function prettyJsonTests() {
    const tjson = await loadTjson();

    // Through the mode the pane actually uses, not the library call directly:
    // what is being checked is that the JSON preview shows the document, and
    // the mode is the part that decides which library call answers that.
    const shown = (json) => MODES.toJson.convert(tjson, tjson.fromJson(json));

    check('the JSON preview is indented rather than minified',
        shown('{"a":1,"b":[2,3]}').includes('\n  "a": 1'),
        shown('{"a":1,"b":[2,3]}'));

    // Numbers no f64 can hold. A preview that rounds these is showing a
    // document the writer does not have, which is worse than showing none:
    // TJSON carries them exactly, so the pane beside it must too.
    //
    // Checked against the minified form of the same TJSON rather than against
    // the JSON that was fed in. Rendering TJSON may respell an exponent --
    // `1e400` becomes `1e+400`, the `+` being optional in JSON's grammar and
    // the value identical -- and that is fromJson's business, not the JSON
    // preview's. Comparing to the original input would test both conversions
    // at once and fail the wrong one.
    const exact = {
        'an integer past Number.MAX_SAFE_INTEGER': '{"n":123456789012345678901234567890}',
        'a number that would overflow to Infinity': '{"n":1e400}',
        'a decimal finer than a double resolves': '{"n":0.1000000000000000000000000001}',
    };
    for (const [label, json] of Object.entries(exact)) {
        const tj = tjson.fromJson(json);
        const got = stripAddedWhitespace(MODES.toJson.convert(tjson, tj));
        check(`${label} reaches the pane exactly`, got === tjson.toJson(tj),
            `${tjson.toJson(tj)}  ->  ${got}`);
    }

    // Against the source digits directly, for the case where no respelling is
    // possible. This is the one an f64 would visibly destroy, and it does not
    // depend on toJson being right either.
    check('a 30-digit integer keeps every digit on the way to the pane',
        stripAddedWhitespace(shown('{"n":123456789012345678901234567890}'))
            === '{"n":123456789012345678901234567890}',
        stripAddedWhitespace(shown('{"n":123456789012345678901234567890}')));

    // Indentation must be the only difference from the minified form. Compared
    // by bytes rather than by parsing both sides, because an f64 round trip
    // produces JSON that still parses and still compares equal to itself while
    // holding a different number than the document did.
    const corpus = [
        '{"a":"he said \\"hi\\""}',
        '{"a":"ends with \\\\"}',
        '{"a":"{[,:]}"}',
        '{"a":{},"b":[],"c":[{}]}',
        '{"k":"héllo 日本 🎉"}',
        '{"a":true,"b":false,"c":null}',
        '[[[[[1]]]]]',
    ];
    const damaged = corpus
        .map((json) => [json, tjson.fromJson(json)])
        .filter(([json, tj]) => stripAddedWhitespace(MODES.toJson.convert(tjson, tj)) !== tjson.toJson(tj))
        .map(([json]) => json);
    check('indenting changes nothing but whitespace outside strings',
        damaged.length === 0,
        damaged.join('\n      '));
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
    await vendoredApiTests();
    await conversionTests();
    await prettyJsonTests();
    uriTests();

    const total = 25;
    console.log(`convert: ${total - failures.length}/${total} case(s) pass`);
    for (const failure of failures) {
        console.log('');
        console.log(`FAIL  ${failure}`);
    }
    if (failures.length > 0) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exit(1); });
