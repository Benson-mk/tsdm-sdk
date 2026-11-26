# SDK #25 qualification record

The November 19, 2026 run built `tsdm-sdk@0.1.0` on integrated #26 at `8b0b839720477d508b5096736755aa174289d3b7`. The candidate tarball SHA-256 is `0b13b5b3c98f7c1f3c32b25a2233d46f26fb6cf93303020373130f77539595a9`.

- [Installed receipt](0.1.0-installed.json) records 33 scenarios and 63 host requests. It verifies clean offline installation, lockfile integrity, links in the packaged guide, strict TypeScript declarations without DOM or ambient types, and execution of the TypeScript example. Each creation has a matching structured readback. Participation checks distinguish both debate GETs, both activity POSTs, poll and bounty effects, and the browser-only debate-join destination. The other cases cover incompatible controls, funding limits, moderation, duplicate votes, wrong targets, refusal, lost responses and session changes. The approved and unapproved TypeScript examples exercise the host’s effect flag.
- [Direct receipt](0.1.0-direct.json) records 24 executions of the Python requests and curl snippets extracted from the same archive. The loopback server verified the read and reviewed dispatch for each of the five creations and six participation effects, as well as the read-only path without approval. The direct examples capture server acknowledgements. The SDK creation checks separately inspect the stored special block and post.
- [Combined regressions](0.1.0-regressions.json) records 18 passing suites and their receipt hashes, including #26 activity, #24 posts, #23 replies, the existing installed package and feature suites, and the historical writing consumer checks on a separately built historical bundle.

The [source pins](pins.json) identify 29 files verified at upstream `Carinoasd/tsdm_client` v1.59.0, commit `02df67e39ded906def5b868e8f8311ba735b316c`. The fixtures recreate the pinned protocol with fictitious members, content, URLs, amounts and tokens. The first installed probe failed at the missing `createSpecialThreadClient` export. Follow-up probes covered each new operation and exposed the missing write and target checks before implementation. The final receipts establish controlled SDK, host and direct HTTP behavior. Browser completion, live privileges, publication and balance changes remain unobserved.

## Replay

Use Node.js 26, locked build dependencies, npm, Python 3 with `requests`, curl, jq and the pinned upstream checkout. The direct examples bind temporary listeners on `127.0.0.1`. Use a writable npm cache if necessary.

```sh
# Set UPSTREAM to the pinned checkout and OUT to a writable directory for receipts.
npm ci --offline
npm run pack:sdk
archive=dist/tsdm-sdk-0.1.0.tgz
shasum -a 256 "$archive"
sh evidence/special-threads/check-candidate.sh "$UPSTREAM" "$archive" "$OUT"
```

## Participation compatibility replay (#47)

With Node.js 26 and the locked build dependencies installed (`npm ci --offline`
when cached), run from the repository root:

```sh
npm_config_cache="$PWD/dist/npm-cache" npm run pack:sdk
node scripts/check-installed-special.mjs dist/tsdm-sdk-0.1.0.tgz > dist/issue-47-installed.json
```

The runner installs the archive in a temporary consumer using offline npm.
The schema 23 replay uses the same fictional poll and form as the schema 15
control, changing only the thread envelope version. The runner needs no
credentials, upstream checkout, network access, or live participation.
The JSON receipt records the archive and replay digests, expected and observed
results, and every request's method, destination and effect flag.

Before the fix the schema 23 poll returned `browser-handoff` rather than an
`action-form`. Both versions now send one POST for an allowed selection and
still require a matching account, result target and poll acknowledgement.
Wrong or missing identity, mismatched board or thread, absent or ineligible
offers, and invalid forms send no effects. A lost or mismatched result remains
`uncertain` after one dispatch. Reusing the submitted form cannot send again.
The replay verifies the SDK's acknowledgement handling, not stored votes or
other live forum state.

An otherwise eligible schema 23 offer does not open a form if `login: 1` or
`message_key: "to_login"` is present. Either marker in an otherwise matching
result is a refusal after one dispatch; the submitted form remains consumed.
