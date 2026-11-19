# SDK #32 qualification

The candidate builds on #31 at `dc865189a576ea7ed504e6fb594071c5e6c77930`. The exact `tsdm-sdk-0.1.0.tgz` SHA-256 is `bbd4c087e681cc9241c11b65a6f7f0bc86a2e46bf0378074fc72e27e5dd897c4`.

- [Installed SDK receipt](0.1.0-installed.json) records 42 expected results and expected request traces compared with the installed SDK. The runner installs into an external Node 26 project with a fresh npm cache, checks lockfile integrity and the README guide link, and compiles the packaged TypeScript without DOM or Node typings. It runs the example's declined-creation branch.
- [Direct guide receipt](0.1.0-direct.json) records 28 groups from the exact packaged Python requests and curl examples on disposable loopback HTTP. It checks discovery and all record reads, preview and recalculation bodies, separate approvals for each effect, single versus batch identifiers, and retention of redirect responses. It also checks that a recalculation carrying the creation flag fails before HTTP.
- [Combined regression receipt](0.1.0-regressions.json) records 30 passing suites against the candidate and rebuilt historical bundle, including #31 awards, #30 tasks and magic, #29 credits, and prior SDK and historical checks. The runner retains the individual receipts in its output directory.

[Protocol pins](pins.json) identify 37 inputs from `Carinoasd/tsdm_client` at `02df67e39ded906def5b868e8f8311ba735b316c`. The installed runner verifies every pin before replay and projects selected fields from the archived schema 33 read and the source's run and undo result examples. It replaces the account, content and target data with fictitious values. Other cases use controlled responses written for this ticket. The pinned upstream regressions identify creation, run and revocation replies as spec-shaped test inputs. Observations establish SDK and host behavior for these inputs. Deployment permissions, actual credits and revocation effects remain unobserved.

## Replay

Use Node.js 26, npm with the locked build dependencies available, Python with requests, curl and OpenSSL. The direct guide checks bind disposable loopback listeners.

```sh
# Set UPSTREAM to the pinned tsdm_client source tree and OUTPUT to a new directory.
npm ci --offline
npm run pack:sdk
archive=dist/tsdm-sdk-0.1.0.tgz
shasum -a 256 "$archive"
sh evidence/batch-ratings/check-candidate.sh "$UPSTREAM" "$archive" "$OUTPUT"
```

The installed red probes reached the missing root export, preview, creation, and list and step operations. Later probes caught a string `true` completion flag, absent packaged documentation, and a first resumed receipt with an unchanged pending count. The final replay exercises those paths along with missing capability, qualified redirects, scope and session changes, blocked and recalculated forms, role-specific revocation and reconciliation after response loss.

## Trade-offs

- A dedicated client keeps the existing ordinary-rating API intact. The host supplies fresh, same-session requests, form encoding and accurate redirect provenance. The request contract marks preview and recalculation POSTs as `effect: false` so hosts can distinguish them from effectful POSTs.
- The SDK probes status and scoped capability on discovery instead of caching access across calls. It uses the qualified same-origin form destinations and supported field metadata. Unknown schemas, destinations or conflicting controls stop the operation. The SDK has no inferred native batch-rating write path.
- Preview binds the selection to the offered board, thread or posts. Recalculation replaces the old preview at dispatch. Creation accepts only the reviewed settings and respects quota, forced settings and the precheck. Older previews use the available quota and local bounds. Load-time checks can leave some server-supported variants unavailable. The forum still decides eligibility and quota when processing the request.
- A creation receipt establishes the returned batch and observable settings. The schema can omit its item list. Read detail for persisted item-level reconciliation. If creation is uncertain, listing can find candidates but cannot attribute indistinguishable batches to a specific attempt.
- Every run or batch revocation call dispatches at most one approved chunk. A declining caller sends nothing. The SDK stops on the first unchanged receipt or a contradictory count and consumes that page's effect authority on ambiguity or refusal. A fresh read and approval are required to proceed. The client prevents concurrent chunks for the same batch and session within one client. Cross-client and restart coordination belong to the host.
- Resume is read-only and can follow one qualified redirect to the same batch result. Single revocation needs an eligible item from detail, and batch revocation also requires detail. A single revocation consumes the page's effect authority so subsequent effects require fresh detail. Structured handles must match the operation; evidenced legacy boolean replies are interpreted in their request context with validated counters where applicable.
- The direct guide uses canonical read routes and pinned form names. Its caller reviews forms and approves effects. Controlled fixtures and projected archived shapes make those cases repeatable without changing a live forum account.
