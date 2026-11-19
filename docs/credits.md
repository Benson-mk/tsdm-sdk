# Check in and manage credits and group membership

Use the installed `tsdm-sdk` on Node 26.x. Pass the canonical HTTPS forum origin, a signed-in member ID and a session continuity value. The host binds each request to that session and changes the continuity value after a new login, including another login as the same member. See [account sessions](account.md) and the [SDK tasks](../README.md#tasks).

The transport receives `fresh: true`, the intended session and a method. Use a fresh network response and manual redirect handling. An unfollowed HTTP response has `redirect: "none"`. Return `opaque` for a filtered redirect and `followed` for an automatically followed redirect. A POST carries `body` as `application/x-www-form-urlencoded`. Send each approved POST once.

| Task                    | SDK operation and observation                                                                                                                                                                                                                                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Today's attendance      | `readAttendance()` reads the forum's check-in status and window, with the native plugin desk as fallback. It can report that today is already checked or that the window is closed.                                                                                                                                                            |
| Attendance calendar     | `readAttendanceCalendar("2026-11")` reads credit logs in the inclusive month. It recognizes sign-in and bonus rows and deduplicates by forum-local date. `complete: false` means coverage is partial. Earlier validated days can survive a failed later page. The default limit is eight pages and the caller can set at most 30.              |
| Credit balance          | `readCreditBalance()` returns credit values, total, and recent changes for the current member. When the forum offers the credit-rules tab, `rules` is a browser handoff to that native page.                                                                                                                                                   |
| Filtered credit history | `readCreditLog({ creditId: "2", direction: 1, operation: "PRC", start: "2026-11-01", end: "2026-11-30", page: 1 })` preserves requested filters, inclusive date bounds and returned paging. Direction `1` is income, `-1` is expense and `0` is unrestricted. Omit a filter for its default. Use filter values the forum returned.             |
| Group list and progress | `readGroups()` returns the main membership and the group menus. `readGroupProgress()` returns current credits and the next tier when the default group page establishes one.                                                                                                                                                                   |
| Group detail and expiry | `readGroupDetail("15")` reads a chosen group's detail separately from the member's active group. `readGroupExpiry()` reads the expiry table, printed dates and eligible switches. `readGroupExpiry("list")` requests the corresponding group list view. Use the forum's expiry flag, since printed dates can be stale or based on server time. |

`prepareCheckIn()` opens a check-in approval. After consent, `submitCheckIn(form, { feeling: "kx", message: "…" })` sends the daily plugin submission, which can record attendance and award credits. The SDK reads attendance again in the same session. `checked-in` means the forum acknowledged the POST and the readback established attendance. `already-checked` distinguishes duplicate attendance. `attendance-observed` means the record is visible and attribution to the attempted POST remains open. A readback rate limit or inconclusive response can yield `unknown` with the original choice and any read interruption. Visit `readAttendance()` later for a fresh observation. A read can show the current day without resending the submission.

To switch groups, read expiry, select a row with `canSwitch`, and call `prepareGroupSwitch(expiry, groupId)`. Present the returned `from` and `to` labels. Call `submitGroupSwitch(form)` after separate approval. A switch changes the member's main group and can change permissions. `switched` records the forum's acknowledgement. A redraw, refusal, qualified continuation or lost response has its own result. A `switch-handoff` carries a same-origin destination with `effect: "unknown"`. Read the current group after an ambiguous effect. Keep preparations in the calling client for the current session. The SDK consumes each preparation on dispatch.

## TypeScript

Save these functions in a project with the tarball installed. Supply the host transport and the user approval callback for each effect.

```ts
import {
  createCreditsClient,
  type CheckInChoice,
  type CreditsClientOptions,
  type GroupSwitchForm,
} from "tsdm-sdk";

export function attendanceMonth(host: CreditsClientOptions, month: string) {
  return createCreditsClient(host).readAttendanceCalendar(month);
}

export async function checkIn(
  host: CreditsClientOptions,
  approve: (memberId: string) => Promise<CheckInChoice | null>,
) {
  const client = createCreditsClient(host);
  const prepared = await client.prepareCheckIn();
  if (prepared.kind !== "checkin-ready") return prepared;
  const choice = await approve(prepared.form.memberId);
  if (!choice) return { kind: "cancelled" } as const;
  return client.submitCheckIn(prepared.form, choice);
}

export async function switchGroup(
  host: CreditsClientOptions,
  groupId: string,
  approve: (form: GroupSwitchForm) => Promise<boolean>,
) {
  const client = createCreditsClient(host);
  const listed = await client.readGroupExpiry();
  if (listed.kind !== "group-expiry") return listed;
  const prepared = await client.prepareGroupSwitch(listed, groupId);
  if (prepared.kind !== "switch-ready") return prepared;
  if (!(await approve(prepared.form))) return { kind: "cancelled" } as const;
  return client.submitGroupSwitch(prepared.form);
}
```

## Direct HTTP with Python `requests`

Start with a `requests.Session` containing the intended member's forum credentials. Disable redirects and transport retries. Decode JSON on structured routes, and parse any native HTML or XML CDATA as data. Check the HTTP status, viewer when returned, result shape, requested filters and returned target before interpreting a response.

| Task                            | HTTP request and response                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Attendance                      | GET `plugin.php?id=tsdmapp:api&action=checkin`. Inspect `installed`, `checked_today`, `can_checkin`, `window` and `day_start`. Some versions give the active session's `formhash` without `uid`. The native GET `plugin.php?id=dsu_paulsign:sign` exposes today's status at `#qdmsgt` and the form at `#qiandao` when available. An ambiguous heading can describe a closed window or a duplicate.                                                                                  |
| Credit balance and history      | GET `home.php?mod=spacecp&ac=credit&op=base` with `tsdmapp=json&tsdmv=4&nodoc=1` for `credit_base` schema 52. For history use `op=log` with `tsdmapp=json&nodoc=1`, `exttype`, `income`, `optype`, `starttime`, `endtime` and `page` for `credit` schema 12. Compare the returned `query`, page and bounds. Date conversion uses `timeoffset`. For calendar results deduplicate sign-in reward days across pages. A native response may expose fewer paging and credit identifiers. |
| Group list, progress and detail | GET `home.php?mod=spacecp&ac=usergroup` with `tsdmapp=json&tsdmv=4&nodoc=1` for `usergroup_info` schema 54. Use `gid` for a specific group and check `viewed.gid`. The main group is `main`. The native view can show current credits and the credits still required for the viewed group.                                                                                                                                                                                          |
| Expiry and switch window        | GET `home.php?mod=spacecp&ac=usergroup&do=expiry` with `tsdmapp=json&tsdmform=1&nodoc=1`. Read the `usergroup` schema 17 expiry list or native table. Open the verified `do=switch&groupid=…` action from the intended row with `infloat=yes`, `inajax=1`, `tsdmapp=json` and `tsdmform=1`. Check target and member, and display the old and proposed group.                                                                                                                        |

```python
from urllib.parse import parse_qs, urljoin, urlsplit


def advertised(session, origin, capability):
    response = session.get(origin + "/plugin.php", params={"id": "tsdmapp:api", "action": "status"},
                           allow_redirects=False, timeout=20)
    if response.status_code == 404:
        return False
    if response.status_code != 200:
        raise RuntimeError("Capability check failed: " + str(response.status_code))
    try:
        flags = response.json()
    except ValueError:
        return False
    if flags.get("error") in {"busy", "login"}:
        raise RuntimeError("Capability check refused: " + flags["error"])
    return flags.get("ok") == 1 and flags.get("v4") == 1 and capability in flags.get("credit_pages", [])


def read_view(session, origin, view, **filters):
    if view == "attendance":
        path, params = "/plugin.php", {"id": "tsdmapp:api", "action": "checkin"}
    elif view in {"balance", "log"}:
        path = "/home.php"
        params = {"mod": "spacecp", "ac": "credit", "op": "base" if view == "balance" else "log",
                  "tsdmapp": "json", "nodoc": 1}
        if view == "balance":
            params["tsdmv"] = 4
        else:
            params.update(exttype=0, income=0, optype="", starttime="", endtime="", page=1)
            params.update({key: filters[key] for key in ("exttype", "income", "optype", "starttime", "endtime", "page") if key in filters})
    elif view in {"group", "expiry"}:
        path = "/home.php"
        params = {"mod": "spacecp", "ac": "usergroup", "tsdmapp": "json", "nodoc": 1}
        if view == "expiry":
            params.update(do="expiry", tsdmform=1)
        else:
            params["tsdmv"] = 4
            if "gid" in filters:
                params["gid"] = filters["gid"]
    else:
        raise ValueError("Unsupported read view")
    if view in {"balance", "group"}:
        capability = "credit_base" if view == "balance" else "usergroup_info"
        if not advertised(session, origin, capability):
            for flag in ("tsdmapp", "tsdmv", "nodoc"):
                params.pop(flag, None)
    return session.get(origin + path, params=params, allow_redirects=False, timeout=20)


def submit_checkin(session, origin, formhash, feeling, message, *, approved=False):
    if not approved:
        return None
    query = {"id": "dsu_paulsign:sign", "operation": "qiandao", "infloat": 1,
             "inajax": 1, "tsdmapp": "json"}
    fields = {"formhash": formhash, "qdxq": feeling, "qdmode": "1",
              "todaysay": message, "fastreply": "1"}
    return session.post(origin + "/plugin.php", params=query, data=fields,
                        allow_redirects=False, timeout=20)


def open_switch(session, origin, offered_url, group_id):
    url = urljoin(origin + "/", offered_url)
    target, forum = urlsplit(url), urlsplit(origin)
    q = parse_qs(target.query, keep_blank_values=True)
    required = {"mod": ["spacecp"], "ac": ["usergroup"], "do": ["switch"], "groupid": [str(group_id)]}
    if ((target.scheme, target.netloc) != (forum.scheme, forum.netloc)
            or target.path != "/home.php" or target.fragment
            or any(q.get(key) != value for key, value in required.items())
            or set(q) - set(required) - {"handlekey"}
            or q.get("handlekey", ["switchgrouphk"]) not in (["switchgrouphk"], ["group"])):
        raise ValueError("Unexpected switch opener")
    return session.get(url, params={"infloat": "yes", "inajax": 1, "tsdmapp": "json", "tsdmform": 1},
                       allow_redirects=False, timeout=20)


def submit_switch(session, origin, offered_destination, group_id, fields, *, approved=False):
    if not approved:
        return None
    url = urljoin(origin + "/", offered_destination)
    target, forum = urlsplit(url), urlsplit(origin)
    query = parse_qs(target.query, keep_blank_values=True)
    required = {"mod": ["spacecp"], "ac": ["usergroup"], "do": ["switch"], "groupid": [str(group_id)]}
    if ((target.scheme, target.netloc) != (forum.scheme, forum.netloc)
            or target.path != "/home.php" or target.fragment or query != required):
        raise ValueError("Unexpected switch destination")
    return session.post(url, params={"inajax": 1, "tsdmapp": "json"}, data=fields,
                        allow_redirects=False, timeout=20)
```

For check-in, use the current form hash and one of `kx`, `ng`, `ym`, `wl`, `nu`, `ch`, `fd`, `yl`, or `shuai` for the chosen feeling. After the approved POST, read attendance again using the same session. The returned schema 13 page or XML window can show sign-in or duplicate wording. A success message with no corresponding readback leaves the effect unresolved. For a switch, preserve the supported form's `submit.fields`, such as `groupsubmit`, `gid`, `handlekey`, `formhash`, `referer` and `editsubmit_btn`. A matching `usergroups_switch_succeed` handle or native success callback is acknowledgement. Verify the current group with a separate GET after a redraw, redirect or uncertain effect. A transport error does not authorize a retry.

## curl

Set `FORUM_ORIGIN` and the protected `FORUM_COOKIE_JAR` for the intended account. Select one operation with `CREDITS_MODE`. Use `READ_URL` first for `plugin.php?id=tsdmapp:api&action=status` before reading a balance or group. Verify the member, `v4=1` and `credit_pages` containing `credit_base` or `usergroup_info`. Select the corresponding structured URL when advertised. Otherwise use the same native route without the JSON, v4 and document-omission flags. For check-in set `FORMHASH`, `FEELING` and `TODAYSAY` after approval. For a switch set `SWITCH_URL` to the verified returned action with `inajax=1&tsdmapp=json` and `SWITCH_FIELDS` to a protected file containing the exact URL-encoded form fields. Set `CREDITS_APPROVAL` to the relevant effect mode only after consent.

```sh
case "${CREDITS_MODE:-}" in
  read)
    curl -q -sS -i --retry 0 --cookie "$FORUM_COOKIE_JAR" "$READ_URL"
    ;;
  check-in)
    [ "${CREDITS_APPROVAL:-}" = check-in ] || exit 2
    curl -q -sS -i --retry 0 --cookie "$FORUM_COOKIE_JAR" \
      --data-urlencode "formhash=$FORMHASH" --data-urlencode "qdxq=$FEELING" \
      --data-urlencode qdmode=1 --data-urlencode "todaysay=$TODAYSAY" --data-urlencode fastreply=1 \
      "$FORUM_ORIGIN/plugin.php?id=dsu_paulsign%3Asign&operation=qiandao&infloat=1&inajax=1&tsdmapp=json"
    ;;
  switch)
    [ "${CREDITS_APPROVAL:-}" = switch ] || exit 2
    curl -q -sS -i --retry 0 --cookie "$FORUM_COOKIE_JAR" \
      -H 'Content-Type: application/x-www-form-urlencoded' --data-binary "@$SWITCH_FIELDS" "$SWITCH_URL"
    ;;
  *) exit 2 ;;
esac
```

Inspect the headers and body after each invocation. Use a separate `read` to inspect stored attendance, balances or the current group. The packaged [profile guide](profile.md) covers the member's other account settings.
