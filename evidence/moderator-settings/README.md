# SDK #39 qualification

The candidate builds directly on #40 at `f2f1888832c95dbf9738cddd0c58260208c4ef14`. The SHA-256 of `tsdm-sdk-0.1.0.tgz` is `583d449b42dd22a4970efee67849f8f97466f10a383bf72a99bed8448d654f05`.

- [Installed receipt](0.1.0-installed.json) records 36 comparisons from a clean external Node 26 project, including the packaged TypeScript example compiled without DOM or ambient types. It checks forum-access search, deny and restore, targeted lookup and edit, bans and lifting, IP-ban list/add/delete, log pages, notes, rules, recommendations, and announcement list/create/edit/delete. Refusals, partial results, payloads, session replacement, explicit approval, and lost replies are independently observed.
- [Direct receipt](0.1.0-direct.json) records 99 comparisons through the packaged Python `requests` and curl examples. The loopback listener compares exact methods, paths, query and body fields, moderator cookies and the absence of administrator credentials for every settings request. It also checks declined and stale actions, refusal, redraw, and lost replies.
- [Combined receipt](0.1.0-combined.json) records #40's administrator and #38's moderator-panel regressions plus earlier suites against the same archive. The runner retains the individual receipts in the output directory.

The [source and fixture pins](pins.json) verify 49 source or fixture files from `Carinoasd/tsdm_client` v1.59.0 at `02df67e39ded906def5b868e8f8311ba735b316c`. The installed and direct tests use authored fixtures derived from those sources, with fictional identities, forums, network addresses and content. Installed red probes reached the missing access, member, log, forum settings and announcement methods. Later probes caught a native IP add refusal returned as a redraw, and a recognized native log form without a table. An independent direct run also caught the schema 13 helper argument collision. The fixed helper retained the schema 13 `kind` field and the full packaged Python and curl runs passed.

## Replay

Use Node 26.x, npm with the locked dependencies available, Python 3 with `requests`, curl, OpenSSL and the pinned upstream tree. Set `UPSTREAM` to that tree and `OUTPUT` to an empty directory. The direct checks bind disposable loopback listeners.

```sh
npm ci --offline
npm run pack:sdk
archive=dist/tsdm-sdk-0.1.0.tgz
shasum -a 256 "$archive"
sh evidence/moderator-settings/check-candidate.sh "$UPSTREAM" "$archive" "$OUTPUT"
```

## Trade-offs and limits

- The moderator settings methods extend #38's existing client and reuse the moderator cookie continuity, panel login and transport. Each effect needs separate approval and a single-use, permission-checked page from that login. The administrator API remains separate. The access lookup is a read on a POST-shaped form, so the shared transport still sends it once.
- Structured access and notes use pinned schemas. Log, member, IP, rules and announcement reads use their applicable native representations as well, with scoped v4 capability or legacy log discovery where needed. Recommendations use the native whole-list form and preserve other displayed fields. That form requires a complete, editable list and can carry stale values if another moderator edits it concurrently.
- Member writes distinguish the forum's keyed verdict or known native message from a confirmed readback. Rules, IP bans, notes, recommendations and announcements compare observed content or selected IDs when available. Missing readback, another session, or an ambiguous redraw can leave an actual change uncertain. A note outside the operator's visible audiences is a concrete example. Native announcement verification can require an extra exact-ID read and can leave normalized content or dates uncertain.
- The examples keep eligibility, authorization and persisted state with the forum. Controlled replay verifies the client and host behavior without changing any forum account. Deployment availability, real permissions and persisted effects remain unobserved.
