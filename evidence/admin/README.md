# SDK #40 qualification

The candidate builds directly on #38. The combined receipt identifies the integration parent and the archive SHA-256 `6592d85ecedee749b8ca6d075e825ed0cbb1c00d6f66daceb5699db64ab25762`. It records 44 passing suites, including 40 installed administrator scenarios and 50 direct HTTP comparisons.

- [Installed SDK receipt](0.1.0-installed.json) records the deployment switch, administrator capabilities, separate login and logout, expiry and session replacement, operation permissions, exact target and form checks, and every admin read and effect. The moderator report-deletion replay uses both package-root clients, two fictional member sessions and distinct transports. The moderator produces only the scoped selection. The administrator independently matches its origin, forum and report IDs, asks separately for approval, and verifies the deletion receipt. Mismatches and declined approval produce no deletion request. It compiles and runs the packaged TypeScript example in an offline external Node 26 install without DOM or ambient Node types.
- [Direct HTTP receipt](0.1.0-direct.json) compares the packaged Python `requests` and curl examples on an inert loopback listener. Each exercises status, entry, login, logout, every data route and write, declines, and raw redirect handling. The replays check credential fields and the token header before masking values in the receipts.
- [Combined receipt](0.1.0-regressions.json) records the exact archive, integration parent, pin hashes, passing suites and individual receipt identities. The runner keeps separate receipt files in its output directory.

[Source and fixture pins](pins.json) identify the administrator implementation, report handling, status, representative administrator fixtures, and regression sources from `Carinoasd/tsdm_client` at `02df67e39ded906def5b868e8f8311ba735b316c`. Controlled fixtures are independently written counterparts with fictional accounts, privileges, target IDs, credentials, report contents and balances. The pinned resolved report sample is derived from a pending report. Login, administrative effects and cleanup receipts are source-shaped test responses. The evidence establishes SDK and guide behavior for the supplied inputs. Deployment availability, granted permissions, real credential validity and persisted effects remain unobserved.

## Replay

Use Node 26.x, npm with locked dependencies available, Python 3 with `requests`, curl, OpenSSL and the pinned upstream tree. Set `UPSTREAM` to that tree and `OUTPUT` to a new local directory. The HTTP examples bind disposable loopback listeners.

```sh
npm ci --offline
npm run pack:sdk
archive=dist/tsdm-sdk-0.1.0.tgz
shasum -a 256 "$archive"
sh evidence/admin/check-candidate.sh "$UPSTREAM" "$archive" "$OUTPUT"
```

The installed red probes reached the missing public export, missing credit, group, report and member-state methods, absent packaged guide, and the server-requested security question that had yet to be required locally. The final candidate exercises those paths in the public package.
