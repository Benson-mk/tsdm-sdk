# SDK #28 qualification

The candidate builds on #27 at `0b428205c300c068d7b73532e8f74ad6d1432aa5`. The exact `tsdm-sdk-0.1.0.tgz` SHA-256 is `4a1dd2049f620fc9ba43daeedd6d93a94efb372d26124a1d42ea8cd47aa1353d`.

- [Installed SDK receipt](0.1.0-installed.json) records 36 controlled observations. The runner installs the archive offline into an external Node 26 project with a fresh npm cache, verifies lockfile integrity and the README guide link, and compiles and exercises the packaged TypeScript without DOM typings. It checks literal expected results and requests against the installed SDK and a controlled host, including the scope and ordering of writes. The recorded payment password is masked after comparison.
- [Direct guide receipt](0.1.0-direct.json) records 18 observations from the packaged Python and curl examples against disposable loopback HTTP. It checks the read routes, no dispatch on each declined effect, separate POSTs, raw redirects and payment fields. The recorder compares the fictional cookie and password before masking them.
- [Combined regression receipt](0.1.0-regressions.json) records 22 passing suites, including #23 replies, #24 posts, #25 special threads, #26 activity, #27 media and the historical reply and draft interfaces. The runner retains the individual receipts in the specified output directory.

[Protocol pins](pins.json) identify the upstream `Carinoasd/tsdm_client` files used to model the tests, including the schema 17 and legacy paid-thread dialogs, trade goods and purchase forms, and the native and structured order and payment replies. The runner verifies the upstream file digests. The installed tests use independently written responses with fictitious members, content, credits and order IDs. The selected-order detail HTML and its terms and payment controls are synthetic because the available pins include the payment body and result but no captured order-detail page. The receipt-based payment path uses the pinned client's order-ID and form-hash flow. These runs establish response handling and request behavior for the controlled inputs. Deployment permissions, account state, credit movements and shipping effects remain unobserved.

## Replay

Use Node.js 26, npm with the locked build dependencies in its cache, Python with `requests`, curl and OpenSSL. The direct tests bind disposable loopback listeners.

```sh
# Set UPSTREAM to the pinned tsdm_client source tree and OUTPUT to a new directory.
npm ci --offline
npm run pack:sdk
archive=dist/tsdm-sdk-0.1.0.tgz
shasum -a 256 "$archive"
sh evidence/trades/check-candidate.sh "$UPSTREAM" "$archive" "$OUTPUT"
```

The installed red probes reached the missing root export and the missing payment and receipt operations. Later probes caught the unsupported native dialog, absent packaged guide, a nonliteral cash price treated as credit-only, and the pinned structured dialog's nullable post ID. All of those probes pass against the archive above.

## Trade-offs

- A dedicated client uses the SDK's existing member-session transport and leaves the historical APIs intact. The host owns authentication, form encoding, manual redirects, redirect provenance and single-attempt transport behavior.
- Preparation returns immutable same-client, same-session handles. Paid-thread confirmation needs literal `true`; trade creation and payment require separate calls. A dispatched handle is consumed even after refusal or response loss, so reconciliation takes a new read or a browser visit. This prevents reusing a handle and leaves independent client instances and deliberate new preparations to the caller.
- The paid-thread flow recognizes schema 14/15 reads, schema 17 terms and qualified native lock and AJAX layouts. Native confirmation requires the exact opening post and readable content after a positive acknowledgement. Unsupported layouts need the browser, and a native thread with no prior lock receipt cannot establish earlier purchase from the absence of a lock alone.
- Sale mode, shipping and recipient inputs come from the offered controls. The credit-only qualification reads the known literal price block without executing forum scripts. Physical trades with seller-paid freight and virtual goods can proceed. Cash, buyer-paid freight and unsupported controls or price layouts go to the browser. Stock and balance checks use the visible snapshots and the forum still decides at dispatch.
- Structured creation, a qualified native acknowledgement, and an original manual redirect can identify the new order. Payment requires the exact selected order and structured acknowledgement. Legacy payment redirects, generic pages and lost responses leave the payment uncertain. This favors identifying an applied effect conservatively over more automatic continuations.
- An original creation receipt provides the order form hash and approved quantity-based amount once. Its status records creation and its credit name is unknown. An existing order instead needs a recognized buyer, credit amount, status and matching payment action. Unknown order layouts need the browser. This supports the pinned client's payment route while preserving a separate preparation step for a selected pre-existing order.
- Passwords enter only the final payment body, and SDK payment errors omit server-provided message text. The real host receives the body and owns private transport and logging. The direct guide leaves form presentation and review to its caller and takes curl bodies from standard input.
