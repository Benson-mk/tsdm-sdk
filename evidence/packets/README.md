# SDK #33 qualification

The candidate builds directly on #32 at `8faa1c1563e058ae0dd43b09f00081f6dfa475ec`. The SHA-256 of `tsdm-sdk-0.1.0.tgz` is `5237a29e8eb947c26a69dc136ca959859516b8b1f778c4502a7c4ce29ad966f7`.

- [Installed SDK receipt](0.1.0-installed.json) records 37 observation groups, including the packaged TypeScript example.
- [Direct guide receipt](0.1.0-direct.json) records 26 observations from the packaged Python and curl examples.
- [Combined receipt](0.1.0-regressions.json) records 32 passing suites, including both #33 suites and #32's 42 installed and 28 direct HTTP observation groups. The runner retains individual receipts in the specified output directory.

The runner installs the archive offline in a clean external Node 26 project and checks its lockfile integrity. It verifies the README and packaged guide links, then compiles and runs the packaged TypeScript without ambient types. The direct check executes packaged Python `requests` and curl helpers against a disposable loopback listener. Both record independent expected and observed request and result evidence, with fictional account credentials.

[Fixture pins](pins.json) identify `Carinoasd/tsdm_client` v1.59.0 at `02df67e39ded906def5b868e8f8311ba735b316c`. The runner hashes originals under the supplied tree. It replays thread envelopes, selected named packet states, claim and withdrawal handlers and records, the native packet marker, and the homepage's literal daily configuration. Legacy plugin responses use the pinned captured shapes from regression 025. Some target/status envelopes, missing offers, login responses, subsequent reads, and transport failures are controlled variations. The award table, supplied link and award pages are synthetic based on the pinned Dart parser and outcome handling. The award action in those fixtures does not establish a deployment route. No deployed forum requests or account changes were made. Actual credit movement, award behaviour and server permission remain unobserved.

## Replay

Use Node 26.x, npm with the locked dependencies available, Python 3 with `requests`, curl, OpenSSL and the pinned upstream tree. Set `UPSTREAM` to that tree and `OUTPUT` to an empty directory. The HTTP checks bind disposable loopback listeners.

```sh
npm ci --offline
npm run pack:sdk
archive=dist/tsdm-sdk-0.1.0.tgz
shasum -a 256 "$archive"
sh evidence/packets/check-candidate.sh "$UPSTREAM" "$archive" "$OUTPUT"
```

Installed red probes reached the missing root export, missing thread packet operations, missing daily and award operations, missing packaged guide, and the daily login response incorrectly interpreted as an old claim. The public replay observes the corrected outcomes.

## Trade-offs

- The client reuses the member-bound text transport and marks effectful requests explicitly, including the supplied award GET. Approval is private to its client and login, consumed at dispatch. Cross-tab coordination, fresh transport, and durable recovery remain with the host.
- Thread inspection trusts the returned permission and the exact validated structured control. Legacy claims need a same-session native marker, form hash, and separate open status. That can cost one native page read plus one plugin read. Legacy withdrawal remains unavailable without an offered control. The password enters only the final body and is omitted from the public result.
- The structured and raw packet paths qualify different reply formats. Success, duplicate, refusal, redrawn form and unknown each have their own result. The plugin's amount or refund is included when qualified. Independent open or record reads can establish current status or ownership while attribution and ledger movement can remain unknown.
- Records preserve raw epoch seconds or native wall-clock strings, with missing IDs and partial coverage explicit. A permission refusal ends the read. A missing structured implementation can cost one retry on the read-only legacy endpoint.
- The daily operation reads a structured homepage or literal native configuration. It makes no login-credit or PM check and executes no scripts. The forum's day marker scopes the offer, but disappearance is only unavailability. A duplicate relies on the daily plugin's explicit response.
- Award details and the supplied claim URL are separate paths. The SDK qualifies the URL by origin, plugin and thread and sends its actual query once. An explicit native claim message can establish an acknowledgement. A generic response establishes arrival, and a redirect or lost response leaves the effect unknown. A fresh detail read remains available. The curl helper expects the operator to review the query and place the plugin ID first.
