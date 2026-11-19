# Run and reconcile a batch rating

Use an authenticated member with the forum's batch-rating permission. The plugin must advertise `batchrate` in `status`, then offer the selection or records capability for the current account. Provide the canonical HTTPS forum origin, member ID and session continuity to the SDK. Honor `fresh`, encode POST bodies as `application/x-www-form-urlencoded`, and return the original response URL, status, content type and raw redirect `Location`. Send each POST once. Preview and recalculation are POSTs with `effect: false`. Creation, execution and revocation are POSTs with `effect: true`.

## TypeScript

```ts
import {
  createBatchRatingClient,
  type BatchRatingClientOptions,
  type BatchRatingScope,
  type BatchRatingSelection,
  type BatchRatingSettings,
} from "tsdm-sdk";

export async function batchRatingExample(
  host: BatchRatingClientOptions,
  scope: BatchRatingScope,
  selection: BatchRatingSelection,
  settings: BatchRatingSettings,
  approve: (operation: "create" | "run", details: unknown) => Promise<boolean>,
) {
  const client = createBatchRatingClient(host);
  const access = await client.discoverBatchRating(scope);
  if (access.kind !== "batch-rating-access") return access;
  const original = await client.previewBatchRating(access.access, selection);
  if (original.kind !== "batch-rating-preview") return original;
  const reviewed = await client.recalculateBatchRating(original.preview, settings);
  if (reviewed.kind !== "batch-rating-preview" || !reviewed.preview.canCreate) return reviewed;
  const created = await client.createBatchRating(reviewed.preview, await approve("create", reviewed.preview));
  if (created.kind !== "batch-rating-created" || !created.batch.canRun) return created;
  const step = await client.runBatchRatingStep(created.batch, await approve("run", created.batch.record));
  if (step.kind === "finished") return client.readBatchRatingResult(created.batch);
  return { created, step };
}
```

`discoverBatchRating({ forumId, threadId })` reports whether the forum offers thread-first-post selection (`threads`), explicit post IDs (`posts`), or floor ranges (`floors`). Use IDs as decimal strings. `discoverBatchRating()` can qualify records without a forum selection. `previewBatchRating` uses the offered selection destination. A floor selection can include closed ranges, individual floors and an open tail such as `2~4 7 9~`.

`recalculateBatchRating` returns a new preview for changed scores, multipliers, thresholds, exclusions, floor ranges and notification preferences. Inspect the selected and skipped posts, eligible count, quota and precheck issues before approving. The SDK creates from the exact reviewed preview. If creation redisplays a preview, inspect and approve it separately after any required changes. `batch-rating-created` establishes a batch ID and may leave all ratings pending.

Keep the same client instance while the SDK handles are in use. Call `runBatchRatingStep(batch, true)` once for each deliberately approved chunk. `advanced` supplies the observed progress. `finished` can be followed by `readBatchRatingResult(batch)`. `no-progress`, `refused` and `uncertain` end the attempt. Use `listBatchRatings(access, page)` and `readBatchRatingDetail(access, id)` to inspect the persisted batch. `resumeBatchRating(access, id)` is a read and may return a new run form or the finished result. Inspect persisted progress before approving a further chunk. A lost creation receipt can require reading recent batches, and the SDK cannot attribute indistinguishable records to one particular attempt.

`revokeBatchRatingItem(batch, itemId, true)` uses an eligible item from batch detail. Use the item ID, which identifies the rating entry in that batch. For batch revocation, read its detail and call `revokeBatchRatingStep(batch, true)` separately for each approved chunk. A revocation can take credits back for eligible ratings. Read fresh detail to reconcile either revocation. The step result ends that attempt on `finished`, `no-progress`, `refused` or `uncertain`. A read-only reconciliation never submits a chunk.

## Direct Python requests

Use an authenticated `requests.Session` configured for one attempt. Check `status`, `batchrate` and the response `uid` before using the forms, using the same member session throughout. Form bodies are ordered name/value pairs based on the forum's served fields. For `preview`, include the selected mode and IDs or the floor range. For `recalc`, send the selected values and `recalc=1`. For `create`, send the exact reviewed values with `ratesubmit=1` and explicit approval. Preserve the supplied `formhash` privately. For execution and batch revocation add the exact `batchid`. For single revocation add the exact `itemid` from detail. Pass the server's action URL for each POST.

```python
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit


def api_read(session, origin, action, *, forum_id=None, thread_id=None):
    if action not in {"status", "batchrate"} or (thread_id is not None and forum_id is None):
        raise ValueError("Invalid batch-rating discovery")
    params = {"id": "tsdmapp:api", "action": action}
    if action == "batchrate" and forum_id is not None:
        params["fid"] = forum_id
        if thread_id is not None:
            params["tid"] = thread_id
    return session.get(origin + "/plugin.php", params=params, allow_redirects=False, timeout=20)


def batch_read(session, origin, operation, *, batch_id=None, page=1):
    if operation == "list":
        params = {"id": "batchrate:list"}
        if page > 1:
            params["page"] = page
    elif operation in {"detail", "resume", "result"} and batch_id is not None:
        if operation == "result":
            params = {"id": "batchrate:rate", "brmode": "result", "batchid": batch_id}
        else:
            params = {"id": "batchrate:list", "bract": "continue" if operation == "resume" else "detail",
                      "batchid": batch_id}
    else:
        raise ValueError("Invalid batch record read")
    return session.get(origin + "/plugin.php", params=params | {"tsdmapp": "json", "nodoc": "1"},
                       allow_redirects=False, timeout=20)


def submit_once(session, origin, operation, offered_url, fields, *, approved=False, target_id=None):
    read_post = operation in {"preview", "recalc"}
    if not read_post and approved is not True:
        return None
    base = urlsplit(origin)
    url = urlsplit(urljoin(origin + "/", offered_url))
    if (url.scheme, url.netloc, url.path) != (base.scheme, base.netloc, "/plugin.php") or url.fragment:
        raise ValueError("Unexpected plugin destination")
    pairs = parse_qsl(url.query, keep_blank_values=True)
    query = dict(pairs)
    body = list(fields)
    controls = dict(body)
    if len(query) != len(pairs) or len(body) != len(controls) or not controls.get("formhash"):
        raise ValueError("Missing form token or duplicate field")
    if operation in {"preview", "recalc", "create"}:
        mode = controls.get("brmode")
        if (query.get("id") != "batchrate:rate" or set(query) - {"id", "brmode"}
                or mode not in {"1", "2", "3"} or query.get("brmode", mode) != mode):
            raise ValueError("Unexpected rating form target")
        if ("ratesubmit" in controls) != (operation == "create") or ("recalc" in controls) != (operation == "recalc"):
            raise ValueError("Unexpected effect control")
        if any(controls.get(flag, "1") != "1" for flag in ("ratesubmit", "recalc")):
            raise ValueError("Invalid effect control value")
    else:
        expected, action, key = {
            "run": ("batchrate:run", None, "batchid"),
            "revoke-item": ("batchrate:list", "undo_item", "itemid"),
            "revoke-batch": ("batchrate:list", "undo_batch", "batchid"),
        }[operation]
        if (query.get("id") != expected or query.get("bract") != action or set(query) - {"id", "bract"}
                or target_id is None or controls.get(key) != str(target_id)):
            raise ValueError("Unexpected chunk or revocation target")
    query["tsdmapp"] = "json"
    return session.post(urlunsplit(url._replace(query=urlencode(query))), data=body,
                        allow_redirects=False, timeout=20)
```

The direct helpers use the pinned form names and canonical read routes. If the forum offers a variation, check its metadata and exact destination before using it. Inspect schema 32 for availability, 33 for the preview, 34 for creation, detail or result, and 35 for records. A schema 13 `handle` must match `batchrate_run`, `batchrate_undo_item` or `batchrate_undo_batch` for the corresponding request. Inspect the counters and `finished` flag for a stepped operation. A resume GET may return a manual redirect to the exact batch result. Review the origin and ID before opening the result.

## Direct curl

Use the same authenticated cookie jar and canonical origin for all calls. Set `FID`, `TID`, `BATCH_ID` and optionally `PAGE` for the intended reads. Record selection and reviewed values from the response before submitting anything.

```sh
plugin="$FORUM_ORIGIN/plugin.php"
read_plugin() {
  curl -sS --include --max-time 20 --cookie "$FORUM_COOKIE_JAR" --get "$plugin" "$@"
}
read_plugin --data-urlencode id=tsdmapp:api --data-urlencode action=status
read_plugin --data-urlencode id=tsdmapp:api --data-urlencode action=batchrate --data-urlencode "fid=$FID" --data-urlencode "tid=$TID"
read_plugin --data-urlencode id=batchrate:list --data-urlencode "page=${PAGE:-1}" --data-urlencode tsdmapp=json --data-urlencode nodoc=1
for action in detail continue; do
  read_plugin --data-urlencode id=batchrate:list --data-urlencode "bract=$action" --data-urlencode "batchid=$BATCH_ID" --data-urlencode tsdmapp=json --data-urlencode nodoc=1
done
read_plugin --data-urlencode id=batchrate:rate --data-urlencode brmode=result --data-urlencode "batchid=$BATCH_ID" --data-urlencode tsdmapp=json --data-urlencode nodoc=1
```

Run the following block separately for `preview`, `recalc`, `create`, `run`, `revoke-item`, or `revoke-batch`. Set `OFFERED_POST_URL` to the reviewed same-origin plugin action with `tsdmapp=json` appended. Supply the reviewed form body from a private process on standard input. For an effect, set `APPROVED_EFFECT` to the exact action approved. Keep the response private and inspect it before proceeding. A result with no advancement or a lost response requires a fresh read before another approved chunk.

```sh
case "${OPERATION-}" in
  preview|recalc) ;;
  create|run|revoke-item|revoke-batch) [ "$OPERATION" = "${APPROVED_EFFECT-}" ] || exit 0 ;;
  *) exit 2 ;;
esac
case "$OFFERED_POST_URL" in "$FORUM_ORIGIN"/plugin.php\?*) ;; *) exit 2 ;; esac
curl -sS --include --max-time 20 --cookie "$FORUM_COOKIE_JAR" \
  --header 'Content-Type: application/x-www-form-urlencoded' --data-binary @- "$OFFERED_POST_URL"
```
