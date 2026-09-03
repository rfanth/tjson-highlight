// Every fixture must be readable by the parser the extension ships.
//
// `regen.sh` compares the CLI's version against the vendored release before it
// writes anything, but a version number is only a proxy. The property that
// actually matters is this one: a fixture the extension itself would reject is
// a fixture that teaches the grammar a format nobody can use. That is not
// hypothetical -- a stale CLI once wrote a comma-packed bare string array,
// forbidden since v0.5.0 of the specification, and the grammar went on
// highlighting it as valid for as long as nobody reparsed it.
//
// Asking the parser directly is both stricter and more permissive than the
// version check: a CLI ahead of the vendored release passes here as long as
// what it wrote still reads, and a CLI at the right version fails here if it
// wrote something the parser refuses.
//
//   node check-fixtures.mjs

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
// `toJson` rather than `parse`: parse builds JS values and refuses an integer a
// JS number cannot hold exactly, which is a limit of the host language and not
// of the format. `fold-types.tjson` carries a forty-digit integer on purpose --
// it is a number long enough to fold. toJson passes numbers through as exact
// text, so it answers the question actually being asked: does this read as
// TJSON.
import { toJson, version } from '../vendor/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, 'fixtures');

const names = fs
    .readdirSync(FIXTURES)
    .filter((name) => name.endsWith('.tjson'))
    .sort();

const failures = [];

for (const name of names) {
    const text = fs.readFileSync(path.join(FIXTURES, name), 'utf8');

    try {
        toJson(text);
    } catch (error) {
        failures.push({ name, message: String(error && error.message ? error.message : error) });
    }
}

for (const failure of failures) {
    console.error(`  REJECTED  ${failure.name}`);
    console.error(`            ${failure.message}`);
}

console.log(
    `fixtures: ${names.length - failures.length}/${names.length} parse with the vendored parser (${version()})`
);

if (failures.length > 0) {
    console.error('');
    console.error('A fixture the shipped parser refuses teaches the grammar a format that');
    console.error('does not exist. Do not commit these goldens.');
    process.exit(1);
}
