# Acquire, display and grant medals, titles and backgrounds

Install `tsdm-sdk` on Node 26.x and bind the transport to the intended signed-in member and canonical HTTPS forum origin. See [account sessions](account.md) and [SDK tasks](../README.md#tasks). Set `session().continuity` to a fresh value after every login. Honor `fresh: true`, report redirects manually and send each approved effect once. POST bodies are `application/x-www-form-urlencoded`. The legacy medal acquisition GET can change ownership or spend credits, so the SDK sends it only through `submit`.

Use `read(catalogue, query)` for one page. The view contains frozen `records` and `metadata` with the forum's returned field names, plus the member ID. Structured responses can supply paging, price and eligibility information. Native medal records carry available titles, methods, status and terms. Handle `awards-handoff` by presenting its same-origin page to the member. Check `kind` before reading records or using a form.

| Journey | SDK operation and what to review |
| --- | --- |
| Browse and acquire medals | `read("medals", { typeid: 3, q: "Event", page: 1 })` shows categories, availability, ownership, pending status and offered methods. Use `prepare(view, { kind: "acquire-medal", id, method })` for method `1` application, `5` purchase, or `6` claim. Method `2` accepts `reason` for manual review when the app API offers a claim form. `openMedalApplication(view, id, reason)` reads the native confirmation form when needed. Present the conditions and price before approval. `pending-review` means the forum reports a queued application. |
| Own and hide medals | `read("mymedals", { page: 1 })` includes owned medals, hidden flags and activity history. Prepare `hide-medals` with `changes: [{ id, hidden }]`. Show any warning returned by the forum and reread the owned list to observe display state. |
| Grant or revoke medals | `read("medalgrant")` provides grantable medals, limits and revocable records. `lookupMedalMembers(view, recipients, medals)` returns ownership and missing UIDs. `lookupMedalThread(view, { tid, from, to, noOwner })` returns candidate recipients by floor range. Review both before preparing `grant-medals` with `recipients`, `medals` and `reason`. Prepare `revoke-medal` with the offered record ID or `revoke-medal-batch` with the offered batch ID. Reread grant records to resolve applied or partial changes. |
| Achievements and display titles | `read("achievements")` keeps the forum's list and activation state. `read("titles", { page: 1 })` lists owned, worn and expired titles. Prepare `wear-title` with the owned title ID or `remove-title` for the default title. `observed` means an independent read established the selected display state. One readback page can leave removal unverified. |
| Buy or exchange titles | `read("titleshop")` shows price, balance and buy eligibility. `read("titleexchange", { filter: "ready", q: "Event" })` shows required medals and whether the exchange consumes them. Prepare `buy-title` or `exchange-title` with the displayed ID. Reread titles or the shop to observe ownership after a result. |
| Issue or revoke titles | `read("titleissue")` exposes permission, titles, limits and logs. Prepare `issue-title` or `revoke-title` with `titles`, `recipients` (UIDs or exact usernames as strings), `days` and `note`. Use `0` days for a permanent issue. Review recipients and duration before submitting and check the returned logs afterward. |
| Grant a background | `read("bggrant", { keyword: "夜空", page: 1 })` exposes the catalogue, permission, expiry presets and limits. Prepare `grant-background` with an offered `id` or a full HTTPS `image`, UID `recipients`, `expiry` and `notify`. Use `"0"` for permanent, a supported date, duration such as `"7天"`, or UNIX time. A positive returned count can be smaller than the requested count. `partial` keeps the count, choices and forum message for review. |

`prepare` creates a private approval for the current client and session without sending an effect. Show its terms and choice and call `submit(form)` after consent. `acknowledged` means the forum returned a positive message. A refusal, redrawn form or lost response is a separate result. `unknown` means the effect remains uncertain. Inspect a fresh view or use the native forum to reconcile before considering another attempt. A dispatched approval cannot be replayed.

## TypeScript

```ts
import { createAwardsClient, type AwardsClientOptions, type AwardsForm } from "tsdm-sdk";

export async function buyTitle(
  host: AwardsClientOptions,
  id: number,
  approve: (form: AwardsForm) => Promise<boolean>,
) {
  const client = createAwardsClient(host);
  const view = await client.read("titleshop");
  if (view.kind !== "awards-view") return view;
  const prepared = client.prepare(view, { kind: "buy-title", id });
  if (prepared.kind !== "awards-ready") return prepared;
  if (!(await approve(prepared.form))) return { kind: "cancelled" } as const;
  return client.submit(prepared.form);
}
```

## Direct HTTP

Use a session with the intended member's credentials and the exact HTTPS origin. Never follow a redirect automatically or enable write retries. Save and inspect each response before further action. Change operations require their own approval, including any legacy acquisition GET. Verify current viewer, exact target, action, form hash, submit markers and returned permission. Preserve any required hidden fields. Apply these rules before passing the reviewed form fields to the helpers.

| Read or open | Request |
| --- | --- |
| Medal and title app catalogues | GET `plugin.php?id=tsdmapp:api&action=medals/mymedals/medalgrant/titles/titleshop/titleexchange/titleissue`. Each slash-separated action is separate. `medals` accepts `typeid`, `q` and `page`. `titleexchange` accepts `filter`, `q` and `page`. `titles` accepts `pp=200` and `page`. Check scope, returned UID, records and permission flags. |
| Achievements and backgrounds | GET `plugin.php?id=tsdmtitle:achi&tsdmapp=json&tsdmv=4&nodoc=1` for schema 68. GET `plugin.php?id=tsdmapp:api&action=bggrant` with optional `kw` and `page` for schema 31. Use returned `url_field`, `uids_field`, `time_field` and `notify_field` names. |
| Grant lookups | GET the `lookup_url` for `dsu_medalCenter:memcp&action=grantlookup` with `uids` and `mids` as comma-separated IDs. GET the `thread_url` for `grantthread` with `tid`, `from`, `to`, `noowner`; use zero for an unbounded floor and `1` to omit the thread author. Check returned recipients and missing IDs. |
| Native medal application | GET the offered `dsu_medalCenter:memcp&action=apply&medalid=…` without `applytype`, or `dsu_medalCenter:specmedal&action=newapply&applymedalid=…`. Inspect the returned form, matching its ID to the requested medal. A native application without a valid form can show an unmet condition. A legacy `apply` link with `applytype` is already an effect. Open it only after dedicated consent and inspect the resulting message. |

| Confirmed form | POST route and fields added to the reviewed form |
| --- | --- |
| `claim` | `dsu_medalCenter:memcp`, `action=claim`. Add `medalid`, `method`, `credit` as offered and `reason` for manual review. A native claim form may supply these directly. The legacy `newapply` form uses its exact returned action and `applyreason`. |
| `sethide` | `dsu_medalCenter:memcp`, `action=sethide`. Use `myMedalHide[ID]=1` to hide and `=2` to show. |
| `grantgrid`, `grantrevoke`, `grantrevokebatch` | `dsu_medalCenter:memcp`, matching `action`. Grant uses `grant_users`, `grant_medalids` and `grant_reason`. Revoke uses `logid` or `batch`. |
| `settitle`, `buy`, `exchange`, `issue` | `tsdmtitle:tsdmtitle`, matching `action`. Set `settitleid` or `0` to remove. Buy uses `buyid`, exchange uses `exchangeid`. Issue uses `issueop=grant/revoke`, comma-separated `issuetitles`, newline-separated `issueusers`, `issuedays` and `issuenote`. Keep the plugin's same-origin return path. |
| `background` | `background:memcp`, `ac=slotadd`. Send the selected file or HTTPS URL, comma-separated UIDs, and expiry. Send the notification field with value `1` if approved and omit it otherwise. |

Inspect schema 13 `kind`, member identity, message and alert, or the native message/form. `ok: 1` can carry a redraw. A successful manual review submission can be pending and a positive background count can be partial. Independently read visible title state, ownership or records when available. An HTTP success or redirect alone leaves the effect unresolved.

### Python `requests`

```python
MEDAL = "dsu_medalCenter:memcp"
TITLE = "tsdmtitle:tsdmtitle"
CATALOGUES = {"medals", "mymedals", "medalgrant", "titles", "titleshop",
              "titleexchange", "titleissue", "bggrant"}


def read_awards(session, origin, view, query):
    if set(query) & {"id", "action", "tsdmapp", "tsdmv", "nodoc"}:
        raise ValueError("Reserved route parameter")
    if view == "achievements":
        route = {"id": "tsdmtitle:achi", "tsdmapp": "json", "tsdmv": "4", "nodoc": "1"}
    elif view in CATALOGUES:
        route = {"id": "tsdmapp:api", "action": view}
    else:
        raise ValueError("Unknown catalogue")
    return session.get(origin + "/plugin.php", params={**route, **query},
                       allow_redirects=False, timeout=20)


def send_award(session, origin, action, fields, *, approved):
    if approved is not True:
        return None
    if action in {"claim", "sethide", "grantgrid", "grantrevoke", "grantrevokebatch"}:
        route = {"id": MEDAL, "action": action}
    elif action in {"settitle", "buy", "exchange", "issue"}:
        route = {"id": TITLE, "action": action}
    elif action == "background":
        route = {"id": "background:memcp", "ac": "slotadd"}
    else:
        raise ValueError("Unknown submission")
    return session.post(origin + "/plugin.php", params={**route, "tsdmapp": "json"},
                        data=fields, allow_redirects=False, timeout=20)


def legacy_medal(session, origin, medal_id, method, *, approved):
    if approved is not True:
        return None
    if type(medal_id) is not int or medal_id < 1 or type(method) is not int or method not in (1, 5, 6):
        raise ValueError("Unknown legacy acquisition")
    route = {"id": MEDAL, "action": "apply", "medalid": medal_id, "applytype": method}
    return session.get(origin + "/plugin.php", params=route,
                       allow_redirects=False, timeout=20)
```

### curl

Set `FORUM_ORIGIN` and provide the intended member's `FORUM_COOKIE` privately. Source the functions, then run `awards_read medals` or `awards_read titleexchange --data-urlencode 'filter=ready'`. Forward only query data arguments in `awards_read`. Review the response and pass an already URL-encoded approved body to `awards_send yes ACTION` on standard input. The helpers print the response and HTTP status. Use `awards_legacy_medal yes ID METHOD` only for a reviewed legacy acquisition link. The table gives the native application and lookup routes.

```sh
awards_read() {
  view=$1; shift
  case "$view" in
    achievements) route='id=tsdmtitle:achi&tsdmapp=json&tsdmv=4&nodoc=1' ;;
    medals|mymedals|medalgrant|titles|titleshop|titleexchange|titleissue|bggrant)
      route="id=tsdmapp:api&action=$view" ;;
    *) return 2 ;;
  esac
  awards_read_query "$@" || return 2
  curl -q -sS --max-time 20 --get --cookie "$FORUM_COOKIE" \
    --write-out '\n%{http_code}\n' "$FORUM_ORIGIN/plugin.php?$route" "$@"
}

awards_read_query() {
  while [ "$#" -gt 0 ]; do
    [ "$#" -ge 2 ] && [ "$1" = --data-urlencode ] || return 2
    case "$2" in
      page=*|typeid=*|q=*|filter=*|sort=*|pp=*|kw=*) ;;
      *) return 2 ;;
    esac
    shift 2
  done
}

awards_send() {
  [ "$1" = yes ] || return 0
  action=$2
  case "$action" in
    claim|sethide|grantgrid|grantrevoke|grantrevokebatch) route="id=dsu_medalCenter:memcp&action=$action" ;;
    settitle|buy|exchange|issue) route="id=tsdmtitle:tsdmtitle&action=$action" ;;
    background) route='id=background:memcp&ac=slotadd' ;;
    *) return 2 ;;
  esac
  curl -q -sS --max-time 20 --cookie "$FORUM_COOKIE" --data-binary @- \
    --header 'Content-Type: application/x-www-form-urlencoded' \
    --write-out '\n%{http_code}\n' "$FORUM_ORIGIN/plugin.php?$route&tsdmapp=json"
}

awards_legacy_medal() {
  [ "$1" = yes ] || return 0
  case "$2" in ''|0*|*[!0-9]*) return 2 ;; esac
  case "$3" in 1|5|6) ;; *) return 2 ;; esac
  curl -q -sS --max-time 20 --cookie "$FORUM_COOKIE" \
    --write-out '\n%{http_code}\n' \
    "$FORUM_ORIGIN/plugin.php?id=dsu_medalCenter:memcp&action=apply&medalid=$2&applytype=$3"
}
```
