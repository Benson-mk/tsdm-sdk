#!/bin/sh
set -eu
upstream=$1
archive=$2
output=$3
mkdir -p "$output"
TSDM_POSTS_UPSTREAM="$upstream" node scripts/check-installed-posts.mjs "$archive" > "$output/posts-installed.json"
TSDM_REPLIES_UPSTREAM="$upstream" node scripts/check-installed-replies.mjs "$archive" > "$output/replies-installed.json"
TSDM_READ_FIXTURES="$upstream/test/data" TSDM_DISCOVERY_FIXTURES="$upstream/test/data" \
  node scripts/check-installed-sdk.mjs "$archive" > "$output/sdk.json"
node scripts/check-installed-account.mjs "$archive" "$upstream/test/data" > "$output/account.json"
node scripts/check-installed-profile.mjs "$archive" "$upstream/test/data" > "$output/profile.json"
node scripts/check-installed-members.mjs "$archive" > "$output/members.json"
TSDM_COLLECTIONS_UPSTREAM="$upstream" node scripts/check-installed-collections.mjs "$archive" > "$output/collections.json"
TSDM_SPACES_UPSTREAM="$upstream" node scripts/check-installed-spaces.mjs "$archive" > "$output/spaces.json"
node scripts/check-installed-messages.mjs "$archive" > "$output/messages.json"
node scripts/check-installed-notices.mjs "$archive" "$upstream" > "$output/notices.json"
python3 evidence/posts/check-direct-guide.py "$archive" > "$output/posts-direct.json"
python3 evidence/replies/check-direct-guide.py "$archive" > "$output/replies-direct.json"
node_modules/.bin/vite build --config vite.library.config.ts
node evidence/replies/check-historical.mjs > "$output/historical-replies.json"
node evidence/posts/check-historical-drafts.mjs > "$output/historical-drafts.json"
