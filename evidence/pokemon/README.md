# SDK #35 qualification

The candidate builds directly on #34 at `87e93bc8d68ee99d2ffc4c304d5eda59148e00fe`. The SHA-256 of `tsdm-sdk-0.1.0.tgz` is `bf1134551be164fde3c9c045c49b28012f0f5946778978f3b9c1b02d3caae4fb`.

- [Installed SDK receipt](0.1.0-installed.json) records 40 observation groups, including all 21 method/group/action combinations and the packaged TypeScript example.
- [Direct guide receipt](0.1.0-direct.json) records 56 observations, including all 21 combinations in each of Python `requests` and curl.
- [Combined receipt](0.1.0-regressions.json) records 36 passing suites, including both #35 suites and #34's 49 installed and 40 direct HTTP observation groups. The runner retains individual receipts in the specified output directory.

The consumer installs the archive offline in a clean external Node 26 project and verifies the lockfile integrity. It checks both README and packaged guide links and compiles and executes the guide TypeScript with no ambient types. Its operation traces compare the exact method, group, action, query, JSON body, hash header and effect flag with independently written expectations. The direct runner uses the packaged Python and curl helpers against an inert loopback server. Each direct client exercises all 21 pairs and both bootstrap paths, with explicit refusal, dropped responses and a same-UID re-login. All cookies and hashes in the receipts are fixture values.

[Fixture pins](pins.json) identify the pinned `Carinoasd/tsdm_client` v1.59.0 source at `02df67e39ded906def5b868e8f8311ba735b316c`. The runner verifies the original source, status fixture, and inline regressions 176, 178 and 180 in the supplied tree. The preserved local status projection and roster replay derive from those examples. The game HTML, response variations and synthetic roster receipts represent controlled cases. The pinned inputs supply no standalone game response archive. No deployed forum or Pokémon account was accessed. Session availability, permissions and game changes on a deployment remain unobserved.

## Replay

Use Node 26.x, npm with the locked dependencies available, Python 3 with `requests`, curl, OpenSSL and the pinned upstream tree. Set `UPSTREAM` to that tree and `OUTPUT` to an empty directory. The HTTP checks bind disposable loopback listeners.

```sh
npm ci --offline
npm run pack:sdk
archive=dist/tsdm-sdk-0.1.0.tgz
shasum -a 256 "$archive"
sh evidence/pokemon/check-candidate.sh "$UPSTREAM" "$archive" "$OUTPUT"
```

The retained installed red probes reached the missing public factory, a redirect with a form-hash-shaped body treated as a refusal, and the clean consumer's declaration and guide boundary. The resumed tests replace placeholder hashes with valid fixture values and compare all 21 inventory entries against their exact wire requests.

## Shared seam for #36

`src/forum-client/pokemon/client.ts` builds one private `createPokemonWire` for the factory. `wire.read(group, action, query, decode)` and `wire.write(group, action, query, body, decode)` pin the method and share the same authenticated binding, plugin envelope and retry semantics. Shop and battle methods can use that wire with their own named routes and decoders. `battle/recover` can interpret its scoped refusal code 404 without changing other refusal semantics. The package exports deliberate named operations.

## Trade-offs

- The host supplies cookie ownership and login continuity. The SDK keeps the hash private to one client and checks continuity before dispatch and after replies. The native path accepts a single parsed hash when the same-login transport is authoritative and the page lacks a viewer marker. A conflicting identity or ambiguous hash ends bootstrap.
- Bootstrap is explicit. Concurrent boots of the same mode and login share a request. Direct status and game-page methods keep discovery paths distinguishable. Auto fallback runs for unavailable or incompatible status, with no fallback after login refusal, identity mismatch or rate limiting.
- A write may be reissued once only for the exact pre-execution form-hash refusal and a different same-login hash. Ordinary refusals, redirects, malformed replies, server errors and lost effect responses send no second write. A stale hash that cannot be refreshed requires another deliberate bootstrap. Hosts own timing and durable recovery.
- Each roster method pins its group, action, method and query versus JSON placement. Basic IDs, slots and move sites are checked locally. Eligibility and resource limits stay with the plugin. The application supplies consent at the named method boundary, with no separate native confirmation token.
- Decoders check the fields needed to interpret a result and keep the plugin's other fields. Targeted reads and profile results check the returned IDs. Returned inventory pagination can differ from the request. Missing legacy badge visibility remains unknown. Acknowledgement and state readback remain separate, so the client does not attribute a later read to a particular uncertain request.
- The SDK has one session and wire for the roster and future shop and battle methods. Direct Python verifies its binding on each call. Direct curl uses a caller-supplied continuity pair and a reviewed hash and query. Direct recovery is deliberate and does not reissue writes automatically.
