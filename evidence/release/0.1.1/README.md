# tsdm-sdk 0.1.1 qualification

The qualified candidate is `tsdm-sdk-0.1.1.tgz`, 425402 bytes, SHA-256 `ea0ac88159aada24d2756a4c13c85aed2d736902013b221f6fb1e7be9093ddbf`. The bytes downloaded from the [preview workflow](https://github.com/Benson-mk/tsdm-sdk/actions/runs/45954420040) matched its `release.json` manifest and `install.json` receipt. The preview built commit `c30bc91cdd57e0c9911b956677071084356e6f14` on Ubuntu 24.04 with Node.js 26.13.1, npm 11.20.0 and TypeScript 6.0.3. The qualification record is not a package input; any tagged build must reproduce the archive checksum.

## Revalidated against this archive

| Expected behavior | Observed result |
| --- | --- |
| Clean install, public ESM import and declaration check | The hosted check passed, and a local fresh consumer repeated it on Node.js 26.0.0 and npm 11.12.1. The lockfile integrity matched the archive. The declarations passed strict NodeNext checking with ES2023 and no DOM or ambient types. The installed terms, notices, structured board/thread reads and discovery guide checks passed. |
| Changed paid-thread, moderation, special-thread and editor paths | The installed trade, moderation, special-thread and post suites passed with controlled responses. They covered newer structured responses, fail-closed identity and permission checks, and exact-source verification with a same-session editor read when needed. |
| Adjacent paths affected by shared parsing or used as regression controls | The installed activity, tasks, replies, spaces, members, batch ratings, bank, moderator queues and moderator settings suites passed. The installed activity and board/thread/discovery checks used the pinned fixtures below. |
| Live signed-out board → thread | The example extracted from the installed README read board `17` and opened thread `1271851` returned by that board on `www.tsdm39.com`. Both GETs returned HTTP 200 with a guest viewer and the thread contained 10 posts. [Guest read receipt](guest-read.json) |

The proxied live attempt received a verification challenge and stopped; the documented direct command passed without credentials. The controlled suites verify SDK behavior against supplied responses, not live purchases, moderation, voting, posting or any other authenticated operation.

## Carried forward from 0.1.0

The [0.1.0 qualification](../0.1.0/README.md) and its [inventory](../0.1.0/inventory-1-3.md) [matrices](../0.1.0/inventory-4-7.md) remain the last full baseline. For inventory operations outside the checks above, carry forward only unchanged paths: for example, standalone account/session and notice operations, administrator-only actions outside the changed moderation permission path, and standalone plugins such as Pokémon and awards. The source changes are confined to structured-thread decoding, its trade, moderation, participation and editor consumers, and the equivalent shared login check used by activity. This record does not represent a fresh run of the full baseline or its direct Python and curl guide replays.

## Reproduce

Run from the SDK checkout at the release source with its locked development dependencies installed (`npm ci --ignore-scripts --no-audit --no-fund`). Use Node.js 26.x, npm, GitHub CLI, `jq`, and `shasum`. Set `UPSTREAM` to the absolute checkout path of `Carinoasd/tsdm_client` at `02df67e39ded906def5b868e8f8311ba735b316c` (v1.59.0). Download the preview artifact while retained; after publication the immutable release provides the tarball and manifest. The suites use controlled inputs and disposable consumers. The guest check needs signed-out HTTPS access.

```sh
set -eu
OUT=$(mktemp -d)
gh run download 45954420040 --repo Benson-mk/tsdm-sdk \
  --name sdk-45954420040-1 --dir "$OUT"
archive="$OUT/tsdm-sdk-0.1.1.tgz"
digest=$(shasum -a 256 "$archive" | cut -d ' ' -f 1)
test "$digest" = ea0ac88159aada24d2756a4c13c85aed2d736902013b221f6fb1e7be9093ddbf
test "$digest" = "$(jq -r .sha256 "$OUT/release.json")"

test "$(git -C "$UPSTREAM" rev-parse HEAD)" = 02df67e39ded906def5b868e8f8311ba735b316c
TSDM_READ_FIXTURES="$UPSTREAM/test/data" TSDM_DISCOVERY_FIXTURES="$UPSTREAM/test/data" \
  node scripts/check-installed-sdk.mjs "$archive" > "$OUT/install-qualified.json"
export TSDM_ACTIVITY_UPSTREAM="$UPSTREAM"
for suite in trades moderation special posts activity tasks replies spaces members \
  batch-ratings bank moderator-queues moderator-settings; do
  node "scripts/check-installed-$suite.mjs" "$archive" > "$OUT/$suite.json"
  jq -e --arg digest "$digest" '.archiveSHA256 == $digest' "$OUT/$suite.json" > /dev/null
done

mkdir "$OUT/guest"
(
  cd "$OUT/guest"
  printf '%s\n' '{"private":true,"type":"module"}' > package.json
  npm install --offline --ignore-scripts --engine-strict --no-audit --no-fund \
    --cache "$OUT/guest-cache" "$archive"
  awk '/^## Read a public board and open a thread$/{section=1} section && /^```ts$/{example=1; next} example && /^```$/{exit} example' \
    node_modules/tsdm-sdk/README.md > check-live-guest.ts
  node check-live-guest.ts https://www.tsdm39.com 17 > "$OUT/guest-read.json"
)
```

The current board listing and selected thread can differ on replay. Compare the guest viewers, status codes and the link between the listing and opened thread, not the transient thread ID.
