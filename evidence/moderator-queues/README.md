# SDK #38 qualification

The candidate builds directly on #37 at `dfdaf112b595fb7c262e83efe30e0a31278b3023`. The SHA-256 of `tsdm-sdk-0.1.0.tgz` is `2954f182716a9f69868e72b15b07c837f1139c2a88fbe45f94029ac465f963ae`.

- [Installed receipt](0.1.0-installed.json) compares 41 expected and observed groups. It covers panel login and dashboard, thread and post search and continuation, selected post deletion, all three queue decisions in each queue family, report listing and handling, the administrator deletion handoff, and search, restore and permanent deletion in both bins. It includes no-send checks, wrong forum and table scope, expiry, refusals, lost and redrawn replies, and a partial effect.
- [Direct HTTP receipt](0.1.0-direct.json) compares 87 observations across the packaged Python `requests` and curl examples. The listener observes exact scoped form fields and appropriate cookie and token separation. The panel deletion check dispatches nothing. The separate administrator fixtures read the selected report and independently exercise approved deletion, refusal and response loss. All accounts and targets are fictional.
- [Combined receipt](0.1.0-combined.json) verifies the same archive through #37's installed and direct suites, the Pokémon route reconciliation and inherited regressions. The runner keeps the individual receipts in the chosen output directory.

[Source and fixture pins](pins.json) verify 41 files from `Carinoasd/tsdm_client` v1.59.0 at `02df67e39ded906def5b868e8f8311ba735b316c`. The test data is authored from their request and response shapes with fictional subjects, identities and sessions. Tests import the candidate by package name after an offline clean Node 26 install, verify lockfile integrity, and compile and run the packaged TypeScript example with no DOM or ambient types. Installed red probes reached the missing public factory, search, report, queue, bin and administrator-handoff methods. Additional reds caught incomplete bin coverage, an unidentified post table and internal declaration dependencies.

## Replay

Use Node 26.x, npm with the locked dependencies available, Python 3 with `requests`, curl, OpenSSL and the pinned upstream tree. Use an empty output directory. The HTTP replays use disposable loopback listeners.

```sh
npm ci --offline
npm run pack:sdk
archive=dist/tsdm-sdk-0.1.0.tgz
shasum -a 256 "$archive"
sh evidence/moderator-queues/check-candidate.sh "$UPSTREAM" "$archive" "$OUTPUT"
```

## Trade-offs and limits

- The client shares the existing host session and transport contracts and binds returned permissions and forms to one client and login. Single-use submission handles protect against repeating a consumed action. Callers need a new page after a submission. They own coordination with other clients sharing server-stored search results.
- Dashboard, search and moderator report reads use their pinned structured schemas. Queue and bin reads discover v4 availability and can use native forms. The extra discovery read preserves the native path, and missing form evidence can make an action unavailable while the view still renders. Unlinked author IDs remain unknown.
- Login confirmation rereads the dashboard after a candidate redirect. Queue and report verdicts distinguish acknowledgement from observed effects. Registration and bin outcomes can require extra reads. Incomplete scope or missing acknowledgement can leave a real effect uncertain. Scoped disappearance does not attribute concurrent changes or independently prove where a restored item landed.
- A moderator can handle one report per submission to keep refusal and optional rewards attributable. Administrator report deletion uses a credential-free handoff and a separate administrator session, selection and approval. The administrator login and general administrator API are owned by SDK #40. Direct examples leave parsing and reconciliation to the caller.
- Tests use an inert host and loopback responses. Deployment availability, real permissions, actual deletion and restoration, and persisted effects remain unobserved.
