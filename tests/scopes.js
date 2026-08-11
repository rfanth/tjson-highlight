// Checks docs/scope-classes.json against reality.
//
// That file is what someone copies to put TJSON on a web page, and it is the
// only part of this repo whose correctness nothing else would notice. A scope
// added to the grammar with no entry here renders as unstyled text on every
// page using it, and the grammar tests would stay green -- the colouring is
// right in an editor, where the theme supplies the mapping.
//
// So: every scope any fixture produces must either resolve to a class or be
// listed as deliberately unstyled. And no entry may be dead, because an entry
// matching nothing is either a typo or a scope that was renamed.

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { tokenizeFile } = require('./tokenize');

const FIXTURES = path.join(__dirname, 'fixtures');
const MAPPING = path.join(__dirname, '..', 'docs', 'scope-classes.json');

function isScope(scope, prefix) {
    return scope === prefix || scope.startsWith(`${prefix}.`);
}

async function emittedScopes() {
    const seen = new Set();
    for (const name of fs.readdirSync(FIXTURES).filter((n) => n.endsWith('.tjson'))) {
        const dump = await tokenizeFile(path.join(FIXTURES, name));
        for (const row of dump.split('\n')) {
            const token = row.match(/^\s+\| \S+\s+"(?:[^"\\]|\\.)*"\s+(.*)$/);
            if (!token || token[1].trim() === '-') {
                continue;
            }
            for (const scope of token[1].trim().split(' ')) {
                seen.add(scope);
            }
        }
    }
    return [...seen].sort();
}

async function main() {
    const mapping = JSON.parse(fs.readFileSync(MAPPING, 'utf8'));
    const classes = mapping.classes;
    const unstyled = mapping.unstyled.prefixes;
    assert.ok(Array.isArray(classes) && classes.length > 0, 'the mapping must list classes');

    const scopes = await emittedScopes();
    const failures = [];
    const used = new Set();

    for (const scope of scopes) {
        const hit = classes.findIndex(([prefix]) => isScope(scope, prefix));
        if (hit >= 0) {
            used.add(hit);
            continue;
        }
        if (unstyled.some((prefix) => isScope(scope, prefix))) {
            continue;
        }
        failures.push(
            `${scope} has no CSS class and is not listed as unstyled — ` +
            `it would render as plain text on any page using this mapping`
        );
    }

    classes.forEach(([prefix, cls], index) => {
        if (!used.has(index)) {
            failures.push(`the entry ${prefix} -> ${cls} matches no scope any fixture produces`);
        }
    });

    // The build-time renderer is the recommended way to put TJSON on a page, so
    // it has to keep working. The property worth asserting is that it leaves no
    // text unclassified: anything falling outside a span renders as body text,
    // which is how a missing mapping entry shows up on a real page.
    const { renderHtml } = await import('../scripts/render-html.mjs');
    for (const name of ['minimal-json.tjson', 'multiline-bold.tjson', 'tables-marked.tjson']) {
        const source = fs.readFileSync(path.join(FIXTURES, name), 'utf8');
        const html = await renderHtml(source);
        const outsideSpans = html.replace(/<span[^>]*>[\s\S]*?<\/span>/g, '');
        if (/\S/.test(outsideSpans)) {
            failures.push(
                `render-html.mjs left text outside every span for ${name}: ` +
                JSON.stringify(outsideSpans.replace(/\s+/g, ' ').slice(0, 60))
            );
        }
        if (!html.includes('<span')) {
            failures.push(`render-html.mjs produced no spans at all for ${name}`);
        }
    }

    console.log(
        `scope map: ${scopes.length} scope(s) emitted, ` +
        `${classes.length} class rule(s), ${failures.length} problem(s)`
    );
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
