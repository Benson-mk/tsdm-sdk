# SDK #26 qualification

The combined candidate includes #24 at `a2729bf834416c9b619922b501e3ae461a8f8b37`. `tsdm-sdk-0.1.0.tgz` has SHA-256 `278abafbae7c513c194b9c32f739657eda5e9d0a8d789bc6be936f82263e0889`.

- [Installed SDK receipt](0.1.0-installed.json) records 53 checks against 31 hash-verified upstream inputs and synthetic variations. The packaged TypeScript example compiled and ran a read and a cancelled evaluation.
- [Direct HTTP receipt](0.1.0-direct.json) records 17 Python `requests` and curl checks, including a zero-request check without curl approval.
- [Combined regression receipt](0.1.0-regressions.json) records 14 passing suites, including #24 and #23 installed and direct HTTP checks, the existing SDK package suite and the historical bundle checks.

The package consumer uses `tsdm-sdk` from a clean external Node 26 install. It checks the tarball against the consumer lockfile and verifies the README task link, packaged guide and TypeScript declarations without DOM types. Each check records its expected and actual observations. Recorded and synthetic responses exercise the SDK with no forum requests. The direct guide check extracts the Python and curl blocks from the package and traces their methods, routes, cookies and form data on an inert loopback server.

[Fixture pins](pins.json) identify the original files under `test/data` in `Carinoasd/tsdm_client` v1.59.0, commit `02df67e39ded906def5b868e8f8311ba735b316c`. The fixture bodies remain in the upstream tree. The consumer uses unchanged responses where their account and target match and supplies synthetic thread permissions and form or receipt variants for the other journeys. It aligns the standalone rate receipt with its recorded form's account and thread, aligns the score-item form to the recorded comment receipt, and substitutes the fixture session's placeholder hash in the historical rate dialog. These transformations appear in the consumer. The direct guide uses fictional IDs, tokens, cookie and form choices. These checks establish SDK behavior and host destinations against the supplied evidence. Deployment availability, account effects and browser completion remain unobserved.

## Replay

Use Node 26.x, npm with the locked build dependencies available, Python 3 with `requests`, curl and the upstream source tree at the fixture pin. The direct check binds a disposable listener on `127.0.0.1`.

```sh
# Set UPSTREAM to the pinned tsdm_client checkout and use a writable npm cache.
npm ci --offline
npm run pack:sdk
archive=dist/tsdm-sdk-0.1.0.tgz
shasum -a 256 "$archive"
TSDM_ACTIVITY_UPSTREAM="$UPSTREAM" node scripts/check-installed-activity.mjs "$archive"
python3 evidence/activity/check-direct-guide.py "$archive"
TSDM_READ_FIXTURES="$UPSTREAM/test/data" TSDM_DISCOVERY_FIXTURES="$UPSTREAM/test/data" \
  node scripts/check-installed-sdk.mjs "$archive"
TSDM_REPLIES_UPSTREAM="$UPSTREAM" node scripts/check-installed-replies.mjs "$archive"
# Reproduce the broader combined regressions in a writable output directory.
sh evidence/posts/check-candidate.sh "$UPSTREAM" "$archive" "$OUTPUT"
```

The first install of the preimplementation package failed at the public `createActivityClient` import. With the read client installed, the first write probe failed at `prepareActivity`. A later installed probe showed that a schema 13 page carrying a valid native rate callback was left unknown. The final replay includes that case.

## Trade-offs

- A separate activity client keeps the existing read-only client and its transport small. Callers supply session continuity and a transport that treats an evaluation GET as an effect.
- Prepared actions stay private to the client, are bound to one session and are consumed on dispatch. This prevents replay of a prepared action and keeps form hashes out of caller records. Approval across tabs, retries after independent investigation and recovery across runs belong to the host.
- Structured list schemas retain totals, visibility and pagination. Native parsing recognizes the observed list windows and preserves what they establish. Native views can expose less metadata, and an unrecognized window remains incomplete after at most one fallback.
- Preparation reads the target thread for current permissions before opening a form. Exact post and hash checks add a request and can send users to the native forum when a deployment serves unfamiliar controls. Known small forms and validated native forms preserve the caller's approved inputs.
- The forum's `subtract` route records a negative evaluation. The API exposes `subtract` so callers can present that effect explicitly.
- Acknowledgements use operation-specific receipts. A redrawn form, qualified handoff and lost response remain distinct. The SDK leaves an ambiguous effect unknown and does not infer attribution from later ledger rows or counters.
- The activity suite uses recorded bodies and inert host or loopback traces. These make refusals and lost responses repeatable while leaving deployed behavior and actual effects for release qualification.
