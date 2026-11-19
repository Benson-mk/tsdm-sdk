# Poll unread notices and deliberately acknowledge them

[Back to SDK tasks](../README.md#tasks)

Use Node.js 26 and the installed `tsdm-sdk` package. For member operations, the host supplies a canonical HTTPS forum origin, an authenticated member session and a transport. Use the same cookie jar throughout a scan and any subsequent acknowledgement. Give each login a new `NoticeSession.continuity` value, including re-login as the same member. Send `fresh` requests without cached responses. Report the actual response URL and stop at redirects. For POSTs set `Content-Type: application/x-www-form-urlencoded`. Disable transport retries on effectful requests.

## Observe unread notices

`pollUnreadNotices({ since })` takes an inclusive Unix timestamp in seconds. Read `rows`, `window`, `accountCoverage`, `stop`, `forumUnreadCount` and `nextSince` together. Store the lower bound per account. A failed continuation returns the accepted rows and retains the previous bound. A first-page rate limit leaves the window unknown. A retry may show the same IDs, so merge displayed rows by notice ID within the account. `forumUnreadCount` is the total reported by the first page when present. Count distinct unread IDs across all accepted pages, including notices older than `since`, when checking that total. Later totals can change as notices arrive.

The default window scan can stop when it sees a strictly older unread row. For account-wide coverage, request `coverage: "account"`. The SDK follows the supplied cursors through an explicit last page or checks that a legacy response contains the reported number of distinct unread rows. The default budget is ten pages. Set `maxPages` explicitly if the host can afford more requests. A continuation can hit a plugin rate limit, so space requests in the host transport if the deployment requires it. Polling dispatches only `notify` GETs.

## Acknowledge all unread notices

Show the member the scope of the action and ask for a separate choice. Acknowledgement can clear older notices outside the displayed time window. Keep the original poll object on the same SDK client. After `accountCoverage: "exhausted"` and the member's choice, call `acknowledgeAllUnreadNotices(poll)`. A usable first-page forum time and form hash and continuous session are required. A terminal page must have an empty or absent `next`. A nonempty terminal continuation must advance past the incoming cursor and contribute an unread ID. A known first-page total must be covered before sending `seen`. `cleared` is explicit forum confirmation for that account. `newer-unread` means the forum left notices unread because one arrived or was flagged unread again. `unknown-effect` means the dispatch may have cleared the notices. Start a fresh poll and get a fresh deliberate choice before trying again. `not-dispatched` means the SDK made no acknowledgement request for that call.

### TypeScript with the installed SDK

Save this as `notice-guide.ts` in the project that installed the tarball. Run `node notice-guide.ts` to print the unread rows and coverage. Run `node notice-guide.ts --acknowledge` to exercise the separate acknowledgement against the in-memory fixture. Both runs use synthetic data and make zero network requests.

```ts
import assert from "node:assert/strict";
import { createNoticeClient } from "tsdm-sdk";

const origin = "https://controlled.example.invalid";
const session = { memberId: "34", continuity: "fixture-login" };
const notices = createNoticeClient({
  origin,
  session: () => session,
  transport: {
    async request(url, request) {
      const target = new URL(url);
      assert.equal(target.origin, origin);
      assert.deepEqual(request.session, session);
      assert.equal(request.fresh, true);
      let body;
      if (request.method === "GET") {
        assert.equal(target.href, origin + "/plugin.php?id=tsdmapp%3Aapi&action=notify&since=1793491200&limit=200");
        body = {
          ok: 1, uid: 34, time: 1794534229, formhash: "fixture-first",
          notices: [{ id: 26771, dateline: 1794278273, new: 1, text: "Fixture notice" }],
          has_more: 0,
        };
      } else {
        assert.equal(target.href, origin + "/plugin.php?id=tsdmapp%3Aapi&action=seen");
        assert.equal(request.body, "formhash=fixture-first&notice=1794534229");
        body = { ok: 1, uid: 34, notice: 1, newer: 0 };
      }
      return { url, status: 200, redirect: "none", contentType: "application/json", body: JSON.stringify(body) };
    },
  },
});

const poll = await notices.pollUnreadNotices({ since: 1793491200, coverage: "account" });
console.log(poll.rows.map(({ id }) => id), poll.window, poll.accountCoverage);
if (process.argv.includes("--acknowledge") && poll.accountCoverage === "exhausted") {
  console.log((await notices.acknowledgeAllUnreadNotices(poll)).kind);
}
```

## Open a native category or read history

Call `prepareNativeNoticePage()` for the inbox or pass a returned `categories` or `pages.links` URL for the next category or page. Display the handoff's `warning` before calling `openNativeNoticePage(handoff)`. **The GET may mark notices read**, even when its response fails to load or decode. A returned page reports `readEffect: "possible"`. After a dispatch with unusable evidence, it reports `readEffect: "unknown"`. From a notice row, pass a `postDestinations` entry to `noticePostDestination` and give the resulting URL to the host to open deliberately. That handoff sends zero SDK requests.

## Manage notice-ignore rules

Call `loadNoticeIgnoreRules()` to read current rules and `loadNoticeIgnoreForm(row.ignoreTarget)` for the scopes offered by the forum. After a deliberate choice, call `addNoticeIgnoreRule(target, "author")` or `addNoticeIgnoreRule(target, "everybody")`. Use `removeNoticeIgnoreRule(target)` to remove a listed rule. Removing a rule submits the privacy form with the other checked filters preserved. Keep privacy writes for the same account serialized across host clients. `applied` includes the rules returned by fresh readback. On an `unknown-effect`, read the rules again before making another choice.

The SDK checks the current member’s `status` for `v4: 1` and `ignore` in `forms` before opening the structured window. If the form is unadvertised or the response uses an unsupported representation, `loadNoticeIgnoreForm` returns `handoff` with the native destination. Explicit refusal, rate limit or session change ends the attempt. `addNoticeIgnoreRule` rechecks before attempting a structured form and leaves native submission to the host.

For native forms, `prepareNativeNoticeIgnoreForm(target)` returns the add form destination and `prepareNativeNoticeIgnoreRules()` returns the privacy filter destination for removal. Let the forum display, submit and report the form in the host browser. The handoffs themselves send zero SDK requests.

## Direct HTTP with Python requests and curl

The runnable examples below use a controlled loopback origin, Python `requests` or Bash with curl and jq, and synthetic account 34. They send actual HTTP requests to the local fixture service. The installed SDK offers the full result and session contract above. These direct examples demonstrate the wire requests with bounded fixture inputs. For a forum integration, use the host's authenticated HTTPS session, validate the returned account on each step, keep the previous lower bound on failure, and handle rate limits and uncertain effects as above. Never forward a session cookie or form fields to a redirected origin.

Both examples default to observing a two-page unread list. `--acknowledge` is the deliberate choice to mark the entire fixture account's unread notices read, with the first page's `time` and `formhash`. A valid run prints `26771 26545` and, when the flag is used, `cleared`. Follow the server's cursor. Omit `pm` from the POST. A missing, lost or ambiguous response leaves the effect unknown. Run a fresh scan and make another deliberate choice before any retry.

### Python requests

Save as `notice-http.py`. Set `NOTICE_FIXTURE_ORIGIN` to the fixture service and run `python3 notice-http.py`. Use `python3 notice-http.py --acknowledge` for a separately chosen effect.

```python
import os
import re
import sys

import requests

origin = os.environ["NOTICE_FIXTURE_ORIGIN"]
assert re.fullmatch(r"http://127\.0\.0\.1:[0-9]+", origin)
assert sys.argv[1:] in ([], ["--acknowledge"])
since = 1793491200
params = {"id": "tsdmapp:api", "action": "notify", "since": since, "limit": 200}

with requests.Session() as session:
    session.trust_env = False

    def api(method, query, fields=None):
        response = session.request(method, origin + "/plugin.php", params=query, data=fields,
                                   allow_redirects=False, timeout=10)
        if response.status_code != 200:
            raise RuntimeError(f"HTTP {response.status_code}")
        data = response.json()
        if data.get("ok") != 1 or data.get("uid") != 34:
            raise ValueError("Unqualified response")
        return data

    ids, all_ids = {}, set()
    incoming = None
    oldest = float("inf")
    for index in range(10):
        page = api("GET", params)
        if index == 0:
            first = page
        assert page["has_more"] in (0, 1)
        unread = [row for row in page["notices"] if row["new"] == 1]
        previously_seen = len(all_ids)
        for row in unread:
            all_ids.add(row["id"])
            assert 0 < row["dateline"] <= oldest
            oldest = row["dateline"]
            if oldest >= since:
                ids[row["id"]] = None
        tail = (unread[-1]["dateline"], unread[-1]["id"]) if unread else None
        if tail is not None and incoming is not None:
            if not tail < incoming:
                raise ValueError("Notice cursor did not advance")
        if page["has_more"] == 0:
            total = first.get("counts", {}).get("notice")
            if (page.get("next") not in (None, "")
                    or (incoming is not None and unread and len(all_ids) == previously_seen)
                    or (isinstance(total, int) and len(all_ids) < total)):
                raise ValueError("Unread coverage remains unproven")
            break
        cursor = page["next"]
        if tail is None or cursor != f"{tail[0]}_{tail[1]}":
            raise ValueError("Invalid notice cursor")
        incoming = tail
        params.pop("since", None)
        params["before"] = cursor
    else:
        raise RuntimeError("Page budget exhausted")

    print(*ids)
    if sys.argv[1:] == ["--acknowledge"]:
        assert first["formhash"] and first["time"] > 0
        outcome = "unknown-effect"
        try:
            result = api("POST", {"id": "tsdmapp:api", "action": "seen"},
                         {"formhash": first["formhash"], "notice": first["time"]})
            if result.get("newer") == 1:
                outcome = "newer-unread"
            elif result.get("notice") == 1 and result.get("newer", 0) == 0:
                outcome = "cleared"
        except (requests.RequestException, ValueError, RuntimeError):
            pass
        print(outcome)
```

### curl

Save as `notice-http.sh` and run `bash notice-http.sh` or explicitly choose `bash notice-http.sh --acknowledge`. This version expects the fixture's two pages. It checks the account, order and terminal page before it can send `seen`.

```sh
set -eu
[[ $NOTICE_FIXTURE_ORIGIN =~ ^http://127\.0\.0\.1:[0-9]+$ ]]
[[ $# == 0 || ( $# == 1 && $1 == --acknowledge ) ]]
api="$NOTICE_FIXTURE_ORIGIN/plugin.php?id=tsdmapp%3Aapi"
request() {
  local output status
  output=$(mktemp)
  status=$(curl --noproxy '*' --silent --show-error --max-time 10 -o "$output" -w '%{http_code}' "$@") || status=000
  if [[ $status == 200 ]]; then cat "$output"; fi
  rm -f "$output"
  [[ $status == 200 ]]
}
first=$(request "$api&action=notify&since=1793491200&limit=200")
cursor=$(jq -er 'select(.ok == 1 and .uid == 34 and .has_more == 1) |
  .next as $next | [.notices[] | select(.new == 1)] | last |
  select($next == "\(.dateline)_\(.id)") | $next' <<<"$first")
last=$(request --get --data-urlencode "before=$cursor" "$api&action=notify&limit=200")
printf '%s\n' "$first" "$last" | jq -ers '
  select(.[1].ok == 1 and .[1].uid == 34 and .[1].has_more == 0
    and (.[1].next == null or .[1].next == "")) |
  .[0].counts.notice as $total |
  [.[0].notices[] | select(.new == 1)] as $initial |
  [.[1].notices[] | select(.new == 1)] as $terminal |
  ($initial + $terminal) as $rows |
  select(($terminal | length) == 0 or
    (([$terminal[-1].dateline, $terminal[-1].id] < [$initial[-1].dateline, $initial[-1].id])
      and (($rows | map(.id) | unique | length) > ($initial | map(.id) | unique | length)))) |
  select($total == null or (($rows | map(.id) | unique | length) >= $total)) |
  ($rows | map(.dateline)) as $times |
  select($times == ($times | sort | reverse)) |
  [$rows[] | select(.dateline >= 1793491200) | .id] | unique | reverse | join(" ")'
if [[ ${1:-} == --acknowledge ]]; then
  hash=$(jq -er '.formhash | strings | select(length > 0)' <<<"$first")
  time=$(jq -er '.time | numbers | select(. > 0 and floor == .)' <<<"$first")
  if result=$(request --data-urlencode "formhash=$hash" --data-urlencode "notice=$time" "$api&action=seen"); then
    jq -er 'if .ok == 1 and .uid == 34 and .newer == 1 then "newer-unread"
      elif .ok == 1 and .uid == 34 and .notice == 1 and (.newer // 0) == 0 then "cleared"
      else "unknown-effect" end' <<<"$result" || printf '%s\n' unknown-effect
  else
    printf '%s\n' unknown-effect
  fi
fi
```

For both HTTP clients, the other operations use the following requests. In Python use `session.get(url, allow_redirects=False, timeout=10)` or a single `session.post(url, data=fields, allow_redirects=False, timeout=10)`. In curl use `curl --silent --show-error --max-time 10 "$url"` or add one `--data-urlencode 'name=value'` for each encoded form field. Use the authenticated host session for member data. Observe the status and response before deciding whether to proceed.

| Operation | Direct request and observable result |
| --- | --- |
| Native category or history | After warning that the GET can mark notices read, GET `/home.php?mod=space&do=notice`. Follow a supplied category such as `view=system`, the `isread=1` history destination, or a supplied `page` link. Inspect the returned category and page. A failed GET or decode leaves the effect uncertain. |
| Notice-to-post | Hand the same-origin `forum.php?mod=redirect&goto=findpost` URL from a notice to the browser with its `pid` and supplied thread parameters. The browser can resolve the redirect to the post. |
| List ignore rules | GET `/home.php?mod=spacecp&ac=privacy&op=filter`. Inspect the checked `privacy[filter_note]` controls for the active account. |
| Add an ignore rule | Open the notice's `/home.php?mod=spacecp&ac=common&op=ignore` link with its `type` and `authorid`. Check same-account `status` before adding `tsdmapp=json&tsdmv=4&tsdmform=1&nodoc=1`. Require `v4: 1` and `ignore` in `forms`; otherwise use the native URL. Inspect the offered author choices. After consent, POST the supplied same-origin form action using its hidden fields, including `formhash` and `ignoresubmit`, and the chosen `authorid`. Read the privacy form again and verify the new rule. |
| Remove an ignore rule | After consent, POST the active privacy form's supplied action with its hidden fields, including `formhash` and `privacy2submit`, and all the checked notice, feed and group controls except the selected notice rule. Reload the privacy form and verify that the rule disappeared and the other checked filters remain. |
