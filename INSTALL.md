# Install tsdm-sdk

Use Node.js 26.x and npm. The package exposes ESM through `import { createForumClient } from "tsdm-sdk"` and includes TypeScript declarations. A strict TypeScript 6.0.3 consumer was checked with `module: "NodeNext"`, `lib: ["ES2023"]`, and `types: []`. The SDK needs no browser DOM types. The host supplies the transport and any session state required for the operation.

## Install the versioned release asset

The `v0.1.0` install has been rehearsed locally. Once `v0.1.0` is published, use its versioned GitHub Release URL in an npm project.

```sh
npm install --save-exact --engine-strict https://github.com/Benson-mk/tsdm-sdk/releases/download/v0.1.0/tsdm-sdk-0.1.0.tgz
```

For a local rehearsal, follow the [rebuild instructions](tests/rehearsal/README.md) and install the resulting tarball by absolute path. To verify an archived download, compare `shasum -a 256 tsdm-sdk-0.1.0.tgz` with `sha256` in the accompanying `release.json`. Retain both files if you need to verify the download later.

## Restore a pinned version

Commit the consumer's `package.json` and `package-lock.json` together. Keep the versioned URL as the dependency and let npm record the resolved URL and SHA-512 integrity in the lockfile. When testing a later release, commit or save both original files first. To restore them, replace both with the originals, then run `npm ci`. For an empty-cache restore, use:

```sh
npm ci --engine-strict --cache "$(mktemp -d)"
```

Require a successful exit before running the installed code. npm can leave extracted files behind after an integrity failure. For a guest read through the installed SDK, use the [board and thread example](README.md#read-a-public-board-and-open-a-thread).
