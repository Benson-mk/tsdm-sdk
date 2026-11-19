# Claim and manage red packets

Install `tsdm-sdk` on Node 26.x. Provide the canonical HTTPS forum origin, a signed-in member, and an account-bound transport. Give `session().continuity` a fresh value after each login. Honor `fresh: true` and report redirects manually. A request with `effect: true` requires single-attempt transport, including the award claim GET. Use the [account session guide](account.md) and the [SDK tasks](../README.md#tasks).

| Journey | Public SDK operation |
| --- | --- |
| Open and inspect | `open(threadId)` reads the raw plugin status. It can show availability, existing share, sender, reply and password conditions, and packet state. `readThreadPacket(threadId)` inspects the thread for the exact offered claim or withdrawal controls. A qualified native packet marker can supply a legacy claim path. |
| Claim a share | Pass the returned thread view to `prepareClaim(view)`. Present the selected packet and requirements. After approval, call `submit(form, password)` when `requiresPassword` is true, and `submit(form)` otherwise. The password enters only the final form body. `claimed` reports the returned share. `already-claimed` reports a prior claim. A separate `open` can observe the member's stored share. |
| View records | `readRecords(threadId)` reads the permitted share list. It preserves the plugin's totals and order, and says whether the returned rows cover the reported claimed count. Legacy records can expose only server-formatted times and no member IDs. The plugin can refuse records before the member has claimed. |
| Withdraw | For the exact sender's offered control, use `prepareWithdrawal(view)` and `submit(form)` after confirming the remaining shares and refund consequence. `withdrawn` includes the refund reported by the plugin. A fresh `open` can observe the withdrawn state. |
| Daily packet | `readDaily()` inspects today's homepage offer and the forum's day marker. `daily-unavailable` means the page carries no offer. Send only after `prepareDaily(view)` and member approval. The result distinguishes a new daily amount from a duplicate, refusal or unknown effect. Homepage inspection does not request `checknewpm` or execute scripts. |
| Award details | `readAwardDetails(threadId)` reads the award details table. The detail row time is the server's displayed time. |
| Award link | `prepareAwardClaim(threadId, href)` qualifies the exact link supplied by the forum post or host. Review it and call `submit(form)` to send one GET. `award-arrived` means the requested page arrived with `effect: "unknown"`. An explicit forum claim message or duplicate is interpreted separately. Revisit details to check the member's record. |

A preparation belongs to the client and login that obtained it. The SDK consumes it at dispatch. A plugin refusal, redrawn form, redirect, and lost response can call for different recovery. A redirect or response loss leaves the effect unknown and does not cause an automatic retry. Review a fresh record or use a returned `packet-handoff` to inspect the native forum. A stored share can establish current ownership without attributing it to a particular uncertain request.

## TypeScript

```ts
import { createPacketClient, type PacketClientOptions, type PacketForm } from "tsdm-sdk";

export async function followAward(
  host: PacketClientOptions,
  threadId: string,
  suppliedLink: string,
  approve: (form: PacketForm) => Promise<boolean>,
) {
  const client = createPacketClient(host);
  const prepared = client.prepareAwardClaim(threadId, suppliedLink);
  if (prepared.kind !== "packet-ready") return prepared;
  if (!(await approve(prepared.form))) return { kind: "cancelled" } as const;
  return client.submit(prepared.form);
}
```

## Direct HTTP

Use an account-bound session for the exact forum origin. Keep credentials and passphrases private, disable retries for effects, and inspect redirects without following them automatically. Before each submission, review the intended account, exact thread, current terms, permission and form hash. Native HTML controls and literal script data can be inspected without executing scripts.

| Operation | Request and observation |
| --- | --- |
| Packet opening | GET `plugin.php?id=hongbao:open&tid=…`. Inspect `state`, `mine`, `haspw`, `cond` and `appoint`. The routing opens the dialog without taking a share. |
| Thread controls and records | GET `forum.php?mod=viewthread&tid=…&tsdmapp=json&nodoc=1` for the `special.type=hongbao` block. Check `uid`, the thread ID, offered action, hidden `tid`, and top-level `formhash`. For the records, GET `plugin.php?id=hongbao:record&tid=…&tsdmapp=json&nodoc=1`. Read schema 19 `records` or native JSON `recs`, and handle permissions and incomplete rows. |
| Grab or withdraw | POST the matching `plugin.php?id=hongbao:grab` or `hongbao:withdraw` with `tid` and `formhash`. Add the offered `password` when needed. Request `tsdmapp=json` for the structured form, then inspect schema 13 `handlekey` and `values`. For a validated legacy native grab, use the raw endpoint with `password` set to the entered phrase or empty, and inspect its JSON directly. An unrelated or malformed response leaves the effect uncertain. |
| Daily | GET `forum.php?tsdmapp=json&nodoc=1` and inspect `red_packet`, `dateflag` and `formhash`. The native page may carry a literal `hongbaoDailyInit` config and a same-session form token. POST raw `plugin.php?id=hongbao:daily` with `formhash` after approval. Inspect the explicit `ok`, `already`, amount and unit. Do not infer prior claim from a missing offer. |
| Award | GET `plugin.php?id=tsdmbet:awardPacket&action=showaward&tid=…` for statistics. A supplied claim link for the same origin, plugin and thread is an effectful GET. Preserve its actual query and send it only after approval. Inspect an explicit plugin claim or duplicate message, or the separate detail record. HTTP 200 alone establishes arrival. |

### Python `requests`

```python
from urllib.parse import parse_qsl, urljoin, urlsplit

LEAN = {"tsdmapp": "json", "nodoc": "1"}


def packet_read(session, origin, operation, thread_id=None):
    if operation == "daily":
        path, route = "/forum.php", LEAN
    else:
        if not isinstance(thread_id, str) or not thread_id.isascii() or not thread_id.isdecimal() or thread_id.startswith("0"):
            raise ValueError("Expected a positive thread ID")
        if operation == "thread":
            path, route = "/forum.php", {"mod": "viewthread", "tid": thread_id, **LEAN}
        elif operation in {"open", "record"}:
            path, route = "/plugin.php", {"id": "hongbao:" + operation, "tid": thread_id}
            if operation == "record":
                route.update(LEAN)
        elif operation == "award-details":
            path, route = "/plugin.php", {"id": "tsdmbet:awardPacket", "action": "showaward", "tid": thread_id}
        else:
            raise ValueError("Unknown read")
    return session.get(origin + path, params=route, allow_redirects=False, timeout=20)


def packet_submit(session, origin, operation, mode, fields, *, approved):
    if approved is not True:
        return None
    if (operation, mode) not in {("grab", "structured"), ("grab", "legacy"),
                                 ("withdraw", "structured"), ("daily", "legacy")}:
        raise ValueError("Unknown packet form")
    query = {"id": "hongbao:" + operation}
    if mode == "structured":
        query["tsdmapp"] = "json"
    return session.post(origin + "/plugin.php", params=query, data=fields,
                        allow_redirects=False, timeout=20)


def packet_award(session, origin, thread_id, supplied, *, approved):
    if approved is not True:
        return None
    destination = urljoin(origin + "/", supplied)
    url, base = urlsplit(destination), urlsplit(origin)
    pairs = parse_qsl(url.query, keep_blank_values=True)
    query = dict(pairs)
    if (url.scheme, url.netloc) != (base.scheme, base.netloc) or url.path != "/plugin.php" or url.fragment:
        raise ValueError("Unqualified award origin or path")
    if len(pairs) != len(query) or query.get("id") != "tsdmbet:awardPacket" or query.get("tid") != thread_id or query.get("action", "").lower() == "showaward":
        raise ValueError("Unqualified award query")
    return session.get(destination, allow_redirects=False, timeout=20)
```

### curl

Set `FORUM_ORIGIN` and provide `FORUM_COOKIE` privately. `packet_read open ID` opens the status. `packet_submit yes grab structured` reads the reviewed URL-encoded body from standard input. `packet_award yes ID URL` requires the absolute, checked claim destination with its plugin ID first in the query. Review and qualify the query as in the Python example. These helpers print the body and HTTP status. They leave redirects for the host to inspect.

```sh
packet_read() {
  op=$1; tid=${2-}
  if [ "$op" != daily ]; then
    case "$tid" in ''|0*|*[!0-9]*) return 2 ;; esac
  fi
  case "$op" in
    open) route="plugin.php?id=hongbao:open&tid=$tid" ;;
    thread) route="forum.php?mod=viewthread&tid=$tid&tsdmapp=json&nodoc=1" ;;
    record) route="plugin.php?id=hongbao:record&tid=$tid&tsdmapp=json&nodoc=1" ;;
    daily) route='forum.php?tsdmapp=json&nodoc=1' ;;
    award-details) route="plugin.php?id=tsdmbet:awardPacket&action=showaward&tid=$tid" ;;
    *) return 2 ;;
  esac
  curl -q -sS --max-time 20 --cookie "$FORUM_COOKIE" --write-out '\n%{http_code}\n' "$FORUM_ORIGIN/$route"
}

packet_submit() {
  [ "$1" = yes ] || return 0
  case "$2:$3" in
    grab:structured|withdraw:structured) query="id=hongbao:$2&tsdmapp=json" ;;
    grab:legacy|daily:legacy) query="id=hongbao:$2" ;;
    *) return 2 ;;
  esac
  curl -q -sS --max-time 20 --cookie "$FORUM_COOKIE" --data-binary @- \
    --header 'Content-Type: application/x-www-form-urlencoded' \
    --write-out '\n%{http_code}\n' "$FORUM_ORIGIN/plugin.php?$query"
}

packet_award() {
  [ "$1" = yes ] || return 0
  case "$2" in ''|0*|*[!0-9]*) return 2 ;; esac
  case "$3" in
    "$FORUM_ORIGIN/plugin.php?id=tsdmbet:awardPacket&"*|"$FORUM_ORIGIN/plugin.php?id=tsdmbet%3AawardPacket&"*) ;;
    *) return 2 ;;
  esac
  case "$3&" in *'#'*|*'&action=showaward&'*) return 2 ;; esac
  case "$3&" in *"&tid=$2&"*) ;; *) return 2 ;; esac
  curl -q -sS --globoff --max-time 20 --cookie "$FORUM_COOKIE" --write-out '\n%{http_code}\n' "$3"
}
```
