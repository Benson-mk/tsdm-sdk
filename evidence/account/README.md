# SDK #16 account verification

The [installed consumer receipt](installed.json) covers the public `tsdm-sdk` import in a fresh Node.js 26 project and the transport or browser handoff for each assigned operation. The [direct HTTP receipt](direct.json) covers the packaged requests and curl examples on a loopback-only fixture server. Both receipts identify the same candidate archive by SHA-256. These are controlled observations. Deployment observations for account operations were outside this run.

## Reproduce

Use Node.js 26.x, npm, Python 3 with `requests`, and curl. Set `TSDM_ACCOUNT_FIXTURES` to the `test/data` directory of `Carinoasd/tsdm_client` v1.59.0, commit `02df67e39ded906def5b868e8f8311ba735b316c`. The installed replay checks each upstream input against its [fixture digest](../../tests/install/account-pins.json). It replaces the historic login form tokens and origin in memory. The other controlled inputs include the upstream account fixtures, variants derived for the email and question verification flows, and synthetic examples for responses or transport failures missing from the pinned files.

```sh
export TSDM_ACCOUNT_FIXTURES=/absolute/path/to/pinned-tsdm_client/test/data
npm ci --offline --ignore-scripts
npm run pack:sdk
node scripts/check-installed-account.mjs dist/tsdm-sdk-0.1.0.tgz "$TSDM_ACCOUNT_FIXTURES" > /tmp/account-installed.json
python3 evidence/account/check-direct-guide.py dist/tsdm-sdk-0.1.0.tgz > /tmp/account-direct.json
TSDM_READ_FIXTURES="$TSDM_ACCOUNT_FIXTURES" TSDM_DISCOVERY_FIXTURES="$TSDM_ACCOUNT_FIXTURES" \
  node scripts/check-installed-sdk.mjs dist/tsdm-sdk-0.1.0.tgz > /tmp/account-get-regression.json
```

`npm ci --offline` uses a cache populated with the locked build dependencies. Both installed checks create their own clean consumer and install the local archive offline. The direct checker binds to `127.0.0.1`, checks method, route, body, and jar continuity, and verifies that a redirect response produces one request. The installed replay asserts fresh requests, effect flags, encoded fields, session continuity, exact request counts, and expected results. The receipts contain digests and reduced observations. The fixture bodies, submitted data, jar contents, and form tokens stay out of the receipts.

## #42 stored-device status

The same installed runner records the `stored-device` observations. It checks the pinned successful status against the saved member and asserts one header-bearing GET on the original continuity. Authored controls exercise matching HTTP 200 and 403 revocations, mismatched member or device, a guest response, a busy response, service unavailability, a redirect, a session switch and invalid input with zero dispatch. The control checks the request's header and the result without needing a deployed saved login. The pre-implementation tarball fails at the missing `readStoredDeviceStatus` method.

## Acceptance criteria

| Criterion                                                                                                                 | Verification                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Status, feature switches, login form and submission, verification image, identity, logout, registration and lost password | Member and guest status, advertised switches and lists, rate limit and native identity fallback. Form GET, deliberate POST, returned member identity, refusal, lost response and single-use form. Same-session image handoff, browser login challenge, registration and lost-password destinations. Deliberate logout GET and independent guest readback, wrong member, already guest, lost reply and unchanged session. |
| Separate verification and submission of password, email and security-question changes                                     | The initial requests use GET. A deliberate current-password POST opens the signed form for the selected change. Each method checks confirmed forum report, refusal, other-check handoff, lost response with one dispatch, and ambiguous effect. Additional cases reject foreign signed destinations, an unobscured password control, a different UID and a replaced session.                                             |
| Linked SDK and direct HTTP guidance                                                                                       | The packed task link and backlink resolve. The packaged TypeScript example compiles under strict NodeNext with no DOM types and runs against a controlled host. The requests and curl helpers run through 23 fixture exchanges each. The guide identifies prerequisites, effects, and observable outcomes.                                                                                                               |
| Repeatable controlled evidence                                                                                            | The receipts retain the archive hash, runtime versions, fixture hashes, and expected and observed results. The same candidate passed the installed legacy thread, #14 board and thread, and #15 discovery regression controls.                                                                                                                                                                                           |
