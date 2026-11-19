# SDK #36 qualification

The candidate is based on #35 at `f8a34174d3b27bbe5b5edc5ab4f46f77e3de6542`. The SHA-256 of `tsdm-sdk-0.1.0.tgz` is `8a60eae997cd9866df5ce7893cd007730d38e02716bdfaf95cc6dbeb9d86399a`.

- [Installed SDK receipt](0.1.0-installed.json) records 63 comparisons, including all 14 shop and battle routes, authenticated request inputs, partial purchases, both item outcomes, refusal, response loss and session boundaries. It also runs the packaged TypeScript example from a clean external Node 26 install after compiling with no DOM or ambient types.
- [Direct HTTP receipt](0.1.0-direct.json) records 42 comparisons through the packaged Python `requests` and curl examples on an inert loopback listener. Each client exercises all 14 combinations separately. The receipts record method, path, query, JSON and fixture header and cookie observations.
- [Combined receipt](0.1.0-combined.json) compares the actual requests with the [35 combinations from #4](inventory.json) separately for the SDK, Python and curl. It qualifies 21 roster combinations plus 14 shop and battle combinations per client. Bootstrap traces sit outside the 35. The runner also reruns banking and the earlier #35 regressions against the same archive and leaves the individual receipts in the output directory.

The [source pins](pins.json) identify the Pokémon Dart repository, model definitions, battle flow notes and inline regression sources from `Carinoasd/tsdm_client` v1.59.0 at `02df67e39ded906def5b868e8f8311ba735b316c`. The fixtures use synthetic rows, sessions and game results based on those sources. The two red probes reached missing `getShop` and `buyShopItem` methods in earlier installed archives. No deployed forum or game account was accessed. Production availability, permissions, undocumented response forms and actual currency, item or game effects remain unobserved.

## Replay

Use Node 26.x, npm with the locked dependencies available, Python 3 with `requests`, curl, OpenSSL and the pinned upstream tree. Set `UPSTREAM` to that tree and `OUTPUT` to an empty directory. HTTP checks bind disposable loopback listeners.

```sh
npm ci --offline
npm run pack:sdk
archive=dist/tsdm-sdk-0.1.0.tgz
BASE=f8a34174d3b27bbe5b5edc5ab4f46f77e3de6542
shasum -a 256 "$archive"
sh evidence/pokemon-battles/check-candidate.sh "$UPSTREAM" "$archive" "$OUTPUT" "$BASE"
```

## Trade-offs

- One client and session serve roster, shop and battle. Named operations pin arguments and effect intent. The host supplies cookies, continuity and consent, and the shared wire handles the exact pre-execution hash refresh case. Server eligibility, stock and other game rules stay with the plugin.
- The SDK models IDs, status and purchase totals and preserves additional plugin fields. An active scene needs a battle ID, and known outcome scenes can omit it. A reported defeat can still be recoverable. Purchase counts reflect what the server reports, even if only part of the requested quantity was bought. Missing or contradictory write evidence yields `uncertain`, which can require a readback after a real effect.
- Recovery interprets only the route's explicit plugin code `404` as absence. Item skill selection is separately observable and submitting a choice takes another call. Capture and battle items use the server's active encounter, so a preflight read helps the host check the intended battle while the server controls the target at dispatch.
- The direct guides share session and transport helpers with #35. They expose the forum response for caller interpretation and leave any retried request deliberate. Controlled replays cover exact route and effect requests and adverse responses without spending game resources. Claims about deployment or persisted effects require observations beyond this evidence.
