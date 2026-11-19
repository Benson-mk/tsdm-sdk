#!/bin/sh
set -eu
upstream=$1
archive=$2
output=$3
mkdir -p "$output"
node evidence/trades/fixture-pins.mjs "$upstream"
node scripts/check-installed-trades.mjs "$archive" > "$output/trades-installed.json"
python3 evidence/trades/check-direct-guide.py "$archive" > "$output/trades-direct.json"
TSDM_MEDIA_UPSTREAM="$upstream" node scripts/check-installed-media.mjs "$archive" > "$output/media-installed.json"
python3 evidence/media/check-direct-guide.py "$archive" > "$output/media-direct.json"
sh evidence/special-threads/check-candidate.sh "$upstream" "$archive" "$output"
python3 evidence/trades/summarize.py "$archive" "$output" > "$output/regressions.json"
