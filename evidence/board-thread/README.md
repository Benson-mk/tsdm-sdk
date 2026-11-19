# SDK #14 board and thread verification

The controlled replay installs the `tsdm-sdk` 0.1.0 tarball in a new Node.js 26 consumer and calls only the public ESM entry. The test contains the expected values. Its receipt records the resulting archive identity, exact fixture hashes, returned values and GET or handoff trace. Dispatch logs record representation selection without retaining the selector value.

## Reproduce the controlled runs

Use Node.js 26.x and npm with the SDK build dependencies installed. Obtain the `test/data` directory from the `Carinoasd/tsdm_client` repository at `02df67e39ded906def5b868e8f8311ba735b316c` (v1.59.0). Keep the pinned files intact. The replay checks their SHA-256 values against [the fixture pins](../../tests/install/board-thread-pins.json). The legacy JSON fixture already distributed with the SDK install tests has [upstream attribution](../../tests/install/fixtures/LICENSE).

```sh
export TSDM_READ_FIXTURES=/absolute/path/to/pinned-tsdm_client/test/data
npm ci
npm run pack:sdk
node scripts/check-installed-sdk.mjs dist/tsdm-sdk-0.1.0.tgz > /tmp/sdk14-installed.json
```

Use Python 3 with `requests`, `beautifulsoup4` and `curl` for the direct examples. The verifier serves the pinned HTML on loopback and runs the README examples with the loopback origin and fixture board ID.

```sh
python3 evidence/board-thread/check-direct-guide.py README.md "$TSDM_READ_FIXTURES"
```

Python printed `2 9199345`. curl returned HTTP 200 for each GET and wrote both fixture bodies byte for byte. The server observed two GETs per example with no cookie or authorization headers.

[Controlled SDK receipt](controlled.json) records these observations.

| Expected behavior | Installed observation |
| --- | --- |
| Preserve identity and order for the document-free board and thread, and retain the legacy read | FID 12 yielded 20 ordered thread IDs. TID 1120 yielded PIDs 100019–100028 in order with the first post readable from rendered HTML. Legacy TID 9199345 yielded nine ordered posts. |
| Navigate the homepage, sections, subforums, favorites and activity links | Five groups, section 1, FID 2, subforum 15, and listed TID 9199345 in the guest replay. The native activity row exposed 17 destinations. A separate homepage response exposed the favorite boards in returned order. |
| Expose categories, previews, monitoring and post updates | Category 3 returned zero matches. Category 4 was available. The newest board row changed from 9202818 to 9202876, with no preview work. Explicit preview requests exposed excerpts, image count and password restriction. Thread updates resolved to PID 4043. |
| Preserve filters, returned pagination and partial content | The board wrapped to 1 of 18 and the thread clamped to 31 of 31. Reverse and by-author pages retained the returned order. The guest replay retained locked posts. A promoted occurrence kept its PID. Poll, activity, debate, reward and trade returned display data. |
| Distinguish empty, malformed, incomplete, denied and unexpected results | A consistently empty board stayed valid. Missing and malformed lists exhausted one native fallback. Same-response legacy HTML needed one GET. Explicit login, permission, missing, rate limit and challenge each terminated after one GET. Cross-origin, conflicting and missing exact-post results were invalid. Unknown viewer and pagination stayed unknown. |
| Preserve exact-post lookup and host navigation | PID 200010 established TID 1125. The opaque redirect passed the original destination to the host after one GET. |

The controlled replay uses recorded and derived inputs. Deployment observations come from the separate two-GET signed-out example in the packaged README.

## Live guest observation

The coordinator installed the exact archive identified in the controlled receipt. The coordinator extracted the TypeScript example from the installed README, compared it byte for byte with `scripts/check-live-guest.ts`, and ran it in a clean consumer using Node’s environment proxy support.

```sh
node --use-env-proxy check-live-guest.ts https://www.tsdm39.com 17
```

On November 19, 2026 at 06:23 UTC, the deployment returned board `17` with 61 rows. The example selected thread `1271440` from that listing and read ten posts. Both responses established a guest viewer and returned HTTP 200. [Live receipt](live.json)
