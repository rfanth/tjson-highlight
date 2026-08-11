#!/usr/bin/env bash
#
# Rebuild every PNG from icon.svg. The SVG is the source and the only committed
# artifact; every PNG is build output and is gitignored.
#
# Wired as "vscode:prepublish" in package.json, so vsce runs it before building
# the .vsix and the icon can never be missing or stale. That covers VSCodium too:
# ovsx publishes the same .vsix, so the hook fires for both registries.
#
# Tracked, unlike local/, because package.json depends on it -- a clone that
# lacks this script cannot package at all.
#
# This script renders, and does nothing else. Everything lands in build/, which
# is gitignored: icon.svg at the root is the source, build/ is what comes out of
# it. Anywhere else those renders need to end up is a property of one particular
# working machine, not of this repo, so it belongs to a script in local/ that
# calls this one -- not here.
#
# Sizes and where each is used:
#
#   128  icon.png       the extension icon, named in package.json
#   256  icon-256.png   README and general use
#   512  icon-512.png   largest source for anything downstream
#    32  icon-32.png    favicon fallback
#   180  icon-180.png   apple-touch-icon

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${REPO}/icon.svg"
OUT="${REPO}/build"

mkdir -p "${OUT}"

command -v magick >/dev/null || { echo "needs ImageMagick (magick)" >&2; exit 1; }
[[ -f "${SRC}" ]] || { echo "missing ${SRC}" >&2; exit 1; }

# An SVG with a stray '--' inside a comment is not well-formed XML. Browsers let
# it pass, magick does not, and the failure names the comment rather than the
# problem -- so check here where the message can say so plainly.
python3 -c "import xml.dom.minidom,sys; xml.dom.minidom.parse(sys.argv[1])" "${SRC}" \
  || { echo "icon.svg is not well-formed XML (a '--' inside a comment will do it)" >&2; exit 1; }

magick -background none "${SRC}" -resize 128x128 "${OUT}/icon.png"
for size in 32 180 256 512; do
  magick -background none "${SRC}" -resize "${size}x${size}" "${OUT}/icon-${size}.png"
done

# ImageMagick has no librsvg delegate here, so it renders fills and drops strokes
# without a word: a stroked path simply is not in the output. Every line in the
# mark is therefore a filled polygon, and this checks that the marker colour
# actually survived rather than trusting that it did.
# Two traps here, both of which made this check fail while the icon was fine.
# magick prints hex at 16 bits per channel, so the literal "4dd8e6" appears as
# "4D4DD8D8E6E6" and grepping the hex never matches -- hence the srgba() form.
# And `magick ... | grep -q` fails under `set -o pipefail`: grep exits on the
# first match, magick dies of SIGPIPE, and the pipeline reports failure exactly
# when the colour was found. So the histogram is captured first, then searched.
histogram="$(magick "${OUT}/icon.png" -format "%c" histogram:info:)"
if [[ "${histogram}" != *"srgba(77,216,230"* ]]; then
  echo "FAIL: the marker colour #4dd8e6 is missing from icon.png." >&2
  echo "      Something in icon.svg is stroked rather than filled -- magick drops" >&2
  echo "      strokes silently. Outline it and rerun." >&2
  exit 1
fi

cp "${SRC}" "${OUT}/icon.svg"

echo "rebuilt from icon.svg:"
for f in icon.png icon-32.png icon-180.png icon-256.png icon-512.png; do
  printf '  %-16s %6s bytes\n' "${f}" "$(stat -c%s "${OUT}/${f}")"
done
