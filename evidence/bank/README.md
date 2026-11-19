# SDK #34 qualification

The candidate builds directly on #33 at `71e5b5f58842b2f7df08e344555a33b34b2d8074`. The SHA-256 of `tsdm-sdk-0.1.0.tgz` is `13767238cdca9c836714e84f686c4d74ff5909faa81890fb96b4669c8529d085`.

- [Installed SDK receipt](0.1.0-installed.json) contains 49 observation groups from an offline clean Node 26 install. The runner verifies rendered package paths, the package lock integrity, and the packaged TypeScript example without ambient host types.
- [Direct guide receipt](0.1.0-direct.json) contains 40 observation groups from the packaged Python requests and curl examples. They exercise 13 read routes, both zero-request loan link handoffs, approved submissions including both fixed record controls, and declined submissions. The loopback server returns a redirect on each POST to verify that neither helper follows it.
- [Combined receipt](0.1.0-regressions.json) covers 34 suites on the same archive, including #33 and preceding tickets. The runner retains individual receipts in the output directory.

[Source and fixture pins](pins.json) identify the bank repository, models, cubit and R120, R123, R124 and R264 of `Carinoasd/tsdm_client` at `02df67e39ded906def5b868e8f8311ba735b316c`. R120 covers page parsing, R123 covers transport boundaries, R124 covers the service forms, and R264 covers fixed withdrawal confirmation and loan record links. The controlled Node and HTTP fixtures are independently written counterparts with fictitious account details, terms, form values and transactions. They prove observable SDK and guide behavior against those inputs. Deployment-side credit movement, password changes, points trading, loan effects and account state were outside this replay. The pinned tree has no standalone bank response corpus.

## Replay

Use Node 26.x, npm with the locked dependencies available, Python 3 with `requests`, curl, OpenSSL and the pinned upstream tree. Set `UPSTREAM` to that tree and `OUTPUT` to an empty directory. The HTTP checks bind disposable loopback listeners.

```sh
npm ci --offline
npm run pack:sdk
archive=dist/tsdm-sdk-0.1.0.tgz
shasum -a 256 "$archive"
sh evidence/bank/check-candidate.sh "$UPSTREAM" "$archive" "$OUTPUT"
```

Installed red probes covered the missing root export, distinct reads and forms, fixed confirmation and loan destinations, password reflection, the missing packaged guide and the inline fixed-record `fixid` form. Final receipts show the corrected behavior and compare requests before masking fixture passwords.
