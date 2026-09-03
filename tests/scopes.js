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
const { tokenizeFile, tokenizeText } = require('./tokenize');

const FIXTURES = path.join(__dirname, 'fixtures');
const MAPPING = path.join(__dirname, '..', 'docs', 'scope-classes.json');
const REJECTIONS = path.join(__dirname, 'rejections.json');

function isScope(scope, prefix) {
    return scope === prefix || scope.startsWith(`${prefix}.`);
}

// The fixtures are all valid by construction, so a scope the grammar only ever
// puts on broken input -- `invalid.*` -- would never appear here and would look
// like a dead entry. The rejection corpus is where broken input lives, and its
// scopes get rendered like any other, so it is surveyed too.
async function emittedScopes() {
    const seen = new Set();
    const sources = fs
        .readdirSync(FIXTURES)
        .filter((n) => n.endsWith('.tjson'))
        .map((name) => () => tokenizeFile(path.join(FIXTURES, name)));

    for (const check of JSON.parse(fs.readFileSync(REJECTIONS, 'utf8'))) {
        sources.push(() => tokenizeText(check.line + '\n'));
    }

    for (const dumpOf of sources) {
        const dump = await dumpOf();
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

// The mapping is only half of what someone copies. The other half is the
// stylesheet, and it lives in two more places: the renderer in
// scripts/render-html.mjs, and the block in docs/web-highlighting.md that a
// reader is told to copy. A class present in the mapping and absent from either
// renders as unstyled text on every page using it -- the same failure this file
// catches one level up, one level further out.
//
// Not hypothetical: `tjson-invalid` was added to the mapping and to the
// renderer and never reached the document.
function checkStylesheets(classes) {
    const wanted = new Set(classes.map(([, cls]) => cls));
    const problems = [];

    for (const file of ['scripts/render-html.mjs', 'docs/web-highlighting.md']) {
        const text = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
        const defined = new Set(
            [...text.matchAll(/^\.(tjson-[a-z-]+)\s*\{/gm)].map((m) => m[1])
        );

        for (const cls of wanted) {
            if (!defined.has(cls)) {
                problems.push(`${file} does not style ${cls}, which the mapping produces`);
            }
        }
        for (const cls of defined) {
            if (!wanted.has(cls)) {
                problems.push(`${file} styles ${cls}, which no scope maps to`);
            }
        }
    }

    return problems;
}

// The README carries a theme snippet someone pastes into settings.json, one
// entry per scope. A scope missing from it is unthemed for everyone who used
// it -- the same failure as an unstyled class, one file further out, and it had
// happened four times over: the three `invalid.*` faults and the EOL indicator.
//
// The EOL indicator is the instructive one. Theme scopes match segment by
// segment, so a rule for `constant.character.escape.tjson` does NOT reach
// `constant.character.escape.eol-indicator.tjson` -- the fourth segment differs.
// Inheriting is not a way out; each scope needs its own entry.
function checkThemeList(scopes) {
    const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
    const listed = new Set(
        [...readme.matchAll(/"scope":\s*"([^"]+)"/g)].map((m) => m[1])
    );
    const problems = [];

    for (const scope of scopes) {
        // meta.* names a region rather than a token; nothing themes one.
        if (scope.startsWith('meta.')) {
            continue;
        }
        if (!listed.has(`${scope}.tjson`)) {
            problems.push(`README.md does not theme ${scope}.tjson, which the grammar emits`);
        }
    }
    for (const scope of listed) {
        if (!scopes.includes(scope.replace(/\.tjson$/, ''))) {
            problems.push(`README.md themes ${scope}, which no fixture or rejection produces`);
        }
    }

    return problems;
}

// The nano syntax file cites the grammar scope each of its colour rules stands
// in for. Those citations are how someone keeps the two in step, and they had
// drifted: two named scopes that no longer exist, and -- worse -- the same
// twelve-character hole in its bare-key class that the grammar itself once had,
// left behind when the grammar was fixed and this file was not.
//
// A citation is only checkable for existence, not for correctness. That is
// still worth having: a renamed scope goes stale silently otherwise.
function checkNanoCitations(scopes) {
    const nano = fs.readFileSync(
        path.join(__dirname, '..', 'editors', 'nano', 'tjson.nanorc'), 'utf8'
    );
    const cited = new Set(
        [...nano.matchAll(/([a-z][a-z0-9._-]*\.tjson)\b/g)].map((m) => m[1])
    );
    const known = new Set(scopes.map((s) => `${s}.tjson`));

    return [...cited]
        .filter((c) => !known.has(c))
        .map((c) => `editors/nano/tjson.nanorc cites ${c}, which the grammar does not emit`);
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

    const styleProblems = checkStylesheets(classes);
    for (const problem of styleProblems) {
        console.log('');
        console.log(`FAIL  ${problem}`);
    }
    console.log(
        `stylesheets: ${new Set(classes.map((c) => c[1])).size} class(es), ` +
        `${styleProblems.length} problem(s) across the renderer and the document`
    );
    const themeProblems = checkThemeList(scopes);
    for (const problem of themeProblems) {
        console.log('');
        console.log(`FAIL  ${problem}`);
    }
    console.log(
        `theme list: ${scopes.filter((s) => !s.startsWith('meta.')).length} themable scope(s), ` +
        `${themeProblems.length} problem(s) in README.md`
    );

    const nanoProblems = checkNanoCitations(scopes);
    for (const problem of nanoProblems) {
        console.log('');
        console.log(`FAIL  ${problem}`);
    }
    console.log(`nano citations: ${nanoProblems.length} problem(s) in editors/nano/tjson.nanorc`);

    failures.push(...styleProblems, ...themeProblems, ...nanoProblems);
    if (failures.length > 0) {
        process.exitCode = 1;
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
