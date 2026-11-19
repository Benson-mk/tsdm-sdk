# Moderate threads, replies and attachments

Use the canonical HTTPS origin, an authenticated member with the relevant forum permission and a continuity value that changes when the session is replaced. Honor `fresh`, send effectful requests once, and report redirects without following them. For AJAX routes the host can supply `X-Requested-With: XMLHttpRequest`. Use form encoding for POST bodies. Keep tokens, moderator-only metadata, and response bodies in private storage.

## TypeScript

```ts
import { createModerationClient, type ModerationClientOptions } from "tsdm-sdk";

export async function removeReply(
  host: ModerationClientOptions,
  forumId: string,
  threadId: string,
  postId: string,
  approve: (selection: { forumId: string; threadId: string; postId: string }) => Promise<boolean>,
) {
  const moderation = createModerationClient(host);
  const ready = await moderation.prepareModeration({
    operation: "delpost", forumId, threadIds: [threadId], postId,
  });
  if (ready.kind !== "moderation-form") return ready;
  if (!await approve({ forumId, threadId, postId })) return { kind: "not-confirmed" };
  return moderation.submitModeration(ready.form, {}, true);
}
```

Pass the desired operation, source forum and exact thread IDs to `prepareModeration`. Review the returned target, method, context, field defaults and choices. Pass only the reviewed form values to `submitModeration` with explicit approval. A form belongs to its original client and member session. A successful preparation carries the same `moderation-form` handle shape for permission-backed repair and attachment actions. Its `method` identifies the actual request.

| Operations | What to review before approval |
| --- | --- |
| `stick`, `digest`, `highlight`, `recommend` | Served levels, styling, recommendation settings and expiration. The chosen action can add, change or remove the setting. |
| `close`, `open`, `bump`, `down`, `type`, `move`, `delete` | Exact thread selection, resulting category or destination, closure, last-activity order or deletion. Supported grouped actions can take several thread IDs. If the forum offers only some, `selection-changed` reports the offered subset and requires a new explicit selection. |
| `stamp`, `stamplist` | Stamp on the thread or icon in the thread list. An offered empty choice clears it. |
| `copy`, `merge`, `split` | Destination forum or other thread, or the new title and distinct floor numbers. A merge can move floors and remove the other thread. To split across pages, supply `splitPages` for the pages that contain the reviewed floors and at least one floor that will stay. The default is page 1. The SDK re-reads those pages before dispatch. Copy or split can create a thread even when a response is lost. |
| `repair` | Permission on the exact thread. The operation can recalculate the first and last post and reply count at its first request. The SDK sends one approved empty POST and never visits the repair route to inspect it. |
| `removereward`, `refund` | The returned bounty or payment terms and possible credit changes. These are separate actions. |
| `delpost`, `warn`, `banpost`, `stickreply` | Exact post, delete or the served apply/undo choice. `banpost` changes post visibility. For `stickreply` pass `undo: true` to request the unpin window. A reply deletion redirect to thread deletion requires a separately prepared thread action. |
| `delcomment`, `removerate` | Exact comment ID or the selected served rating row values in `logidarray[]`. For adding comments and reading more comments or warnings, use the existing [activity client](activity.md). |
| `deleteattach` | Exact post and attachment ID, plus the filename returned by its edit page. The approved GET can delete it immediately, independent of saving the edit. Keep this URL out of prefetches and logs. |

`readDestinationTypes(forumId)` is read-only. Review the forum's type choices before copying or moving. Submit the reviewed `threadtypeid` where the form offers it. The SDK verifies the selected destination type again before dispatch.

`readPosterIp({ forumId, threadId, postId, page })` is an explicit private read. The SDK requires the thread and post permission and the offered route. The result has the reported IP, optional port and location. It omits the administrator links. For attachments and IP on a later thread page, supply its `page` so the SDK can inspect the exact post.

`acknowledged` means an operation-specific forum reply recognized for the request. Independently inspect the relevant thread, reply, board or records for current state before reporting it to others. `refused`, `redrawn` and `uncertain` require separate handling. A lost, redirected or unqualified reply can follow a completed action. Reconcile by reading current state and never automatically resubmit.

## Direct Python requests

Use one authenticated `requests.Session` with retries disabled. Query the exact thread or board and verify the current moderator, target and relevant permission. Match the displayed form to the operation and the selected targets. Keep only the action's reviewed controls from its current form. For an attachment, review the bound attachment and form hash on its exact edit page. Neither authentication cookies nor form hash values belong in shared evidence.

```python
from urllib.parse import parse_qsl, urljoin, urlsplit

GROUPS = {
    "stick": 1, "digest": 1, "highlight": 1, "recommend": 1,
    "move": 2, "type": 2, "delete": 3, "bump": 3, "down": 3,
    "close": 4, "open": 4,
}
TOPIC_POST = {"stamp", "stamplist", "copy", "merge", "split", "removereward", "refund",
              "delpost", "warn", "banpost", "stickreply", "delcomment", "repair"}
AJAX = {"X-Requested-With": "XMLHttpRequest"}


def forum_url(origin, offered):
    base = urlsplit(origin)
    url = urlsplit(urljoin(origin + "/", offered))
    if ((base.scheme, base.netloc, "/forum.php") != (url.scheme, url.netloc, url.path)
            or url.fragment or url.username or url.password):
        raise ValueError("Unexpected forum destination")
    pairs = parse_qsl(url.query, keep_blank_values=True)
    singleton = [key for key, _ in pairs if key not in {"moderate[]", "topiclist[]"}]
    if len(singleton) != len(set(singleton)):
        raise ValueError("Duplicate routing parameter")
    return url.geturl(), dict(pairs)


def read_moderation(session, origin, offered):
    url, query = forum_url(origin, offered)
    if (query.get("mod"), query.get("action")) not in {
        ("forumdisplay", None), ("viewthread", None), ("post", "edit"),
        ("ajax", "getthreadtypes"), ("misc", "removerate"),
        *(("topicadmin", action) for action in (TOPIC_POST - {"repair"}) | {"moderate", "getip"}),
    } or any(key in query for key in ("modsubmit", "ratesubmit")):
        raise ValueError("Unexpected read route")
    return session.get(url, headers=AJAX, timeout=20, allow_redirects=False)


def submit_moderation(session, origin, operation, offered, fields=(), *, approved=False):
    if approved is not True:
        return None
    url, query = forum_url(origin, offered)
    body = list(fields)
    if operation == "deleteattach":
        if (query.get("mod"), query.get("action"), query.get("inajax")) != ("ajax", "deleteattach", "yes") or body:
            raise ValueError("Unexpected attachment route")
        return session.get(url, headers=AJAX, timeout=20, allow_redirects=False)
    if operation in GROUPS:
        expected = {"mod": "topicadmin", "action": "moderate", "modsubmit": "yes", "optgroup": str(GROUPS[operation])}
        if [value for key, value in body if key == "operations[]"] != [operation]:
            raise ValueError("Unexpected bulk operation")
    elif operation == "removerate":
        expected = {"mod": "misc", "action": operation, "ratesubmit": "yes"}
    elif operation in TOPIC_POST:
        expected = {"mod": "topicadmin", "action": operation}
        if operation == "repair" and body:
            raise ValueError("Repair has an empty body")
        if operation != "repair":
            expected["modsubmit"] = "yes"
    else:
        raise ValueError("Unexpected moderation operation")
    if any(query.get(key) != value for key, value in expected.items()) or any(
        key in {"banuser", "userdelpost", "crimerecord"} for key, _ in body
    ):
        raise ValueError("Unexpected moderation controls")
    return session.post(url, data=body, headers=AJAX, timeout=20, allow_redirects=False)
```

Supply `offered` as the exact reviewed native URL with its representation parameters, when applicable. For JSON windows use the pinned plugin form representation. For type lookup the URL is `forum.php?mod=ajax&action=getthreadtypes&fid=…&inajax=1`. Grouped windows use `mod=topicadmin&action=moderate`, `optgroup`, `fid` and repeated `moderate[]`. Add `operation=highlight`, `recommend`, `type` or `delete` for those particular windows. Other actions use their own name. Reply windows carry `tid`, `fid` and `topiclist[]`. `delcomment` uses the comment ID in the lookup's `topiclist[]`. `removerate` and `getip` use the selected post; `getip` requires the forum-offered link. For deletion, the approved `deleteattach` GET has the served `formhash`, `tid`, `pid` and one `aids[]` value. Never use `read_moderation` to preview repair or attachment deletion.

Inspect the original response. In schema 13, `admin_succeed`, `admin_repair_succeed` and `thread_rate_removesucceed` acknowledge their corresponding actions when the account and receipt match. Attachment deletion reports one deleted or zero, either in the AJAX body or its structured result. A redrawn form or redirect alone leaves the effect unverified. The raw HTTP helpers return the response for private, operation-specific inspection.

## Direct curl

Set `FORUM_ORIGIN`, the path to a private `FORUM_COOKIE_JAR`, the exact reviewed `OFFERED_URL`, `OPERATION`, `REQUEST_METHOD` and `RESPONSE_FILE`. Use `read` and `GET` for an inspected read. Set `APPROVED_EFFECT` to the exact operation only after reviewing the same-session form or effectful action. For POST, pass the reviewed form encoding on standard input. Leave standard input empty for repair. The response file must be new and private. Keep the URL and body private, especially for the attachment effect.

```sh
case "$OFFERED_URL" in "$FORUM_ORIGIN"/forum.php\?*) ;; *) exit 2 ;; esac
request() {
  umask 077
  curl -sS --include --max-time 20 --cookie "$FORUM_COOKIE_JAR" \
    --header 'X-Requested-With: XMLHttpRequest' --output "$RESPONSE_FILE" "$@" -- "$OFFERED_URL"
}
case "$REQUEST_METHOD:$OPERATION" in
  GET:read)
    case "$OFFERED_URL" in *action=repair*|*action=deleteattach*|*modsubmit=*|*ratesubmit=*) exit 2 ;; esac
    request ;;
  GET:deleteattach)
    [ "${APPROVED_EFFECT-}" = "$OPERATION" ] || exit 0
    case "$OFFERED_URL" in *\?mod=ajax\&action=deleteattach\&*) ;; *) exit 2 ;; esac
    request ;;
  POST:stick|POST:digest|POST:highlight|POST:recommend|POST:close|POST:open|POST:move|POST:type|POST:delete|POST:bump|POST:down|POST:stamp|POST:stamplist|POST:copy|POST:merge|POST:split|POST:repair|POST:removereward|POST:refund|POST:delpost|POST:warn|POST:banpost|POST:stickreply|POST:delcomment|POST:removerate)
    [ "${APPROVED_EFFECT-}" = "$OPERATION" ] || exit 0
    mode=topicadmin
    case "$OPERATION" in
      stick|digest|highlight|recommend|close|open|move|type|delete|bump|down) action=moderate ;;
      removerate) mode=misc; action=removerate ;;
      *) action=$OPERATION ;;
    esac
    case "$OFFERED_URL" in
      *\?mod="$mode"\&action="$action"\&*) ;;
      *) exit 2 ;;
    esac
    request --header 'Content-Type: application/x-www-form-urlencoded' --data-binary @- ;;
  *) exit 2 ;;
esac
```

Do a separate read to reconcile current state after a write. Keep native forms, private IP data and moderator notices out of shared application logs.
