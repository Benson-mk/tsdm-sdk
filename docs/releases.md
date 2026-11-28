# SDK CI and releases

SDK CI runs for pull requests and pushes to `main`. It builds a tarball with the locked dependencies on Node.js 26, tests a clean install and public imports, and type-checks the installed declarations. Each successful run retains the tarball, `release.json`, and an `install.json` receipt as an Actions artifact for 30 days. CI does not publish to GitHub Releases or npm.

Pull requests also run the installed trades and moderation regression suites against that same tarball. The suites use controlled responses and do not contact the forum. Successful PR artifacts include `trades.json` and `moderation.json` with the tested archive SHA-256 and scenario results.

## Preview and qualify

1. Bump the SDK version with `npm version <version> --no-git-tag-version`. This updates `package.json` and its lockfile without creating a tag. Update the versioned installation examples in `README.md` and `INSTALL.md`.
2. Copy the [release summary template](releases/notes/template.md) to `docs/releases/notes/v<version>.md` and fill in the user-facing changes. The workflow adds categorized changes since the nearest prior stable tag, a source-pinned changelog, and installation and qualification links. It uses the categories in `.github/release.yml` and groups commits by their Conventional Commit type (`feat`, `fix`, `docs`, or other); it does not fetch PR labels for the workflow preview.
3. Run **Build and publish SDK release** manually to preview the branch. A manual run only builds and uploads an Actions artifact, even if dispatched for a tag. The full `RELEASE_NOTES.md` appears in the run summary and artifact. A preview marks an unfinished summary or qualification record as pending; a tagged candidate requires both.
4. Qualify the preview tarball per [ADR 0007](adr/0007-qualify-the-release-tarball-and-record-carried-forward-evidence.md). Run the signed-out README example against the installed tarball and recheck the affected journeys. Commit a record at `evidence/release/<version>/README.md` with the exact candidate SHA-256 and the evidence. Record the Node and npm versions from `install.json` for repeat builds.

To reproduce the automated package checks locally with Node.js 26:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run pack:sdk
node scripts/check-installed-sdk.mjs > dist/install.json
```

After packing, reproduce the PR regression checks with:

```sh
archive="dist/tsdm-sdk-$(node -p 'require("./package.json").version').tgz"
node scripts/check-installed-trades.mjs "$archive" > dist/trades.json
node scripts/check-installed-moderation.mjs "$archive" > dist/moderation.json
```

## Publish from a version tag

In **Settings → Environments → `github-release`**, allow only tags matching `v*` and leave **Required reviewers** off. Keep immutable releases enabled in **Settings → General**; the workflow checks immutability after publication.

1. After merging the version, release summary and qualification record to `main`, push a matching `vMAJOR.MINOR.PATCH` tag pointing to that commit. Pushing the tag starts the release; there is no separate approval.
2. The workflow builds and verifies the SDK, checks the tag and qualification record, and prepares the artifact and release notes. The publishing job validates the artifact, notes and remote tag, then publishes the tarball and manifest to GitHub Releases with the prepared `RELEASE_NOTES.md` as the release description.

If GitHub leaves an unpublished draft because an upload fails, inspect it before retrying. Do not replace already published assets; ship a new version instead.
