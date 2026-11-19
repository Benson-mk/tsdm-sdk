# Inspect and respond to post activity

Use the [installed SDK](../README.md#tasks) with a canonical HTTPS forum origin and the session that can see the thread or post. Get the thread ID, post ID and containing `thread.url` from `readThread`. Use that page as `threadURL` when preparing a post action. A session has a `memberId` and a `continuity` value supplied by the host. Set `memberId` to `"0"` for a guest and change `continuity` whenever the credential context changes, including signing back in as the same member.

The transport receives `fresh: true`, the intended session, the HTTP method and an `effect` flag. Bind the outgoing request to that session, use a fresh network response, handle redirects manually and allow a single attempt for `effect: true`. For POST, send `body` as `application/x-www-form-urlencoded`. Return the actual response URL, HTTP status, content type, body and redirect disposition. Keep cookies, prepared submissions and form hashes in the current host session.

| View                | SDK query                                    | Direct HTTP action                                    | Observe                                                                                                     |
| ------------------- | -------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Rating ledger       | `{view: "ratings", threadId, postId}`        | `viewratings`, `tid`, `pid`                           | Raters, credit, signed scores, times, reasons and structured totals                                         |
| Poll voters         | `{view: "voters", threadId, optionId, page}` | `viewvote`, `tid`, optional `polloptionid` and `page` | Selected option, visible member IDs and continuation. A private poll can return `thread_poll_nopermission`. |
| Moderation log      | `{view: "moderation", threadId}`             | `viewthreadmod`, `tid`                                | Operator, time, action and expiry. Reasons depend on forum visibility.                                      |
| Payment history     | `{view: "payments", threadId}`               | `viewpayments`, `tid`                                 | Buyer, time, amount and credit. This is the history view.                                                   |
| Warning history     | `{view: "warnings", threadId, memberId}`     | `viewwarning`, `tid`, `uid`                           | Listed warnings, visible operator labels and cumulative summary when present                                |
| Additional comments | `{view: "comments", threadId, postId, page}` | `commentmore`, `tid`, `pid`, `page`                   | Comment text, author, time and returned pagination                                                          |

### TypeScript

Save this as `activity.ts` in a project with `tsdm-sdk` installed. Pass your host's `ActivityClientOptions` and the IDs from the forum. `inspect` runs a read. `respond` lets the host show the form choices and obtain confirmation before the single effect request.

```ts
import {
  createActivityClient,
  type ActivityClientOptions,
  type ActivityIntent,
  type ActivityQuery,
  type ActivityTarget,
  type PreparedActivity,
} from "tsdm-sdk";

export async function inspect(
  host: ActivityClientOptions,
  query: ActivityQuery,
) {
  return createActivityClient(host).readActivity(query);
}

export async function respond(
  host: ActivityClientOptions,
  target: ActivityTarget,
  confirm: (form: PreparedActivity) => Promise<ActivityIntent | null>,
) {
  const client = createActivityClient(host);
  const form = await client.prepareActivity(target);
  if (form.kind !== "prepared") return form;
  const intent = await confirm(form.prepared);
  if (!intent) return { kind: "cancelled" } as const;
  return client.submitActivity(form.prepared, intent);
}
```

For `rate`, send `{action: "rate", scores: {score6: 12}, reason: "…", notify: false}` using the credit input names and limits in `prepared.rating`. Sending a rating can change a poster's credits, can deduct credits from the rater where the form says so and may send a PM when `notify` is selected. For `report`, send `{action: "report", message: "…"}` to file a report for the floor. Use the returned reasons or provide text. For `comment`, send `{action: "comment", message: "…", items: {}}` to add a comment, using any score-item names and values from the form. The empty string abstains from an item. The SDK checks the returned text limit in forum units before dispatch. For `recommend` and `subtract`, pass the corresponding `action`. The former supports the thread. The latter casts a negative evaluation and can change the evaluation index or use an evaluation allowance.

`accepted` means the forum supplied an operation-specific acknowledgement. `refused` carries an explicit forum or permission verdict. `redrawn` means the forum returned the form again and the host can show the supplied choices and request fresh confirmation. A `handoff` provides a same-origin thread destination to show the user. A handoff after dispatch has `effect: "unknown"`. `unknown` means the action may already have taken effect. Keep the returned `target` and `intent` with the attempted action. The SDK consumes a prepared action on dispatch. Before any further attempt, inspect the applicable history or use the native forum and obtain fresh permission and confirmation. A read can show visible ratings or comments, and report status may remain private. A change in evaluation index alone can also reflect other users' evaluations.

### Python `requests`

The direct endpoints use the same forum session. Create a `requests.Session` with the intended forum cookies through your host's sign-in flow. The following functions take that session and an `origin` without a trailing slash. Supply IDs from the thread. Keep `allow_redirects=False` for both form reads and submissions.

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
    return flags.get("ok") == 1 and flags.get("v4") == 1 and capability in flags.get("thread_lists", [])


def activity(session, origin, action, **ids):
    params = {"mod": "misc", "action": action, **ids}
    if action == "viewwarning":
        params["inajax"] = 1
    elif action == "commentmore":
        params.update(inajax=1, tsdmapp="json", tsdmform=1)
    elif action in {"viewratings", "viewvote", "viewthreadmod", "viewpayments"}:
        capabilities = {"viewratings": "ratings", "viewvote": "poll_voters",
                        "viewthreadmod": "thread_mod", "viewpayments": "payments"}
        if advertised(session, origin, capabilities[action]):
            params.update(tsdmapp="json", tsdmv=4, nodoc=1)
        elif action == "viewvote":
            params.update(inajax=1)
        else:
            handle = "pay" if action == "viewpayments" else action
            params.update(infloat="yes", handlekey=handle, inajax=1, ajaxtarget="fwin_content_" + handle)
    else:
        raise ValueError("Select a read view from the table")
    return session.get(origin + "/forum.php", params=params, allow_redirects=False, timeout=20)


def open_form(session, origin, offered_url, handle):
    url = urljoin(origin + "/", offered_url)
    parsed = urlsplit(url)
    query = parse_qs(parsed.query, keep_blank_values=True)
    if (parsed.scheme, parsed.netloc) != (urlsplit(origin).scheme, urlsplit(origin).netloc):
        raise ValueError("Unexpected origin")
    opening = (
        parsed.path == "/forum.php" and query.get("mod") == ["misc"]
        and query.get("action") in (["rate"], ["comment"])
        and "ratesubmit" not in query and "commentsubmit" not in query
    ) or (
        parsed.path == "/misc.php" and query.get("mod") == ["report"]
        and query.get("rtype") == ["post"] and "reportsubmit" not in query
    )
    if not opening:
        raise ValueError("Expected an offered form opener")
    return session.get(url, params={"infloat": "yes", "handlekey": handle, "inajax": 1,
                       "ajaxtarget": "fwin_content_" + handle, "tsdmapp": "json", "tsdmform": 1},
                       allow_redirects=False, timeout=20)


def submit_once(session, origin, verified_destination, form_fields, approved_controls):
    # Verify the same-origin action and target against the thread and opened form first.
    # Call only after confirmation, with transport retries disabled.
    url = urljoin(origin + "/", verified_destination)
    parsed = urlsplit(url)
    if (parsed.scheme, parsed.netloc) != (urlsplit(origin).scheme, urlsplit(origin).netloc):
        raise ValueError("Unexpected origin")
    params = {"tsdmapp": "json"}
    if parsed.path == "/forum.php":
        params["inajax"] = 1
    return session.post(url, params=params, data={**form_fields, **approved_controls},
                        allow_redirects=False, timeout=20)


def evaluate_once(session, origin, offered_url, tid, side):
    # Call only after confirmation, with transport retries disabled.
    url = urljoin(origin + "/", offered_url)
    parsed = urlsplit(url)
    q = parse_qs(parsed.query, keep_blank_values=True)
    expected = {"mod": ["misc"], "action": ["recommend"], "tid": [str(tid)], "do": [side]}
    if ((parsed.scheme, parsed.netloc) != (urlsplit(origin).scheme, urlsplit(origin).netloc)
            or parsed.path != "/forum.php" or parsed.fragment or side not in {"add", "subtract"}
            or set(q) != {*expected, "hash"} or any(q.get(k) != v for k, v in expected.items())
            or len(q["hash"]) != 1 or not q["hash"][0]):
        raise ValueError("Unexpected evaluation URL")
    return session.get(url, params={"inajax": 1, "tsdmapp": "json"},
                       allow_redirects=False, timeout=20)
```

For example, `activity(session, origin, "viewratings", tid=tid, pid=pid)` asks for the rating ledger. The document-free JSON types for the first four views are `ratings` (48), `poll_voters` (49), `thread_mod` (50) and `payments` (51). Verify `ok`, viewer `uid`, target, list and any returned paging or visibility fields. For `commentmore`, schema 22 carries structured comments and schema 13 can carry only `document`. Warning history uses a native AJAX XML root whose CDATA holds the warning table or the forum's explicit no-record message. When the structured form of a read is unavailable, examine HTML in the same response, then make at most one native read with the same target. Stop on explicit refusal.

For a write, read the thread as the intended member, verify its ID and the exact floor and follow its offered `urls.rate`, `urls.report` or `urls.comment` and permission. `handle` is `rate`, `miscreport` followed by the PID, or `comment`. Inspect small-form schema 17 for `submit.url` and `submit.fields`. The legacy window may carry form HTML directly or in schema 13 `document`. Preserve hidden fields, submit button and the caller-approved controls. Require a matching hash and target. Rating posts to `forum.php?mod=misc&action=rate&ratesubmit=yes&infloat=yes` with `scoreN`, `reason` and the optional notification value. Reporting posts to `misc.php?mod=report` with the form's `rtype`, `rid`, `fid` and the chosen `message`. Commenting posts to the returned `forum.php?mod=post&action=reply&comment=yes` URL with its exact `tid` and `pid`, `message` and any approved comment score fields. Present forms containing verification or unfamiliar controls in the native forum.

After deliberate confirmation for a recommendation, call `evaluate_once(session, origin, offered_url, tid, side)` once. Verify that the thread offered exactly the selected `do=add` or `do=subtract` operation, `tid` and `hash`. Opening this URL itself writes.

### curl

Set `FORUM_ORIGIN`, `FORUM_COOKIE_JAR`, `TID` and the IDs needed below. Use a protected host cookie jar for the intended session. Add `--cookie "$FORUM_COOKIE_JAR"` to requests that require it. Use the intended account throughout the status and list reads. The ratings example uses `jq` to check `thread_lists`. The native AJAX options for a fallback are `inajax=1` for voters and comments, or `infloat=yes&inajax=1&handlekey=…&ajaxtarget=fwin_content_…` for ratings (`viewratings`), moderation (`viewthreadmod`) and payments (`pay`).

```sh
# Structured read. For the other views change ACTION and supply the IDs in the table.
ACTION=viewratings
# Query the capability before choosing the structured flags or the native window.
flags=$(curl -q -fsS --retry 0 --cookie "$FORUM_COOKIE_JAR" "$FORUM_ORIGIN/plugin.php?id=tsdmapp:api&action=status") || exit 1
if printf '%s' "$flags" | jq -e '.ok == 1 and .v4 == 1 and (.thread_lists | arrays | index("ratings") != null)' >/dev/null; then
  set -- --data-urlencode tsdmapp=json --data-urlencode tsdmv=4 --data-urlencode nodoc=1
else
  set -- --data-urlencode infloat=yes --data-urlencode handlekey=viewratings --data-urlencode inajax=1 --data-urlencode ajaxtarget=fwin_content_viewratings
fi
curl -sS -i --retry 0 --cookie "$FORUM_COOKIE_JAR" -G "$FORUM_ORIGIN/forum.php" \
  --data-urlencode mod=misc --data-urlencode "action=$ACTION" \
  --data-urlencode "tid=$TID" --data-urlencode "pid=$PID" "$@"

# Native warnings. For commentmore send pid/page instead of uid and add tsdmapp=json&tsdmform=1.
curl -sS -i --retry 0 --cookie "$FORUM_COOKIE_JAR" -G "$FORUM_ORIGIN/forum.php" \
  --data-urlencode mod=misc --data-urlencode action=viewwarning \
  --data-urlencode "tid=$TID" --data-urlencode "uid=$WARNED_UID" --data-urlencode inajax=1

# Open the verified read-only form URL supplied by the current thread.
curl -sS -i --retry 0 --cookie "$FORUM_COOKIE_JAR" -G "$OFFERED_FORM_URL" \
  --data-urlencode infloat=yes --data-urlencode inajax=1 \
  --data-urlencode "handlekey=$HANDLE" --data-urlencode "ajaxtarget=fwin_content_$HANDLE" \
  --data-urlencode tsdmapp=json --data-urlencode tsdmform=1
```

After obtaining consent, set `SUBMIT_URL` to the verified returned action with `tsdmapp=json` and, for rating or comment, `inajax=1` added. Save the returned hidden controls and approved choices to a protected file as the exact URL-encoded request body. Alternatively, set `EVALUATION_URL` to the verified offered recommendation URL with `inajax=1&tsdmapp=json` added, preserving the chosen side and hash. Set `ACTIVITY_CONFIRM` to `submit-form` or `evaluate` only after the user approves that particular operation.

```sh
case "${ACTIVITY_CONFIRM:-}" in
  submit-form)
    curl -sS -i --retry 0 --cookie "$FORUM_COOKIE_JAR" \
      -H 'Content-Type: application/x-www-form-urlencoded' \
      --data-binary "@$FORM_BODY_FILE" "$SUBMIT_URL"
    ;;
  evaluate)
    curl -sS -i --retry 0 --cookie "$FORUM_COOKIE_JAR" "$EVALUATION_URL"
    ;;
  *) echo 'Choose and confirm one activity action first.' >&2; exit 2 ;;
esac
```

For structured submissions inspect schema 13 and the forum keys `thread_rate_succeed`, `report_succeed`, `comment_add_succeed`, `recommend_succeed` or `recommend_daycount_succeed`. Evaluations can acknowledge success through an error-shaped callback and carry `recommendv` as the signed change. Check that its sign matches the requested side. Native rate/comment callbacks, the report success dialog and the native evaluation result can establish acknowledgement. Inspect duplicate, own-thread and quota messages as refusals. A redrawn form, opaque redirect, unrecognized reply or lost response needs deliberate handling because a repeat request can apply an additional effect.
