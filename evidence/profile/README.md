# SDK #17 profile, privacy, devices and sync verification

The [installed consumer receipt](installed.json) records 54 expected and observed results through the public `tsdm-sdk` import or the avatar uploader handoff. It includes the actual request sequence checked for each scenario. The [direct HTTP receipt](direct.json) checks the packaged Python and curl helpers on loopback. Both receipts identify `tsdm-sdk@0.1.0` candidate `ea6ccd10ec61ba38bcd8bbb450e2563c95cf820d3aa8524c92e21e1b77b69bdb` by SHA-256. These are controlled observations using fictitious accounts, values, URLs and session material. Production behavior and uploader completion require deployment observations.

## Replay

Use Node.js 26.x and npm, Python 3 with `requests`, and curl. Set `TSDM_PROFILE_FIXTURES` to `test/data` of the [`Carinoasd/tsdm_client` v1.59.0 source at `02df67e39ded906def5b868e8f8311ba735b316c`](https://github.com/Carinoasd/tsdm_client/tree/02df67e39ded906def5b868e8f8311ba735b316c). Preserve the neighboring `test/regression` directory. The runner checks the original [input digests](../../tests/install/profile-pins.json) before deriving the responses. The upstream tree supplies schema 17 profile forms, native profile and privacy controls, avatar editor markup, privacy and blacklist v4 pages, schema 20 device results, and the regression 283 sync control. The replay substitutes fictitious member IDs, session material and other account-specific data. It authors the missing write outcomes, malformed and conflicting responses, and host behavior. The upstream fixture files stay in the upstream checkout.

```sh
export TSDM_PROFILE_FIXTURES=/absolute/path/to/pinned-tsdm_client/test/data
npm ci
npm run pack:sdk
shasum -a 256 dist/tsdm-sdk-0.1.0.tgz
node scripts/check-installed-profile.mjs dist/tsdm-sdk-0.1.0.tgz "$TSDM_PROFILE_FIXTURES" > /tmp/sdk17-installed.json
python3 evidence/profile/check-direct-guide.py dist/tsdm-sdk-0.1.0.tgz > /tmp/sdk17-direct.json
```

The installed runner creates a clean directory, installs the local archive offline, checks npm lock integrity and loads the package root. It compiles the packaged TypeScript example under strict NodeNext with `ES2023`, no DOM or ambient types, and executes the compiled example. Pass `devices`, `sync`, `editors`, `avatar`, or `blacklist` as a third argument for one scenario group. The direct checker extracts both languages’ examples from the tarball. Each exercises an authenticated read, a multipart signature POST whose redirect remains unfollowed, and a URL-encoded device registration POST with its device header.

## Acceptance criteria

| Criterion | Controlled observation |
| --- | --- |
| Read and change profile, signature, avatar and privacy settings, and look up and change the site blacklist | Structured and native profile, separate signature tab and submission, old and new avatar URL, offered uploader handoff, privacy base/feed/other/filter, structured and native blacklist operations. The receipt captures returned controls, exact actions, payload fields, redirects, refusals, stale-session rejection and readbacks. |
| Verify device and sync operations independently under the intended account | List, register, revoke and remove have separate assertions for UID, operation and device identity. The sync controls check populated and empty reads, a conditional upload, conflict and size responses, wrong accounts and a replaced session. Lost or ambiguous responses never trigger a second write. |
| Link SDK and direct guidance with prerequisites, effects and results | The packaged README links to [the guide](../../docs/profile.md), which links back to the task list and to packaged account sign-in instructions. TypeScript, Python and curl were exercised from the archive. |
| Retain independently repeatable evidence | The receipts include archive identity, fixture pins, per-operation expectations, outcomes and request traces, or the loopback request matrix. The existing clean SDK install with board/thread and discovery fixtures, account/security install, and immutable historical consumer replay also passed. |
