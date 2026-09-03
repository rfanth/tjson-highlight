#!/usr/bin/env bash
#
# Regenerates the generated fixtures in fixtures/ from their JSON sources by
# running the real tjson CLI. Keeping the fixtures machine-generated means the
# grammar is always tested against output a generator actually emits, not
# against TJSON that a human imagined.
#
# Fixtures NOT listed here are handwritten and are left alone: comments.tjson,
# minimal-json.tjson, marker-gap.tjson, bare-strings-mixed.tjson and
# indent-glyph-array.tjson, each for a construct the generator never emits
# though the format allows it. See the
# README section "Fixtures are generated, not imagined". Run after upgrading tjson-rs, then `npm test` to see what moved.

set -euo pipefail

cd "$(dirname "$0")"

TJSON="${TJSON:-tjson}"

if ! command -v "$TJSON" >/dev/null 2>&1; then
    echo "regen: '$TJSON' not on PATH; set TJSON=/path/to/tjson" >&2
    exit 1
fi

echo "regen: using $("$TJSON" --version)"

# The CLI that writes the fixtures and the parser the extension ships must be the
# same release, or the fixtures encode a format the extension itself rejects.
# That is not hypothetical: a stale 0.7.0 on PATH generated a comma-packed bare
# string array, which v0.5.0 of the specification forbids, and the grammar went on
# highlighting it as valid for as long as nobody reparsed it. vendor/SOURCE.txt is
# the single source of truth for which release is shipped.
VENDOR_SOURCE="../vendor/SOURCE.txt"
EXPECTED="$(sed -n 's/^ *version *//p' "$VENDOR_SOURCE" | head -1)"
ACTUAL="$("$TJSON" --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"

if [ -z "$EXPECTED" ]; then
    echo "regen: could not read the shipped version from $VENDOR_SOURCE" >&2
    exit 1
fi

# A mismatch can still be the right thing to do -- a CLI ahead of the vendored
# release is how a fix reaches the fixtures before it reaches npm -- but it must
# be deliberate, because the failure it guards against is silent. So the
# override is an environment variable and it says so on every run.
if [ "$ACTUAL" != "$EXPECTED" ]; then
    if [ "${TJSON_ALLOW_VERSION_MISMATCH:-}" != "1" ]; then
        echo "regen: version mismatch -- refusing to write fixtures." >&2
        echo "  CLI       $ACTUAL  ($(command -v "$TJSON"))" >&2
        echo "  shipped   $EXPECTED  (per $VENDOR_SOURCE)" >&2
        echo "  Install the matching CLI, or set TJSON=/path/to/tjson." >&2
        echo "  To write fixtures with this CLI anyway, on purpose:" >&2
        echo "    TJSON_ALLOW_VERSION_MISMATCH=1 npm run regen" >&2
        exit 1
    fi

    echo "regen: WRITING FIXTURES WITH $ACTUAL WHILE $EXPECTED IS VENDORED." >&2
    echo "regen: every fixture is checked against the vendored parser below;" >&2
    echo "regen: diff the goldens before committing." >&2
fi

# name<TAB>extra CLI flags
generate() {
    local name="$1"
    shift

    "$TJSON" -i "sources/${name}.json" -o "fixtures/${name}.tjson" "$@"
    echo "  fixtures/${name}.tjson  ($*)"
}

# Same, but the fixture is named separately from its source, so one source can
# be rendered more than one way.
generate_as() {
    local source="$1"
    local name="$2"
    shift 2

    "$TJSON" -i "sources/${source}.json" -o "fixtures/${name}.tjson" "$@"
    echo "  fixtures/${name}.tjson  ($*)"
}

generate inline-packing
generate tables
generate inline-arrays

# Values that are the string spelling of a basic type, so the leading space is
# the only thing telling ' true' from true. The string array here is Type 3,
# because a bare string may contain commas and so cannot be comma packed at all.
generate keyword-lookalikes

# The unmarked half of the bare-strings twin pair. Generated for the same reason
# its --bare-strings marked counterpart below is: the twins test compares the two
# token for token, so if only one of them is regenerated they can drift apart.
generate bare-strings

# Type 3 (double-space separated) packed string arrays, the default shape for
# string arrays since 0.8.0. 'commas' is the case the format exists for: a
# comma inside a bare element, which Type 2 would have to double quote.
generate array-packed-strings

generate folds

# The four things a fold marker can continue, in one document: a number, a bare
# string, a quoted string and a multiline body. A continuation line says nothing
# about which of them it belongs to -- 'looksnumeric' folds to a line that is
# exactly '/ 8', the same shape 'number' folds to two lines above it -- so this
# is the fixture that would catch the grammar guessing again.
generate fold-types            -w 30 --fold fixed --fold-multiline fixed

# A folded quoted key beside a folded quoted string value, which are the same
# shape: '"' at an even column, running on over '/ ' lines, and only the ':'
# after the closing quote tells them apart -- lines later, too late for a
# grammar to go back. The source also puts an object inside an array, which is
# what makes the generator write '[ { ' on its own: that marker settles the key
# behind it, and the sibling key one entry below it stays undecided, so the
# fixture holds both halves of what the marker can and cannot reach. Its indents
# run 2, 4 and 6, which exercises the fold column check at three depths.
generate fold-quoted-key       -w 30 --fold fixed --bare-keys none

# Keys long enough to fold before their colon. The key continues on '/ '
# lines and the colon lands on one of them, so the whole entry spans lines. At
# this width the colon and the value it introduces land on the same
# continuation line.
generate folded-keys           -w 30

# The same source at two more widths, for the shape where the colon ENDS its
# line and the value opens on the continuation below it. That is a rule of its
# own -- '#fold-opening-value' -- because the spacing rule that applies after a
# colon has to apply after the fold marker instead, and what follows decides
# which value it is: gap 0 is a scalar, gap 1 is a bare string.
#
# Two fixtures rather than one, because no single width gives both branches
# from this source. It used to be one, at a width where the release we ship
# produces neither branch the fixture asserted -- the fixture was written from a
# build one version ahead, and the expectations on it would have broken for
# whoever regenerated next.
generate_as folded-keys fold-opening-value       -w 40
generate_as folded-keys fold-opening-value-bare  -w 24
generate multiline-bold        --multiline-style bold
generate multiline-quoted-key  --multiline-style bold
generate fold-quotes           --multiline-style folding-quotes
generate markers               --force-markers -w 60
generate indent-glyphs         --indent-glyph-style fixed -w 40

# Widest inline gap the generator will emit (-k 4 means 8 spaces), against a
# line that also contrasts ' two' with true/null — the one-sided quote sitting
# right next to the scalars it distinguishes.
generate kv-pack               -k 4

# Root-level values. These have no colon to anchor the spacing rule to, so
# they exercise the line-level path — including the mixed array, where a
# string element is followed by ', ' rather than ',  '.
generate root-array-numbers
generate root-array-strings
generate root-string
generate root-empty
generate root-array-mixed

# One source, all three fence forms, and it is the fixture for two faults at
# once.
#
# The marker chain is the first. `--force-markers` writes '[ [ { ' in front of
# the opening glyph, and the closing glyph then has to be found under four
# indent cells. The end test rebuilds that width as a sum of slots, and while
# the unbounded overflow slot sat ahead of the object-marker slot it ate that
# slot's two columns -- atomically, so it could not give them back -- and the
# fence never closed. The multiline swallowed the rest of the document. No
# other fixture puts two array markers and an object marker in front of a
# construct that has to find its own closing line.
#
# The LOCAL EOL INDICATOR is the second. `deep` holds a CRLF string, so its
# glyph carries the literal '\r\n' suffix the specification allows; `plain`
# holds the same shape with LF, so the plain glyph sits beside it in the same
# file and the pair shows the suffix is optional rather than assumed.
#
# The minimal (`) form had no fixture at all before this one.
generate_as multiline-nested multiline-nested-bold         --multiline-style bold        --force-markers
generate_as multiline-nested multiline-nested-minimal      --multiline-style light       --force-markers
generate_as multiline-nested multiline-nested-transparent  --multiline-style transparent --force-markers

# The transparent style only survives when the payload has no line that could
# be mistaken for a closing fence, so it needs its own narrow source.
generate multiline-transparent --multiline-style transparent

# The `_` bare-string marker (`--bare-strings marked`). The specification lets a
# bare string open with `_` instead of its non-data leading space, treats the two
# as interchangeable, and requires no consistency between them within a document
# or even within a line -- so the grammar has to accept either wherever an opener
# can appear. These three cover every rule that scopes one: a keyed value and an
# inline-packed pair, both packed array forms plus an element alone on its line,
# and a table cell.
#
# A fold continuation is deliberately absent. What follows `/ ` there is data, not
# a reopened quote, so an `_` in that position is content and no marker rule
# applies -- `k: aaa bbb` / `/ _ccc` parses as "aaa bbb_ccc".
generate_as bare-strings          bare-strings-marked          --bare-strings marked
generate_as array-packed-strings  array-packed-strings-marked  --bare-strings marked
generate_as tables                tables-marked                --bare-strings marked

# The same table with quoted keys, which is what --bare-keys none writes. A
# header cell and a data cell are spelled the same, so nothing below the first
# row can tell them apart -- the header is row one by definition and `begin`
# reads it. Bare header keys had been separated from data by a heuristic
# (booleans, nulls and numbers matched first, so a leftover identifier could
# only be a header); a quoted one had no such luck and came out a string.
generate_as tables                tables-quoted-keys           --bare-keys none

# The version check above is a proxy for the thing that actually matters: the
# fixtures must be readable by the parser the extension ships. That is what went
# wrong when a stale CLI wrote a comma-packed bare string array -- the format had
# moved on and nothing noticed. Ask the vendored parser directly, so a mismatch
# that does no harm is allowed through and one that does is caught on the spot.
# The same sources wrapped in six more layers of array, so every construct in
# them lands behind a marker chain two cells longer than the grammar can count
# to. The column tests rebuild an opening line's indent from a fixed number of
# width slots, and past that number they fall back to counting in twos -- these
# exist so the fallback is exercised on real documents rather than on lines
# somebody made up. They found two bugs the day they were added: a folded bare
# key behind ANY marker chain matched nothing at all, and a key fragment ending
# in a space was refused although only a whole key may not end in one.
generate deep-folded-keys      -w 44 --fold fixed
generate deep-fold-quoted-key  -w 44 --fold fixed --bare-keys none
generate deep-tables
generate deep-multiline-bold   --multiline-style bold
generate deep-folds            -w 44 --fold fixed

echo "regen: checking every fixture against the vendored parser"
node ./check-fixtures.mjs

echo "regen: done"
