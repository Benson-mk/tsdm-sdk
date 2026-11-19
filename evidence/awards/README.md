# SDK #31 qualification

The candidate builds directly on #30 at `0c004cc5aafe3e91ee885872a77a2e1f1967f7c5`. The SHA-256 of `tsdm-sdk-0.1.0.tgz` is `987a1953089715659233aaf3ccdc99d1a008280165f2b9b4168ac3bcf0733848`.

- [Installed SDK receipt](0.1.0-installed.json) records 34 observation groups, including the packaged TypeScript example.
- [Direct guide receipt](0.1.0-direct.json) records 46 observations from the packaged Python and curl examples.
- [Combined receipt](0.1.0-regressions.json) records 28 passing suites, including both #31 suites and #30's 45 installed and 39 direct HTTP observation groups. The runner retains the individual receipts in the specified output directory.

The installed consumer uses a clean external Node 26 project and a fresh offline npm cache. It checks package lockfile integrity, the README and packaged guide links, and compiles and runs the guide's TypeScript with no ambient types. The direct HTTP check replays the packaged Python `requests` and curl examples against disposable loopback HTTP. Both checks record expected and actual responses and request behavior. They use an inert host and make zero deployed forum requests or account changes.

[Fixture pins](pins.json) identify the pinned `Carinoasd/tsdm_client` v1.59.0 source at `02df67e39ded906def5b868e8f8311ba735b316c`. The runner hashes the original inputs in the supplied tree. It replays the achievement and background responses, native medal catalogues and application windows, claim response, and representative title legacy envelopes. The upstream available native application form and success message were built from the plugin templates. Its background write messages are spec-shaped. The catalogue, gift, title shop, exchange and issue payloads use controlled cases based on the pinned regression builders. The legacy `newapply` form, readback, errors, transport loss and redirects are synthetic. The shell examples send a fictional cookie to the disposable listener. Deployment permissions, actual changes to credits, and actual grants and revocations remain unobserved.

## Replay

Use Node 26.x, npm with the locked dependencies available, Python 3 with `requests`, curl and OpenSSL. The direct guide and prior regressions bind local listeners. Set `UPSTREAM` to the pinned source tree and `OUTPUT` to an empty directory.

```sh
npm ci --offline
npm run pack:sdk
archive=dist/tsdm-sdk-0.1.0.tgz
shasum -a 256 "$archive"
sh evidence/awards/check-candidate.sh "$UPSTREAM" "$archive" "$OUTPUT"
```

The installed red probes reached the missing public factory, missing preparation, unobserved title wear, missing native medal view, and missing packaged guide. The replay exercises those behaviors through the exported client and transport.

## Trade-offs

- One client exposes a typed catalogue and action vocabulary with immutable records that retain the forum's field names and operation-specific fields. Callers interpret the relevant fields for each view. Paths for reads and action forms are validated separately and hidden controls remain private.
- The client reuses the member-bound text transport. A private client/session-bound approval is consumed once before dispatch. Hosts supply credentials, approval, fresh requests, redirect provenance and durable or cross-tab coordination.
- The catalogue returns one result page per read and checks returned identity and echoed scope when provided. Native medal fallback uses one read, preserves search/category in the URL, and can have less definite pagination or filtering metadata. Legacy title shop, owned-title, achievement and other unsupported layouts use same-origin handoffs. Present the native page for actions that lack supported controls.
- Native medal acquisition distinguishes a review-page GET, a reviewed claim POST and a deliberate legacy acquisition GET. It recognizes returned fields or hands off unsupported form layouts. The SDK treats attendance-related medal claims as medal acquisition, independent of daily check-in.
- Gift and issue preparation enforce the visible per-operation permissions, limits and selection, while ownership and thread lookups remain explicit reads. The host reviews candidate recipients and applies the intended selection. The remote forum can still reject or partially apply a batch after the visible snapshot.
- Wear or removal uses one same-session readback page after an acknowledgement. Absence on an incomplete page cannot confirm removal. Other positive messages establish acknowledgement; callers can reread the affected catalogue or records for independent observation. No retries follow unknown outcomes.
- Background grants accept an offered file or an HTTPS image URL as form data and omit notify when declined. The SDK never fetches the image through the account transport. Reported recipient counts distinguish refusal, partial and acknowledged outcomes, without assigning a specific successful UID from the count alone.
