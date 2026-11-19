# Complete forum tasks and use magic items

Use an authenticated member session on the canonical HTTPS forum origin. The host supplies the current member ID and a continuity value that changes when the session is replaced. Honor `fresh` on every request. An `effect: true` request can change forum state even when its method is GET. Send it once with no retries, caching, prefetching or redirect following. Where possible return the raw redirect `Location` with the original response URL and `redirect: "none"`. Use the same authenticated session and `X-Requested-With: XMLHttpRequest` for AJAX windows and legacy AJAX effects. Encode POST bodies as `application/x-www-form-urlencoded`.

## TypeScript

```ts
import {
  createTaskMagicClient,
  type TaskMagicClientOptions,
  type MagicField,
  type MagicPurchaseTerms,
} from "tsdm-sdk";

export async function applyExample(
  host: TaskMagicClientOptions,
  taskId: string,
  approve: (effect: string) => Promise<boolean>,
) {
  const client = createTaskMagicClient(host);
  const available = await client.readTasks("new");
  if (available.kind !== "task-list") return available;
  const task = available.tasks.find(task => task.id === taskId);
  if (!task) return { kind: "task-not-listed" };
  const prepared = client.prepareTaskAction(task, "apply");
  if (prepared.kind !== "task-action") return prepared;
  return client.confirmTaskAction(prepared.action, await approve(task.name));
}

export async function magicExample(
  host: TaskMagicClientOptions,
  operation: "buy" | "use",
  identifier: string,
  choose: (fields: readonly MagicField[], terms: MagicPurchaseTerms | null) => Promise<Record<string, string> | null>,
) {
  const client = createTaskMagicClient(host);
  const shop = operation === "buy" ? await client.readMagicShop() : await client.readMagicInventory();
  const selected = shop.kind === "magic-shop"
    ? shop.items.find(item => item.identifier === identifier && item.available)
    : null;
  const owned = shop.kind === "magic-inventory"
    ? shop.items.find(item => item.identifier === identifier && item.available)
    : null;
  const prepared = selected ? await client.prepareMagicPurchase(selected)
    : owned ? await client.prepareMagicUse(owned) : null;
  if (!prepared) return shop;
  if (prepared.kind !== "magic-form") return prepared;
  const values = await choose(prepared.form.fields, prepared.form.purchase);
  return client.confirmMagic(prepared.form, values ?? {}, values !== null);
}
```

`readTasks` accepts `new`, `doing` and `done`. `readTask(id)` provides detail and offered actions. `readTaskParticipants(id)` provides the participant list or a read-only browser destination. Apply can enroll the member and leave `claimAvailable: true` if the forum sends an immediate claim redirect. Refresh the task detail or active list and approve `claim` separately. Claim may award a reward, return progress, or report a failed task. Approve `abandon` separately from task detail to give up the task. Inspect `rewarded`, `in-progress`, `abandoned` or `refused` before choosing the next action.

`readMagicShop(page)` and `readMagicInventory(page)` expose item availability, price or quantity, and capacity where available. Purchase may spend credits and use inventory capacity. Use can consume an item and affect the target account or thread. The prepared window gives the exact controls and known terms. Render the field descriptors yourself. Unknown scripted controls return a browser handoff. Open that URL in the same authenticated browser to review the form. `readMagicLog(direction, page)` reads `usage`, `purchase`, `gift` or `receipt`, with epoch seconds and the forum time offset when returned. A successful purchase or use can be checked against the inventory and the corresponding log. The gift and receipt logs are reads.

Each task or magic read checks the exact operation in plugin `status` from the current session. Task lists, the shop and the inventory can use their legacy pages. Detail, participants and magic logs give a browser destination when their structured page is unavailable. The buy and use windows check `forms` independently of the page that listed the item.

Keep the original SDK handles in memory for the session. A declined action sends no effect. After dispatch, the handle is consumed. `uncertain` means the forum may already have acted. Refresh the task, inventory or log before another deliberate attempt.

## Direct Python requests

Use an authenticated `requests.Session` configured for one attempt. Before invoking an effect, check that the forum offered the exact action for the selected task or magic and present the conditions, target and cost to the member. For `magic_write`, pass the ordered pairs from the current POST form and update only the visible controls the member approved. Keep the server's `formhash` and hidden fields private. Pass `legacy=True` for writes prepared from a native page or form. The structured write mode applies to an operation offered and qualified in v4.

```python
from urllib.parse import parse_qsl, urljoin, urlsplit, urlunsplit, urlencode

WRITE = {"tsdmapp": "json", "tsdmv": "4"}
PAGE = {**WRITE, "nodoc": "1"}
XHR = {"X-Requested-With": "XMLHttpRequest"}


def advertised(session, origin, group, name):
    result = session.get(origin + "/plugin.php", params={"id": "tsdmapp:api", "action": "status"},
                         allow_redirects=False, timeout=20)
    if result.status_code == 429:
        result.raise_for_status()
    if result.status_code != 200:
        return False
    try:
        data = result.json()
    except ValueError:
        return False
    if not isinstance(data, dict) or data.get("ok") != 1 or data.get("v4") != 1:
        return False
    names = data.get(group)
    return isinstance(names, list) and name in names


def read(session, origin, operation, *, target=None, page=1):
    task_tabs = {"new", "doing", "done"}
    logs = {"usage": "uselog", "purchase": "buylog", "gift": "givelog", "receipt": "receivelog"}
    if operation in task_tabs:
        params = {"mod": "task", "item": operation}
    elif operation in {"detail", "participants"}:
        params = {"mod": "task", "do": "view" if operation == "detail" else "parter", "id": target}
    elif operation in {"shop", "mybox"}:
        params = {"mod": "magic", "action": operation}
    elif operation in logs:
        params = {"mod": "magic", "action": "log", "operation": logs[operation]}
    else:
        raise ValueError("Unknown read")
    if page > 1 and params["mod"] == "magic":
        params["page"] = page
    if params["mod"] == "task":
        group = "task_pages"
        name = {"detail": "task", "participants": "task_parter"}.get(operation, "task_list")
    else:
        group = "magic_pages"
        name = "magic_" + params["action"]
    v4 = advertised(session, origin, group, name)
    if not v4 and name in {"task", "task_parter", "magic_log"}:
        return None  # Open the native destination in the browser.
    flags = PAGE if v4 else {"tsdmapp": "json"}
    return session.get(origin + "/home.php", params=params | flags, allow_redirects=False, timeout=20)


def task_write(session, origin, operation, task_id, *, approved=False, legacy=False):
    if approved is not True:
        return None
    action = {"apply": "apply", "claim": "draw", "abandon": "delete"}[operation]
    if not str(task_id).isascii() or not str(task_id).isdigit() or int(task_id) <= 0:
        raise ValueError("Invalid task ID")
    if legacy and operation == "abandon":
        raise ValueError("Abandon requires a v4 task detail offer")
    flags = {"inajax": "1", "tsdmapp": "json"} if legacy else WRITE
    query = {"mod": "task", "do": action, "id": task_id} | flags
    return session.get(origin + "/home.php", params=query, headers=XHR if legacy else {},
                       allow_redirects=False, timeout=20)


def magic_window(session, origin, operation, target):
    tab, key = {"buy": ("shop", "mid"), "use": ("mybox", "magicid")}[operation]
    v4 = advertised(session, origin, "forms", "magic" + operation)
    flags = WRITE | {"tsdmform": "1", "nodoc": "1"} if v4 else {"tsdmapp": "json"}
    params = {"mod": "magic", "action": tab, "operation": operation, key: target,
              "infloat": "yes", "handlekey": "magics", "inajax": "1"} | flags
    return session.get(origin + "/home.php", params=params, headers=XHR, allow_redirects=False, timeout=20)


def magic_write(session, origin, operation, target, action, fields, *, approved=False, legacy=False):
    if approved is not True:
        return None
    tab, key, submit = {"buy": ("shop", "mid", "operatesubmit"), "use": ("mybox", "magicid", "usesubmit")}[operation]
    base = urlsplit(origin)
    url = urlsplit(urljoin(origin + "/", action))
    if (url.scheme, url.netloc, url.path) != (base.scheme, base.netloc, "/home.php") or url.fragment:
        raise ValueError("Unexpected magic form origin or path")
    pairs = parse_qsl(url.query, keep_blank_values=True)
    query = dict(pairs)
    if (len(query) != len(pairs) or query.get("mod") != "magic" or query.get("action") != tab
            or set(query) - {"mod", "action", "infloat", "inajax"} or query.get("infloat", "yes") != "yes"
            or query.get("inajax", "1") != "1"):
        raise ValueError("Unexpected magic form action")
    body = list(fields)
    controls = dict(body)
    if (len(controls) != len(body) or controls.get(key) != str(target) or controls.get("operation") != operation
            or controls.get("handlekey") != "magics" or not controls.get("formhash") or controls.get(submit) != "yes"):
        raise ValueError("Unexpected magic form controls")
    query |= {"tsdmapp": "json"} if legacy else WRITE
    return session.post(urlunsplit(url._replace(query=urlencode(query))), data=body, headers=XHR,
                        allow_redirects=False, timeout=20)
```

## Direct curl

Set `FORUM_ORIGIN` and `FORUM_COOKIE_JAR` to the authenticated forum and protected Netscape cookie file. Set `TID` to the reviewed forum task ID, `MID` to the reviewed shop identifier, and `MAGIC_ID` to the reviewed inventory item. The commands below read pages and forms. They use `jq` to check the exact operation in `status` before sending the v4 flags.

```sh
home="$FORUM_ORIGIN/home.php"
status=$(curl -fsS --max-time 20 --cookie "$FORUM_COOKIE_JAR" --get "$FORUM_ORIGIN/plugin.php" \
  --data-urlencode 'id=tsdmapp:api' --data-urlencode action=status) || exit 1
supports() {
  printf '%s' "$status" | jq -e --arg group "$1" --arg name "$2" \
    '.ok == 1 and .v4 == 1 and (.[$group] // [] | index($name) != null)' >/dev/null
}
read_page() {
  group=$1 name=$2; shift 2
  if supports "$group" "$name"; then
    set -- --data-urlencode tsdmv=4 --data-urlencode nodoc=1 "$@"
  else
    case "$name" in task|task_parter|magic_log) return 0 ;; esac
  fi
  curl -sS --max-time 20 --cookie "$FORUM_COOKIE_JAR" --get "$home" \
    --data-urlencode tsdmapp=json "$@"
}
for tab in new doing done; do read_page task_pages task_list --data-urlencode mod=task --data-urlencode "item=$tab"; done
read_page task_pages task --data-urlencode mod=task --data-urlencode do=view --data-urlencode "id=$TID"
read_page task_pages task_parter --data-urlencode mod=task --data-urlencode do=parter --data-urlencode "id=$TID"
for tab in shop mybox; do read_page magic_pages "magic_$tab" --data-urlencode mod=magic --data-urlencode "action=$tab"; done
for op in uselog buylog givelog receivelog; do
  read_page magic_pages magic_log --data-urlencode mod=magic --data-urlencode action=log --data-urlencode "operation=$op"
done
window() {
  name=$1; shift
  if supports forms "$name"; then set -- --data-urlencode tsdmform=1 "$@"; fi
  read_page forms "$name" --header 'X-Requested-With: XMLHttpRequest' --data-urlencode mod=magic \
    --data-urlencode infloat=yes --data-urlencode handlekey=magics --data-urlencode inajax=1 "$@"
}
window magicbuy --data-urlencode action=shop --data-urlencode operation=buy --data-urlencode "mid=$MID"
window magicuse --data-urlencode action=mybox --data-urlencode operation=use --data-urlencode "magicid=$MAGIC_ID"
```

Choose `OPERATION` as `apply`, `claim` or `abandon` after reading the offered action. Set `APPROVED_EFFECT` only for the exact action the member approved. This block sends one effectful GET. Inspect `task_applied`, `task_completed` or `task_reward_*`, or `task_deleted` for the corresponding outcome. An apply redirect to the same task's `draw` route leaves claiming outstanding. The command preserves that redirect for inspection.

```sh
case "${OPERATION-}" in apply) action=apply ;; claim) action=draw ;; abandon) action=delete ;; *) exit 2 ;; esac
[ "$OPERATION" = "${APPROVED_EFFECT-}" ] || exit 0
case "$TID" in ''|*[!0-9]*|0*) exit 2 ;; esac
curl -sS --include --max-time 20 --cookie "$FORUM_COOKIE_JAR" --get "$FORUM_ORIGIN/home.php" \
  --data-urlencode mod=task --data-urlencode "do=$action" --data-urlencode "id=$TID" \
  --data-urlencode tsdmapp=json --data-urlencode tsdmv=4
```

For purchase or use set `OPERATION` and `APPROVED_EFFECT` to the chosen `buy` or `use` separately. Set `OFFERED_POST_URL` to the reviewed same-origin form action with `tsdmapp=json&tsdmv=4` appended. Pipe the reviewed URL-encoded body on standard input. For native forms use the served hidden submit flag of `yes`, and omit `tsdmv=4` on the legacy POST. Keep bodies private. `magics_buy_succeed` verifies a structured purchase. A qualified `magics` use acknowledgement identifies use. Generic pages or a lost response require a fresh read before any later effect.

```sh
case "${OPERATION-}" in buy|use) ;; *) exit 2 ;; esac
[ "$OPERATION" = "${APPROVED_EFFECT-}" ] || exit 0
case "$OFFERED_POST_URL" in "$FORUM_ORIGIN"/home.php\?*) ;; *) exit 2 ;; esac
curl -sS --include --max-time 20 --cookie "$FORUM_COOKIE_JAR" \
  --header 'X-Requested-With: XMLHttpRequest' --header 'Content-Type: application/x-www-form-urlencoded' \
  --data-binary @- "$OFFERED_POST_URL"
```
