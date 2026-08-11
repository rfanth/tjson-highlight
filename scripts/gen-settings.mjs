#!/usr/bin/env node
//
// Regenerate `contributes.configuration` in package.json from the vendored
// parser's own type definitions.
//
// Two things must never be written into a user's settings.json: a value they
// did not choose, and a value that was only ever *today's* default. The
// underlying library changes its defaults from time to time, and a setting
// carrying a stale copy of one would quietly override the new behaviour for
// everyone who once opened the settings UI.
//
// So every setting here declares `null` as its default, and src/render-options.js
// forwards only the keys a user explicitly set. Unset means the key is absent
// from the options object entirely, and the library decides.
//
// The descriptions are generated for the same reason. They quote the library's
// current defaults, which is genuinely useful when picking a value and would be
// a lie the moment the library moved — so they are rebuilt from the bundled
// .d.ts rather than typed out here, and scripts/pull-wasm.mjs reruns this after
// every pull. Names, enum values and documentation stay in lockstep with the
// version actually shipped.
//
//   node scripts/gen-settings.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = join(REPO, 'vendor', 'tjson.d.ts');
const MANIFEST = join(REPO, 'package.json');

const source = readFileSync(TYPES, 'utf8');

// Named string-union types become enums, so the settings UI offers a dropdown
// rather than a free-text box that silently produces an invalid render.
// A union member may be another named union rather than a literal --
// StringStyleCompat is `StringStyle | "prefer" | "none"` -- so members have to
// be resolved, not just scraped for quoted strings. Scraping alone silently
// produced a two-value enum for bareStrings and lost "marked" entirely, which
// is exactly the sort of quiet wrong answer a dropdown should never give.
const bodies = new Map(
    [...source.matchAll(/^export type (\w+) = ([^;]+);/gm)].map(([, name, body]) => [name, body])
);

function resolveUnion(name, seen = new Set()) {
    if (seen.has(name)) {
        throw new Error(`type ${name} is defined in terms of itself`);
    }
    seen.add(name);

    const values = [];
    for (const part of (bodies.get(name) ?? '').split('|').map((s) => s.trim())) {
        const literal = /^"([^"]+)"$/.exec(part);
        if (literal) {
            values.push(literal[1]);
        } else if (bodies.has(part)) {
            values.push(...resolveUnion(part, seen));
        } else {
            return []; // not a pure string union; no dropdown for it
        }
    }
    return values;
}

const unions = new Map();
for (const name of bodies.keys()) {
    const values = resolveUnion(name);
    if (values.length > 0) {
        unions.set(name, [...new Set(values)]);
    }
}

const block = source.split('export interface StringifyOptions')[1]?.split(/^}/m)[0];
if (!block) {
    throw new Error(`no StringifyOptions interface in ${TYPES}`);
}

const properties = {};
let count = 0;

for (const [, rawDoc, name, rawType] of block.matchAll(/\/\*\*([\s\S]*?)\*\/\s*(\w+)\?:\s*([^;]+);/g)) {
    const doc = rawDoc.replace(/^\s*\*\s?/gm, '').replace(/\s+/g, ' ').trim();
    const type = rawType.trim();

    const setting = {
        // `null` and nothing else. See the header: a real value here would be
        // this version's default frozen into every user's settings.
        default: null,
        markdownDescription: `${doc}\n\nLeave unset to use the bundled TJSON library's own default.`,
    };

    if (type === 'boolean' || type === 'number') {
        setting.type = [type, 'null'];
    } else if (unions.has(type)) {
        setting.type = ['string', 'null'];
        setting.enum = [null, ...unions.get(type)];
    } else {
        throw new Error(`option ${name} has type ${type}, which has no settings representation`);
    }

    properties[`tjson.render.${name}`] = setting;
    count += 1;
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
manifest.contributes.configuration = {
    title: 'TJSON',
    // Generated. Editing this in package.json will be undone by the next pull.
    properties,
};
writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`generated ${count} tjson.render.* setting(s) from vendor/tjson.d.ts`);
