# Shop and battle in Pokémon

Use Node 26.x and the same `createPokemonClient` and authenticated host as the [Pokémon session and roster guide](pokemon.md). Call `bootstrap()` first or reuse the already-open client for the current login. The host sends the current login's cookies, honors fresh reads, reports redirects and avoids transport retries on effect requests. See the [SDK tasks](../README.md#tasks).

Every operation uses `plugin.php?id=pokemon:pokemon&endpoint=GROUP&action=ACTION` and the game-specific `X-Pm-Formhash`. GET arguments go in the query. Every POST below sends only the listed JSON fields as its arguments. Read the relevant catalogue, map, battle or battle items before asking for approval. The server determines availability, eligibility and the effects of each action.

| Method | Group / action | SDK operation | Arguments | Observable result |
| --- | --- | --- | --- | --- |
| GET | `shop/list` | `getShop({ page, type })` | Query `page` defaults to `1`, `type` is optional | Returned page, item IDs, prices and available stock details |
| GET | `shop/pets` | `getShopPets({ page })` | Query `page` defaults to `1` | Returned page, species IDs and purchase details |
| POST | `shop/buy` | `buyShopItem(itemId, quantity)` | JSON `item_id`, `quantity` | Cost, remaining money and actual item count, which may be smaller than requested |
| POST | `shop/buy_pet` | `buyShopPet(typeId, quantity)` | JSON `pokemon_type_id`, `quantity` defaults to `1` | Species, actual quantity, balance and destination `site` when returned |
| GET | `battle/maps` | `getBattleMaps()` | — | Map IDs, availability and any boss choices |
| GET | `battle/recover` | `recoverBattle()` | — | Current scene or `success` with `data: null` for the plugin's explicit code `404` |
| GET | `battle/get_battle_items` | `getBattleItems()` | — | Battle-usable items and available counts |
| POST | `battle/start` | `startBattle(mapId, bossTypeId)` | JSON `map_id`, optional `boss_pokemon_type_id` | Started scene for the chosen map, with a battle ID when active |
| POST | `battle/turn` | `takeBattleTurn(battleId, skillId)` | JSON `battle_id`, `skill_id` | Scene after using the selected skill, with status and any rewards |
| POST | `battle/flee` | `fleeBattle(battleId)` | JSON `battle_id` | Scene reporting the outcome of the flee attempt |
| POST | `battle/capture` | `capturePokemon(ballId)` | JSON `ball_id` | Scene reporting the capture attempt and whether the encounter continues |
| POST | `battle/switch_pokemon` | `switchBattlePokemon(battleId, pokemonId)` | JSON `battle_id`, optional `pokemon_id` | New scene after the explicit or server-selected switch |
| POST | `battle/use_item` | `useBattleItem(itemId)` | JSON `item_id` | Immediate battle scene or `skill-selection` with `available_skills` |
| POST | `battle/use_item_on_skill` | `useBattleItemOnSkill(itemId, skillId)` | JSON `item_id`, `skill_id` | Scene after applying the item to the selected skill |

Turn, flee and switch use the caller's battle ID. Capture and both battle item actions act on the server's active battle. Refresh the battle and relevant choices and coordinate access if another client may change the active encounter. Roster `user/use_item` targets the roster, and `pokemon/list` lists owned pets. `shop/list` lists items for sale.

A `skill-selection` response presents choices for a separate approved `useBattleItemOnSkill` call. It provides no confirmation of consumption. A `defeat` scene can have a recoverable battle with a backup pet. Call `recoverBattle()` to check. Terminal replies can omit the battle ID and usable pet instance IDs. The SDK preserves reported counts, status and additional scene fields. An HTTP 404 page alone is an invalid response. A plugin refusal returns `refused` except for the specific recovery case above.

Purchases can spend game currency. Battle actions can advance or end an encounter, change the active pet, or consume items and skill PP. A readable `success` reply is the plugin's acknowledgement and reported outcome. Use fresh profile, inventory, roster or recovery reads to reconcile state. For a lost, redirected, contradictory or malformed effect reply, treat `uncertain` as a potential effect on the original account. The shared client only reissues after the exact pre-execution form-hash rejection and successful refresh with a different hash for the same login.

## TypeScript

The following example checks the returned battle and inventory before asking the host to approve an item submission. If the result offers skill choices, present them to the user before any new action.

```ts
import { createPokemonClient, type PokemonClientOptions } from "tsdm-sdk";

export async function applyBattleItem(
  host: PokemonClientOptions,
  itemId: number,
  approve: (choice: { uid: number; battleId: string; itemId: number }) => Promise<boolean>,
) {
  const game = createPokemonClient(host);
  const opened = await game.bootstrap();
  if (opened.kind !== "ready") return opened;
  const battle = await game.recoverBattle();
  if (battle.kind !== "success") return battle;
  if (!battle.data?.battle_id) return { kind: "unavailable" } as const;
  const items = await game.getBattleItems();
  if (items.kind !== "success") return items;
  if (!items.data.some((item) => item.id === itemId)) return { kind: "unavailable" } as const;
  const choice = { uid: opened.session.uid, battleId: battle.data.battle_id, itemId };
  if (!(await approve(choice))) return { kind: "cancelled" } as const;
  const current = await game.recoverBattle();
  if (current.kind !== "success") return current;
  if (current.data?.battle_id !== choice.battleId) return { kind: "unavailable" } as const;
  return game.useBattleItem(itemId);
}
```

## Direct HTTP

Use the `pokemon_bootstrap` and `pokemon_call` functions or the `pm_open` and `pm_call` functions in the [session and roster guide](pokemon.md#direct-http). Both direct examples share those transport helpers. Keep cookies and hashes private, use the canonical origin and bind the hash to the same login. For Python, pass a private `requests.Session` configured without retries and a `current()` callback for that session. For curl, set the origin, cookie and continuity variables, and check identity at bootstrap. Use the method, group, action and arguments in the table for every call. The direct helper exposes the envelope, so evaluate the returned fields using the observations above. Preserve the skill-selection reply as a choice and reconcile ambiguous effects before another submission.

### Python `requests`

```python
def battle_request(session, origin, current, binding, method, group, action, query, body, *, approved=False):
    result = pokemon_call(session, origin, current, binding, method, group, action, query, body, approved=approved)
    if (method, group, action) == ("GET", "battle", "recover") and result.get("kind") == "refused" and result.get("code") == 404:
        return {"kind": "success", "data": None}
    return result
```

Obtain `binding = pokemon_bootstrap(session, origin, current)`. Call `battle_request(session, origin, current, binding, "GET", "shop", "list", {"page": 1}, None)` to inspect the catalogue. Following approval for the selected item and quantity, use `battle_request(session, origin, current, binding, "POST", "shop", "buy", {}, {"item_id": 30, "quantity": 2}, approved=True)` and check the actual count before deciding whether any further purchase is needed.

### curl

Run `pm_open status` or `pm_open game-page` as described in the roster guide. Then run `pm_call yes GET battle recover ''` and inspect the response body and HTTP status. After explicit approval for a skill and the original battle, pass `printf '%s\n' '{"battle_id":"battle_123.456","skill_id":15}' | pm_call yes POST battle turn ''`. Use the actual ID and chosen skill. An explicit `404` code in a refused recovery envelope means no active battle. For effect calls inspect the envelope and relevant scene or purchase fields, including when the server supplies HTTP 200.
