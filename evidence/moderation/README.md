# SDK #37 qualification

The candidate builds directly on #36 at `9078f9cafb29e962bc79b6010d597dd7edf76dff`. The SHA-256 of `tsdm-sdk-0.1.0.tgz` is `30e11df946bb32eaa9b577f6beefb2356d36b65de6a0865e45fc4cb82d880790`.

- [Installed SDK receipt](0.1.0-installed.json) records 67 observation groups. It exercises each supported individual and grouped thread action, stamp and icon, copy, merge and split, repair, bounty removal and refund, reply moderation, comment and rating removal, private poster IP, attachment deletion, and destination types. It also checks exact form scope, selected fields, refusal, session replacement, response loss, and legacy results. The packaged TypeScript example compiles without ambient host types and runs from the clean installed package.
- [Direct HTTP receipt](0.1.0-direct.json) records 76 comparisons through the packed Python `requests` and curl blocks. They compare read and write methods, exact queries and encoded controls, approvals and blocked previews, session-cookie behavior, and raw redirect preservation on inert loopback.
- [Combined receipt](0.1.0-regressions.json) records 40 passing suites on the same archive and identifies #36’s 35-operation inventory replay for each of the three consumers. The runner retains the individual receipts in its output directory.

[Source and fixture hashes](pins.json) pin the moderation and post-comment source, the relevant regression sources, and representative schema 17, schema 13 and AJAX captures from `Carinoasd/tsdm_client` at `02df67e39ded906def5b868e8f8311ba735b316c`. The test scripts use independently written counterpart forms and results with fictional moderators, participants, board and record IDs, and a documentation-range IP address. They compare the exact requests and outcomes under those responses. No deployed forum or real moderator account participated. Actual moderator grants, private data, financial or thread effects, and persistence require separate deployment observations.

## Replay

Use Node 26.x, npm with locked dependencies available, Python 3 with `requests`, curl, OpenSSL and the pinned upstream tree. Put `UPSTREAM` and `OUTPUT` on local paths. HTTP checks bind disposable loopback listeners.

```sh
npm ci --offline
npm run pack:sdk
archive=dist/tsdm-sdk-0.1.0.tgz
shasum -a 256 "$archive"
sh evidence/moderation/check-candidate.sh "$UPSTREAM" "$archive" "$OUTPUT"
```

Installed red probes reached the missing public export, individual and batch forms, reply and financial windows, private and immediate effects, receipt classification, the missing packaged guide, split validation and cross-session destination preflight. The final receipt records the corrected behavior.

## Structured-thread compatibility replay (#46)

Use Node.js 26.x and the locked build dependencies (`npm ci --offline` when
cached). Build a local archive and replay it through a clean offline install:

```sh
npm_config_cache="$PWD/dist/npm-cache" npm run pack:sdk
node scripts/check-installed-moderation.mjs dist/tsdm-sdk-0.1.0.tgz > dist/issue-46-installed.json
```

The schema 23 poster-IP case preserves only the permission and target shape
from `Carinoasd/tsdm_client` commit `56a3f5ffe6dbd3e959b907ac4074b5d2feceabb0`,
`test/data/tsdmapp_390/thread_viewip.json` (SHA-256
`32bddf762b1228ed67ed221279fb89874d0f4b56b58857f464461f5bdd8ce476`).
All identifiers and response data are fictional. The original capture is not
needed. The suite checks the returned address in memory, omits administrator
links, and redacts the address from the JSON receipt.

Before the fix, schema 21 passed but schema 23 stopped before the offered
lookup. The receipt binds the expected and observed requests and results to
the installed archive's digest. It also verifies operation-specific grants,
one approved repair or deletion per form, and refusal without dispatch for
inadequate authority, session changes, or mismatched targets. The transport
is in-process; this replay needs no credentials and never contacts the forum.
