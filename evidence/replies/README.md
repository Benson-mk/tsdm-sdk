# SDK #23 qualification record

Built on `d40df0df736b6a3ef32bf8142f0f81f390f668d8`, the integration commit containing #22. The candidate `tsdm-sdk-0.1.0.tgz` SHA-256 is `8d3aae8604a41b2541bceeee7cac241d4788be107835d49d5ba33b83f8e600ce`.

- [Installed SDK receipt](0.1.0-installed.json) records 20 outcome rows and 58 host requests. The clean Node 26 project installed offline, checked its lockfile against the archive, read the packaged guide and type-checked the example without DOM types. It exercised plain, quoted and legacy native forms, structured and literal AJAX acknowledgements, explicit moderation, refusal and redisplay, both human challenge update/check flows, browser destinations, and uncertain dispatch followed by exact readback. Two deliberately dispatched identical replies each lost their response. Both checks matched the same stored PID, reported unresolved attribution, and left the write count at two.
- [Direct HTTP receipt](0.1.0-direct.json) records 18 checks using executable snippets extracted from the archive. The Python and curl clients each sent one deliberate POST to a disposable loopback forum. The fixture recorded the actual methods, cookies, routes, fields and response bodies. Independent readback, human verification requests, and native fallback reads used GETs. Curl without deliberate confirmation produced zero requests.
- [Regression receipt](0.1.0-regressions.json) records the installed package, board/thread/discovery, collections, spaces, messages and notices regressions against this archive. Historical publication, reply and edit consumers also passed against the rebuilt historical entry, including its original native callback handling. Its separate bundle digest is recorded there.

The [upstream pins](upstream-pins.json) identify 20 verified files from `Carinoasd/tsdm_client` v1.59.0 at `02df67e39ded906def5b868e8f8311ba735b316c`. The installed test replays the pinned plain, quoted and floating form shapes and a flood refusal with the relevant fixture account. Other journeys use authored responses and fictional IDs, tokens, answers and content. The checks establish SDK behavior and handoff destinations under controlled transports, and direct HTTP requests on loopback. Deployment availability and completion in a human browser remain unobserved.

## Replay

Use Node 26, npm, Python 3 with `requests`, curl, and the pinned upstream checkout. A populated npm cache or existing lockfile-matched build dependencies are sufficient. The November 19, 2026 run reused a local lockfile-matched `node_modules` and packed offline with a writable local npm cache. The direct check needs permission to bind a disposable HTTP listener on `127.0.0.1`.

```sh
# Set UPSTREAM to the pinned upstream checkout directory.
npm ci --offline
npm run pack:sdk
archive=dist/tsdm-sdk-0.1.0.tgz
shasum -a 256 "$archive"
TSDM_REPLIES_UPSTREAM="$UPSTREAM" node scripts/check-installed-replies.mjs "$archive"
python3 evidence/replies/check-direct-guide.py "$archive"
TSDM_READ_FIXTURES="$UPSTREAM/test/data" TSDM_DISCOVERY_FIXTURES="$UPSTREAM/test/data" \
  node scripts/check-installed-sdk.mjs "$archive"
TSDM_COLLECTIONS_UPSTREAM="$UPSTREAM" node scripts/check-installed-collections.mjs "$archive"
TSDM_SPACES_UPSTREAM="$UPSTREAM" node scripts/check-installed-spaces.mjs "$archive"
node scripts/check-installed-messages.mjs "$archive"
node scripts/check-installed-notices.mjs "$archive" "$UPSTREAM"
node_modules/.bin/vite build --config vite.library.config.ts
node evidence/replies/check-historical.mjs
```

Omit `TSDM_REPLIES_UPSTREAM` to replay only the authored installed fixtures. The first preimplementation probe failed at the package-root `createReplyClient` import. Later probes failed at verification preparation, native preparation, missing readback and a conflicting exact-link anchor that issued a GET. The final traces exercise those paths through the installed public API.

## Trade-offs

- A separate `createReplyClient` reuses the session-bound transport and leaves ordinary readers on their simpler host interface. Callers instantiate a second client and implement the extra POST, continuity and verification referer requirements.
- Prepared forms are private, single-use, scoped to one client and session and consumed at dispatch. This keeps tokens out of recovery records and blocks duplicate activation of one form. An uncertain send leaves retention, multi-tab coordination, and deliberate re-preparation to the host.
- Schema 16 and the native form paths qualify the destination and preserve supported controls before dispatch. Same-response native HTML and one full native fallback cover older representations. Unknown controls, legacy fragments without viewer evidence and interactive challenges lead to native browser continuation, so some deployments require a user handoff.
- Image and question update/check requests run only on user actions. The host fetches and displays the qualified image in the same session. Keeping verification separate from publication preserves forum-side verification and entails extra requests and UI work for the host.
- Explicit operation evidence distinguishes publication, moderation, refusal and form redisplay. The SDK conservatively returns uncertainty for a lost, generic, inconsistent or unqualified response, including an unqualified redirect. The host can expose an available exact candidate and ask the original member to check it.
- Recovery checks the exact post for viewer and author, then GETs its edit form for stored source and supported material flags. That additional read costs another request and leaves unavailable source, unexpected quote formatting, transformations, missing fields and unsupported options inconclusive. An identical match establishes stored content with attribution unresolved. Every recovery request is read-only.
- The native reply result parser widens the historical literal grammar only for the selected reply handler. Shared package and historical parser regressions keep the compatibility surface verifiable. Controlled transport, scrubbed pinned inputs, and loopback requests make this reproducible without forum accounts while limiting the evidence to those inputs.
