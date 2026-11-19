# SDK #29 qualification

The candidate builds directly on #28 at `3a639282434b011ec14eb3c4140691a4e805d9a5`. The SHA-256 of `tsdm-sdk-0.1.0.tgz` is `ee9cca6af49b3328177987c4cc7c3fd3e6240df99f1403839b95b8aecb8acde1`.

- [Installed SDK receipt](0.1.0-installed.json) records 37 observations on Node 26, including the packaged TypeScript example.
- [Direct guide receipt](0.1.0-direct.json) records 18 observations from the packaged Python and curl examples.
- [Combined regression receipt](0.1.0-regressions.json) records 22 passing suites on the same archive, including 36 installed and 18 direct observations for #28. The runner retains the individual suite receipts in the specified output directory.

The consumer installs the archive in a clean external Node 26 project, verifies its lockfile integrity against the tarball, and exercises only the public SDK export. It verifies the packaged guide links and compiles and executes the TypeScript example without DOM types. The direct check executes the packaged Python `requests` and shell blocks against an inert loopback forum, including zero requests when approval is withheld.

[Fixture pins](pins.json) refer to the untouched source files under `test/data` from `Carinoasd/tsdm_client` v1.59.0 at `02df67e39ded906def5b868e8f8311ba735b316c`. The consumer replays the attendance readback and floating responses, bounded credit logs, balance, group list and detail, group progress, expiry, and switch form. It derives the open attendance state from the source's regression recipe. Legacy fragments, the switch success keyed by `usergroups_switch_succeed`, negative outcomes and lost responses use controlled synthetic variations. The examples and replay establish request, consent and observation behavior for their inputs. Deployment availability, permissions and actual account effects remain unobserved.

## Replay

Use Node 26.x, npm with a writable cache and available locked dependencies, Python 3 with `requests`, curl, OpenSSL and the pinned source tree. The direct checks bind disposable listeners on `127.0.0.1`.

```sh
# Set UPSTREAM to the pinned tsdm_client checkout and OUTPUT to a new directory.
npm ci --offline
npm run pack:sdk
archive=dist/tsdm-sdk-0.1.0.tgz
shasum -a 256 "$archive"
sh evidence/credits/check-candidate.sh "$UPSTREAM" "$archive" "$OUTPUT"
```

Installed red probes initially reached the missing package export, balance operation, and group reads. A later probe exposed the missing rate-limit hint after a check-in POST. The green consumer records expected and actual results at the same boundary.

## Trade-offs

- The credits client reuses the member-bound text transport. Both effects are POSTs, and each preparation is private, tied to the session and consumed at dispatch. Hosts handle cross-tab approval and recovery.
- Check-in uses the forum's session-scoped hash from the status API or a validated native form. It asks for a fresh readback once after dispatch. Readback confirms attendance, and only an applicable acknowledgement supports attribution to the submission. A rate limit yields an unknown effect with the available wait hint, leaving continued observation to the host.
- The calendar scans bounded credit-log pages, deduplicates reward dates and marks incomplete coverage. It presents the attendance days evidenced by recognizable log entries. A missing reward row provides limited evidence about whether that day was attended.
- Structured credit and group views retain IDs, filter echoes, pagination and permissions. Native parsing covers recognizable views with at most one fallback GET. Native results can carry fewer identifiers or an unknown last page. The credit rules page remains a native handoff when the balance view offers it.
- Group progress uses the next tier established by the default page. Individual tier details are deliberate reads. The SDK avoids fetching every tier as a side effect of a progress read.
- Group switching requires the expiry row to offer the action, then checks the exact group and member on the returned form. Unfamiliar controls go to the native group page. A switch acknowledgement, redrawn form, explicit refusal and unknown effect remain distinct. A qualified redirect can be handed off for review while the switch effect remains unknown.
- Controlled fixtures, opaque transport failures and loopback requests make the results repeatable without account changes. Live behavior remains a release qualification question.
