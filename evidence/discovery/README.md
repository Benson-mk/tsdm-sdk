# SDK #15 discovery qualification

The [installed receipt](0.1.0-installed.json) covers the 0.1.0 candidate at the recorded archive digest. The [direct HTTP receipt](0.1.0-direct.json) covers the same archive. Both use controlled responses. These runs establish request construction, decoding, paging, and handoff destinations. The live deployment has its own settings and permission checks. The discovery run did not exercise that deployment or send posts, change authentication, or edit drafts.

## Reproduce

Use Node.js 26.x with npm and obtain `test/data` from `Carinoasd/tsdm_client` v1.59.0 at `02df67e39ded906def5b868e8f8311ba735b316c`. The [fixture pins](../../tests/install/discovery-pins.json) identify the original bytes. The upstream files remain in the upstream checkout. The replay also uses small, authored controls for cases listed below. The installed consumer checks the lockfile integrity against the input archive and checks TypeScript declarations with `ES2023`, `NodeNext` and no DOM or ambient types.

```sh
export TSDM_DISCOVERY_FIXTURES=/absolute/path/to/pinned-tsdm_client/test/data
export TSDM_READ_FIXTURES="$TSDM_DISCOVERY_FIXTURES"
npm ci
npm run pack:sdk
node scripts/check-installed-sdk.mjs dist/tsdm-sdk-0.1.0.tgz > /tmp/sdk15-installed.json
shasum -a 256 dist/tsdm-sdk-0.1.0.tgz
```

For the direct examples, use Python 3 with `requests` and `beautifulsoup4`, Bash and curl. The script reads the guide from the archive, serves pinned responses on loopback and runs the packaged examples.

```sh
python3 evidence/discovery/check-direct-guide.py \
  dist/tsdm-sdk-0.1.0.tgz "$TSDM_DISCOVERY_FIXTURES" > /tmp/sdk15-direct.json
```

## Expected and observed results

| Expected | Observed |
| --- | --- |
| All seven guide views preserve view, rows and paging. The index exposes supplied module destinations. | The index returned four module links. `hot` returned five rows, `digest` returned zero, and `new`, `newthread`, `sofa` and `my` returned 50 each. `my&type=reply` produced exact PID 4719. The native `new` page preserved the supplied thread URL and next link. A guest personal guide returned `login`. |
| Search preparation hands off the native form. The initial deliberate GET establishes identity. Later pages stay in that result and use no new search criteria. | The form returned a same-origin handoff. Search ID `1` had 211 matches and page 2 started with TID `9199821`. The native filtered search preserved the highlight query and search ID `4`. Tests observed zero matches, throttle, expiry, a previous-page link, and rejection of mismatched identity, order and foreign continuation. |
| Member activity preserves viewer, owner, board filter, post identities and draft scope. | The viewer was UID `35` for owner UID `31`. The other-member reply retained PID `3925` and four hidden rows. FID `10` survived pagination. The saved list had draft TID `9199982` and an empty second page. Native replies and an older JSON document preserved PID `1250`, including the fragment. A wrong owner was rejected. An unsupported draft layout returned a handoff. |
| Member and thread rankings retain ranks, values and destinations. | The member views returned the first member IDs `31`, `31` and `35`. The thread heats ranks remained `1`, `2`, `4` in order. Both controlled thread rank variants preserved the supplied `from=rank` link. A closed view returned `permission`. |
| Tag cloud, tag preview, and full tagged thread pages preserve supplied destinations. | The cloud had 14 tags. Tag `2` supplied a full-list URL. Tag `15` had 20 rows on page 1 and five on page 2, whose first TID was `1134` and whose pager linked back to page 1. |
| Overview, board statistics, a board daily log, team, moderation, member list and trend expose the forum statistics. The statistics chart fetch uses the supplied destination. | The daily log exposed its table dates and month links. The member list preserved the page-2 link. The supplied trend XML yielded 30 labels and five series. The first series started at 14 and ended at 27. Guest and privileged refusals, a foreign XML destination, and incomplete XML were distinguished. |
| The packaged task index and guide resolve, type-check and run. The HTTP examples are repeatable. | The install checked the three links and ran the guide’s TypeScript example from the installed artifact. Python and curl exercised submission and page 2 independently and matched response bodies for eight other reads on loopback. The #14 controlled board/thread replay passed against the same candidate. |

The installed tests cover the boundary through public `tsdm-sdk` methods and the supplied host transport. The initial red runs failed on missing methods for the guide, search, member activity, rankings, tags and statistics. The documentation red failed on the missing task index link. Later reds exposed a missing search previous-page link and missing native member decoding. All passed after implementation.

The upstream search snapshots normalize `searchid` to `1`. The fixture for an empty search uses its original shape with an authored keyword. The other-member reply fixture is itself derived upstream. The controlled inputs cover an expired and throttled search, redirect scope drift, a board-filtered member listing, legacy member layouts based on upstream regression 235, thread view/favorite rankings with no standalone captures, a tag detail for the packaged example and incomplete trend XML. The tag `15` paging fixtures come from a different capture than the cloud. No fixture bytes are redistributed in this ticket.
