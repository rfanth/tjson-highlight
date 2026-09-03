// classFor, on its own.
//
// It is the whole of how a scope becomes a colour on a web page, and the only
// part of the renderer whose correctness nothing else would notice: get it
// wrong and every page still renders, just with the wrong things coloured.
// scopes.js checks that the MAPPING is complete -- every scope the grammar
// emits resolves to something -- and says nothing about how the walk resolves
// it. These are the cases where the walk itself has a decision to make.

import assert from 'assert';
import { classFor } from '../scripts/render-html.mjs';

const ROOT = 'source.tjson';
let checks = 0;

function check(what, scopes, expected) {
    checks += 1;
    const actual = classFor(scopes);
    assert.strictEqual(
        actual,
        expected,
        `${what}\n  scopes   ${JSON.stringify(scopes)}\n  expected ${expected}\n  actual   ${actual}`
    );
}

// The innermost scope is the most specific thing known about the text, so the
// walk runs inward-out and takes the first hit.
check(
    'the innermost scope wins over the regions around it',
    [ROOT, 'meta.object.entry.tjson', 'entity.other.attribute-name.bare.tjson'],
    'tjson-key'
);

// The reason the walk stops rather than skipping. An indent inside an open
// quoted string carries the string's scope, because scopes only accumulate --
// so reaching past the indent finds string.quoted.double and paints whitespace
// that is not the string's data.
check(
    'an unstyled scope ends the walk instead of being skipped',
    [ROOT, 'string.quoted.double.tjson', 'punctuation.whitespace.indent.tjson'],
    null
);
check(
    'and the same for a fold marker inside a folded string',
    [ROOT, 'meta.object.entry.tjson', 'string.quoted.double.tjson', 'punctuation.whitespace.indent.tjson'],
    null
);

// meta.* marks a region rather than a token; colouring it would paint whole
// lines.
check('a region scope alone is not a colour', [ROOT, 'meta.multiline.tjson'], null);

// The three places where the ORDER of the mapping decides the answer. Each of
// these scopes matches two entries by prefix, and the earlier one must win.
check(
    'a bare string opener beats the generic string punctuation',
    [ROOT, 'punctuation.definition.string.begin.bare.tjson'],
    'tjson-bare'
);
check(
    'a multiline margin beats the generic string punctuation',
    [ROOT, 'punctuation.definition.string.multiline-margin.tjson'],
    'tjson-multiline'
);
check(
    'a table pipe beats the generic separator',
    [ROOT, 'punctuation.separator.table.tjson'],
    'tjson-pipe'
);

// A scope nothing knows about is not an answer; keep walking outward.
check(
    'an unrecognised innermost scope falls through to the region around it',
    [ROOT, 'string.quoted.double.tjson', 'some.scope.nobody.mapped'],
    'tjson-string'
);

// The root scope is on every token and means nothing on its own.
check('the root scope alone is not a colour', [ROOT], null);
check('and neither is nothing at all', [], null);

// invalid.* is last in the mapping but must still beat the region it sits in.
check(
    'a fault beats the construct it was found in',
    [ROOT, 'meta.table.tjson', 'invalid.illegal.table-row-column.tjson'],
    'tjson-invalid'
);

console.log(`classFor: ${checks}/${checks} case(s) pass`);
