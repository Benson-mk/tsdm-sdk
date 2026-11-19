# Historical UI client transfer

SDK ticket [#11](https://github.com/Benson-mk/tsdm-sdk/issues/11) establishes the extracted client baseline for the first SDK release. The [maintainer decision](https://github.com/Benson-mk/tsdm-sdk/issues/3#issuecomment-6971726334) records the approved paths and consumer replay.

## History attachment

| Identity | Commit |
| --- | --- |
| SDK integration base and first merge parent | `3b60eaae4d98991247d6afeb73a2f92b72fb4ee3` |
| Pinned UI tree | `94f68a5558d016d561b2bac417db2f52b5d27510` |
| Last retained original UI commit | `c6cf001b953bb6553e54796b9e75ce5dcda153da` |
| Filtered tip and second merge parent | `256111cce69687b9fef09a266f332d660fe41a90` |

Each selected path maps identically from the UI to the SDK. The pinned [package builder](https://github.com/Benson-mk/tsdm-ui/blob/94f68a5558d016d561b2bac417db2f52b5d27510/scripts/package-library.mjs) retains the original UI package-version notes.

| UI path | SDK path | Entries |
| --- | --- | ---: |
| `src/forum-client/` | `src/forum-client/` | 30 |
| `tests/consumer/` | `tests/consumer/` | 10 |
| `vite.library.config.ts` | `vite.library.config.ts` | 1 |
| `tsconfig.library.json` | `tsconfig.library.json` | 1 |
| `scripts/package-library.mjs` | `scripts/package-library.mjs` | 1 |
| `scripts/check-consumer.mjs` | `scripts/check-consumer.mjs` | 1 |
| `scripts/replay-consumer.mjs` | `scripts/replay-consumer.mjs` | 1 |

The [commit map](ui-commit-map.tsv) covers all 153 commits reachable from the UI pin. It identifies 39 rewrites and 114 pruned originals, including the pin itself. The merge at the pin introduced no additional selected tree changes. Raw author identities and timestamps and the selected tree of every retained commit matched their original. Use the full original SHA at the [UI repository](https://github.com/Benson-mk/tsdm-ui) to recover mixed-commit context and the original issue references.

### Reproduce the filter and verify the tree

The transfer used Git 2.39.5 (Apple Git-154). Set `ui` and `sdk` to the source and SDK checkout paths. Set `attachment` to the SDK history merge commit.

```bash
set -euo pipefail
pin=94f68a5558d016d561b2bac417db2f52b5d27510
paths=(
  src/forum-client tests/consumer
  vite.library.config.ts tsconfig.library.json
  scripts/package-library.mjs scripts/check-consumer.mjs scripts/replay-consumer.mjs
)
scratch=$(mktemp -d)
git init --bare -q "$scratch/source.git"
git init --bare -q "$scratch/filtered.git"
git -C "$scratch/source.git" fetch -q --no-tags "$ui" "${pin}:refs/heads/ui-sdk-import"
git clone --no-local -q --branch ui-sdk-import "$scratch/source.git" "$scratch/pinned"
git -C "$scratch/pinned" fast-export --show-original-ids \
  --export-marks="$scratch/source.marks" refs/heads/ui-sdk-import -- "${paths[@]}" |
  git -C "$scratch/filtered.git" fast-import --quiet --export-marks="$scratch/filtered.marks"

git -C "$ui" ls-tree -r -z "$pin" -- "${paths[@]}" > "$scratch/original.tree"
git -C "$scratch/filtered.git" ls-tree -r -z refs/heads/ui-sdk-import > "$scratch/filtered.tree"
git -C "$sdk" ls-tree -r -z "$attachment" -- "${paths[@]}" > "$scratch/attached.tree"
cmp "$scratch/original.tree" "$scratch/filtered.tree"
cmp "$scratch/original.tree" "$scratch/attached.tree"
git -C "$sdk" show -s --format=%P "$attachment"
```

The three tree listings matched byte for byte across all 45 paths, modes and blob IDs. Each mode is `100644`. The SHA-256 of the NUL-delimited listing is `202f811cad8d2d8727401da8dbe8ef7acf755388c8dafbeaf9eb41d857619bab`.

To reconstruct the commit map, join the marks files by mark number and keep entries whose filtered object is a commit. Compare those originals with `git rev-list --topo-order --reverse "$pin"` in the UI checkout to identify the pruned entries. The attachment fetched only the filtered ref and used `git merge --allow-unrelated-histories --no-ff --no-commit` with the filtered tip before committing the transfer evidence.

Blame was checked with `git blame --root --line-porcelain <ref> -- <path>` at the UI pin and the SDK attachment. Mapping the UI commit on each line through the table gives the SDK commit on that same line.

| Path | Matching lines | Distinct original commits |
| --- | ---: | ---: |
| `src/forum-client/html.ts` | 267 | 6 |
| `src/forum-client/index.ts` | 939 | 20 |
| `tests/consumer/current-types.txt` | 134 | 8 |

## Historical consumer evidence

The [original November 14 run](consumer-2026-11-14T13-08-40.303Z/report.md) preserves all 11 files byte for byte from `evidence/runs/108-preserved-originals/tsdm-ui-108-delivery/evidence/runs/consumer-2026-11-14T13-08-40.303Z` in the UI evidence checkout. The pinned UI implementation record identifies that run. [UI #108 receipt reference](https://github.com/Benson-mk/tsdm-ui/blob/94f68a5558d016d561b2bac417db2f52b5d27510/docs/implementation/ui-ux-108.md#L294)

| Verified identity | SHA-256 |
| --- | --- |
| Original manifest, covering all ten other files | `f6b42c4a06aea94966d86f7419ae7e9a4f9840c2fd7c7d3fe205ca3359371c48` |
| Original `@tsdm/forum-client@0.26.0` archive, 115,363 bytes | `1e0d15a313cd8aee8d08e6a596beda67225de9796fdb808c051dd5f5546457fe` |

The archive contains seven regular files. Its ESM entry is `index.js`. Its four shipped declarations are `index.d.ts`, `types.d.ts`, `prepare-writing.d.ts` and `edit-post.d.ts`. The other entries are `package.json` and `README.md`. The consumer source, receipts and notices live alongside the archive as repository evidence. The consumer uses stubbed transports with reserved example domains and synthetic forum records.

### Replay from an SDK checkout

Use Node.js 24.22.0 and npm 11.21.1. The clean consumer resolves TypeScript 6.0.3 from its lockfile. With a cold npm cache, run `npm cache add typescript@6.0.3` first.

```bash
run=consumer-2026-11-14T13-08-40.303Z
replay=$(mktemp -d)
cp -R "evidence/history/$run" "$replay/"
cd "$replay/$run"
shasum -a 256 manifest.json tsdm-forum-client-0.26.0.tgz
npm exec -- node replay-consumer.mjs .
```

The [November 19 SDK replay](consumer-2026-11-14T13-08-40.303Z-replay-2026-11-19T02-19-42.783Z/report.md) verified every manifest member, installed the exact archive in an isolated consumer, compiled the strict public declarations without DOM types and reproduced every recorded observation. The script writes a separate receipt, report and manifest next to the copied input. The retained replay used a warm cache in offline mode. It checks the historical package through public imports and synthetic transport, with live deployment and SDK 0.1.0 qualification tracked separately.

### Rebuild from the full UI pin

Export the full UI tree at the pin into an empty directory with `git archive` or check out that commit cleanly. Use the same Node.js and npm versions, unset `RELEASE_TAG` and run these commands in that directory.

```bash
unset RELEASE_TAG
npm ci
npm run build
npm run test:consumer
```

The November 19 clean build and consumer run `consumer-2026-11-19T02-17-59.742Z` passed using cached dependencies. Its packed archive matched the November 14 archive byte for byte, which also verifies the ESM entry and all four shipped declarations. The observed runtime results and qualification input manifest matched the original. All 48 inputs listed in [inputs.json](consumer-2026-11-14T13-08-40.303Z/inputs.json) were independently hashed from the pinned UI Git blobs and matched their recorded sizes and SHA-256 digests.

The historical package builder checks that the built userscript and its metadata share the same header. The full UI pin provides these shared inputs and the notice generator.

| Pinned UI path | Git blob | SHA-256 |
| --- | --- | --- |
| `package.json` | `61d149a5c59f27b935badf0c396452012f344044` | `cd8043a9f3988edc34b02bf58e7f12b47c55ba556cc98655c65a5fc56a4ae685` |
| `package-lock.json` | `1726db3059d92ce0142ac5974957ab91a7d003e4` | `ff92f13457df78791ff0d2cd9f931daf6c383124231a8d7ae594aa366a3430b5` |
| `.npmrc` | `b6f27f135954640c8cc5bfd7b8c9922ca6eb2aad` | `7151cf397def0c2cb0ab65643701d27d335a72c90f775675b5f826bc7005818a` |
| `.nvmrc` | `a43a5b943d99774f28761310d5fa42e839602f22` | `a1c56e968c358e10872d64220b3ae759ffe7feaffc4da95fae425dbcca43fe44` |
| `tsconfig.json` | `9aa897d242c0ad6ad8fbf78bc0bcca31ecaf09f8` | `99589ece267e4c2eee8972db7ada820c59be2cad67042b6b24f5185dfaade838` |
| `vite.config.ts` | `8e5cde08ad9a882717194d0b158f73475d986643` | `e061cd5a551970d7838f40dc38cefd01b99fb4da90b25aee780777b6d7871d3e` |
| `vite.editor-focus.ts` | `4cc11b152f2e0b9a01afd4d9f83f29935a866314` | `b7ed115c865fc9714808ce4f2866fce40b3dbc8bdcf6f5463c281bef1f033aca` |
| `scripts/package-notices.mjs` | `316b6a46dab1bf8e4b63a0f1a8a39daaf5be6b34` | `9bf1ca47d1160a1cc44737809e3f920de1748d791a9991e76abc888e6b7aaab4` |

### Notices

The dependency notices are preserved from the locked npm installation as [parse5 8.0.1, MIT](notices/parse5-8.0.1.LICENSE) and [entities 8.1.0, BSD-2-Clause](notices/entities-8.1.0.LICENSE). The later UI release rehearsal described in #3 has archive SHA-256 `8645bf2d0e12e1781de765f85a771261dccc1d010f5c3471a45b7352b00f60dd`. Its package metadata lists an additional `THIRD_PARTY_NOTICES.md`. Separate identities preserve the provenance of the historical bytes and the later rehearsal. [Maintainer decision](https://github.com/Benson-mk/tsdm-sdk/issues/3#issuecomment-6971726334)

## Transfer cutoff

The maintainer confirmed the official hosted UI `main` via the hosting API on 2026-11-19 at `94f68a5558d016d561b2bac417db2f52b5d27510`. Local UI `main` and `origin/main` resolved to the same full SHA. `git rev-list --count "$pin..$cutoff"` returned zero and the full-tree diff from pin to cutoff was empty. This also covers changes to SDK code in mixed UI commits, build and lock inputs, declarations, consumer fixtures, replay tooling and notices.

There are zero intervening commits to classify, port or skip. The November 19 receipt is a replay of the original baseline. Standalone packaging and behavior changes begin from this baseline with their own artifact identities and receipts. [Parent issue](https://github.com/Benson-mk/tsdm-sdk/issues/10)
