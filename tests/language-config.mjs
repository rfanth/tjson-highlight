// The editor behaviours that are not the grammar's, and are not covered by
// anything else here.
//
// A TextMate grammar cannot change a document -- it only labels spans. Two
// other files can, and both were reported as changing text unasked:
//
//   language-configuration.json  autoClosingPairs, indentationRules,
//                                onEnterRules, folding
//   package.json                 contributes.configurationDefaults
//
// Neither had a test. These assert the claims the comments in those files
// make, on the exact lines they are about.

import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// language-configuration.json is JSONC: VS Code allows comments there, and the
// file uses them heavily.
function readJsonc(file) {
    const text = fs.readFileSync(file, 'utf8');
    const stripped = text.replace(
        /"(?:[^"\\]|\\.)*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
        (m) => (m.startsWith('"') ? m : '')
    );
    return JSON.parse(stripped);
}

const config = readJsonc(path.join(HERE, '..', 'language-configuration.json'));
const pkg = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'package.json'), 'utf8'));

let checks = 0;
const check = (what, condition) => {
    checks += 1;
    assert.ok(condition, what);
};

// --- Nothing may auto-close.
//
// TJSON has no closing token for either bracket. `[ ` and `{ ` at the head of a
// line are cells of the indent, and that is much the commonest reason to type
// one, so an inserted `]` has to be deleted every time. A backtick is worse
// still: pairing it turns ` `` ` into a different multiline style rather than a
// closed pair.
//
// The empty list has to be PRESENT, not absent. The editor reads
// `autoClosingPairs ? … : brackets ? …` -- leave it out and it derives the
// pairs from `brackets`, which is exactly the two that were reported closing
// themselves.
// The list must be NON-EMPTY, and that is the whole point. The editor's
// validator builds its result with `let n;` and only assigns when it pushes a
// pair, so an empty array comes back as undefined -- indistinguishable from the
// field being absent. The consumer then reads
// `autoClosingPairs ? … : brackets ? …` and derives the pairs from `brackets`,
// which is why `[` and `{` closed themselves while `"` did not.
check('autoClosingPairs is declared', Array.isArray(config.autoClosingPairs));
check(
    'autoClosingPairs is NOT empty -- an empty array is read as absent and falls back to brackets',
    config.autoClosingPairs.length > 0
);

// ...and every pair in it must be unable to fire. A FORBIDDEN CHARACTER cannot
// appear in a TJSON document in any form and cannot be typed.
const FORBIDDEN = /^[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+$/;
for (const pair of config.autoClosingPairs) {
    const open = Array.isArray(pair) ? pair[0] : pair.open;
    check(
        `an auto-closing pair must be untypable, got ${JSON.stringify(open)}`,
        FORBIDDEN.test(open)
    );
}

check('brackets are still declared, for jump-to-bracket', config.brackets.length === 2);

// surroundingPairs only ever wraps a SELECTION; with nothing selected it is not
// consulted, so it cannot be what inserts a closing bracket as you type. It
// must stay present all the same: the editor reads
// `surroundingPairs || autoClosingPairs`, so leaving it out would fall back to
// the sentinel and surrounding would stop working.
check('surroundingPairs is declared', Array.isArray(config.surroundingPairs));
check('and can still wrap a selection in quotes', config.surroundingPairs.some(p => p[0] === '"'));

const defaults = pkg.contributes.configurationDefaults['[tjson]'];
check('auto-closing brackets are off at the settings layer too', defaults['editor.autoClosingBrackets'] === 'never');
check('auto-closing quotes are off at the settings layer too', defaults['editor.autoClosingQuotes'] === 'never');

// The indentation rules are written for a two-space format and are wrong at any
// other tab size, so the pin matters as much as the rules do.
check('tab size is pinned to 2', defaults['editor.tabSize'] === 2);
check('indentation is not detected from the file', defaults['editor.detectIndentation'] === false);

// --- The indentation rules, on the lines they are about.
const rule = (name) => {
    const value = config.indentationRules[name];
    const source = typeof value === 'string' ? value : value.pattern;
    const flags = typeof value === 'string' ? '' : (value.flags || '');
    return new RegExp(source, flags);
};

const increase = rule('increaseIndentPattern');
const decrease = rule('decreaseIndentPattern');
const ignore = rule('unIndentedLinePattern');

// A key alone on its line opens a container; the next line is one level in.
for (const line of ['  key:', '  "quoted key":', '  [ { key:', 'root:', '  \u4f55\u3067\u3082:']) {
    check(`a key alone on its line increases indent: ${JSON.stringify(line)}`, increase.test(line));
}
// A key with a value on the line does not.
for (const line of ['  key: value', '  key:1', '  k:  1, 2', '  key: ``']) {
    check(`a key with its value does not: ${JSON.stringify(line)}`, !increase.test(line));
}
// And neither does a line that only looks like one. The pattern used to be
// written as a negation -- "not one of the things that cannot start a key" --
// which indented after every one of these, none of which is a key.
for (const line of ['  _key:', '  .key:', '  -key:', '  +key:', '  / a fold continuation:']) {
    check(`not a key, so no indent: ${JSON.stringify(line)}`, !increase.test(line));
}

// --- onEnterRules: the one shape that opens a block without a trailing colon.
const enter = (index) => {
    const value = config.onEnterRules[index].beforeText;
    const source = typeof value === 'string' ? value : value.pattern;
    const flags = typeof value === 'string' ? '' : (value.flags || '');
    return new RegExp(source, flags);
};
check('there is exactly one onEnterRule', config.onEnterRules.length === 1);
const minimalFence = enter(0);

// A MINIMAL multiline's body is at the opening line's n+2 and cannot move.
for (const line of ['  k: `', '  k: `\\n', '  "q": `\\r\\n', 'k: `']) {
    check(`a keyed minimal fence indents: ${JSON.stringify(line)}`, minimalFence.test(line));
}

// An UNKEYED fence is excluded, and this is the case that matters: a closing
// glyph is spelled exactly like an unkeyed opening one, so a rule that fires on
// it indents after the end of every minimal multiline.
for (const line of [' `', '   `', '        `']) {
    check(`an unkeyed fence is left alone, opening or closing: ${JSON.stringify(line)}`, !minimalFence.test(line));
}

// Marker cells are excluded too: indentAction shifts from leading WHITESPACE,
// and a marker is two columns that are not whitespace.
check('a fence behind markers is left alone', !minimalFence.test('  [ [ { k: `'));

// The other two fence forms choose their own body column.
for (const line of ['  k: ``', '  k: ```', '  k: ``\\n', '  k: ```\\r\\n']) {
    check(`a bold or transparent fence does not: ${JSON.stringify(line)}`, !minimalFence.test(line));
}

// The rule for an opening indent glyph was REMOVED, measured rather than
// argued: across the fixtures and the external corpus the line after an
// opening glyph moves left or stays put 18 times out of 21, and the rule
// shifted it right. Nothing here may indent after one.
for (const line of ['  k: /<', '[  /<', '  [ [  /<']) {
    check(`an opening glyph gets no rule: ${JSON.stringify(line)}`, !minimalFence.test(line) && !increase.test(line));
}

// Nothing decreases, deliberately. The rule that used to live here outdented by
// one level after a closing glyph -- measured across the fixtures and the
// external corpus, the real change is -38, -19, -5, -3, -3 and 0, never -2 --
// and the same rule re-indented the line as it was typed, which is what made a
// closing glyph impossible to push off its column.
for (const line of ['     />', '   />', '  key: value', '     /<', '']) {
    check(`nothing decreases indent: ${JSON.stringify(line)}`, !decrease.test(line));
}

// --- The editor may not move text the writer is typing.
//
// It re-indents a line when typing makes it START matching decreaseIndentPattern:
// !shouldDecrease(before) && shouldDecrease(after). With a pattern that never
// matches, that condition can never be met, so nothing a writer types is ever
// pushed back.
for (const before of ['   />', '    />', '     />', '  k: v', '']) {
    for (const typed of [' ', '/', '>', 'x']) {
        const after = before + typed;
        check(
            `typing cannot trigger a re-indent: ${JSON.stringify(before)} + ${JSON.stringify(typed)}`,
            !(!decrease.test(before) && decrease.test(after))
        );
    }
}

console.log(`language config: ${checks}/${checks} check(s) pass`);
