# Manage moderator access and forum settings

Use `createModeratorPanelClient` from `tsdm-sdk` on Node 26.x. Open the [moderator panel](moderator-queues.md) under an existing forum login and complete its password prompt if the forum offers one. The host supplies that login's cookies and continuity, marks a replacement login immediately, sends URL-encoded POST fields, and uses single-attempt effect requests with manual redirect handling. The moderator panel uses its own permission checks. The [administrator API](admin.md) has separate credentials and authority.

Read the page for the intended forum or member and present the offered choices before confirming. Each mutation method takes a separate `approved` boolean. The client binds the form and allowed selections to the original login and consumes the form when the approved request is sent. Read a fresh page for another action. The only POST used to inspect without an SDK mutation approval is `searchForumAccess`, which sends the panel's read-only search form.

| Task | SDK operation | Scope and observable result |
| --- | --- | --- |
| Inspect forum access | `readForumAccess(forumId, page)`, `searchForumAccess(page, username)` | Offered forums and listed per-member overrides. Rights are `-1`, `0` or `1` when returned. A missing field stays unknown. |
| Change forum access | `setForumAccess(page, username, denied, approved)` | Replaces the complete deny set. Denying `view` denies all seven rights. An empty array restores group permissions. The scoped result reports completion or errors such as `staff` or `whitelist`. |
| Inspect a member | `lookupPanelMember("edit" or "ban", { uid } or { username })` | Returns the exact member with the observed edit fields or ban choices and available violation records. Staff protection is reported under the attempted lookup. |
| Edit a member | `editPanelMember(page, { bio, signature, clearAvatar }, approved)` | Saves both texts. Avatar clearing is a separate option on an offered form. Look for the operation-specific verdict. |
| Ban or lift a ban | `changeMemberBan(page, choice, days, reason, approved)` | Use only an offered choice. `4` restricts posting, `5` restricts access, and `0` lifts a ban when offered. `null` uses the forum's no-expiry field. Verify the verdict or reread the member. |
| Inspect and manage IP bans | `readIpBans()`, `addIpBan(page, ip, days, approved)`, `deleteIpBans(page, ids, approved)` | Shows current entries and per-row delete permission. Add sends an address or a range under the forum's CIDR permission. Compare a new matching row or explicit acknowledgement. Deletion checks which selected entries remain. |
| Read moderation logs | `readPanelLog(keyword, page)` | Returns the log filter, page, continuation and available operation and target fields. The structured IP field is surfaced only when the page enables it. |
| Inspect and manage notes | `readManagementNotes()`, `addManagementNote(page, note, approved)`, `deleteManagementNotes(page, ids, approved)` | A note sets message, audiences and days. The confirmed creation observation is a new visible note matching the message and audiences. A note outside the operator's view can leave the effect uncertain. |
| Inspect and save rules | `readForumRules(forumId)`, `saveForumRules(page, rules, approved)` | The reply must identify the original forum. An editable form with the returned text establishes a matching save. A locked editor refuses changes even when a generic success caption appears. |
| Inspect and save recommendations | `readRecommendations(forumId)`, `saveRecommendations(page, { edits, remove }, approved)` | The moderator may edit offered rows and remove selected rows from a manually ordered list. The native form resubmits all displayed fields, including unchanged rows. An automatically ordered list is read-only. |
| List, create, edit and delete announcements | `readPanelAnnouncements()`, `createPanelAnnouncement(page, draft, approved)`, `readPanelAnnouncement(id)`, `editPanelAnnouncement(form, draft, approved)`, `deletePanelAnnouncements(page, ids, approved)` | A draft chooses text or link, start and end dates, and content. Edits preserve the returned display order. Deletion uses only selectable IDs and examines the redrawn list. |

`acknowledged` is a returned verdict. `completed` is a matching observation in the applicable view, and `partial` reports mixed selected outcomes. `redrawn` and `uncertain` require review before another submission. Responses may carry confirmed, remaining and unknown IDs. Reconcile an ambiguous result with a fresh read for the original scope and account. A matching page can establish what the forum now shows while concurrent operations can still make attribution uncertain.

## TypeScript

```ts
import { createModeratorPanelClient, type ModeratorPanelOptions } from "tsdm-sdk";

export async function saveForumRules(
  host: ModeratorPanelOptions,
  forumId: string,
  rules: string,
  approve: (change: { forumId: string; before: string; after: string }) => Promise<boolean>,
) {
  const panel = createModeratorPanelClient(host);
  const shown = await panel.readForumRules(forumId);
  if (shown.kind !== "forum-rules") return shown;
  if (!shown.page.editable) return { kind: "refused", code: "rules-locked" } as const;
  const approved = await approve({ forumId: shown.page.forumId, before: shown.page.rules, after: rules });
  return panel.saveForumRules(shown.page, rules, approved);
}
```

## Direct HTTP

Use the moderator login and private cookie setup described in the [moderator panel guide](moderator-queues.md#direct-http). Acquire the current form under the same login, validate its origin, action and targets, and extract only the offered choices. Use `/forum.php?mod=modcp` for the following requests. For structured access, log and note reads add `tsdmapp=json&nodoc=1`. Log reads can also return native HTML. For members, IP bans, rules and announcements, first read `/plugin.php?id=tsdmapp:api&action=status`. Add `tsdmapp=json&tsdmv=4&nodoc=1` on reads when `v4=1` and the corresponding page is advertised in `modcp_pages_v4`. Use `tsdmapp=json&tsdmv=4` on its write path. Recommendation forms are native HTML. Use a separate deliberate approval before sending the prepared POST.

| Panel route | Read and write fields |
| --- | --- |
| `action=forumaccess` | GET with `fid`, optional `page`. Search POST to returned form with `formhash`, `searchsubmit=true`, `fid`, `suser`. Mutation POST with `formhash`, `op=`, `addsubmit=true`, `fid`, `new_user`, and selected `new_*=-1` fields or `deleteaccess=1`. Use `tsdmapp=json` on both POSTs. |
| `action=member&op=edit` | GET with `uid` or `username`. POST the shown `uid`, `username`, `formhash`, `bionew`, `signaturenew`, optional `clearavatar=1`, and `editsubmit=true`. Native member writes also use `tsdmapp=json` for their verdict. |
| `action=member&op=ban` | GET with `uid` or `username`. POST the shown `uid`, `username`, `formhash`, `bannew`, `banexpirynew`, `reason`, and `bansubmit=true`. Inspect the same member and distinguish absence of permission from login expiry. |
| `action=member&op=ipban` | GET the list and enabled controls. POST `formhash`, `ipbansubmit=true` and either `ipnew`, `validitynew` or indexed `delete[0]` and subsequent fields. Compare the redrawn list and any explicit error. |
| `action=log` | GET with optional `keyword` and `page`. Read entries with scope and visible fields. |
| `action=home` | GET notes and their forms. POST `tsdmapp=json` with `formhash`, `op=addnote`, `submit=true`, `newmessage`, `newexpiration` and chosen `newaccess[2]=1` or `newaccess[3]=1`. Deletion uses `op=delete`, `notlistsubmit=yes`, indexed `delete[0]` and the current hash. |
| `action=forum&op=editforum` | GET with `fid`. POST `formhash`, `fid`, `editsubmit=true`, `rulesnew`. Check the returned forum and editor state. |
| `action=forum&op=recommend` | GET with `fid`. POST to `action=forum` with `formhash`, `op=recommend`, `page=1`, `fid`, `check=`, `editsubmit=yes`, indexed `delete[0]`, and `order[TID]`, `subject[TID]`, `expirationrecommend[TID]` for every displayed row. |
| `action=announcement` | GET the list and create form. GET `op=edit&id=ID` for editing. POST `op=add` or `op=edit` in the URL and send `formhash`, `id`, returned `displayorder`, `subject`, `type` (`0` text or `1` link), `starttime`, `endtime`, `message[0]`, `message[1]`, and `submit=true`. Send the unused message field empty. POST `op=manage` with `formhash`, `submit=true`, indexed `delete[0]` and subsequent selected IDs. Verify the result and any necessary readback. |

### Python `requests`

Use a private `requests.Session` with retries disabled. `bound` is the login identifier when the selection was read, and `current()` returns the active login identifier. The `query` and `fields` are dictionaries built from the reviewed route and offered form. Inspect status, returned UID and schema, and the relevant fields in the table. For example, `settings_request(session, origin, current, current(), "GET", {"action": "forumaccess", "fid": "10", "tsdmapp": "json", "nodoc": "1"})` opens a forum's access list.

```python
from requests import RequestException


def settings_request(session, origin, current, bound, method, query, fields=None, *, approved=False):
    action, op = query.get("action"), query.get("op", "")
    reads = {("home", ""), ("log", ""), ("forumaccess", ""), ("announcement", ""),
             ("member", "edit"), ("member", "ban"), ("member", "ipban"),
             ("forum", "editforum"), ("forum", "recommend"), ("announcement", "edit")}
    posts = {("home", ""), ("forumaccess", ""), ("member", "edit"), ("member", "ban"), ("member", "ipban"),
             ("forum", "editforum"), ("forum", ""), ("announcement", "add"), ("announcement", "edit"), ("announcement", "manage")}
    if "mod" in query or ("id" in query and (method, action, op) != ("GET", "announcement", "edit")):
        raise ValueError("Unexpected route fields")
    if not ((method == "GET" and fields is None and (action, op) in reads) or
            (method == "POST" and fields is not None and (action, op) in posts)):
        raise ValueError("Unexpected settings route or method")
    if method == "POST" and approved is not True:
        return "declined"
    if not bound or current() != bound:
        return "binding-changed"
    try:
        response = session.request(method, origin + "/forum.php", params={"mod": "modcp", **query},
                                   data=fields, allow_redirects=False, timeout=20)
    except RequestException:
        return "uncertain" if method == "POST" else "network"
    if current() != bound:
        return "uncertain" if method == "POST" else "binding-changed"
    return response
```

### curl

Set `FORUM_ORIGIN`, `FORUM_COOKIE`, `PANEL_BOUND_LOGIN` and `PANEL_CURRENT_LOGIN` in your private host shell. Supply an encoded query without the `mod` field. For a POST send the validated form body on standard input. Run `settings_request no GET 'action=log&tsdmapp=json&nodoc=1'` to read the log. The function prints the reply body and status and leaves outcome interpretation to the caller. Use the appropriate read after an ambiguous response.

```sh
settings_request() (
  approved=$1 method=$2 query=$3
  case "$query" in ''|*'#'*|*' '*|*'?'*|*';'*) return 2 ;; esac
  action= op= found_id= seen=':'
  set -f
  IFS='&'
  for field in $query; do
    key=${field%%=*}; value=${field#*=}
    case "$key" in ''|*[!a-zA-Z0-9_]*|mod) return 2 ;; esac
    case "$seen" in *":$key:"*) return 2 ;; esac
    seen="$seen$key:"
    case "$key" in action) action=$value ;; op) op=$value ;; id) found_id=yes ;; esac
  done
  [ "$found_id" != yes ] || [ "$method:$action:$op" = GET:announcement:edit ] || return 2
  case "$method:$action:$op" in
    GET:home:|GET:log:|GET:forumaccess:|GET:member:ban|GET:member:edit|GET:member:ipban|GET:forum:editforum|GET:forum:recommend|GET:announcement:|GET:announcement:edit) ;;
    POST:home:|POST:forumaccess:|POST:member:ban|POST:member:edit|POST:member:ipban|POST:forum:editforum|POST:forum:|POST:announcement:add|POST:announcement:edit|POST:announcement:manage)
      [ "$approved" = yes ] || return 0 ;;
    *) return 2 ;;
  esac
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
