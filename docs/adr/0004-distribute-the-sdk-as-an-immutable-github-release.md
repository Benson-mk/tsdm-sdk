# Distribute tsdm-sdk as an immutable GitHub Release

Use `tsdm-sdk` as the package name and public import. It matches the repository and keeps consumer imports short. Both the repository README and the packaged README identify the SDK as unofficial. Release `0.1.0` supports Node.js 26.x only and exposes an ESM entry point with TypeScript declarations.

Distribute the packed tarball exclusively through public, immutable GitHub Releases. Enable release immutability before publishing `v0.1.0`. Consumers can install `tsdm-sdk-0.1.0.tgz` anonymously from its versioned release URL and commit their npm lockfile. A later `npm ci` restores the pinned bytes. Each upgrade selects a new release URL, and corrections to published artifacts require a new version.

Keep the README and third-party notices inside the tarball. Attach a manifest recording the package name, version, tag, full SDK source commit, tarball filename and SHA-256 to the same release. A consumer who retains both files can verify the archive even if the hosted copy becomes unavailable. [Maintainer decision, install command and replay evidence](https://github.com/Benson-mk/tsdm-sdk/issues/6#issuecomment-6977558151)
