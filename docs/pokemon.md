# Open a Pokémon session and manage a roster

Install `tsdm-sdk` on Node 26.x. Pass the canonical HTTPS forum origin and the host's signed-in `session()` with `memberId` and `continuity`. Change continuity on every new login, including another login as the same member. The host sends that exact login's cookies with each request, honors `fresh: true`, reports redirects manually and gives `effect: true` requests single-attempt transport. See [account sessions](account.md) and the [SDK tasks](../README.md#tasks).

Call `bootstrap()` before using the client. It tries `tsdmapp:api&action=status`, then `pokemon:game` when the status API does not supply a compatible token. `bootstrapFromStatus()` and `bootstrapFromGamePage()` select a single path. A game page can supply the hash in a hidden input or literal script assignment. The SDK keeps the `X-Pm-Formhash` value private and binds it to the current login. A mismatched identity, explicit login refusal or rate limit stops bootstrap.

Each row below is a separate operation. Every game request uses `plugin.php?id=pokemon:pokemon&endpoint=GROUP&action=ACTION`. Extra GET and query-only POST parameters go in the URL. Every POST sends a JSON object, including `{}` when the action uses the URL for all its arguments. Recheck the intended account and target before invoking a write. Obtain explicit approval for irreversible or resource-consuming effects such as release and item use.

| Method | Group / action | SDK operation | Query or JSON body | Observable result |
| --- | --- | --- | --- | --- |
| GET | `config/global_config` | `getGlobalConfig()` | — | Open flag, version and returned settings |
| GET | `evolution/evolution_path` | `getEvolutionPath(speciesId)` | Query `pmid` | Exact species and steps in either direction |
| GET | `pokemon/list` | `getMyPokemon()` | — | Roster with owned instance IDs |
| GET | `pokemon/detail` | `getPokemonDetail(id)` | Query `pokemon_id` | Exact owned instance and available statistics |
| GET | `pokemon/learnable_skills` | `getLearnableSkills(id)` | Query `pokemon_id` | Available and unlocked skills for the selected instance |
| GET | `pokemon/equipment` | `getEquipment(id)` | Query `pokemon_id` | Slots, owned equipment and items offered for sale |
| GET | `user/profile` | `getProfile()` | — | Bound member and returned profile fields |
| GET | `user/inventory` | `getInventory({ page, type })` | Query `page`, optional `type` | Returned page and item rows, including any server clamping |
| GET | `user/badge_status` | `badgeStatus()` | — | Returned `hidden` flag, when supported |
| POST | `pokemon/set_first` | `setFirst(id)` | Query `pokemon_id`, body `{}` | Plugin acknowledgement of a first-pet change |
| POST | `pokemon/move_pokemon` | `movePokemon(id, site)` | Query `pokemon_id`, `site`, body `{}` | Acknowledged movement to first, bag or storage (`1`, `2`, `3`) |
| POST | `pokemon/rename` | `rename(id, name)` | JSON `id`, `name` | Acknowledgement of the new name |
| POST | `pokemon/release` | `release(id)` | JSON `id` | Acknowledgement of release from the roster |
| POST | `pokemon/learn_skill` | `learnSkill(id, skillId, { slotIndex })` | JSON `pokemon_id`, `skill_id`, optional `slot_index` | Acknowledgement of learning the skill |
| POST | `pokemon/forget_skill` | `forgetSkill(id, skillId)` | JSON `pokemon_id`, `skill_id` | Acknowledgement of forgetting the skill |
| POST | `pokemon/equip_item` | `equipItem(id, ownedItemId, { slotIndex })` | JSON `pokemon_id`, `myitem_id`, optional `slot_index` | Acknowledgement of changing equipment |
| POST | `pokemon/unequip_item` | `unequipItem(id, slotIndex)` | JSON `pokemon_id`, `slot_index` | Acknowledgement of clearing the slot |
| POST | `user/heal` | `heal(id)` | Query `pokemon_id`, body `{}` | Reported HP and cost |
| POST | `user/heal_and_flee` | `healAndFlee(id)` | Query `pokemon_id`, body `{}` | Reported HP and cost after leaving an active battle |
| POST | `user/refresh_badge` | `refreshBadge({ hide })` | JSON optional `hide` | Returned badge and pet-display information. An omitted flag refreshes the badge without choosing hide or show. |
| POST | `user/use_item` | `useItem(itemId, { pokemonId })` | JSON `item_id`, optional `pokemon_id` | Acknowledged use of an inventory item outside the battle endpoint |

The client keeps the plugin's field names in returned data. It also supplies `pokemonId` on evolution, skills and equipment results. An omitted legacy badge flag remains unknown. `success` means the plugin acknowledged the specific request and any required reply data could be read. Reread the relevant roster, item list or badge to observe the resulting state. The SDK refreshes and reissues once only after the exact pre-execution form-hash rejection and a different hash from the same login. Other explicit plugin rejections return `refused`. A lost, redirected or malformed effect response returns `uncertain`, even when the account changes in flight. Reconcile the original account before considering another effect.

## TypeScript

```ts
import { createPokemonClient, type PokemonClientOptions } from "tsdm-sdk";

export async function renamePet(
  host: PokemonClientOptions,
  id: number,
  name: string,
  approve: (selection: { uid: number; id: number; name: string }) => Promise<boolean>,
) {
  const client = createPokemonClient(host);
  const opened = await client.bootstrap();
  if (opened.kind !== "ready") return opened;
  const pet = await client.getPokemonDetail(id);
  if (pet.kind !== "success") return pet;
  if (!(await approve({ uid: opened.session.uid, id: pet.data.id, name }))) {
    return { kind: "cancelled" } as const;
  }
  return client.rename(id, name);
}
```

## Direct HTTP

Bind a private `requests.Session` to the current account and keep a continuity value that changes at every login. In the Python example, `current()` returns `(numeric_member_id, continuity)` for that cookie session. Provide the canonical origin. Disable transport retries, including retries configured on a session adapter. For the game calls below, the body is always JSON when present. The table gives the exact query and JSON keys.

### Python `requests`

```python
import re
from html.parser import HTMLParser
from requests import RequestException

READS = {
    "config": {"global_config"}, "evolution": {"evolution_path"},
    "pokemon": {"list", "detail", "learnable_skills", "equipment"},
    "user": {"profile", "inventory", "badge_status"},
}
WRITES = {
    "pokemon": {"set_first", "move_pokemon", "rename", "release", "learn_skill",
                "forget_skill", "equip_item", "unequip_item"},
    "user": {"heal", "heal_and_flee", "refresh_badge", "use_item"},
}


class GamePage(HTMLParser):
    def __init__(self):
        super().__init__()
        self.hashes = set()
        self.script = False

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "input" and values.get("type") == "hidden" and values.get("name") == "formhash":
            self.hashes.add(values.get("value", ""))
        if tag == "script":
            self.script = "src" not in values

    def handle_data(self, text):
        if self.script:
            self.hashes.update(re.findall(r'\bformhash\s*=\s*[\'\"](\w{1,128})[\'\"]', text, re.ASCII))

    def handle_endtag(self, tag):
        if tag == "script":
            self.script = False


def pokemon_bootstrap(session, origin, current, mode="auto"):
    uid, continuity = current()
    if type(uid) is not int or uid < 1 or not continuity or mode not in {"auto", "status", "game-page"}:
        raise ValueError("Expected an active forum login and a known bootstrap path")

    def get(params):
        if current() != (uid, continuity):
            raise ValueError("Login changed")
        response = session.get(origin + "/plugin.php", params=params, allow_redirects=False, timeout=20)
        if current() != (uid, continuity):
            raise ValueError("Login changed")
        return response

    if mode != "game-page":
        response = get({"id": "tsdmapp:api", "action": "status"})
        if response.status_code not in (200, 404):
            raise ValueError("Status refused or unavailable")
        try:
            data = response.json() if response.status_code == 200 else {}
        except ValueError:
            data = {}
        if not isinstance(data, dict):
            data = {}
        if data.get("uid", uid) != uid or data.get("error") in {"login", "busy"} or data.get("login") == 1:
            raise ValueError("Status belongs to another login or is unavailable")
        token = data.get("formhash")
        if data.get("ok") == 1 and data.get("uid") == uid and isinstance(token, str) and re.fullmatch(r"[a-f0-9]{8}", token):
            return origin, (uid, continuity), token, "status"
        if mode == "status":
            raise ValueError("Status supplied no usable hash")

    response = get({"id": "pokemon:game"})
    if response.status_code != 200 or "html" not in response.headers.get("Content-Type", "").lower():
        raise ValueError("Game page unavailable")
    identities = set(re.findall(r'\bdiscuz_uid\s*=\s*[\'\"](\d+)[\'\"]', response.text))
    if identities and identities != {str(uid)}:
        raise ValueError("Game page belongs to another login")
    page = GamePage()
    page.feed(response.text)
    if len(page.hashes) != 1 or not all(re.fullmatch(r"\w{1,128}", value, re.ASCII) for value in page.hashes):
        raise ValueError("Game page supplied no unambiguous hash")
    return origin, (uid, continuity), page.hashes.pop(), "game-page"


def pokemon_call(session, origin, current, binding, method, group, action, query, body, *, approved=False):
    write = method == "POST"
    registry = WRITES if write else READS
    if method not in {"GET", "POST"} or action not in registry.get(group, set()):
        raise ValueError("Unexpected method, group or action")
    if set(query) - {"pokemon_id", "pmid", "page", "type", "site"}:
        raise ValueError("Unexpected query field")
    if write and approved is not True:
        return {"kind": "cancelled"}
    bound_origin, bound_login, token, _ = binding
    if origin != bound_origin or current() != bound_login:
        return {"kind": "session-changed"}
    try:
        response = session.request(method, origin + "/plugin.php",
            params={"id": "pokemon:pokemon", "endpoint": group, "action": action, **query},
            headers={"X-Pm-Formhash": token}, json=body if write else None,
            allow_redirects=False, timeout=(20, 45 if write else 20))
    except RequestException:
        return {"kind": "uncertain" if write else "network"}
    if current() != bound_login:
        return {"kind": "uncertain" if write else "session-changed"}
    try:
        envelope = response.json()
    except ValueError:
        envelope = {}
    if not isinstance(envelope, dict):
        envelope = {}
    code = envelope.get("code")
    if response.status_code == 429:
        return {"kind": "rate-limited"}
    if response.status_code in (401, 403) and not envelope:
        return {"kind": "refused", "code": 401}
    if envelope.get("success") is False and (response.status_code == 200 or 400 <= response.status_code < 500):
        if not (write and type(code) is int and code >= 500):
            return {"kind": "refused", "code": code, "message": envelope.get("error")}
    data = envelope.get("data")
    if response.status_code == 200 and envelope.get("success") is True and "data" in envelope and \
            (data is None or isinstance(data, dict)) and code in (None, 0) and envelope.get("error") in (None, ""):
        return {"kind": "success", "data": data}
    return {"kind": "uncertain" if write else "invalid-response"}
```

### curl

Set `FORUM_ORIGIN` and supply `FORUM_COOKIE` through your private session setup. Use `pm_open status` and compare `uid` to the current account. Use `pm_open game-page` for the native bootstrap when status is unavailable. Inspect returned identity if shown and extract one hidden or literal form hash. Export that hash as `PM_FORMHASH` along with the bootstrap session's `PM_BOUND_CONTINUITY` and the current cookie session's `PM_CONTINUITY`. The host owns continuity and must update it on account change or re-login. Treat the hash as private.

Pass the table's method, group and action to `pm_call`. Give it an already encoded query without a leading ampersand. For POST, supply a reviewed JSON object on standard input. For example, after approving a rename, pass `{"id":7,"name":"Blue"}` to `pm_call yes POST pokemon rename ''`. The functions print the body and HTTP status. Inspect the `success/data/error/code` envelope. If the body is missing, malformed, or a redirect interrupts an effect, check the original roster before retrying. The direct examples leave recovery and any new submission to the caller.

```sh
pm_open() {
  case "$1" in
    status) query='id=tsdmapp:api&action=status' ;;
    game-page) query='id=pokemon:game' ;;
    *) return 2 ;;
  esac
  curl -q -sS --max-time 20 --cookie "$FORUM_COOKIE" --write-out '\n%{http_code}\n' "$FORUM_ORIGIN/plugin.php?$query"
}

pm_call() {
  approved=$1; method=$2; group=$3; action=$4; query=${5-}
  [ "$method" != POST ] || [ "$approved" = yes ] || return 0
  [ -n "$PM_BOUND_CONTINUITY" ] && [ "$PM_BOUND_CONTINUITY" = "$PM_CONTINUITY" ] || return 3
  case "$PM_FORMHASH" in ''|*[!a-zA-Z0-9_]*) return 2 ;; esac
  case "$method:$group:$action" in
    GET:config:global_config|GET:evolution:evolution_path|GET:pokemon:list|GET:pokemon:detail|GET:pokemon:learnable_skills|GET:pokemon:equipment) ;;
    GET:user:profile|GET:user:inventory|GET:user:badge_status) ;;
    POST:pokemon:set_first|POST:pokemon:move_pokemon|POST:pokemon:rename|POST:pokemon:release|POST:pokemon:learn_skill|POST:pokemon:forget_skill|POST:pokemon:equip_item|POST:pokemon:unequip_item) ;;
    POST:user:heal|POST:user:heal_and_flee|POST:user:refresh_badge|POST:user:use_item) ;;
    *) return 2 ;;
  esac
  case "$query" in *[!a-zA-Z0-9_=\&]*) return 2 ;; esac
  case "&$query" in *'&id='*|*'&endpoint='*|*'&action='*) return 2 ;; esac
  target="$FORUM_ORIGIN/plugin.php?id=pokemon:pokemon&endpoint=$group&action=$action${query:+&$query}"
  if [ "$method" = POST ]; then
    set -- --max-time 45 --header 'Content-Type: application/json' --data-binary @-
  else
    set -- --max-time 20
  fi
  curl -q -sS --cookie "$FORUM_COOKIE" --header "X-Pm-Formhash: $PM_FORMHASH" \
    --write-out '\n%{http_code}\n' "$@" "$target"
}
```
