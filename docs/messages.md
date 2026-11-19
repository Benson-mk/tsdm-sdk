# Read and send private messages

Return to the [SDK tasks](../README.md#tasks).

Use your own signed-in forum session on the canonical HTTPS origin. Use the public `createMessageClient` with the same host contract as [unread notices](notices.md). The host supplies the current member ID and a continuity value that changes on every sign-in, even for the same member. It attaches the matching session, performs fresh requests, reports redirects and sends each requested POST once. Transport bodies use `application/x-www-form-urlencoded` for POSTs.

| Task                                 | SDK operation                                                                                              | Observable result and possible effect                                                                                                                                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| List private conversations           | `listPrivateMessages()`                                                                                    | `private-list` reports one-to-one peers, previews and unread flags from `pmlist`. `omittedGroups` counts group rows.                                                                                                |
| List broadcasts                      | `listBroadcastMessages()`                                                                                  | `broadcast-list` reports message IDs, text and unread flags from `pmlist&filter=announce`. `closed` reports that the forum turned PMs off.                                                                          |
| Open a conversation                  | `openPrivateConversation(peerId, { confirm: true, page })`                                                 | `conversation` reports the returned page and messages. Omitting `page` lets the forum choose the last page. The forum may mark messages read. A usable reply form appears as `send`.                                |
| Open a broadcast                     | `openBroadcastMessage(id, { confirm: true })`                                                              | `broadcast` returns the body. Opening marks the broadcast read on supported forum paths. A failed load can leave that effect unknown.                                                                               |
| Open chat or refresh recent messages | `openChatDialog(peerId, { confirm: true })` or `openRecentMessages(peerId, { confirm: true })`             | `chat-dialog` returns recent messages and a send form. `recent-messages` supplies rows alone. Both may mark messages read.                                                                                          |
| Send from either form                | `sendPrivateMessage(view.send, message, { confirm: true })`                                                | `accepted` means the forum returned a matching success result. `messageId` is available when supplied. `refused` can carry a forum code.                                                                            |
| Clear the private-message prompt     | `preparePrivateMessageAcknowledgement()` then `acknowledgePrivateMessagePrompt(prompt, { confirm: true })` | `cleared` requires an explicit `pm=1` result for the same account. The request contains `pm=1` and the observed `formhash`. The forum can clear the account's PM prompt for messages that arrive after preparation. |
| Check the homepage PM prompt         | `prepareHomepageMessageCheck()` then `checkHomepageMessages(check, { confirm: true })`                     | The prepared result advertises `may-credit-daily-login`. `loaded` confirms the HTTP response and reports `credit: 'unknown'`. Check an independent credit balance or log if the amount or eligibility matters.      |

Show these effects before asking the user to proceed. A list can return `native-page` with a URL and effect for the host to display or open deliberately. Page numbers above one use that handoff. A native private list may clear the PM prompt. A native broadcast list is distinct from broadcast detail. On detail reads, the SDK can use native HTML returned by the same request. `effect-unknown` may offer a `nativeUrl` for a separate user action. This release handles one-to-one conversations. Continue group chat and any unsupported form in the native forum. Use list previews to avoid opening detail merely to display a summary.

Send forms and prompt/check preparations are transient and bound to this client and session. Retain the draft when a send returns `uncertain` and let the user check the original conversation, under the original account, before deciding whether to start a fresh send. Similar message text alone cannot attribute an attempt. A send form is consumed at dispatch. For an uncertain PM clear or homepage check, make a fresh observation and ask again before dispatching. Clearing the PM prompt and marking all unread notices read are separate operations. Homepage script responses are fetched as data and are never executed by the SDK.

## TypeScript

This example uses a fake signed-in session and controlled transport. Run the saved file with `node messages.ts` in a Node 26 project with `tsdm-sdk` installed. It prints `702 Fake message`.

```ts
import { createMessageClient, type NoticeClientOptions } from "tsdm-sdk";

const options: NoticeClientOptions = {
  origin: "https://forum.example.test",
  session: () => ({ memberId: "701", continuity: "example-session" }),
  transport: {
    async request(url, request) {
      if (request.method !== "GET") throw new Error("Unexpected write");
      return {
        url,
        status: 200,
        redirect: "none",
        contentType: "application/json",
        body: JSON.stringify({
          ok: 1,
          uid: 701,
          timeoffset: 8,
          closed: 0,
          pms: [
            {
              type: 1,
              plid: 812,
              touid: 702,
              tousername: "Fake Peer",
              lastauthorid: 702,
              lastdateline: 1700000001,
              new: 1,
              lastsummary_html: "Fake message",
            },
          ],
        }),
      };
    },
  },
};
const sdk = createMessageClient(options);
const inbox = await sdk.listPrivateMessages();
if (inbox.kind !== "private-list") throw new Error(inbox.kind);
const first = inbox.rows[0];
if (first) console.log(first.peerId, first.preview);
```

For a host send, first display the recipient and draft from your own UI. Open the dialog or history deliberately, retain the returned `send` value, then call `sendPrivateMessage` on that value only after the user confirms. The SDK applies a supplied native `maxlength`. The server can impose additional permissions, length limits and flood control.

## Direct HTTP with Python requests and curl

Set `FORUM_ORIGIN` to the canonical HTTPS forum origin, `FORUM_COOKIE` to the cookie header of your own current session, and `MEMBER_ID` to its member ID. Keep the cookie and form hash private. The examples print raw protocol responses. For `history`, `dialog` and `recent`, supply `PEER_UID` from your own conversation or a selected member. For `broadcast`, supply `BROADCAST_ID` from the broadcast list. Use `CONFIRM=1` only once the user has reviewed a possible effect, including effects of GETs. Structured snapshots expose account `uid`. For native HTML or AJAX XML, maintain the same cookie session and inspect the return route and form before taking another action.

For `clear`, first run `prompt` and take `FORMHASH` from the same account's fresh response. For `send-dialog`, take `FORMHASH` and `MESSAGE_APPEND` from the selected dialog form, and verify its `touid`, `handlekey`, `pmsubmit` and action. For `send-history`, verify `reply.action`, `reply.topmuid`, `reply.pmid` and the enclosing `formhash` against the named conversation. On the legacy history path, check the corresponding `pmform` action and fields. Supply `REPLY_PMID` from that form and `MESSAGE` as typed. These examples cover only the exact actions and fields shown in the respective POST branches. Use the native form for a different layout or extra required fields.

For `check`, first run `homepage` and inspect `checknewpm` or the native page's script `src`. Check that it resolves to the same origin and exact `/home.php?mod=spacecp&ac=pm&op=checknewpm` route with at most one `rand` parameter. Pass that value as `CHECK_RAND` if present. A response may be JavaScript or empty. Treat it as data. For structured lists and details, observe `pms`, `announces`, schema 11 `messages` or schema 40 `announce`. A supported send can return a native success handler or schema 13 `kind=handle`. Verify the account when the payload includes it and check the expected handler. HTTP success, a redrawn form, redirect or missing callback leaves the send uncertain. Never repeat an uncertain POST automatically. For `clear`, require `ok=1`, the expected `uid`, and `pm=1` with `notice` absent or `0`.

### Python requests

Save the block as `messages.py` and run `MODE=private python3 messages.py` with Python 3 and `requests`. Use a mode named below for each separate action. The Python example checks the UID when a JSON response supplies it and prints the forum body.

```python
import os
import re
import requests

mode = os.environ.get("MODE", "private")
origin = os.environ["FORUM_ORIGIN"].rstrip("/")
member = os.environ["MEMBER_ID"]


def member_id(key):
    value = os.environ[key]
    if not re.fullmatch(r"[1-9][0-9]*", value):
        raise SystemExit(f"Invalid {key}")
    return value


if mode not in {"private", "broadcasts", "prompt", "homepage"} and os.environ.get("CONFIRM") != "1":
    raise SystemExit("Review the effect and deliberately set CONFIRM=1")

json_mode = {"tsdmapp": "json", "nodoc": "1"}
inbox = {"mod": "space", "do": "pm"}
pm = {"mod": "spacecp", "ac": "pm"}
api = {"id": "tsdmapp:api"}
path, fields = "/home.php", None

if mode in {"private", "broadcasts", "prompt", "clear"}:
    path = "/plugin.php"
    query = {**api, "action": {"prompt": "notify", "clear": "seen"}.get(mode, "pmlist")}
    if mode == "broadcasts":
        query["filter"] = "announce"
    if mode == "clear":
        fields = {"formhash": os.environ["FORMHASH"], "pm": "1"}
elif mode in {"private-native", "broadcasts-native"}:
    query = {**inbox, "filter": "privatepm" if mode == "private-native" else "announcepm"}
elif mode == "history":
    query = {**inbox, "subop": "view", "touid": member_id("PEER_UID"), **json_mode}
elif mode == "broadcast":
    query = {**inbox, "subop": "viewg", "pmid": member_id("BROADCAST_ID"), **json_mode, "tsdmv": "4"}
elif mode in {"dialog", "recent"}:
    peer = member_id("PEER_UID")
    query = {**pm, "op": "showmsg", "touid": peer, "pmid": "0", "daterange": "2", "inajax": "1"}
    if mode == "recent":
        query["msgonly"] = "1"
    else:
        query.update(handlekey=f"showmsg_{peer}", infloat="yes", ajaxtarget="fwin_content_showMsgBox")
elif mode in {"send-dialog", "send-history"}:
    peer = member_id("PEER_UID")
    query = {**pm, "op": "send"}
    fields = {"formhash": os.environ["FORMHASH"], "message": os.environ["MESSAGE"]}
    if mode == "send-dialog":
        query.update(touid=peer, inajax="1")
        fields.update(touid=peer, handlekey=f"showmsg_{peer}", pmsubmit="true",
                      messageappend=os.environ.get("MESSAGE_APPEND", ""))
    else:
        query.update(pmid=member_id("REPLY_PMID"), daterange="0", handlekey="pmsend", pmsubmit="yes", topmuid=peer)
elif mode == "homepage":
    path, query = "/forum.php", {"mod": "index", **json_mode}
elif mode == "check":
    query = {**pm, "op": "checknewpm"}
    if "CHECK_RAND" in os.environ:
        query["rand"] = os.environ["CHECK_RAND"]
else:
    raise SystemExit("Unknown mode")

with requests.Session() as session:
    session.headers["Cookie"] = os.environ["FORUM_COOKIE"]
    response = session.request("GET" if fields is None else "POST", origin + path,
                               params=query, data=fields, allow_redirects=False, timeout=15)
    if response.status_code != 200:
        raise SystemExit(f"HTTP {response.status_code}. Check the forum before any retry.")
    if "json" in response.headers.get("Content-Type", ""):
        result = response.json()
        if "uid" in result and str(result["uid"]) != member:
            raise SystemExit("Forum response belongs to a different account")
    print(response.text)
```

### curl

Save the block as `messages.sh` and run `MODE=private sh messages.sh` with curl. The commands use URL-encoded query and form fields and print the HTTP status and body without following redirects. Verify the returned account and operation as described above. Native XML and HTML need a parser if you want structured output.

```sh
set -eu
origin=${FORUM_ORIGIN%/}
mode=${MODE:-private}

get() {
  path=$1
  shift
  curl -q --silent --show-error --include --fail-with-body --max-time 15 --cookie "$FORUM_COOKIE" \
    --get "$origin/$path" "$@"
}
post() {
  path=$1
  shift
  curl -q --silent --show-error --include --fail-with-body --max-time 15 --cookie "$FORUM_COOKIE" \
    "$origin/$path" "$@"
}
case "$mode" in
  private|broadcasts|prompt|homepage) ;;
  *) [ "${CONFIRM:-}" = 1 ] || { echo 'Review the effect and set CONFIRM=1' >&2; exit 1; } ;;
esac
case "$mode" in
  private) get plugin.php -d 'id=tsdmapp:api' -d 'action=pmlist' ;;
  broadcasts) get plugin.php -d 'id=tsdmapp:api' -d 'action=pmlist' -d 'filter=announce' ;;
  prompt) get plugin.php -d 'id=tsdmapp:api' -d 'action=notify' ;;
  clear) post 'plugin.php?id=tsdmapp:api&action=seen' \
    --data-urlencode "formhash=$FORMHASH" -d 'pm=1' ;;
  private-native) get home.php -d 'mod=space&do=pm&filter=privatepm' ;;
  broadcasts-native) get home.php -d 'mod=space&do=pm&filter=announcepm' ;;
  history) get home.php -d 'mod=space&do=pm&subop=view&tsdmapp=json&nodoc=1' --data-urlencode "touid=$PEER_UID" ;;
  broadcast) get home.php -d 'mod=space&do=pm&subop=viewg&tsdmapp=json&nodoc=1&tsdmv=4' --data-urlencode "pmid=$BROADCAST_ID" ;;
  dialog) get home.php -d 'mod=spacecp&ac=pm&op=showmsg&pmid=0&daterange=2&inajax=1&infloat=yes&ajaxtarget=fwin_content_showMsgBox' \
    --data-urlencode "touid=$PEER_UID" --data-urlencode "handlekey=showmsg_$PEER_UID" ;;
  recent) get home.php -d 'mod=spacecp&ac=pm&op=showmsg&msgonly=1&pmid=0&daterange=2&inajax=1' --data-urlencode "touid=$PEER_UID" ;;
  send-dialog)
    case "$PEER_UID" in ''|*[!0-9]*|0*) exit 1 ;; esac
    post "home.php?mod=spacecp&ac=pm&op=send&touid=$PEER_UID&inajax=1" \
      --data-urlencode "touid=$PEER_UID" --data-urlencode "handlekey=showmsg_$PEER_UID" -d 'pmsubmit=true' \
      --data-urlencode "messageappend=${MESSAGE_APPEND:-}" --data-urlencode "formhash=$FORMHASH" --data-urlencode "message=$MESSAGE" ;;
  send-history)
    case "$PEER_UID" in ''|*[!0-9]*|0*) exit 1 ;; esac
    case "$REPLY_PMID" in ''|*[!0-9]*|0*) exit 1 ;; esac
    post "home.php?mod=spacecp&ac=pm&op=send&pmid=$REPLY_PMID&daterange=0&handlekey=pmsend&pmsubmit=yes&topmuid=$PEER_UID" \
      --data-urlencode "formhash=$FORMHASH" --data-urlencode "message=$MESSAGE" ;;
  homepage) get forum.php -d 'mod=index&tsdmapp=json&nodoc=1' ;;
  check)
    if [ "${CHECK_RAND+x}" = x ]; then
      get home.php -d 'mod=spacecp&ac=pm&op=checknewpm' --data-urlencode "rand=$CHECK_RAND"
    else
      get home.php -d 'mod=spacecp&ac=pm&op=checknewpm'
    fi ;;
  *) exit 1 ;;
esac
```
