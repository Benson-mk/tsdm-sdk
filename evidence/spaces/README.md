# SDK #21 qualification record

The local candidate was built on `d163df95abaa3ab1fe61bcbf90adf6b5baca9647`, the integration commit containing #20. [Installed receipt](0.1.0-installed.json) records the exact archive, offline installation and lockfile integrity, package-root imports and TypeScript declarations, both packaged guides, and each independent expected and observed value with host requests. [Direct guide receipt](0.1.0-direct.json) records Python `requests` and `curl` on a disposable loopback fixture. [Combined-candidate regressions](0.1.0-regressions.json) record the shared package and #20 checks on the same archive.

The [upstream pins](upstream-pins.json) reference `Carinoasd/tsdm_client` v1.59.0 at commit `02df67e39ded906def5b868e8f8311ba735b316c`. The pinned write/storage repositories, page parsers, fixture shapes and regression expectations establish the requests and response representations. The installed and direct checks use locally authored fixtures with fictional members, IDs, token and content. The package and receipts use synthetic fixture data. These checks establish fixture-level protocol behavior, page scope, host handoff destinations, deliberate dispatch and classification. Browser completion and deployed effects are outside these observations.

## Replay

Use Node.js 26, npm, Python 3 with `requests`, and curl. Set `TSDM_SPACES_UPSTREAM` to the verified upstream tree to additionally check all listed source and fixture file hashes. The installed runner still works without that checkout. For the Python replay, permit a disposable loopback listener on `127.0.0.1`. Run from the repository root.

```sh
npm ci
npm run pack:sdk
shasum -a 256 dist/tsdm-sdk-0.1.0.tgz
node scripts/check-installed-spaces.mjs dist/tsdm-sdk-0.1.0.tgz
python3 evidence/spaces/check-direct-guide.py dist/tsdm-sdk-0.1.0.tgz
npm run test:install
node scripts/check-installed-messages.mjs dist/tsdm-sdk-0.1.0.tgz
```

The installed check covers all structured families, legacy document and XML replies and archive fragments, native blog and photo markup, and the browser destinations for member and photo views, password and challenge pages, and a native reply fragment without viewer evidence. The write cases cover status add, reply at two depths and both deletion targets, blog publication, wall add, reply and delete, greeting send, return, ignore one and ignore all, follow, unfollow, rename, relay with deliberate thread reply, and deleting a feed entry. Fresh following and timeline reads check the expected results independently. Refusals, session switches, generic success, unlabelled redirects and transport ambiguity are checked separately, including the absence of an automatic resend.

## Implementation trade-offs

- A separate session-bound `createSpaceClient` keeps the existing read-only transport shape and couples space views and deliberate effects to one transport. Hosts instantiate it and supply session continuity.
- A shared, serializable row model keeps familiar content and identity types across eight structured response families and native views. It exposes the fields common to callers, including a separate privacy field. Some source fields and widgets stay at the forum.
- Structured reads try the returned document and at most one native fallback. The SDK exposes each older-feed fragment and the archive transition as separate calls, so hosts can stop or show partial progress. This leaves duplicate display policy to the host and can take more calls than automatically skipping empty fragments.
- Session-bound continuations and single-use write preparations use same-client object identity. This keeps tokens out of public results and consumes each preparation before the host can dispatch twice. Restarting or serializing an object requires fresh preparation. The host retains drafts and coordinates separate clients or processes.
- Native photo and member views, password entry, particular-friend blog publication, interactive challenges and legacy fragments without viewer evidence use browser handoffs. The SDK verifies their start destinations. The browser owns completion and interactive controls.
- Established operation keys, matching native AJAX handlers and an identified blog destination can confirm effects. Generic redirects or missing evidence stay uncertain. Hosts can independently re-read relevant lists under the original account and must traverse continuations before concluding absence. The SDK never resends on a verification read.
- The SDK rejects oversized status and relay inputs at the pinned protocol limits and preserves the forum's returned saved name for renames. Callers can adjust the original drafts, and forum validation still governs other input and permissions.
- Independent fiction-based SDK and loopback receipts keep the journeys repeatable without accounts. The observed capabilities and effects apply to the supplied fixtures. Re-running the shared consumer and #20 against the combined artifact adds a packaging regression check at the cost of another pair of clean installs.
