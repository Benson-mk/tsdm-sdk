# SDK #22 collection qualification

The [collection guide](../../docs/collections.md) ships with the package. These receipts qualify the combined local `0.1.0` archive on integration parent `0535173338a339039f1401cfe2e581de45daa26c` (#21). The tests use fictitious accounts, an in-process host transport, and a loopback HTTP fixture. They establish what the SDK and examples do with controlled inputs. There were no deployment observations or live writes.

## Replay

Use Node.js 26.0.0, npm 11.12.1, and the locked build dependencies. The direct guide check used Python 3.12.10, requests 2.34.2, and curl 8.7.1.

```sh
npm ci
npm run pack:sdk
ARCHIVE=dist/tsdm-sdk-0.1.0.tgz
node scripts/check-installed-collections.mjs "$ARCHIVE" > /tmp/sdk22-installed.json
python3 evidence/collections/check-direct-guide.py "$ARCHIVE" > /tmp/sdk22-direct.json
cmp evidence/collections/0.1.0-installed.json /tmp/sdk22-installed.json
cmp evidence/collections/0.1.0-direct.json /tmp/sdk22-direct.json
```

The installed runner creates a fresh temporary project, installs only the archive offline with scripts disabled, verifies its npm lock integrity, and executes the package-root consumer. It checks the example in the packaged guide with strict TypeScript and runs it with Node. The direct runner extracts the packaged Python and curl snippets and substitutes a loopback origin. It checks the native collection request and returned heading for both tools. The request table in the guide covers direct writes. Their dedicated effect and receipt verification is in the installed consumer.

[`upstream-pins.json`](upstream-pins.json) attributes and identifies the inputs used to derive the synthetic scenarios. They follow `Carinoasd/tsdm_client` at `02df67e39ded906def5b868e8f8311ba735b316c`, particularly the collection repository, parsers, fixtures, and upstream regression tests 853 and 1022. The repository contains the authored fixture text in [`collections.mjs`](../../tests/install/collections.mjs). To also verify the pinned source bytes, set `TSDM_COLLECTIONS_UPSTREAM` to the root of the pinned source tree before running the installed check.

## Coverage and decisions

- Read paths cover recommended, sorted all, owned and team, subscribed, a specific thread’s related collections, paged detail, comments, and v4 and legacy add dialogs. Separate owned and subscribed calls each do a fresh `op=my` read. This keeps operations independent and can cost a second request when the host wants both. Public reads accept guest access. Personal reads require a verified member even when the native guest page can show an empty directory. Native selectors and exact target and page checks favor valid evidence at the cost of rejecting some unexpected templates or rewritten URLs.
- `createCollectionClient` uses the existing host response contract with a collection-specific request type. Original returned objects bind write offers to exact targets and the session on the client instance. This keeps form tokens out of display data and prevents edits to public fields from retargeting a write. Reconnecting or deserializing a read requires fetching fresh write authority. Removal is scoped to IDs offered on the loaded page. The server still decides permissions and quotas at dispatch.
- Add-dialog discovery takes an extra status request to check whether v4 advertises `collection`. The SDK falls back on an unusable supported form before any write, posts the qualified form variant once, and requires the structured operation key for a v4 submission. Unknown hooks and unfamiliar targets do not qualify for structured submission.
- Receipts cover create from a list and dialog, edit, remove threads, delete, add, comment and rate, subscribe, and unsubscribe. Each dispatch has an assertion on its host method, effect flag, session, URL and submitted fields. Deletion, subscription and unsubscription are effectful GETs. The created-collection handoff is checked against the new ID and canonical URL. A matching acceptance receipt can include a redundant add. Redrawn forms, blank duplicate-subscription responses, conflicting targets, and transport failures remain uncertain. A caller can investigate with an independent read. This avoids a retry or inferred success at the cost of leaving some real effects unresolved. Legacy success needs a recognized callback and any operation-specific target evidence.
- Receipt tests use deterministic authored responses for permission, login, rate-limit, stale hash, mismatched actor, off-origin redirect and session drift cases. This makes the evidence replayable without credentials and leaves forum deployment behavior for release qualification. The general installed entry-point check accounts for the new export. The notices guide check keeps requiring its original guides and validates every linked guide so adding a task no longer breaks the earlier check.
