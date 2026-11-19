# SDK #30 qualification

The candidate builds on #29 at `d0ef01226afa66d95f26383506773e734579c6ac`. The exact `tsdm-sdk-0.1.0.tgz` SHA-256 is `4a69b7a994c64d238e005614d8cad2ebede92c1200efbf044be12b1e3dc96906`.

- [Installed SDK receipt](0.1.0-installed.json) records 45 expected results and complete expected requests compared with a controlled host. The runner installs into an external Node 26 project with a fresh npm cache, checks the archive's lockfile integrity, and verifies the README guide link. It compiles the packaged TypeScript without DOM or Node types and runs the example's declined-application branch.
- [Direct guide receipt](0.1.0-direct.json) records 39 expected and actual groups from the packaged Python requests and curl examples on disposable loopback HTTP. It checks the thirteen read and form routes, both legacy magic windows, all five approved effects and declined calls, the legacy apply and claim flags, the AJAX header, ordered form fields and preservation of raw redirects.
- [Combined regression receipt](0.1.0-regressions.json) records 26 passing suites against this candidate and the rebuilt historical bundle. It includes #29 attendance, credits and groups, #28 trades, #27 media, the earlier installed and direct guides, and historical replies and drafts. The replay command retains every constituent receipt in the specified output directory.

[Protocol pins](pins.json) identify the `Carinoasd/tsdm_client` source, sample responses and regression examples used for this implementation. The replay verifies those hashes. Inputs used for dispatch and observation in the installed and direct tests are independently written fictitious content and members. The pinned source also uses synthetic examples for populated gift and receipt logs and some v4 write outcomes. These runs establish SDK result semantics and the host request contract for the controlled inputs. Deployment permission, reward accounting, inventory effects and effects on other members or threads remain unobserved.

## Replay

Use Node.js 26, npm with the locked dependencies available in its cache, Python with requests, curl and OpenSSL. The guide checks bind disposable loopback listeners.

```sh
# Set UPSTREAM to the pinned tsdm_client source and OUTPUT to a new directory.
npm ci --offline
npm run pack:sdk
archive=dist/tsdm-sdk-0.1.0.tgz
shasum -a 256 "$archive"
sh evidence/tasks/check-candidate.sh "$UPSTREAM" "$archive" "$OUTPUT"
```

Installed red probes reached the absent root export, missing task detail and effects, missing magic reads and forms, native dialog layout, and missing packaged guide. Subsequent red probes caught declaration leakage, an older-plugin read fallback, and detail fields omitted from the initial model. The final installed check covers those paths, session replacement, foreign targets, refusal, progress, reapplication, legacy and structured acknowledgements, and ambiguity after dispatch.

## Trade-offs

- A task and magic client reuses the existing member-session and `effect` request convention. Its packaged declarations describe only the portable boundary. Hosts own credentials, AJAX headers, fresh reads, single attempts and truthful redirect provenance.
- Session-bound handles separate reads and form preparation from explicit approval. Apply, claim and abandon are marked as effects even though the method is GET. A claim redirect is held and requires a separate read, preparation and confirmation. Handles are consumed at dispatch, even on ambiguity, and the caller owns coordination across new handles or clients.
- Task effects require matching server-offered actions, including applicable detail state. Structured success keys and narrowly recognized native fragments prove specific effects. Unknown, lost, followed or mismatched responses leave the effect uncertain. Known refusal, failure and progress remain distinct results.
- Read-only task lists, the shop and inventory can fall back to recognized native pages. Unrecognized detail, participant and log representations hand off to a same-origin browser page. Native task rewards use plain display text, native shop balances may be absent, and native page totals reflect visible navigation. Structured logs keep epoch seconds and the server's time offset. Unsupported rows are omitted from magic lists and logs.
- A shop purchase requires an offered target. Structured inventory with a positive owned count may try opening a canonical use window when the response omits a use URL, as the pinned client does. The window still has to establish the exact item and controls. Native inventory requires a recognized use link. Gift and receipt operations are log reads in this ticket.
- Magic forms use recognized POST destinations and preserve selected hidden values privately. Editable controls are checked against the served form and known bounds. Purchase enforces visible credit, stock and capacity limits when available, and the forum decides actual availability. Unsupported scripting or controls fall back to the browser. The native and structured success checks use their own evidence, and a redisplayed form or unrelated result stays uncertain.
- The direct guide delegates rendering and review to the caller, then shows how to send the approved action once. Controlled replays make all effect and log paths repeatable without changing a live account.
