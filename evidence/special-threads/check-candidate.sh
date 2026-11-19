#!/bin/sh
set -eu
upstream=$1
archive=$2
output=$3
mkdir -p "$output"
TSDM_SPECIAL_UPSTREAM="$upstream" node scripts/check-installed-special.mjs "$archive" > "$output/special-installed.json"
python3 evidence/special-threads/check-direct-guide.py "$archive" > "$output/special-direct.json"
TSDM_ACTIVITY_UPSTREAM="$upstream" node scripts/check-installed-activity.mjs "$archive" > "$output/activity-installed.json"
python3 evidence/activity/check-direct-guide.py "$archive" > "$output/activity-direct.json"
sh evidence/posts/check-candidate.sh "$upstream" "$archive" "$output"
