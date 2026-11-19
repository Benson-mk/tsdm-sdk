# SDK #24 qualification record

The November 19, 2026 run built the local `tsdm-sdk@0.1.0` candidate on integrated commit `dbb136988da99c38783117ca6d7436b88a5a15fa` (#23). The exact tarball SHA-256 is `52a6b92e2fe8678ac0c3d7748097a52a80fcfba811d3db6396d0cafe1e1a9bf7`.

- [Installed SDK receipt](0.1.0-installed.json) records 31 scenarios and 84 host requests. A clean Node 26 project installed the archive offline, verified its lockfile integrity and links to both writing guides, and compiled the packaged posts example with strict TypeScript and an empty ambient type set. The receipt includes expected and observed result records and request fields. It covers creation, both edit targets, new and existing draft saves, draft publication, scheduling with date readback and immediate publication, native HTML and manual HTTP redirects, challenge update/check and browser destinations, refusal, moderation, redisplay, wrong session or target and uncertainty after dispatch. A native draft’s effectful publication link was observed without issuing its GET.
- [Direct HTTP receipt](0.1.0-direct.json) records 16 runs of the Python requests and curl snippets extracted from the tarball. The disposable server observed the method, destination, form fields and fictitious session for each operation. Both examples stopped after the form GET when approval was absent. The direct examples print the raw forum acknowledgement. The installed SDK checks the resulting state independently.
- [Combined regressions](0.1.0-regressions.json) records the core SDK and installed account, profile, member, collections, spaces, messages and notices checks. It contains the regenerated #23 installed and direct HTTP observations against the same tarball and the archived-client consumer replays against a separately built historical entry. The historical fixtures exercise publication, replies, edits and drafts. Full run outputs can be regenerated with the commands below.

The [upstream pins](upstream-pins.json) identify 17 checked files at `Carinoasd/tsdm_client` v1.59.0, commit `02df67e39ded906def5b868e8f8311ba735b316c`. The installed and loopback fixtures are authored from the pinned protocol and use fictitious accounts, content, form tokens and dates. The run establishes behavior of the packaged SDK and the supplied host adaptations. Deployment privileges, successful live scheduling and completion in a user’s browser remain unobserved.

## Replay

Use Node 26, npm, Python 3 with `requests`, curl, jq and the pinned upstream checkout. Supply a writable local npm cache if needed. Both direct checks bind temporary listeners on `127.0.0.1`.

```sh
# Set UPSTREAM to the pinned upstream checkout and OUT to a new output directory.
npm ci --offline
npm run pack:sdk
archive=dist/tsdm-sdk-0.1.0.tgz
shasum -a 256 "$archive"
sh evidence/posts/check-candidate.sh "$UPSTREAM" "$archive" "$OUT"
```

The preimplementation clean install failed on the missing `createPostClient` export. Subsequent tracer runs exposed missing edit preflight, draft capability, native handling and challenge dispatch, as well as mismatched target and reply-subject fields. The final run verifies those paths through the installed package.
