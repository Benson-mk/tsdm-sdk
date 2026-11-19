# Installed SDK consumer evidence for #13

The November 19, 2026 run used Node.js 26.0.0, npm 11.12.1 and TypeScript 6.0.3. The [consumer receipt](receipt.json) records the exact local archive, SHA-256, npm integrity, request trace and observed results. The source starts from SDK integration commit `79aace477cedbf7f2379ac59d880d4ad0e560b58`, whose second parent `256111cce69687b9fef09a266f332d660fe41a90` preserves the imported client history.

| Input | SHA-256 |
| --- | --- |
| `tsdm-sdk-0.1.0.tgz` | `76790dd5ff10f67f59f7e6600982f0967aa72995d4a45d1f6f353be794a2a6c6` |
| `tests/install/fixtures/thread_plain.json` | `4c315c9baa628790c74c0eed3c477cea13fc6ef961b4fe78cef8080a2e01e1b1` |
| `tests/install/fixtures/LICENSE` | `a07d3e5d6fa74061bd349669fac3ae578516ebebf4e8ece941569cbcea0cc7a6` |

The fixture and its accompanying license are byte-for-byte copies of `test/data/tsdmapp/thread_plain.json` and `LICENSE` from `Carinoasd/tsdm_client` at commit `02df67e39ded906def5b868e8f8311ba735b316c`. The test host serves the response under the fixture's `https://forum.test` origin and a modeled member session. It makes no forum requests. The installed test verifies the viewer, thread ID and title, each post's ID, author, visible text and exact URL, page 1, and the returned order including the promoted post. Post `3942` carries the author-only restriction text. The fixture and its license stay with the repository's tests. The tarball carries the two bundled dependency notices.

## Repeat the run

Use the source and harness at commit `603d273ab6153b3ca1087251477e15377995875d` to reproduce the #13 receipt. Use Node.js 26.x, npm and a writable temporary directory. The build dependencies come from `package-lock.json`. Run `npm ci` with a populated cache in offline mode when required. The build and replay for this receipt both used an offline cache. From a checkout of that commit, run:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run pack:sdk
shasum -a 256 dist/tsdm-sdk-0.1.0.tgz
node scripts/check-installed-sdk.mjs dist/tsdm-sdk-0.1.0.tgz > /tmp/tsdm-sdk-13-replay.json
cmp evidence/install/receipt.json /tmp/tsdm-sdk-13-replay.json
```

The harness installs the local archive using npm with an empty cache, offline mode and strict engine checking. It runs the ESM consumer from an independent project, then checks the installed types with strict NodeNext and only `ES2023` libraries and `types: []`. It checks the SDK metadata, README, dependency notice bytes and archive integrity from the consumer lockfile. Expect a single fresh thread request through the supplied transport after two rejected destinations, followed by all nine ordered posts. Use the recorded toolchain versions for byte-for-byte comparison of the archive and receipt.

## Preimplementation result

Before any SDK implementation, the same installed-consumer harness installed the historical archive successfully and exited with code 1 when the public import reported `ERR_MODULE_NOT_FOUND: Cannot find package 'tsdm-sdk'`. The historical archive SHA-256 was `1e0d15a313cd8aee8d08e6a596beda67225de9796fdb808c051dd5f5546457fe`. Repeat that test against the retained reference with:

```sh
node scripts/check-installed-sdk.mjs evidence/history/consumer-2026-11-14T13-08-40.303Z/tsdm-forum-client-0.26.0.tgz
```

## Distribution terms evidence for #12

The [distribution terms receipt](distribution-terms.json) records a local 0.1.0 archive built from integration base `3d8e52efbaa0328e5585d53a561e6376a6a9fba4` with the #12 distribution changes applied. The archive installed offline in a clean Node.js 26.0.0 project with npm 11.12.1. The installed manifest declared `MIT`, and the installed README linked to `./LICENSE`. The linked file matched the repository `LICENSE` byte-for-byte and contained the standard MIT permission and warranty text. Both bundled dependency notices matched their retained upstream files byte-for-byte. The receipt also records the passing public import, fixture replay and TypeScript 6.0.3 declaration check.

Before the distribution changes, the saved integration archive with SHA-256 `583d449b42dd22a4970efee67849f8f97466f10a383bf72a99bed8448d654f05` installed successfully and passed both notice comparisons. The new check exited with code 1 because the installed package lacked the MIT metadata, the README link and the `LICENSE` file. To replay that observation, pass the retained archive with that digest to the current harness.

To reproduce the passing receipt, use the recorded toolchain and the source with the #12 changes applied:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run pack:sdk
shasum -a 256 dist/tsdm-sdk-0.1.0.tgz
node scripts/check-installed-sdk.mjs dist/tsdm-sdk-0.1.0.tgz > /tmp/tsdm-sdk-12-replay.json
cmp evidence/install/distribution-terms.json /tmp/tsdm-sdk-12-replay.json
```
