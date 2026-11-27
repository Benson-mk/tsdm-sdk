# SDK CI and releases

SDK CI runs for pull requests and pushes to `main`. It builds a tarball with the locked dependencies on Node.js 26, tests a clean install and public imports, and type-checks the installed declarations. Each successful run retains the tarball, `release.json`, and an `install.json` receipt as an Actions artifact for 30 days. CI does not publish to GitHub Releases or npm.

## Preview and qualify

1. Bump the SDK version with `npm version <version> --no-git-tag-version`. This updates `package.json` and its lockfile without creating a tag. Update the versioned installation examples in `README.md` and `INSTALL.md`.
2. Run **Build and approve SDK release** manually to preview the branch. A manual run only builds and uploads an Actions artifact, even if dispatched for a tag.
3. Qualify the preview tarball per [ADR 0007](adr/0007-qualify-the-release-tarball-and-record-carried-forward-evidence.md). Run the signed-out README example against the installed tarball and recheck the affected journeys. Commit a record at `evidence/release/<version>/README.md` with the exact candidate SHA-256 and the evidence. Record the Node and npm versions from `install.json` for repeat builds.

To reproduce the automated package checks locally with Node.js 26:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run pack:sdk
node scripts/check-installed-sdk.mjs > dist/install.json
```

## Approve and publish

In **Settings → Environments → `github-release`**, require `Benson-mk` as the sole reviewer, disable administrator bypass, and allow only tags matching `v*`. Leave **Prevent self-review** off so the owner can queue and later approve a release. Keep immutable releases enabled in **Settings → General**.

1. After merging the version and qualification record to `main`, push a matching `vMAJOR.MINOR.PATCH` tag pointing to that commit. The tag queues a build; it does not create a GitHub Release, not even a draft.
2. Review the run summary, verify that repository release immutability is enabled, and download the Actions artifact. Compare the SHA-256 with `release.json` and the qualification record. If anything is wrong, reject the pending deployment.
3. As `Benson-mk`, select **Review deployments → `github-release` → Approve and deploy**. The publishing job confirms the approval, validates the prepared artifact and remote tag, then publishes the tarball and manifest with generated notes that link to the qualification record.

If GitHub leaves an unpublished draft because an upload fails, inspect it before retrying. Do not replace already published assets; ship a new version instead.
