#!/usr/bin/env bash
#
# Regenerates the generated fixtures in fixtures/ from their JSON sources by
# running the real tjson CLI. Keeping the fixtures machine-generated means the
# grammar is always tested against output a generator actually emits, not
# against TJSON that a human imagined.
#
# Fixtures NOT listed here are handwritten (see fixtures/README) and are left
# alone. Run after upgrading tjson-rs, then `npm test` to see what moved.

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

if [ "$ACTUAL" != "$EXPECTED" ]; then
    echo "regen: version mismatch -- refusing to write fixtures." >&2
    echo "  CLI       $ACTUAL  ($(command -v "$TJSON"))" >&2
    echo "  shipped   $EXPECTED  (per $VENDOR_SOURCE)" >&2
    echo "  Install the matching CLI, or set TJSON=/path/to/tjson." >&2
    exit 1
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

# Keys long enough to fold before their colon. The key continues on '/ '
# lines and the colon lands on one of them, so the whole entry spans lines.
generate folded-keys           -w 30
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

echo "regen: done"
