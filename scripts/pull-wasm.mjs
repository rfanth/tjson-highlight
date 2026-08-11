#!/usr/bin/env node
//
// Refresh vendor/ — the parser the extension's diagnostics call — from the
// PUBLISHED @rfanth/tjson package.
//
// Why published and not a local crate checkout: a user who sees a squiggle has
// to be able to get the same answer from the released library or CLI. A parser
// built from someone's working tree reports errors that exist nowhere else and
// that nobody can reproduce. Pulling the npm artifact makes the bytes here the
// same bytes everyone else can install, and lets anyone with a clone of this
// repo alone refresh them — no Rust, no wasm-pack, no sibling checkout.
//
// Why the web target rather than the package root: the root is wasm-pack's
// bundler target, which reaches the wasm through `import ... from "./x.wasm"`.
// Node only honours that behind an experimental flag, and an extension host is
// not somewhere we get to pass flags. The web target's index.js carries the
// wasm inlined, so it needs no asset lookup at runtime — which also means
// nothing to get wrong about paths inside a packed .vsix.
//
// Why wasm at all: it is the one build that is the same on Linux, macOS and
// Windows. No per-platform binary, nothing to download on first run.
//
//   node scripts/pull-wasm.mjs            # whatever npm calls latest
//   node scripts/pull-wasm.mjs 0.8.0      # a specific release

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = join(REPO, 'vendor');
const PACKAGE = '@rfanth/tjson';

// The glue imports these by relative path, so the tree shape has to survive the
// copy. Keeping the list explicit means an upstream file appearing or vanishing
// is a loud failure here rather than a mystery at runtime.
const WANTED = [
    ['web/index.js', 'index.js'],
    ['web/tjson.js', 'tjson.js'],
    ['web/index.d.ts', 'index.d.ts'],
    ['web/tjson.d.ts', 'tjson.d.ts'],
    ['LICENSE', 'LICENSE'],
];

const requested = process.argv[2] ?? 'latest';
const spec = `${PACKAGE}@${requested}`;

// `npm install --prefix` rather than `npm pack` plus tar: no archive to unpack,
// so there is no dependence on a tar binary and this runs the same on Windows.
const staging = mkdtempSync(join(tmpdir(), 'tjson-wasm-'));
let landed;
try {
    console.log(`pulling ${spec} …`);
    execFileSync('npm', ['install', spec, '--prefix', staging, '--no-save', '--silent'], {
        stdio: ['ignore', 'inherit', 'inherit'],
    });

    const root = join(staging, 'node_modules', PACKAGE);
    landed = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

    // Everything in vendor/ is generated, so it is replaced wholesale. Copying
    // over the top instead would leave whatever the previous target happened to
    // need — the earlier wasm-pack build put a tjson_bg.wasm here, and a stale
    // one sitting next to a working parser is exactly the kind of thing that
    // gets shipped by accident.
    rmSync(VENDOR, { recursive: true, force: true });
    mkdirSync(VENDOR, { recursive: true });

    for (const [from, to] of WANTED) {
        copyFileSync(join(root, from), join(VENDOR, to));
    }

    // The snippets directory name carries a content hash, so a stale one would
    // sit next to the new one forever. Replace the tree rather than merge it.
    rmSync(join(VENDOR, 'snippets'), { recursive: true, force: true });
    const snippets = execFileSync('node', [
        '-e',
        `const {readdirSync}=require('fs');process.stdout.write(readdirSync(${JSON.stringify(join(root, 'web/snippets'))}).join('\\n'))`,
    ]).toString().split('\n').filter(Boolean);

    for (const hashed of snippets) {
        const dest = join(VENDOR, 'snippets', hashed, 'src', 'js');
        mkdirSync(dest, { recursive: true });
        copyFileSync(
            join(root, 'web/snippets', hashed, 'src/js/value_transport.js'),
            join(dest, 'value_transport.js'),
        );
    }

    // The extension is CommonJS, so the root package.json cannot say
    // "type": "module" — but everything here is an ES module. Without this
    // marker node has to guess, discovers module syntax, and reparses the file,
    // which it warns about on every load. One line scopes the declaration to
    // this directory and leaves the extension's own module type alone.
    writeFileSync(join(VENDOR, 'package.json'), `${JSON.stringify({ type: 'module' }, null, 2)}\n`);

    writeFileSync(join(VENDOR, 'SOURCE.txt'),
        [
            `Pulled by scripts/pull-wasm.mjs from the published npm package.`,
            ``,
            `  package  ${PACKAGE}`,
            `  version  ${landed}`,
            `  asked    ${requested}`,
            `  target   web (wasm inlined in index.js, no asset lookup at runtime)`,
            `  pulled   ${new Date().toISOString().replace('T', ' ').slice(0, 19)}Z`,
            ``,
            `Do not edit by hand. Rerun the script after a release.`,
            `A diagnostic this parser reports must be reproducible with:`,
            `  npx --yes ${PACKAGE}@${landed}`,
            ``,
        ].join('\n'));
} finally {
    rmSync(staging, { recursive: true, force: true });
}

// The settings mirror the library's own options, including their documentation
// and their current defaults, so they are regenerated from the .d.ts that just
// landed. Doing it here rather than by hand is what keeps a setting from
// describing a default the bundled parser no longer has.
execFileSync('node', [join(REPO, 'scripts', 'gen-settings.mjs')], { stdio: 'inherit' });

console.log(`vendor/ now holds ${PACKAGE} ${landed}`);
