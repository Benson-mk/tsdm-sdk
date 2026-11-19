# Use the administrator API under its own session

Use an authenticated administrator on the canonical HTTPS forum origin. Keep the ordinary member session and administrator authorization separate. `AdminClientOptions.session()` identifies the current member and supplies a continuity value that changes whenever the cookie session changes. `transport.request` must honor the fresh request, preserve its headers, send POST bodies as `application/x-www-form-urlencoded`, report redirects without following them, and send each effect once. Keep the raw admin traffic out of logs. The host sees the password, security answer, token and form hash on the requests that need them.

## TypeScript

```ts
import {
  createAdminClient,
  type AdminClientOptions,
  type AdminCredentials,
  type AdminReport,
  type ModeratorReportDeletionHandoff,
} from "tsdm-sdk";

export async function inspectPendingReports(
  host: AdminClientOptions,
  approve: () => Promise<boolean>,
  credentials: () => Promise<AdminCredentials>,
) {
  const client = createAdminClient(host);
  const access = await client.discoverAdmin();
  if (access.kind !== "admin-access" || !access.eligible || !access.capabilities.adminreport?.read)
    return access;
  if (!(await approve())) return { kind: "not-confirmed" } as const;
  const opened = await client.openAdminSession(await credentials(), true);
  if (opened.kind !== "admin-opened") return opened;
  try {
    return await client.readAdminReports("pending");
  } finally {
    // This approval covers ending the separate authorization opened above.
    await client.closeAdminSession(true);
  }
}

export async function completeReportDeletion(
  administrator: AdminClientOptions,
  selection: ModeratorReportDeletionHandoff,
  adminPage: number,
  operationId: string,
  approveLogin: () => Promise<boolean>,
  credentials: () => Promise<AdminCredentials>,
  approveDeletion: (reports: readonly AdminReport[]) => Promise<boolean>,
) {
  if (selection.kind !== "admin-report-deletion" || selection.origin !== administrator.origin ||
      selection.reportIds.length === 0 || new Set(selection.reportIds).size !== selection.reportIds.length)
    return { kind: "invalid-input" } as const;
  const client = createAdminClient(administrator);
  const access = await client.discoverAdmin();
  if (access.kind !== "admin-access" || !access.eligible || !access.capabilities.adminreport?.write)
    return access;
  if (!(await approveLogin())) return { kind: "not-confirmed" } as const;
  const opened = await client.openAdminSession(await credentials(), true);
  if (opened.kind !== "admin-opened") return opened;
  try {
    const page = await client.readAdminReports("pending", adminPage);
    if (page.kind !== "admin-reports") return page;
    const reports: AdminReport[] = [];
    for (const id of selection.reportIds) {
      const observed = page.reports.find((report) => report.id === id && report.forumId === selection.forumId);
      if (!observed) return { kind: "invalid-input" } as const;
      reports.push(observed);
    }
    if (!(await approveDeletion(reports))) return { kind: "not-confirmed" } as const;
    return await client.deleteAdminReports(page, selection.reportIds, operationId, true);
  } finally {
    await client.closeAdminSession(true);
  }
}

```

`discoverAdmin` reads the deployment switch before asking for read and write capabilities. Review its login state before requesting the login password and, if the server requests it, the selected security question and answer. `openAdminSession` keeps the returned token only in memory. A matching member ID and continuity value are required for each request. The SDK sends the token only in `X-Tsdmapp-Admin` to its configured plugin route and discards it on expiry or session replacement. Close the administrator session deliberately before replacing the member session. A failed close still drops the local token, and may leave the server-side token active until it expires.

| Read first | Approved effect |
| --- | --- |
| `readAdminCredits({ memberIds, usernames })` gives balances, offered currencies, missing lookups and limits. | `adjustAdminCredits(page, { memberIds, deltas, reason, notify, operationId }, true)` changes the selected observed members' balances. The result reports the returned balances, deltas and notified count. |
| `readAdminGroup({ memberId })` gives current, available and restricted group settings, expiry and administrator levels. Group and member lookups also accept `{ username }`. | `changeAdminGroup(page, desiredState, true)` replaces the main and extended group selection. Supply the whole `extendedGroups` list, the desired `groupId`, and optional `adminId`, `expiry`, reason and notification. Omitting expiry clears it. `group-acknowledged` can be followed by a new group read to verify current state. |
| `readAdminReports("pending" | "resolved", page)` gives the specified report queue and offered reward and message limits. | `resolveAdminReports(page, decisions, operationId, true)` can resolve pending reports and send rewards or messages. `deleteAdminReports(page, ids, operationId, true)` can remove the selected reports. Review the returned applied, skipped and unreported IDs. |
| `readAdminMemberState({ memberId })` gives bans, history, content counts, offered cleanup choices and whether a post cleanup is pending. | `changeAdminBan(page, intent, true)` may restrict posting, visiting or status, or lift a ban with `ban: ""`. The `clear` choices can immediately remove comments, avatar or profile data, or start a separate post cleanup. Review `cleared` and any `cleanup` checkpoint separately. |
| Use the checkpoint from a ban or progress result, or a fresh member result that reports a pending cleanup. | `stepAdminCleanup(source, true)` sends one approved batch. `cleanup-progress` gives the next checkpoint. `cleanup-complete` requires the forum's confirmation for that member and zero remaining. After interruption, read the member again before resuming. |

For a [moderator panel handoff](moderator-queues.md), pass the selection to a separate administrator host as in `completeReportDeletion`. The handoff carries the origin, forum and report IDs. The administrator opens its own session, independently locates those IDs in that forum and confirms deletion separately. Select the administrator queue page containing the reports before confirming. If reports span pages, review and approve each applicable page separately. The example always drops its separately opened session at the end.

Each effect uses a read returned by this client under the current admin token. An approved dispatch consumes that read or checkpoint. Choose a unique 8–64 character `operationId` for each new credit, group, report or ban effect. The forum uses `opid` to identify duplicate submissions. A `duplicate` response records the server's duplicate verdict, while an `uncertain` result calls for a separate read of the original targets. Preserve the operation ID and exact intent if you later decide to submit the same action again. The SDK sends no automatic retry and never starts a new ban from a cleanup failure. `refused` carries the action and recognized forum code, with the retry interval when supplied.

## Direct Python requests

Use an authenticated `requests.Session` with retries disabled and a fixed canonical origin. Review the status, capability, target and limits before sending an effect. Keep passwords, the returned token and form hashes private. The helper keeps them in memory and returns the private HTTP response only to the caller responsible for decoding it. The caller must reauthenticate deliberately after loss of authorization and drop the token before changing the member session.

```python
from urllib.parse import urlsplit

ACTIONS = {"admincredit", "admingroup", "adminreport", "adminban"}
WRITES = {"admin": {"login", "logout"}, "admincredit": {None}, "admingroup": {None},
          "adminreport": {"resolve", "delete"}, "adminban": {"ban", "clear"}}


def admin_request(session, origin, actor_id, action, *, query=None, fields=None,
                  token=None, capabilities=None, approved=False):
    if action not in ACTIONS | {"status", "admin"}:
        raise ValueError("Unknown administrator action")
    base = urlsplit(origin)
    if not base.netloc or base.path or base.query or base.fragment or base.username or base.password:
        raise ValueError("Use a canonical origin")
    params = dict(query or {})
    if set(params) - {"uids", "usernames", "uid", "username", "op", "page"}:
        raise ValueError("Unexpected read fields")
    url = origin + "/plugin.php"
    params = {"id": "tsdmapp:api", "action": action, **params}
    if fields is not None and approved is not True:
        return None
    body = list(fields) if fields is not None else None
    values = dict(body or ())
    op = values.get("op")
    if action in ACTIONS:
        permission = (capabilities or {}).get(action, {})
        if not token or permission.get("read") != 1 or (body is not None and permission.get("write") != 1):
            raise ValueError("No observed administrator capability")
    if body is not None and (query or action not in WRITES or op not in WRITES[action]
                             or len(body) != len(values) or not values.get("formhash")
                             or set(values) & {"token", "admintoken"}):
        raise ValueError("Use the approved admin form and form hash")
    if action == "admin" and body is not None and ((op == "logout") != bool(token)):
        raise ValueError("Use the administrator token only when closing the session")
    headers = {"X-Tsdmapp-Admin": token} if token and action != "status" else {}
    if body is None:
        response = session.get(url, params=params, headers=headers, timeout=20, allow_redirects=False)
    else:
        response = session.post(url, params=params, data=body, headers=headers, timeout=20, allow_redirects=False)
    if response.is_redirect:
        return response
    data = response.json()
    if str(data.get("uid")) != actor_id and not (data.get("uid") == 0 and data.get("error") in {"login", "admin_login"}):
        raise ValueError("Response does not belong to the acting member")
    return response
```

GET `status`, then GET `admin` when `status.admin` is `1`. The `actions` object is the capability argument for private calls. POST `admin` with `op=login`, the member's `password`, and `questionid` and `answer` when required. Include `formhash` from the current response in every POST. Keep the token from the successful login response beside the same member session in memory. Observe `session.active`, `expires` and `ttl`. POST `admin` with `op=logout` and its token before changing sessions.

| `action` | Read query | Form fields in addition to `formhash` |
| --- | --- | --- |
| `admincredit` | `uids` comma-delimited and `usernames` newline-delimited | `uids`, `credits[id]`, `opid`, optional `reason` and `notify` |
| `admingroup` | `uid` or `username` | `uid`, `groupid`, `expiry`, `opid`, reviewed `adminid`, `expgroupid`, `expadminid`, `extgroupids[index]`, `extexpiry[id]`, `reason` and `notify` when applicable |
| `adminreport` | `op=new` or `op=resolved`, optional `page` | `op=resolve` or `op=delete`, `ids[index]`, `opid`, optional served `credits[id]` and `msg[id]` for resolution |
| `adminban` | `uid` or `username` | `op=ban`, `uid`, `bannew`, `opid`, possible `banexpirynew`, `reason`, `clear[index]`. For an authorized cleanup batch use `op=clear`, `uid` and the served `cursor`. A newly read pending cleanup starts at `0-0`. |

Read successful responses from the current actor. A cleanup response has a separate `target_uid` and requires `done=1` with `remaining=0` to confirm completion. Keep a refused or incomplete result distinct from an acknowledged effect. Inspect the relevant state after a lost response.

## Direct curl

Use a private directory and a private cookie jar. Set `FORUM_ORIGIN`, `FORUM_COOKIE_JAR`, `ACTION`, `METHOD` and a new `RESPONSE_FILE`. For a token-bearing call provide `ADMIN_HEADER_FILE` containing the single `X-Tsdmapp-Admin` header line. Leave it unset for the status lookup, first entry and login. For POST, set `APPROVED_EFFECT` to the specific `INTENT` after reviewing the permission and targets. Put the exact form encoding in a new private `ADMIN_FORM_FILE`. These paths keep the token and credentials out of command arguments and output. Remove the files when done. `READ_QUERY` is an optional encoded query for the inspected GET, without a leading `&`. Never put credentials in it.

```sh
case "$ACTION" in status|admin|admincredit|admingroup|adminreport|adminban) ;; *) exit 2 ;; esac
url="$FORUM_ORIGIN/plugin.php?id=tsdmapp%3Aapi&action=$ACTION"
case "$ACTION" in
  status) unset ADMIN_HEADER_FILE ;;
  admin) ;;
  *) [ -n "${ADMIN_HEADER_FILE-}" ] || exit 2 ;;
esac
case "$METHOD:$ACTION:${INTENT-}" in
  GET:*) [ -z "${READ_QUERY-}" ] || url="$url&$READ_QUERY" ;;
  POST:admin:login|POST:admin:logout|POST:admincredit:reward|POST:admingroup:group|POST:adminreport:resolve|POST:adminreport:delete|POST:adminban:ban|POST:adminban:clear)
    [ "${APPROVED_EFFECT-}" = "$INTENT" ] || exit 0
    [ -n "${ADMIN_FORM_FILE-}" ] || exit 2
    case "$INTENT" in
      login) [ -z "${ADMIN_HEADER_FILE-}" ] || exit 2 ;;
      logout) [ -n "${ADMIN_HEADER_FILE-}" ] || exit 2 ;;
    esac ;;
  *) exit 2 ;;
esac
umask 077
(set -C; : > "$RESPONSE_FILE") || exit 2
set -- --disable --silent --show-error --max-time 20 --cookie "$FORUM_COOKIE_JAR" \
  --include --output "$RESPONSE_FILE"
if [ -n "${ADMIN_HEADER_FILE-}" ]; then set -- "$@" --header "@$ADMIN_HEADER_FILE"; fi
if [ "$METHOD" = POST ]; then
  set -- "$@" --header 'Content-Type: application/x-www-form-urlencoded' --data-binary "@$ADMIN_FORM_FILE"
fi
curl "$@" -- "$url"
```

Read the response file privately. Enter the returned token into the private header file for the same actor and remove it on logout or expiry. After an ambiguous submission, consult the relevant read endpoint before deciding how to proceed.
