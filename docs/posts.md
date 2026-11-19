# Create, edit, save and schedule posts

[Tasks](../README.md#tasks) · [Account and session setup](account.md) · [Find a saved draft](discovery.md) · [Send a new reply](replies.md)

Use an authenticated forum session with permission to write in the selected board or edit the selected post. Keep the same account, cookie jar and session continuity through preparation, verification, dispatch and readback. An edit takes the board, thread and exact post IDs. For a saved draft, use the opening post ID, which the draft list can supply or you can obtain by opening the draft.

| Task | `openPost` target kind | `submitPost` input | Observable result |
| --- | --- | --- | --- |
| Create an ordinary thread | `new-thread` | Subject and message | `published` with the opening post permalink |
| Edit the opening post | `edit-first` | Message and optional subject | `edited` with the opening post permalink |
| Edit an existing reply | `edit-reply` | Message | `edited` with that reply’s exact permalink |
| Save a new draft or save changes | `new-thread` or `draft` | `intent: "save-draft"` | `draft-saved` with an author-visible post permalink |
| Publish an existing draft | `draft` | `intent: "publish"` | `published` with the same opening post identity |
| Schedule a new thread | `new-thread` | `intent: "schedule"` and `forumDate` | `scheduled` with the post permalink and observed date, or `published` if the forum released it immediately |

Check the form’s `canSaveDraft`, `canPublishDraft`, `canSchedule` and `categories` before enabling those inputs. `forumDate` is a calendar value such as `2099-04-03 14:05` in the account’s **forum time zone**. The forum compares it against its clock and controls when the publication job runs. A schedule is confirmed only when the follow-up editor exposes the selected date for the saved post. The browser continues management of a post that is already scheduled.

## TypeScript

A host supplies an HTTPS forum origin, `session()` and a transport. The transport uses the supplied session continuity, honors `fresh: true`, sends POST bodies as `application/x-www-form-urlencoded`, forwards the verification `referer` and leaves redirects manual. Use `redirect: "none"` for a response received directly from the requested URL, including a manual 302 whose `Location` is available in `location`. Report opaque and followed redirects using their respective values.

```ts
import {
  createPostClient,
  type PostClientOptions,
  type PostEditorTarget,
  type PostInput,
} from "tsdm-sdk";

export async function submitReviewedPost(
  host: PostClientOptions,
  target: PostEditorTarget,
  input: PostInput,
  approved: boolean,
) {
  const posts = createPostClient(host);
  const prepared = await posts.openPost(target);
  if (prepared.kind !== "post-form" || !approved) return prepared;
  return posts.submitPost(prepared.form, input);
}
```

For interactive verification, retain the client and original form. Call `refreshPostVerification(form, "image")` or `refreshPostVerification(form, "question")` for each challenge the form advertises. For an image result, fetch and display its `destination` with the supplied `session` and `referer`. For a question, display the returned text. Ask the member for the answers. An optional `checkPostVerification` call returns `accepted`, `rejected` or `inconclusive`. Pass the human answers as `answers.image` and `answers.question` on deliberate submission. If the forum challenges at dispatch, `challenge-refused` consumes the form. Reopen the editor or continue in the browser.

`openPost` may hand back a native editor URL for a form that requires browser continuation, including a legacy draft, a special thread or an unsupported challenge. A `redisplayed` result gives the editor URL for deliberate review. `conflict` means the edit preflight found a changed or unavailable baseline. A valid form belongs to one client and session. Starting a valid submission attempt consumes it, including when an edit preflight finds a conflict. Keep the submitted source in the host if the result is `uncertain`. Look for the intended effect using a separate read under the original account before deciding whether to submit again. `moderation` means the forum reports pending review. Links on draft and scheduled results can require the original account.

## Direct HTTP with Python requests

The examples below cover schema 16 editors. Set `FORUM_ORIGIN`, `FORUM_COOKIE`, `MEMBER_ID`, `BOARD_ID`, `POST_MESSAGE` and `POST_ACTION` in the environment. Choose `new-thread`, `edit-first`, `edit-reply`, `save-draft`, `publish-draft` or `schedule` for `POST_ACTION`. Set `THREAD_ID` and `POST_ID` for edits, existing draft saves and draft publication. Supply `POST_SUBJECT` for a new thread and optional `CATEGORY_ID` for a category shown by the form. Set `FORUM_DATE` for scheduling. Inspect the form and confirm the intended effect before running a dispatch with `POST_ACCEPT=YES`.

```python
import os
from http.cookies import SimpleCookie
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit
import requests

env = os.environ
origin = env["FORUM_ORIGIN"].rstrip("/")
board, member, job = (env[k] for k in ("BOARD_ID", "MEMBER_ID", "POST_ACTION"))
assert job in {"new-thread", "edit-first", "edit-reply", "save-draft", "publish-draft", "schedule"}
thread, post = env.get("THREAD_ID"), env.get("POST_ID")
assert bool(thread) == bool(post)
assert bool(thread) == (job in {"edit-first", "edit-reply", "publish-draft"} or job == "save-draft" and bool(thread))
action = "edit" if thread else "newthread"
page = {"mod": "post", "action": action, "fid": board}
if thread:
    page.update(tid=thread, pid=post)

with requests.Session() as session:
    for name, cookie in SimpleCookie(env["FORUM_COOKIE"]).items():
        session.cookies.set(name, cookie.value, domain=urlsplit(origin).hostname, path="/")
    response = session.get(origin + "/forum.php", params={**page, "tsdmapp": "json", "nodoc": "1"},
                           allow_redirects=False, timeout=15)
    assert response.status_code == 200
    form = response.json()
    assert (form["type"], form["schema"], form["ok"], str(form["uid"]), form["action"]) == ("post", 16, 1, member, action)
    assert str(form["fid"]) == board
    assert (str(form["tid"]), str(form["pid"])) == (thread or "0", post or "0")
    assert form["first"] == (0 if job == "edit-reply" else 1)
    assert not form.get("seccheck") and not form.get("hook_fields") and not form.get("unsupported")
    assert not (form.get("special") or {}).get("current")
    assert form["submit"]["method"] == "POST"
    dest = urlsplit(urljoin(origin + "/forum.php", form["submit"]["url"]))
    query = parse_qsl(dest.query, keep_blank_values=True)
    assert not dest.fragment and f"{dest.scheme}://{dest.netloc}" == origin and dest.path == "/forum.php"
    assert len(dict(query)) == len(query)
    keys = dict(query)
    assert keys.get("mod") == "post" and keys.get("action") == action
    assert keys.get("editsubmit" if thread else "topicsubmit") == "yes"
    assert not {"delete", "delpost", "replysubmit"} & keys.keys()
    fields = list(form["submit"]["fields"].items())
    for key, expected in (("fid", board), ("tid", thread), ("pid", post)):
        assert all(str(values[key]) == expected for values in (dict(fields), keys) if key in values)
        assert expected is None or key in keys or key in dict(fields)
    blocks = [form.get("options") or []]
    blocks += [(form.get(key) or {}).get("inputs", []) for key in ("replycredit", "rushreply", "cronpublish")]
    types = form.get("types") or {}
    category = None if types.get("locked") else types.get("input")
    controls = [category, form.get("readperm"), form.get("stand"), form.get("mygroup")]
    controls += [(form.get(key) or {}).get("input") for key in ("price", "tags")]
    for field in controls + [field for block in blocks for field in block]:
        if field and not field.get("disabled") and (field.get("type") not in {"checkbox", "radio"} or field.get("checked")):
            if field.get("value") is not None:
                fields.append((field["name"], field["value"]))
    fields += list((form.get("attach") or {}).get("fields", {}).items())
    overrides = {"message": env["POST_MESSAGE"]}
    if form["first"]:
        overrides["subject"] = env.get("POST_SUBJECT", form["subject"]["value"])
    elif (form.get("subject") or {}).get("shown") == 1:
        overrides["subject"] = form["subject"]["value"]
    if "CATEGORY_ID" in env:
        assert category and any(str(choice["value"]) == env["CATEGORY_ID"] for choice in category["choices"])
        overrides["typeid"] = env["CATEGORY_ID"]
    if job == "save-draft":
        assert form["draft"]["can_save"] == 1
        overrides["save"] = "1"
    if job == "publish-draft":
        assert form["draft"]["publish"] == 1 and form["thread"]["draft"] == 1
    if job == "schedule":
        cron = {item["name"]: item for item in blocks[-1] if not item.get("disabled")}
        assert not cron["cronpublish"].get("checked") and "cronpublishdate" in cron
        overrides.update(cronpublish=cron["cronpublish"]["value"], cronpublishdate=env["FORUM_DATE"])
    fields = [(key, value) for key, value in fields if key not in overrides] + list(overrides.items())
    if env.get("POST_ACCEPT") != "YES":
        print("Review the returned form before dispatch.")
    else:
        keys["tsdmapp"] = "json"
        url = urlunsplit(dest._replace(query=urlencode(keys)))
        response = session.post(url, data=fields, allow_redirects=False, timeout=15)
        print(response.status_code, response.headers.get("Location", ""))
        print(response.text)
```

The direct examples print the wire result. Use the separate read described below to assess the effect. For a native editor, remove `tsdmapp` and `nodoc` from the editor request. An older JSON response may also carry its editor HTML in `document`. Read the exact form’s `action` and successful controls, preserve repeated names and hidden fields, and verify the viewer, target and submit action before a deliberate POST. Use the browser if the form requires controls or verification you cannot represent. The forum’s native **Publish** link on a saved draft can itself change state via GET. Opening or following that action requires separate user approval.

## Direct HTTP with curl

With the same environment, `curl` and `jq`, get the editor, inspect its account and controls, then send the encoded fields to its same-origin `submit.url`. For a native form, inspect the returned HTML and use the verified form action and its successful controls in a separate `curl --data-urlencode` call. Use a private working directory for cookie, form and response data.

```sh
set -eu
origin=${FORUM_ORIGIN%/}
case "$POST_ACTION" in
  new-thread|schedule) action=newthread ;;
  edit-first|edit-reply|publish-draft) action=edit ;;
  save-draft) if [ -n "${THREAD_ID:-}" ]; then action=edit; else action=newthread; fi ;;
  *) exit 2 ;;
esac
if [ "$action" = edit ]; then
  set -- --data-urlencode "tid=${THREAD_ID:?}" --data-urlencode "pid=${POST_ID:?}"
else
  set --
fi
form=$(curl -fsS --max-time 15 --cookie "$FORUM_COOKIE" --get "$origin/forum.php" "$@" \
  --data-urlencode 'mod=post' --data-urlencode "action=$action" --data-urlencode "fid=$BOARD_ID" \
  --data-urlencode 'tsdmapp=json' --data-urlencode 'nodoc=1')
[ "${POST_ACCEPT:-}" = YES ] || exit 0
form_action=$(printf '%s' "$form" | jq -er --arg uid "$MEMBER_ID" --arg fid "$BOARD_ID" \
  --arg tid "${THREAD_ID:-0}" --arg pid "${POST_ID:-0}" --arg action "$action" --arg job "$POST_ACTION" '
  select(.type == "post" and .schema == 16 and .ok == 1 and (.uid|tostring) == $uid
    and (.fid|tostring) == $fid and (.tid|tostring) == $tid and (.pid|tostring) == $pid
    and .action == $action and .first == (if $job == "edit-reply" then 0 else 1 end)
    and .seccheck == null and (.hook_fields // [] | length) == 0 and (.unsupported // [] | length) == 0
    and (.special.current // 0) == 0 and .submit.method == "POST") | .submit.url')
# This example accepts the relative forum.php destinations that these editors return.
case "$form_action" in
  forum.php\?*) ;;
  /forum.php\?*) form_action=${form_action#/} ;;
  *) exit 2 ;;
esac
case "$form_action" in *'#'*|*'\'*) exit 2 ;; esac
case "&${form_action#*\?}&" in
  *'&mod=post&'*) ;;
  *) exit 2 ;;
esac
case "$action:&${form_action#*\?}&" in
  newthread:*'&action=newthread&'*) marker=topicsubmit ;;
  edit:*'&action=edit&'*) marker=editsubmit ;;
  *) exit 2 ;;
esac
case "&${form_action#*\?}&" in
  *"&$marker=yes&"*) ;;
  *) exit 2 ;;
esac
body=$(printf '%s' "$form" | jq -ce --arg job "$POST_ACTION" --arg msg "$POST_MESSAGE" \
  --arg subject "${POST_SUBJECT:-}" --arg date "${FORUM_DATE:-}" --arg category "${CATEGORY_ID:-}" '
  def pairs: to_entries | map([.key, .value]);
  def active: select(. != null and (.disabled // 0) != 1
    and (if .type == "checkbox" or .type == "radio" then .checked == 1 else true end)
    and .value != null) | [.name, .value];
  . as $f | (if .types.locked == 1 then null else .types.input end) as $type
  | ($f.submit.fields | pairs)
  + ([$type, $f.readperm, $f.price.input, $f.tags.input, $f.stand, $f.mygroup]
    + ($f.options // []) + ($f.replycredit.inputs // []) + ($f.rushreply.inputs // []) + ($f.cronpublish.inputs // []) | map(active))
  + ($f.attach.fields // {} | pairs)
  | ((if $f.first == 1 then {subject: (if $subject == "" then $f.subject.value else $subject end)} elif $f.subject.shown == 1 then {subject: $f.subject.value} else {} end)
    + {message: $msg}
    + (if $category == "" then {} elif any($type.choices[]?; (.value|tostring) == $category) then {typeid: $category} else error("Unknown category") end)
    + (if $job == "save-draft" then if $f.draft.can_save == 1 then {save: "1"} else error("No draft save") end
      elif $job == "publish-draft" and ($f.draft.publish != 1 or $f.thread.draft != 1) then error("No draft publication")
      elif $job == "schedule" then
        ($f.cronpublish.inputs[] | select(.name == "cronpublish" and .checked == 0 and (.disabled // 0) == 0)) as $cron
        | {cronpublish: $cron.value, cronpublishdate: $date}
      else {} end)) as $changes
  | map(select(.[0] as $name | $changes | has($name) | not)) + ($changes | pairs)
  | map(map(tostring | @uri) | join("=")) | join("&")' -r)
curl -sS --max-time 15 --cookie "$FORUM_COOKIE" -i \
  --header 'Content-Type: application/x-www-form-urlencoded' --data "$body" \
  "$origin/$form_action&tsdmapp=json"
```

On either direct path, retain the response status, `Location` and body. In schema 13, check the viewer, `kind`, `login`, `alert`, `message_key` and returned URL. A `page` can contain a redrawn editor. A `handle` can carry a post callback. On the native path, a manual redirect or a forum message may identify a candidate thread. Fetch the candidate with a separate same-session GET to `forum.php?mod=viewthread&tid=…&tsdmapp=json&nodoc=1`. Check the board, thread, post ID, author, stored source and draft or moderation status. For a queued schedule, GET the opening post editor and check its retained `cronpublishdate`. Lack of matching evidence leaves the effect uncertain. Keep the draft after a timeout or ambiguous response and decide on any further submission separately.

For verification the forum uses `misc.php?mod=seccode` or `misc.php?mod=secqaa` with `action=update` and the served `idhash`. Use the same forum session and the editor `Referer`. Display the qualified same-origin image or the text inside the question’s AJAX response. An optional `action=check` GET adds `inajax=1` and the human’s `secverify`. Image requests use the served `modid`. Submit image answers as `seccodehash`, `seccodemodid` and `seccodeverify`, and question answers as `secqaahash` and `secanswer`. The verification check is advisory. Let the member continue in the browser when the form or verification format is unsupported.
