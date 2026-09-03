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

// The library marks an option experimental with a `@experimental` JSDoc tag,
// which renders as those literal characters at the head of the paragraph --
// markdown gives it no meaning and neither does the settings UI. So it is
// lifted out of the prose and re-emitted as the warning it stands for.
//
// `tags` is the editor's own mechanism and the only one there is. It draws no
// badge -- stable VS Code has none for extension settings -- but it makes
// `@tag:experimental` in the settings search list exactly these.
//
// The warning names the default rather than alluding to it, because the
// settings UI is no help there: every setting here declares `null`, meaning
// "unset, the library decides", which is not the library's value. The figure
// comes from the library's own `Default:` sentence.
//
// Two tiers, because a warning on everything is a warning on nothing. Most of
// these only choose between shapes the library can already read back, and the
// worst they do is render something unexpected that re-rendering fixes. Which
// one is worse than that is the only fact here the .d.ts does not carry --
// hence the list, and hence the check below that its names are still
// experimental options at all.
const EXPERIMENTAL = /^@experimental\s*/;
const DEFAULT = /Default:\s*(`[^`]+`)/;
const MAY_NOT_ROUND_TRIP = new Set(['tableFold']);

function warningFor(name, prose) {
    const stated = DEFAULT.exec(prose);
    const names = stated ? ` The default is ${stated[1]}.` : '';

    // Loud about turning it on, and explicit that leaving it alone is fine: the
    // library is finished, this one feature is not, and a warning that does not
    // draw that line scares people off a default that is perfectly good.
    // Upstream's own "not currently implemented" reads as "does nothing yet, so
    // it cannot hurt", and sits directly below this, so this is the half that
    // has to look dangerous.
    if (MAY_NOT_ROUND_TRIP.has(name)) {
        return (
            '**⚠ UNFINISHED — do not turn this on for anything you need to keep.**' +
            `${names} That default is complete and safe; this feature is not. It ` +
            'renders, and what it renders is unfinished: output written with any ' +
            'other value is not guaranteed to round trip!'
        );
    }

    return `**⚠ Experimental.**${names} It may change or be removed in a future release.`;
}

const properties = {};
const marked = new Set();
let count = 0;
let experimental = 0;

for (const [, rawDoc, name, rawType] of block.matchAll(/\/\*\*([\s\S]*?)\*\/\s*(\w+)\?:\s*([^;]+);/g)) {
    const doc = rawDoc.replace(/^\s*\*\s?/gm, '').replace(/\s+/g, ' ').trim();
    const type = rawType.trim();

    const isExperimental = EXPERIMENTAL.test(doc);
    const prose = doc.replace(EXPERIMENTAL, '');

    const setting = {
        // `null` and nothing else. See the header: a real value here would be
        // this version's default frozen into every user's settings.
        default: null,
        markdownDescription: [
            isExperimental ? `${warningFor(name, prose)}\n\n${prose}` : prose,
            "Leave unset to use the bundled TJSON library's own default.",
        ].join('\n\n'),
    };

    if (isExperimental) {
        setting.tags = ['experimental'];
        experimental += 1;
    }

    if (type === 'boolean' || type === 'number') {
        setting.type = [type, 'null'];
    } else if (unions.has(type)) {
        setting.type = ['string', 'null'];
        setting.enum = [null, ...unions.get(type)];
    } else {
        throw new Error(`option ${name} has type ${type}, which has no settings representation`);
    }

    if (isExperimental) {
        marked.add(name);
    }

    properties[`tjson.render.${name}`] = setting;
    count += 1;
}

// See MAY_NOT_ROUND_TRIP: the list is local knowledge about the library, so it
// is the thing most likely to go stale, and a stale entry fails silent -- the
// option keeps its warning while the option that needs one does not get it.
for (const name of MAY_NOT_ROUND_TRIP) {
    if (!marked.has(name)) {
        throw new Error(
            `${name} is listed as unable to round trip, but vendor/tjson.d.ts no longer ` +
            'marks it @experimental. Confirm whether it is still experimental and ' +
            'still lossy, then update MAY_NOT_ROUND_TRIP in this file.'
        );
    }
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
manifest.contributes.configuration = {
    title: 'TJSON',
    // Generated. Editing this in package.json will be undone by the next pull.
    properties,
};
writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(
    `generated ${count} tjson.render.* setting(s) from vendor/tjson.d.ts, ` +
    `${experimental} marked experimental`
);
