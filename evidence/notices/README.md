# SDK #19 unread notices evidence

The [installed receipt](installed.json) and [direct HTTP receipt](direct.json) cover `tsdm-sdk` 0.1.0 on Node.js 26.0.0 with archive SHA-256 `ed3d6d73128e478dce3a0a35cdf2e146e6cc67fa4b2d4a8e44c0f82672f0c1cf`. The installed replay uses an isolated npm cache and checks the dependency-free package lock against the tarball's SHA-512 integrity. Each recorded case compares expected and observed outcomes, including request traces for dispatch and host handoffs.

## Reproduce

Use Node.js 26.x, npm, the locked SDK build dependencies, and Python 3 with `requests`, Bash, curl and jq. Obtain the original files from Carinoasd/tsdm_client v1.59.0 at `02df67e39ded906def5b868e8f8311ba735b316c`. The [upstream pins](upstream-pins.json) verify the actual input bytes before any replay. The installed test projects only member ID, times, unread rows, count and cursors from the two archived `notify` pages. It supplies synthetic message content, credentials and effect responses. Native categories and ignore forms use synthetic controls shaped by the pinned markup and Dart code. The original upstream files remain in the upstream checkout with their license. [Pinned upstream source](https://github.com/Carinoasd/tsdm_client/tree/02df67e39ded906def5b868e8f8311ba735b316c)

```sh
UPSTREAM=/absolute/path/to/pinned-tsdm_client
ARCHIVE=dist/tsdm-sdk-0.1.0.tgz
npm ci
npm run pack:sdk
shasum -a 256 "$ARCHIVE"
node scripts/check-installed-notices.mjs "$ARCHIVE" "$UPSTREAM" > /tmp/sdk19-installed.json
python3 evidence/notices/check-direct-guide.py "$ARCHIVE" > /tmp/sdk19-direct.json
TSDM_READ_FIXTURES="$UPSTREAM/test/data" TSDM_DISCOVERY_FIXTURES="$UPSTREAM/test/data" \
  node scripts/check-installed-sdk.mjs "$ARCHIVE" > /tmp/sdk19-regression-read.json
node scripts/check-installed-account.mjs "$ARCHIVE" "$UPSTREAM/test/data" > /tmp/sdk19-regression-account.json
node scripts/check-installed-profile.mjs "$ARCHIVE" "$UPSTREAM/test/data" > /tmp/sdk19-regression-profile.json
TSDM_MEMBERS_UPSTREAM="$UPSTREAM" \
  node scripts/check-installed-members.mjs "$ARCHIVE" > /tmp/sdk19-regression-members.json
```

## Checked criteria

| Criterion | Controlled observation |
| --- | --- |
| Inclusive polling, partial coverage and account exhaustion | The pinned two-page window returns 26771, 26769 and 26767, with a forum count of 221 and unproven account exhaustion. A 429 on continuation keeps those IDs and the incoming lower bound, with no acknowledgement. The controls separately cover a first-page 429, same-second paging with duplicate IDs, stuck and rewound cursors, explicit last page, legacy list evidence, page budget and continuity changes. |
| Deliberate acknowledgement | The installed SDK posts once with the first page's forum time and synthetic hash, omitting `pm`. The controls cover explicit confirmation, a newer or re-flagged notice, an unknown effect after lost or ambiguous dispatch, account drift and a fresh scan followed by one deliberately chosen retry. |
| Native pages, ignore rules and destinations | The host sees the warning before dispatch. Independent cases open the inbox, each native category, read history and its second page, then cover lost or unreadable native responses. Post handoffs preserve the supplied same-origin destination. Ignore cases cover rule and form reads, author and everybody additions, removal with unrelated checked filters preserved, refusal and uncertainty, and both native forms as handoffs. |
| Packed guidance | All five task guide links resolve in the installed package. The notice guide's TypeScript sample compiles without DOM types and runs both ways from the installed guide. The packed Python and curl snippets each pass seven loopback cases. The package's declarations also type-check without any ambient types in the shared consumer. |
| Repeatable operation evidence | The receipts record 68 installed cases plus the guide outputs, and 14 direct HTTP cases. They are controlled transport, archived fixture projections and loopback observations. Deployment effects for these member actions remain unobserved. |

The inherited public board/thread, discovery, account, profile and member installed checks passed against this archive using the pinned fixture inputs.
