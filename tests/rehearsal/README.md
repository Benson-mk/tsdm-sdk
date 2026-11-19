# Versioned asset installation rehearsal

Use Node.js 26.x, npm, Git, and `tar`. Use the Node.js and npm versions recorded in the receipt for a byte-for-byte replay. The build uses the pinned SDK source commit and its npm lockfile. It needs the locked development packages from the npm registry or a populated npm cache. The SDK consumer uses new empty caches and versioned loopback HTTP paths. See the [installation guide](../../INSTALL.md) for the downstream commands and compatibility details.

Run from the repository root:

```sh
source_commit=$(node -p 'require("./tests/rehearsal/release.json").sourceCommit')
output=$(mktemp -d)
sh tests/rehearsal/build-source.sh "$source_commit" "$output"
cmp "$output/release.json" tests/rehearsal/release.json
shasum -a 256 "$output/tsdm-sdk-0.1.0.tgz"
npm ci --ignore-scripts --no-audit --no-fund
npm run test:rehearsal -- "$output/tsdm-sdk-0.1.0.tgz" "$output/release.json" "$output/receipt.json"
cmp "$output/receipt.json" evidence/rehearsal/receipt.json
```

The source build uses a fresh export of the full committed tree. It produces the archive and `release.json` together. The manifest is external to the archive and names the complete source commit, version, tag, filename, digest and intended release URL. Keeping the rehearsal and downstream guide outside the package lets the rehearsal commit reproduce the package bytes of its integrated parent without a self-referential source hash. Keep the archive and manifest together for local use.

The [receipt](../../evidence/rehearsal/receipt.json) records the lock URL and integrity, package-root ESM import, strict declaration check without DOM or ambient Node types, upgrade to synthetic `0.1.1`, and restoration of the original lock while the newer asset is available. It records the SHA-256 of the changed archive and the npm `EINTEGRITY` failure. The runner flips one gzip header byte and proves that the decompressed contents are identical. The original lock therefore rejects changed archive bytes even though the package payload can still be extracted. Discard the failed install directory.

The runner removes its temporary consumers and caches and closes the loopback server on success or failure. Receipt URLs use `<loopback>` in place of the temporary origin. This is a local rehearsal of the release path and npm behavior. Hosting, access and immutability on GitHub require separate verification when a release is authorized.
