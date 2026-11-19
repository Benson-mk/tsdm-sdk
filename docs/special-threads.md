# Create and participate in special threads

[Tasks](../README.md#tasks) · [Account and session setup](account.md) · [Ordinary post editors](posts.md) · [Post activity](activity.md)

Use an authenticated forum member with the selected board’s posting permission or the thread’s participation permission. Keep the same cookie jar, account and transport continuity from the editor or thread read through the deliberate action. Bounties can charge the amount plus the forum’s tax. A red packet can charge credits when its thread is created. Review the settings and costs before invoking either effect.

## TypeScript SDK

`createSpecialThreadClient` uses the post editor’s transport contract and supplies `effect: true` for every write, including the two debate vote GETs. Honor `fresh: true`, preserve the supplied session and referer, leave redirects manual, and send effects once. Use `openSpecialThread(boardId, kind)` to obtain a form, then call `createSpecialThread(form, { subject, message, settings })` on approval. The returned `created` result identifies the kind and exact opening post permalink.

| Creation kind | Settings required | Independent observation |
| --- | --- | --- |
| `poll` | `choices` with at least two nonblank choices | The matching poll and stored choice labels |
| `bounty` | Integer `price` within the served credit limits | An open reward with the requested amount |
| `activity` | `startsAt`, `place`, `category` | An activity with the advertised class, place and any entered capacity |
| `debate` | `affirmative`, `negative` | Both stored positions |
| `red-packet` | Integer `total` and `shares` | The sender’s packet ID, split, reply condition and share count |

Activity dates and a debate’s `endsAt` use `YYYY-MM-DD HH:mm` in the forum member’s time zone. An end time must follow or equal the activity’s start time. The server applies its clock, privileges and cost rules. Red-packet controls come from the native plugin box. A packet receipt establishes those observed attributes. Balance changes need separate ledger evidence. A `moderation` result means the forum placed the submission in review. `redisplayed` gives the editor URL for review. `uncertain` means the effect may already have happened. Keep the input in the host and read the expected state before considering another dispatch. Some older or unsupported forms return a native browser destination. For a challenge advertised on the editor, use `refreshSpecialVerification` and `checkSpecialVerification` as on an ordinary post, then submit the member’s answers with the form.

For participation, give `prepareSpecialAction` the `boardId`, `threadId`, optional `page` and the operation below. The public form exposes offered choices or activity fields. Call `submitSpecialAction` only after the member approves. A preparation is bound to its original client and session and consumed on dispatch.

| Operation | Selection or input | Success result and effect |
| --- | --- | --- |
| `poll-vote` | `choices` containing offered IDs | `poll-voted` after the poll POST |
| `activity-apply` | `fields` keyed by the served questions | `activity-applied` after the application POST. Attendance approval remains a separate forum step. |
| `activity-cancel` | Optional `fields.message` | `activity-cancelled` after the cancellation POST |
| `debate-position` | `stand: 1` or `stand: 2` in the target | `debate-position-voted` after a GET with `stand` |
| `debater-vote` | An eligible reply’s `postId` in the target | `debater-voted` after a GET with `pid` |
| `debate-join` | `stand: 1` or `stand: 2` in the target | `browser-handoff` to the side-specific reply editor. The member publishes there. |
| `bounty-answer` | An offered reply’s `postId` in the target | `bounty-answer-selected` after the best-answer POST |

For example, prepare a side vote and dispatch it only on explicit approval.

```ts
import { createSpecialThreadClient, type SpecialThreadClientOptions } from "tsdm-sdk";

export async function voteForSide(
  host: SpecialThreadClientOptions,
  boardId: string,
  threadId: string,
  stand: 1 | 2,
  approved: boolean,
) {
  const client = createSpecialThreadClient(host);
  const result = await client.prepareSpecialAction({
    operation: "debate-position",
    boardId,
    threadId,
    stand,
  });
  if (result.kind !== "action-form" || !approved) return result;
  return client.submitSpecialAction(result.form);
}
```

`already-voted` records the forum’s duplicate-vote response. `refused` can carry the forum’s code and message, for example `reward_cant_operate`. A lost or mismatched reply returns `uncertain` after one dispatch. A fresh thread read may show a recorded vote, application state or the exact best answer. An unsupported participation form hands off to the thread or supplied debate reply editor before dispatch.

## Direct HTTP preparation

Set `FORUM_ORIGIN` to the forum origin and `FORUM_COOKIE` to the authenticated cookie header value. Set `READ_PATH` to the relative editor or thread path below, without a leading slash. Run either direct example with `APPROVE_SPECIAL` unset to capture the wire form. Inspect the viewer UID, board, thread, opening or selected reply, permission flags, and exact form destination. When the structured form is unavailable, open the native editor or thread under that account.

For a creation read, use `forum.php?mod=post&action=newthread&fid=…` plus the table’s query. The examples append `tsdmapp=json&nodoc=1`. Start the POST fields with `submit.fields` from schema 16. Add the source `subject` and `message`, current successful controls and the settings below. Keep the form hash, hidden and checked fields, attachment metadata and any native hook values. Use the returned `submit.url` and append `tsdmapp=json` at dispatch. Submit only after reviewing the current form, settings and any cost.

| Kind | Editor query | Main POST fields |
| --- | --- | --- |
| Poll | `special=1` | Preserve `special`, `polls`, `fid`, `tpolloption`. Set `polloptions` to one choice per line, `maxchoices`, optional `expiration`, and checked `visibilitypoll` or `overt`. |
| Bounty | `special=3` | Preserve `special`. Set `rewardprice` in the offered credit unit. |
| Activity | `special=4` | Preserve `special`. Set `activityplace`, `activityclass`, and `starttimefrom[0]` for a single start. For a range use `starttimefrom[1]`, `starttimeto`, and checked `activitytime`. Include served capacity, costs and requested profile fields as applicable. Serialize selected profile fields as `userfield[0]`, `userfield[1]`, and so on. |
| Debate | `special=5` | Preserve `special`. Set `affirmpoint` and `negapoint`, with `endtime` and `umpire` where offered. |
| Red packet | `specialextra=hongbao` | Read the same native editor without the JSON flags to get the plugin box first. Preserve `special=127` and `specialextra=hongbao`. Use the supplied `hb_total`, `hb_shares`, `hb_split`, optional checked `hb_cond`, `hb_password`, `hb_appoint`, `hb_expire` and `hb_blessing` controls. |

For participation, read `forum.php?mod=viewthread&tid=…` and include `page=…` for the relevant reply page where needed. Use the schema 15 `special` block and its session `formhash`. Substitute only the requested `stand` or eligible `pid` into the forum template. A `join_template` opens the reply editor and requires separate review and submission in the browser.

| Action | Use the supplied destination and fields | Acknowledgement key |
| --- | --- | --- |
| Vote on a poll | POST `special.form.action` with its fields, `formhash`, `pollsubmit=true`, and selected IDs as `pollanswers[0]`, `pollanswers[1]`, and so on. | `thread_poll_succeed` |
| Apply for an activity | POST `special.apply.action` with `inajax=1`, `formhash`, supplied fields and answers to the advertised inputs. Encode selected checkbox values with indexed names. | `activity_completion` |
| Cancel an application | POST `special.cancel.action` with `formhash`, its cancellation controls and optional message. | `activity_cancel_success` |
| Vote for a debate side or debater | GET `special.vote` with `stand`, or `special.vote_post` with `pid`. Append the supplied query fields such as `inajax=1`. Each is effectful. | `debate_poll_succeed` |
| Select a bounty answer | POST `special.set_best.action_template` with an allowed `pid`, its fixed fields, and `formhash`. | `reward_completion` |

For the approved run, set `SPECIAL_PLAN` to a private JSON file with `url`, `method` and `fields`. Copy the same-origin destination and list of `[name, value]` pairs you verified from the current form and completed inputs. Preserve repeated pairs. The examples accept `forum.php?…` destinations and append the write representation flag. For example, a fictional side vote plan can contain `{"url":"forum.php?mod=misc&action=debatevote&tid=42&stand=2","method":"GET","fields":[["inajax","1"]]}`. Set `APPROVE_SPECIAL=YES` only when the saved plan still matches the current form and the member approves. Leave redirects manual and keep the raw result for inspection.

### Python requests

```python
import json
import os
from http.cookies import SimpleCookie
from urllib.parse import parse_qs, urlsplit
import requests

env = os.environ
origin = env["FORUM_ORIGIN"].rstrip("/")

def path(value):
    result = urlsplit(value)
    assert not (result.scheme or result.netloc or result.fragment)
    assert result.path == "forum.php"
    return origin + "/" + value, parse_qs(result.query, keep_blank_values=True)

with requests.Session() as session:
    for name, cookie in SimpleCookie(env["FORUM_COOKIE"]).items():
        session.cookies.set(name, cookie.value, domain=urlsplit(origin).hostname, path="/")
    read, access = path(env["READ_PATH"])
    assert access.get("mod") == ["viewthread"] or (access.get("mod") == ["post"] and access.get("action") == ["newthread"] and "topicsubmit" not in access)
    response = session.get(read, params={"tsdmapp": "json", "nodoc": "1"}, timeout=15, allow_redirects=False)
    assert response.status_code == 200
    print(response.text)
    if env.get("APPROVE_SPECIAL") == "YES":
        with open(env["SPECIAL_PLAN"], encoding="utf-8") as file:
            plan = json.load(file)
        target, route = path(plan["url"])
        assert all(len(values) == 1 for values in route.values()) and "tsdmapp" not in route
        op = (route.get("mod", [""])[0], route.get("action", [""])[0])
        methods = {("post", "newthread"): "POST", ("misc", "votepoll"): "POST", ("misc", "activityapplies"): "POST",
                   ("misc", "debatevote"): "GET", ("misc", "bestanswer"): "POST"}
        method = methods[op]
        assert plan["method"] == method
        form = response.json()
        assert form["ok"] == 1 and str(form["uid"]) == env["MEMBER_ID"]
        fields = [(name, value) for name, value in plan["fields"]]
        if method == "POST":
            assert [value for name, value in fields if name == "formhash"] == [form["formhash"]]
        result = session.request(method, target, params=[("tsdmapp", "json")] + (fields if method == "GET" else []),
                                 data=fields if method == "POST" else None, timeout=15, allow_redirects=False)
        print(result.status_code, result.headers.get("Location", ""))
        print(result.text)
```

### curl and jq

```sh
set -eu
origin=${FORUM_ORIGIN%/}
json_mode=$(printf '%s=%s' tsdmapp json)
case "$READ_PATH" in
  forum.php\?mod=viewthread\&tid=*|forum.php\?mod=post\&action=newthread\&fid=*) ;;
  *) exit 2 ;;
esac
case "$READ_PATH" in *'#'*|*'\'*|*topicsubmit*) exit 2 ;; esac
form=$(curl -fsS --max-time 15 --cookie "$FORUM_COOKIE" "$origin/$READ_PATH&$json_mode&nodoc=1")
printf '%s\n' "$form"
[ "${APPROVE_SPECIAL:-}" = YES ] || exit 0
url=$(jq -er '.url' "$SPECIAL_PLAN")
method=$(jq -er '.method' "$SPECIAL_PLAN")
case "$url" in *'#'*|*'\'*|*tsdmapp*) exit 2 ;; esac
case "$method:$url" in
  GET:forum.php\?mod=misc\&action=debatevote\&*|POST:forum.php\?mod=post\&action=newthread\&*|\
  POST:forum.php\?mod=misc\&action=votepoll\&*|POST:forum.php\?mod=misc\&action=activityapplies\&*|\
  POST:forum.php\?mod=misc\&action=bestanswer\&*) ;;
  *) exit 2 ;;
esac
formhash=$(printf '%s' "$form" | jq -er --arg uid "$MEMBER_ID" 'select(.ok == 1 and (.uid|tostring) == $uid) | .formhash')
fields=$(jq -er --arg method "$method" --arg hash "$formhash" '
  .fields | select($method == "GET" or (map(select(.[0] == "formhash") | .[1]) == [$hash]))
  | map(map(tostring | @uri) | join("=")) | join("&")' "$SPECIAL_PLAN")
if [ "$method" = GET ]; then
  curl -sS -i --max-time 15 --cookie "$FORUM_COOKIE" --get --data "$fields" "$origin/$url&$json_mode"
else
  curl -sS -i --max-time 15 --cookie "$FORUM_COOKIE" --data "$fields" "$origin/$url&$json_mode"
fi
```

Read schema 13’s `kind`, `message_key`, `login`, `uid`, `alert` and candidate URL together. The bounty success key may carry `alert: "info"`. A generic success message or redirect after participation can leave the effect uncertain. For creation, verify the exact opening post and special block by a separate same-account thread GET. For a suspected vote or participation change, read the thread in the intended session and inspect the current special block. An absent, lost or ambiguous response leaves the original effect uncertain. Any further dispatch needs a new deliberate decision.
