# tsdm-sdk 0.1.0 qualification

The candidate is `tsdm-sdk-0.1.0.tgz`, 423256 bytes, SHA-256 `33d50e8ad2b77241312d7fcd9eea53849a46315a70e022437a5cac70661625d7`. The [candidate manifest](candidate.json) binds the archive to the [package inputs](package-inputs.json), including source paths, file modes, content digests, the lockfile, the staging script and third-party notices. The attached release manifest identifies the full Git commit after rebuilding its clean export and comparing the tarballs byte for byte.

## Published release

GitHub published immutable `v0.1.0` on November 19, 2026 at 14:45:30 UTC. Its tag resolves to `edbabcedfe03c5d8da817ec1a1aa7ed3ac98ccd8`. A clean export of this commit produced a byte-identical 423256-byte tarball. Before publication, both authenticated draft downloads matched the local files and GitHub reported immutability enabled. [Source manifest](release.json) · [Draft verification](draft-verification.json) · [Public release metadata](public-release.json)

A fresh anonymous consumer downloaded both release assets and verified their bytes. The exact command in `INSTALL.md` installed the SDK from the versioned URL into an empty npm cache. The lockfile recorded the expected URL and SHA-512. The package imported as ESM and its declarations passed strict NodeNext checking without DOM types. GitHub CLI verified the release attestation and its reference to each asset. [Public installation receipt](public-install.json) · [GitHub attestation](github-attestation.json)

To repeat the public check from an SDK checkout with the locked development packages installed, supply the local qualified tarball and the attached release manifest. The verifier uses a fresh home and cache and emits a JSON receipt.

```sh
python3 evidence/release/0.1.0/verify-public.py "$archive" evidence/release/0.1.0/release.json INSTALL.md --tsc node_modules/typescript/bin/tsc
gh release verify v0.1.0 --repo Benson-mk/tsdm-sdk
gh release verify-asset v0.1.0 "$archive" --repo Benson-mk/tsdm-sdk
gh release verify-asset v0.1.0 evidence/release/0.1.0/release.json --repo Benson-mk/tsdm-sdk
```

## Candidate evidence

| Qualification check | Expected and observed |
| --- | --- |
| Package and rights | A fresh external Node.js 26.0.0 project installed the exact bytes, imported the public ESM package, and passed strict TypeScript 6.0.3 checking with ES2023 and no DOM or ambient types. The installed README linked to the repository-identical MIT license. The package declared MIT and carried the matching notices for parse5 8.0.1 and entities 8.1.0. [Installation and terms](terms.json) |
| Repeatable installation | npm 11.12.1 restored 0.1.0 from an empty cache after a synthetic upgrade. A one-byte change failed with `EINTEGRITY`. [Loopback rehearsal](installation-rehearsal.json) |
| Visible forum data | The package read the legacy nine-post thread, the populated 20-row document-free board and the ten-post document-free thread. The 46 indexed suites passed, including two compatibility controls that use the separately built legacy entry point. Each receipt matched its indexed digest. Nine additional packaged Python and curl guide replays passed. [Suite index](suites.json) · [Guide index](direct-guides.json) |
| Live README journey | At 2026-11-19T14:38:16.667Z the signed-out example made two GETs to `www.tsdm39.com`. Board 17 returned 61 rows. The selected thread 1106488 matched the listing and returned 10 posts. Both responses reported guest and HTTP 200. [Guest read](guest-read.json) |
| Device, achievements and embedded players | Bound revocation and a temporary failure produced distinct results. Six achievement cases checked schema 68, native empty and populated pages, a missing status plugin and viewer boundaries. A thread carrying nine player cases returned the expected inert destinations in one forum request. [Device](device-status.json) · [Achievements](achievements.json) · [Players](media.json) |
| Remaining inventory | Both matrices identify the public SDK call or host destination, the guide and the check for each independently observable operation. Supplemental installed probes exercise native medal/title navigation, populated achievements, member lookup, composition and approved moderation. [Inventory sections 1–3](inventory-1-3.md) · [Inventory sections 4–7](inventory-4-7.md) · [Supplemental probes](inventory-4-7-probes.json) |

The approved inventory is pinned to `Carinoasd/tsdm_client` v1.59.0 at `02df67e39ded906def5b868e8f8311ba735b316c`. This baseline reran the SDK and direct-guide checks. No first-release operation relies solely on a previous candidate. The historical reply and draft suites rerun their legacy entry point and report its independent digest. Controlled inputs establish SDK requests and returned outcomes. Browser handoff coverage ends at the supplied destination. Authenticated account changes, privileged effects and delivery by external services have no live deployment claim in this record. [Inventory decision](https://github.com/Benson-mk/tsdm-sdk/issues/4#issuecomment-6973144922) · [Qualification decision](https://github.com/Benson-mk/tsdm-sdk/issues/7#issuecomment-6982631888)

## Reproduce

Use the SDK source at the release tag and the pinned upstream checkout. Set `UPSTREAM` to the absolute path of that upstream tree. Use Node.js 26.0.0, npm 11.12.1, the locked development dependencies, Python 3 with `requests` and `beautifulsoup4`, Git, tar, curl, jq, OpenSSL and a POSIX shell. The suite uses disposable loopback servers. The README check needs signed-out HTTPS access to the forum. Run from the SDK repository root. For an offline build, supply a populated `npm_config_cache` and scope `npm_config_offline=true` to the build command. The cold-cache rehearsal fetches the archives from its loopback server.

```sh
set -eu
record=evidence/release/0.1.0
OUT=$(mktemp -d)
npm ci --ignore-scripts --no-audit --no-fund
python3 "$record/build-candidate.py" "$OUT"
archive="$OUT/tsdm-sdk-0.1.0.tgz"
cmp "$record/package-inputs.json" "$OUT/package-inputs.json"
cmp "$record/candidate.json" "$OUT/candidate.json"
node scripts/check-installed-sdk.mjs "$archive" > "$OUT/terms.json"
npm run test:rehearsal -- "$archive" "$OUT/candidate.json" "$OUT/installation-rehearsal.json" --candidate
TSDM_MEMBERS_UPSTREAM="$UPSTREAM" sh evidence/moderator-settings/check-candidate.sh "$UPSTREAM" "$archive" "$OUT/suites"
python3 "$record/check-supplement.py" "$OUT" "$UPSTREAM"
```

Check the `actual` entries in `$OUT/suites/moderator-settings-combined.json` and the expected/observed values in the individual receipts. Fresh timestamps, local ports and the live forum listing can change on replay. The `sha256` of the tarball, its lockfile integrity and its package-input fingerprint must match this record.

For the final source-to-artifact comparison, resolve `v0.1.0^{commit}` to the full SHA, run `sh tests/rehearsal/build-source.sh "$SOURCE" "$OUT/rebuild"` with that SHA, and `cmp "$archive" "$OUT/rebuild/tsdm-sdk-0.1.0.tgz"`. The rebuild also creates the `release.json` attached to the release.
