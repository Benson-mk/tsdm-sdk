#!/bin/sh
set -eu
upstream=$1
archive=$2
output=$3
base=${4:-$(git rev-parse HEAD)}
git merge-base --is-ancestor "$base" HEAD
mkdir -p "$output"
sh evidence/pokemon/check-candidate.sh "$upstream" "$archive" "$output"
TSDM_POKEMON_UPSTREAM="$upstream" node scripts/check-installed-pokemon-battles.mjs "$archive" > "$output/pokemon-battles-installed.json"
python3 evidence/pokemon-battles/check-direct-guide.py "$archive" > "$output/pokemon-battles-direct.json"
python3 evidence/pokemon-battles/check-inventory.py "$archive" "$output" "$base" > "$output/pokemon-battles-combined.json"
