# SDK 0.1.0 ticket #20 qualification

Recorded on November 19, 2026 on integration base `1ae086f6c739569e70a49776093300f0b7f612cc`. The candidate archive is `tsdm-sdk-0.1.0.tgz`, 149,395 bytes with SHA-256 `1ebf45aab13230549a8516627ddfe48f41bfa1fe3a7185bfdd7b7a90576df828`. The archive was installed in an empty project with Node 26.0.0 and npm 11.12.1. The checks compare the installed lockfile integrity with the tarball and the packaged guide with its repository source. TypeScript 6.0.3 checks the public declarations under strict NodeNext and ES2023 without DOM types.

The [installed receipt](0.1.0-installed.json) records the expected operations, observed results and host request traces. The [direct receipt](0.1.0-direct.json) records 28 loopback requests and two confirmation declines through the exact Python and curl examples extracted from the candidate. The [regression receipt](0.1.0-regressions.json) records archive and input hashes, current installed regressions and a separate historical replay.

| #20 acceptance | Verification |
| --- | --- |
| Distinct private and broadcast lists and detail, chat and recent dialogs, and homepage check | The controlled host serves one-to-one, omitted-group, closed, paginated, empty, native, refused and unknown cases. It checks exact `pmlist`, list handoff, `view`, `viewg`, both `showmsg` routes, homepage discovery and the deliberate `checknewpm` GET. A synthetic script response supplies no confirmed credit amount. |
| Send from dialog and history, and clear the PM prompt independently | The host checks the exact bodies and recipient bindings for both forms, the schema 13 and native XML outcomes, native `maxlength`, flood refusal, continuity drift, and a dropped send with exactly one POST. A later recent-message read issues a GET. The PM clear sends `formhash` and `pm=1`. The separate installed #19 regression verifies notice-only `seen`, its server-time bound and uncertain clearing. |
| Discover the task and direct use from the package | The installed README links the [message guide](../../docs/messages.md). The runner compiles and executes the TypeScript example from the archive. The loopback check uses the archived Python requests and curl examples. |
| Repeatable evidence and provenance | The checked-in synthetic inputs, source hashes, installed and direct receipts identify the exact candidate and expected/observed results. The checks use controlled transports and a loopback server. No forum communications or deployed effects were observed for #20. |

## Repeat the candidate checks

Use Node 26.0.0, npm 11.12.1, Python 3 with `requests` and curl. Set `UPSTREAM` to the checkout at the commit in [upstream-pins.json](upstream-pins.json). Use your npm cache containing the locked dependencies for offline installation. The direct-guide runner needs permission to bind loopback.

```sh
npm ci --offline --ignore-scripts
npm_config_cache="$(mktemp -d)" npm run pack:sdk
archive=dist/tsdm-sdk-0.1.0.tgz
shasum -a 256 "$archive"
TSDM_MEMBERS_UPSTREAM="$UPSTREAM" node scripts/check-installed-messages.mjs "$archive"
python3 evidence/messages/check-direct-guide.py "$archive"
TSDM_READ_FIXTURES="$UPSTREAM/test/data" TSDM_DISCOVERY_FIXTURES="$UPSTREAM/test/data" npm run test:install
node scripts/check-installed-account.mjs "$archive" "$UPSTREAM/test/data"
node scripts/check-installed-profile.mjs "$archive" "$UPSTREAM/test/data"
TSDM_MEMBERS_UPSTREAM="$UPSTREAM" node scripts/check-installed-members.mjs "$archive"
node scripts/check-installed-notices.mjs "$archive" "$UPSTREAM"
```

The SDK replay inputs are in [the installed consumer](../../tests/install/messages.mjs). The loopback inputs are in [the guide runner](check-direct-guide.py). They use an authored fake session, destination, member IDs and message text. The [upstream source and fixture hashes](upstream-pins.json) pin behavior references from `Carinoasd/tsdm_client` v1.59.0. The installed consumer uses synthetic analogues for the PM history pages, X5 XML dialog, positive and disabled broadcast responses, and schema 13 PM handlers. No upstream private messages or captured session material were copied into these inputs. Regressions #018, #185, #210, #211, #220 and #1003 inform the route and result checks.

The installed checks first failed on the missing public client, then on the missing detail, dialog and acknowledgement methods as each slice was added. The legacy form case failed on the named submit button until the historical layout was covered. A later destination check failed when a success callback for a different peer was accepted. The final installed run passes each of these cases.

## #42 native lists

The installed `nativeLists` case verifies deliberate opening of the two filters with a scoped member session, exact paging, native row decoding and an empty broadcast page. It checks zero dispatch when confirmation is declined, `effect: true` on the private GET, and effect uncertainty after loss, an unresolved page or session replacement. It also checks a different viewer and a different active broadcast filter. Set `TSDM_MEMBERS_UPSTREAM` to enable `pinnedPrivateList`, which hashes and replays the pinned X5 private list from the checkout. Broadcast markup is authored from the pinned Dart regressions. The archive before implementation failed at each missing native opener. An intermediate archive reproduced the missing GET effect flag.

## Previous private-writing regression

The retained `@tsdm/forum-client` 0.26.0 replay reran its private-writing cases on Node 26.0.0. The [historical manifest and receipt](../history/consumer-2026-11-14T13-08-40.303Z/manifest.json) identify the archived input. The old runtime consumer reproduced its seven private-writing observations, including single-use approval and independent readback. These describe the historical package. SDK 0.1.0 qualifies a separate API with host-owned recovery and its own controlled read after a dropped response.

```sh
source_dir="$PWD/evidence/history/consumer-2026-11-14T13-08-40.303Z"
replay=$(mktemp -d)
cp "$source_dir/consume.mjs" "$replay/"
cd "$replay"
printf '%s\n' '{"private":true,"type":"module"}' >package.json
npm install --offline --ignore-scripts --no-audit --no-fund --cache "$replay/cache" \
  "$source_dir/tsdm-forum-client-0.26.0.tgz"
node consume.mjs >observed.json
node -e 'const a=require("node:assert/strict");a.deepEqual(require("./observed.json").privateWritingCases,require(process.argv[1]).observed.privateWritingCases)' "$source_dir/receipt.json"
```
