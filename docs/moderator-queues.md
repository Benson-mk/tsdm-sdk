# Triage moderator queues, reports and recycle bins

Use `createModeratorPanelClient` from `tsdm-sdk` on Node 26.x. Give the client a canonical HTTPS forum origin and a signed-in forum session with `memberId` and `continuity`. Change continuity every time the host replaces the login, even for the same member. Send that session's cookies, honor `fresh: true`, report redirects manually, and use single-attempt transport for `effect: true`. Encode POST bodies as `application/x-www-form-urlencoded`. See [account sessions](account.md) and the [SDK tasks](../README.md#tasks).

The forum determines the account's permissions for each view and selection. Keep the returned page with the client and session that read it. Show the exact forum, IDs, action and any reason or credit option when asking for confirmation. The operations that require confirmation send nothing until passed `true`. Moderation submissions and login consume their prepared page or form. Obtain a fresh page after an attempt. A new search can replace the previous server-side result set. Panel login sends the password only to the returned panel login form. A candidate redirect triggers a fresh dashboard read under the same login. Keep passwords, form hashes and cookies private.

| task | SDK entry point | forum route and observation |
| --- | --- | --- |
| Dashboard and panel login | `readDashboard()`, `login(form, password, confirmed)` | GET `action=home` with JSON mode. A `panel-login` offer may lead to POST `action=login`; a fresh dashboard confirms access. |
| Thread and post search | `readSearch(kind, forumId)`, `search(page, filters, confirmed)` | GET `action=thread&op=thread` or `op=post`. Search submits the offered GET and stores temporary results in the panel session. |
| Stored search results | `readSearchResults(page, number)` | GET the supplied `do=list` destination and page under the same login. A new search invalidates earlier result handles of that kind in the client. |
| Delete selected posts | `deleteSelectedPosts(page, ids, keepCredits, confirmed)` | POST the offered `action=thread&op=post` deletion form. Permission, selected IDs and credit handling come from the observed page and approved request. The deletion key and returned rows establish full or partial success. |
| Thread and reply queues | `readQueue(kind, forumId, number)`, `moderateQueue(page, id, action, reason, confirmed)` | GET `action=moderate&op=threads` or `op=replies` with `filter=0`. The POST is scoped to the selected forum and item. `validate` publishes, `ignore` keeps hidden, and `delete` removes. An omitted author UID stays unknown. |
| Registration queue | `readQueue("members")`, `moderateQueue(page, id, action, reason, confirmed)` | GET `action=moderate&op=members&filter=0`. Acknowledgement and rereading the pending queue establish the outcome for the chosen applicant. Account deletion requires the applicant's returned permission. |
| Report list and resolution | `readReports(forumId, number)`, `resolveReport(page, decision, confirmed)` | GET `action=report` in JSON mode. POST the offered form with report ID, reporter UID, and optional permitted credit and message. The panel acknowledges with `modcp_report_success`. |
| Report deletion | `prepareReportDeletion(page, ids, confirmed)` | Returns a credential-free `admin-report-deletion` handoff with origin, forum and selected report IDs. `deleteReports` under the panel session returns `panel-report-delete-unavailable`. |
| Thread and post bins | `readRecycleBin(kind, forumId, number)`, `searchRecycleBin(page, filters, confirmed)` | GET `action=recyclebin` or `action=recyclebinpost`. POST the offered `op=search` form. Search changes temporary panel context. |
| Restore bin items | `restoreFromRecycleBin(page, ids, confirmed)` | POST `op=restore` for previously listed items, then verify against a fresh unfiltered view of the same bin. |
| Permanently delete bin items | `permanentlyDeleteFromRecycleBin(page, ids, confirmed)` | POST `op=delete` only if clearing is offered. The same bin recheck shows whether the items remain. Permanent deletion removes recovery through the bin. |

The panel uses structured dashboard, searches and reports where supported. Queue and bin reads discover v4 support in `status` and can use native HTML. The bin read accepts `"native"` as its last argument when the host needs to open the native form directly. Post-bin forms keep the returned post table. Keep one active search per kind for a cookie session across applications. The SDK can detect search replacements it initiates itself.

`acknowledged` reports the forum's explicit verdict. `completed`, `partial`, `redrawn` and `uncertain` may carry confirmed, remaining and unknown ID sets. Disappearance from a scoped bin or queue is evidence about that list. It cannot attribute a concurrent change to one moderator. Use a fresh authorized read of the same targets after a lost reply, session replacement or incomplete result. The SDK does not repeat a submission.

## TypeScript

```ts
import { createModeratorPanelClient, type ModeratorPanelOptions } from "tsdm-sdk";

export async function restoreSelectedReply(
  host: ModeratorPanelOptions,
  forumId: string,
  postId: string,
  approve: (selection: { forumId: string; postId: string }) => Promise<boolean>,
) {
  const panel = createModeratorPanelClient(host);
  const shown = await panel.readRecycleBin("posts", forumId);
  if (shown.kind !== "recycle-bin") return shown;
  if (!shown.page.canRestore || !shown.page.items.some((row) => row.id === postId)) {
    return { kind: "unavailable" } as const;
  }
  return panel.restoreFromRecycleBin(shown.page, [postId], await approve({ forumId, postId }));
}
```

## Direct HTTP

Use a private cookie session, a stable canonical HTTPS origin and an application-supplied login identifier that changes whenever the login changes. Use the current response to obtain form destinations, hashes, fields, permission and selectable IDs. Review the complete intent before a POST or search GET. The helpers below send a single approved request and expose the response for interpretation. After a candidate login redirect, read `action=home` yourself. Each forum request uses `/forum.php?mod=modcp`; capability discovery uses `/plugin.php?id=tsdmapp:api&action=status`.

| Request | Query and body |
| --- | --- |
| Dashboard, thread and post search views, reports | Add `tsdmapp=json&nodoc=1`. The structured schemas are 39, 36, 37 and 28 respectively. Keep search `do=search` and the returned fixed flags and filters in the query. Stored results use the returned `list_url`; add `page` for continuation. |
| Panel login | POST returned `action=login` with `formhash`, `fid`, `submit=yes`, `login_panel=yes`, `cppwd`. |
| Selected post deletion | POST returned form with `tsdmapp=json` at the destination. Keep its fixed fields and index the selected IDs as `delete[0]`, `delete[1]` and so on. Include `nocredit=1` only for the approved keep-credit choice. Check `modcp_thread_delete_succeed` and returned rows. |
| Queue reads | Use `action=moderate&op=threads`, `replies` or `members`, with `filter=0`, and `fid` for threads and replies. When status advertises `moderate`, add `tsdmapp=json&tsdmv=4&nodoc=1` for reads. |
| Thread or reply verdict | POST to the same scoped operation with `infloat=yes&inajax=1`. Send the offered `formhash`, `fid`, `filter`, any `posttableid`, and `modact`, `modsubmit=1`, `handlekey=mods`, `moderate[]`, `reason`. Add `tsdmapp=json&tsdmv=4` for v4 writes. Verify the explicit `modcp_mod_succeed` key or native AJAX success handler. |
| Registration verdict | POST `action=moderate&op=members&tsdmapp=json` with `formhash`, `filter=0`, `modact`, `modsubmit=1`, `moderate[0]`, `reason`. Add `tsdmv=4` for v4. Read the pending list again after the success key. |
| Report resolution | POST to the `submit.url` with its fixed fields and `reportids[0]`, `reportuids[ID]`, plus `creditsvalue[ID]` and `msg[ID]` when offered and selected. Check the schema 13 verdict. Report deletion has no panel request. |
| Bin views and search | Open the chosen `action=recyclebin` or `recyclebinpost` with `fid`. Submit the offered `op=search` form with `formhash`, `fid`, selected filters, any post table and `searchsubmit=true`. When advertised, v4 applies the same read and write modifiers as above. |
| Bin restore or permanent deletion | POST to that bin with `fid` and `page=1`. Use its `formhash`, any `posttableid`, `oldop=list`, `dosubmit=submit`, indexed `moderate[0]` values and either `op=restore` or `op=delete`. Require a clear permission for `delete`. Read the same unfiltered bin and establish whether the selected IDs remain. |

### Python `requests`

Keep retries disabled on the `requests.Session`. `current()` returns the host's current login identifier and `bound` is the identifier from the form or view. `query` is a dictionary and `fields` is a list of encoded form field pairs before URL encoding. `binding-changed`, `declined` and `panel-report-delete-unavailable` are local results. The helper returns a `requests.Response` for a forum reply.

```python
from requests import RequestException


def panel_request(session, origin, current, bound, method, query, fields=None, *, approved=False):
    action, op = query.get("action"), query.get("op", "")
    allowed = {
        "home": {""}, "login": {""}, "thread": {"thread", "post"},
        "moderate": {"threads", "replies", "members"}, "report": {"", "delete"},
        "recyclebin": {"", "search"}, "recyclebinpost": {"", "search"},
    }
    if method not in {"GET", "POST"} or {"mod", "id"}.intersection(query) or op not in allowed.get(action, set()):
        raise ValueError("Unexpected moderator route")
    if action == "report" and op == "delete":
        return "panel-report-delete-unavailable"
    if (method == "POST" and (action == "home" or fields is None)) or (method == "GET" and (action == "login" or fields is not None)):
        raise ValueError("Unexpected moderator method or fields")
    if "do" in query and query["do"] not in {"search", "list"}:
        raise ValueError("Unexpected moderator method or fields")
    effect = method == "POST" or query.get("do") == "search"
    if effect and approved is not True:
        return "declined"
    if not bound or current() != bound:
        return "binding-changed"
    try:
        response = session.request(method, origin + "/forum.php", params={"mod": "modcp", **query},
                                   data=fields, allow_redirects=False, timeout=20)
    except RequestException:
        return "uncertain" if effect else "network"
    if current() != bound:
        return "uncertain" if effect else "binding-changed"
    return response
```

For example, call `panel_request(session, origin, current, current(), "GET", {"action": "home", "tsdmapp": "json", "nodoc": "1"})`. Inspect the HTTP status and then the structured schema, `uid`, `ok`, `message_key`, and returned form or rows. For native results, parse the returned HTML for the selected tab, forum, permission and rows. For effect requests treat a lost reply, an unexplained redirect or an unparseable verdict as uncertain.

### curl

Set `FORUM_ORIGIN`, `FORUM_COOKIE`, `PANEL_BOUND_LOGIN` and `PANEL_CURRENT_LOGIN` in your private host shell. Construct the query from reviewed route fields using URL encoding. For example, `panel_request no GET 'action=home&tsdmapp=json&nodoc=1'` reads the dashboard. Supply the URL-encoded POST fields on standard input after approval. The response body and status are printed separately. Check the same verdict and current login before interpreting any effect.

```sh
panel_request() (
  approved=$1 method=$2 query=$3
  case "$query" in ''|*'#'*|*' '*|*'?'*|*';'*) return 2 ;; esac
  action= op= search= seen=':'
  set -f
  IFS='&'
  for field in $query; do
    key=${field%%=*}; value=${field#*=}
    case "$key" in ''|*[!a-zA-Z0-9_]*|mod|id) return 2 ;; esac
    case "$seen" in *":$key:"*) return 2 ;; esac
    seen="$seen$key:"
    case "$key" in
      action) action=$value ;;
      op) op=$value ;;
      do) case "$value" in search) search=yes ;; list) ;; *) return 2 ;; esac ;;
    esac
  done
  case "$method:$action:$op" in
    GET:report:delete|POST:report:delete) return 4 ;;
    GET:home:|POST:login:|GET:thread:thread|GET:thread:post|POST:thread:post|GET:moderate:threads|GET:moderate:replies|GET:moderate:members|POST:moderate:threads|POST:moderate:replies|POST:moderate:members|GET:report:|POST:report:|GET:recyclebin:|GET:recyclebinpost:|POST:recyclebin:|POST:recyclebinpost:|POST:recyclebin:search|POST:recyclebinpost:search) ;;
    *) return 2 ;;
  esac
  if [ "$method" = POST ] || [ "$search" = yes ]; then
    [ "$approved" = yes ] || return 0
  fi
  [ -n "$PANEL_BOUND_LOGIN" ] && [ "$PANEL_BOUND_LOGIN" = "$PANEL_CURRENT_LOGIN" ] || return 3
  if [ "$method" = POST ]; then
    set -- --header 'Content-Type: application/x-www-form-urlencoded' --data-binary @-
  else
    set --
  fi
  curl -q -g -sS --max-time 20 --cookie "$FORUM_COOKIE" --write-out '\n%{http_code}\n' \
    "$@" "$FORUM_ORIGIN/forum.php?mod=modcp&$query"
)
```

## Administrator report deletion handoff

A handoff is a selection for review. The administrator host opens its own privileged session through the forum's administrator API, checks that `adminreport` offers read and write access, and reads the pending or resolved reports. Match the handoff's origin, forum and report IDs against that response, then obtain a separate deletion confirmation. Deletion removes the report records. Use the current administrator form hash and a unique operation ID for the approved selection. Retain that ID if the effect remains uncertain, and read the administrator report lists before deciding what to do next.

### Python administrator request

Use a separate `requests.Session` and login binding for the administrator. Supply the private token and the current admin API form hash obtained through that session. The example accepts a verified administrator selection through `selected`, a set of `(forum_id, report_id)` pairs; construct it from a same-origin, same-login `adminreport` response for the handoff's scope. The explicit `writable` value comes from the current administrator capability response.

```python
from requests import RequestException


def admin_report_page(session, origin, current, bound, token, scope):
    if not bound or current() != bound or not token or scope not in {"new", "resolved"}:
        return "admin-report-read-unavailable"
    try:
        response = session.get(origin + "/plugin.php", params={"id": "tsdmapp:api", "action": "adminreport", "op": scope},
                               headers={"X-Tsdmapp-Admin": token}, allow_redirects=False, timeout=20)
    except RequestException:
        return "network"
    return response if current() == bound else "binding-changed"


def delete_admin_reports(session, origin, current, bound, token, formhash, writable, selected, intent, opid, *, approved=False):
    if approved is not True:
        return "declined"
    if not bound or current() != bound:
        return "binding-changed"
    if writable is not True or not token or not formhash:
        return "admin-report-delete-unavailable"
    ids = intent["reportIds"]
    if intent["kind"] != "admin-report-deletion" or origin != intent["origin"] or not ids or len(set(ids)) != len(ids) or any((intent["forumId"], rid) not in selected for rid in ids) or not opid:
        return "invalid-selection"
    fields = [("op", "delete"), *((f"ids[{i}]", rid) for i, rid in enumerate(ids)), ("opid", opid), ("formhash", formhash)]
    try:
        response = session.post(origin + "/plugin.php", params={"id": "tsdmapp:api", "action": "adminreport"},
                                data=fields, headers={"X-Tsdmapp-Admin": token}, allow_redirects=False, timeout=20)
    except RequestException:
        return "uncertain"
    return response if current() == bound else "uncertain"
```

### curl administrator request

Set the administrator origin, cookie, and independent continuity variables. `ADMIN_TOKEN_HEADER_FILE` points to a private file containing the `X-Tsdmapp-Admin` header with its value. The caller prepares and reviews the URL-encoded fields `op=delete`, indexed `ids`, `opid`, and `formhash` from the administrator-bound selection above. Pass the already checked write permission and separate deletion approval. Compare `uid`, `type: adminreport`, `op: delete` and the returned `deleted` IDs with the exact request. After a partial, missing or ambiguous answer, reread under the administrator session before any further submission.

```sh
admin_report_page() {
  case "$1" in new|resolved) ;; *) return 2 ;; esac
  [ -n "$ADMIN_BOUND_LOGIN" ] && [ "$ADMIN_BOUND_LOGIN" = "$ADMIN_CURRENT_LOGIN" ] || return 3
  curl -q -sS --max-time 20 --cookie "$ADMIN_COOKIE" --write-out '\n%{http_code}\n' \
    --header "@$ADMIN_TOKEN_HEADER_FILE" "$ADMIN_ORIGIN/plugin.php?id=tsdmapp:api&action=adminreport&op=$1"
}

admin_report_delete() {
  [ "$1" = yes ] || return 0
  [ "$2" = yes ] || return 4
  [ -n "$ADMIN_BOUND_LOGIN" ] && [ "$ADMIN_BOUND_LOGIN" = "$ADMIN_CURRENT_LOGIN" ] || return 3
  curl -q -sS --max-time 20 --cookie "$ADMIN_COOKIE" --write-out '\n%{http_code}\n' \
    --header "@$ADMIN_TOKEN_HEADER_FILE" --header 'Content-Type: application/x-www-form-urlencoded' \
    --data-binary @- "$ADMIN_ORIGIN/plugin.php?id=tsdmapp:api&action=adminreport"
}
```
