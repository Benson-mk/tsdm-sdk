import assert from "node:assert/strict";
import { createPokemonClient } from "tsdm-sdk";

const origin = "https://forum.test";
const status = { ok: 1, uid: 31, formhash: "f1f2f3f4" };
const session = { memberId: "31", continuity: "fixture" };
const ok = (data) => ({ success: true, data, error: null, code: 0 });
const statusRequest = [
  "GET",
  { id: "tsdmapp:api", action: "status" },
  {},
  null,
  false,
];
const request = (method, endpoint, action, query = {}, body = null) => [
  method,
  { id: "pokemon:pokemon", endpoint, action, ...query },
  {
    "X-Pm-Formhash": "f1f2f3f4",
    ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
  },
  body,
  method === "POST",
];
const results = [];
const check = (name, actual, expected) => {
  assert.deepEqual(actual, expected, name);
  results.push({ name, expected, actual });
};
function game(responses) {
  let login = session;
  const calls = [];
  const client = createPokemonClient({
    origin,
    session: () => login,
    transport: {
      async request(url, input) {
        assert.equal(input.fresh, true);
        assert.deepEqual(input.session, login);
        const target = new URL(url);
        assert.equal(target.origin, origin);
        assert.equal(target.pathname, "/plugin.php");
        calls.push([
          input.method,
          Object.fromEntries(target.searchParams),
          input.headers,
          input.body === undefined ? null : JSON.parse(input.body),
          input.effect,
        ]);
        assert.ok(responses.length, "unexpected dispatch");
        let reply = responses.shift();
        if (typeof reply === "function") reply = reply();
        if (reply instanceof Error) throw reply;
        return {
          url,
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(reply),
          redirect: "none",
          ...reply?.response,
        };
      },
    },
  });
  return {
    client,
    calls,
    change(next) {
      login = next;
    },
  };
}
const shopPage = {
  page: 1,
  total: 1,
  items: [{ id: 30, name: "PP restore", price: 60, stock: 5, can_buy: true }],
};
{
  const { client, calls } = game([status, ok(shopPage)]);
  const ready = await client.bootstrap();
  const listed = await client.getShop({ page: 2, type: 4 });
  check(
    "GET shop/list",
    [ready.kind, listed.kind, listed.data, calls],
    [
      "ready",
      "success",
      shopPage,
      [statusRequest, request("GET", "shop", "list", { page: "2", type: "4" })],
    ],
  );
}
const petPage = {
  page: 1,
  pets: [{ id: 25, name: "Pikachu", price: 800, can_buy: true }],
};
const itemPurchase = {
  total_cost: 60,
  remaining_money: 940,
  items_purchased: 1,
};
const petPurchase = {
  total_cost: 800,
  remaining_money: 140,
  pokemon_type_id: 25,
  pokemon_name: "Pikachu",
  site: 2,
  quantity: 1,
};
const maps = [{ id: 3, is_enabled: true, bosses: [{ pokemon_type_id: 149 }] }];
const items = [{ id: 30, nums: 2, item_type: 4 }];
const scene = {
  battle_id: "battle_123.456",
  map_id: 3,
  turn: 2,
  status: "active",
  my_pokemon: { instance_id: 7 },
  wild_pokemon: { id: 25 },
};
const defeat = { status: "defeat", my_pokemon: { hp: 0 } };
const captured = { status: "captured", message: "Captured" };
const fled = { status: "fled" };
const selection = {
  requires_skill_selection: true,
  available_skills: [{ id: 15, pp: 0, max_pp: 5 }],
};
const refusal = (code) => ({
  success: false,
  code,
  error: "Game refused",
  data: null,
});
async function exercise(name, call, input, expected, ...trace) {
  const { client, calls } = game([status, ...input]);
  assert.equal((await client.bootstrap()).kind, "ready");
  check(
    name,
    [await call(client), ...calls],
    [expected, statusRequest, ...trace],
  );
}
const success = (data) => ({ kind: "success", data });
const fail = (kind, operation, details) => ({ kind, operation, ...details });
const uncertain = (operation) =>
  fail("uncertain", operation, {
    message:
      "The plugin did not establish the effect. Reconcile the original account before considering another submission.",
  });
const writes = [
  [
    "shop",
    "buy",
    (c) => c.buyShopItem(30, 2),
    { item_id: 30, quantity: 2 },
    itemPurchase,
  ],
  [
    "shop",
    "buy_pet",
    (c) => c.buyShopPet(25),
    { pokemon_type_id: 25, quantity: 1 },
    petPurchase,
  ],
  [
    "battle",
    "start",
    (c) => c.startBattle(3, 149),
    { map_id: 3, boss_pokemon_type_id: 149 },
    scene,
  ],
  [
    "battle",
    "turn",
    (c) => c.takeBattleTurn(scene.battle_id, 15),
    { battle_id: scene.battle_id, skill_id: 15 },
    defeat,
  ],
  [
    "battle",
    "flee",
    (c) => c.fleeBattle(scene.battle_id),
    { battle_id: scene.battle_id },
    fled,
  ],
  ["battle", "capture", (c) => c.capturePokemon(18), { ball_id: 18 }, captured],
  [
    "battle",
    "switch_pokemon",
    (c) => c.switchBattlePokemon(scene.battle_id, 7),
    { battle_id: scene.battle_id, pokemon_id: 7 },
    scene,
  ],
  [
    "battle",
    "use_item",
    (c) => c.useBattleItem(30),
    { item_id: 30 },
    selection,
    { kind: "skill-selection", data: selection },
  ],
  [
    "battle",
    "use_item_on_skill",
    (c) => c.useBattleItemOnSkill(30, 15),
    { item_id: 30, skill_id: 15 },
    scene,
  ],
];
for (const [
  endpoint,
  action,
  call,
  body,
  data,
  expected = success(data),
] of writes) {
  const operation = `${endpoint}/${action}`;
  const trace = request("POST", endpoint, action, {}, body);
  await exercise(`POST ${operation}`, call, [ok(data)], expected, trace);
  await exercise(
    `${operation} preserves refusal`,
    call,
    [refusal(403)],
    fail("refused", operation, { code: 403, message: "Game refused" }),
    trace,
  );
  await exercise(
    `${operation} lost reply sends once`,
    call,
    [new Error("lost reply")],
    uncertain(operation),
    trace,
  );
  await exercise(
    `${operation} empty acknowledgement sends once`,
    call,
    [ok({})],
    uncertain(operation),
    trace,
  );
}
for (const [endpoint, action, call, query, data, decoded] of [
  [
    "shop",
    "pets",
    (c) => c.getShopPets({ page: 2 }),
    { page: "2" },
    petPage,
    petPage,
  ],
  ["battle", "maps", (c) => c.getBattleMaps(), {}, { maps }, maps],
  ["battle", "recover", (c) => c.recoverBattle(), {}, scene, scene],
  [
    "battle",
    "get_battle_items",
    (c) => c.getBattleItems(),
    {},
    { items },
    items,
  ],
]) {
  const trace = request("GET", endpoint, action, query);
  await exercise(
    `GET ${endpoint}/${action}`,
    call,
    [ok(data)],
    success(decoded),
    trace,
  );
  await exercise(
    `${endpoint}/${action} reports malformed reads`,
    call,
    [ok({})],
    fail("invalid-response", `${endpoint}/${action}`),
    trace,
  );
}
await exercise(
  "recovery alone interprets plugin 404 as absence",
  (c) => c.recoverBattle(),
  [refusal(404)],
  success(null),
  request("GET", "battle", "recover"),
);
await exercise(
  "bare HTTP 404 is not absence",
  (c) => c.recoverBattle(),
  [{ response: { status: 404, body: "Not found" } }],
  fail("invalid-response", "battle/recover"),
  request("GET", "battle", "recover"),
);
await exercise(
  "maps plugin 404 is a refusal",
  (c) => c.getBattleMaps(),
  [refusal(404)],
  fail("refused", "battle/maps", { code: 404, message: "Game refused" }),
  request("GET", "battle", "maps"),
);
await exercise(
  "item can return scene immediately",
  (c) => c.useBattleItem(30),
  [ok(scene)],
  success(scene),
  request("POST", "battle", "use_item", {}, { item_id: 30 }),
);
await exercise(
  "skill selection needs identifiable choices",
  (c) => c.useBattleItem(30),
  [ok({ ...scene, requires_skill_selection: true })],
  uncertain("battle/use_item"),
  request("POST", "battle", "use_item", {}, { item_id: 30 }),
);
await exercise(
  "optional boss is omitted",
  (c) => c.startBattle(3),
  [ok(scene)],
  success(scene),
  request("POST", "battle", "start", {}, { map_id: 3 }),
);
await exercise(
  "optional switch selection is omitted",
  (c) => c.switchBattlePokemon(scene.battle_id),
  [ok(scene)],
  success(scene),
  request(
    "POST",
    "battle",
    "switch_pokemon",
    {},
    { battle_id: scene.battle_id },
  ),
);
await exercise(
  "different echoed battle cannot establish effect",
  (c) => c.fleeBattle(scene.battle_id),
  [ok({ ...fled, battle_id: "different" })],
  uncertain("battle/flee"),
  request("POST", "battle", "flee", {}, { battle_id: scene.battle_id }),
);
await exercise(
  "active result needs an identifiable battle",
  (c) => c.startBattle(3),
  [ok({ status: "active" })],
  uncertain("battle/start"),
  request("POST", "battle", "start", {}, { map_id: 3 }),
);
await exercise(
  "different echoed map cannot establish effect",
  (c) => c.startBattle(3),
  [ok({ ...scene, map_id: 9 })],
  uncertain("battle/start"),
  request("POST", "battle", "start", {}, { map_id: 3 }),
);
await exercise(
  "different species receipt cannot establish effect",
  (c) => c.buyShopPet(25),
  [ok({ ...petPurchase, pokemon_type_id: 26 })],
  uncertain("shop/buy_pet"),
  request("POST", "shop", "buy_pet", {}, { pokemon_type_id: 25, quantity: 1 }),
);
await exercise(
  "invalid battle choice sends nothing",
  (c) => c.takeBattleTurn(" ", 15),
  [],
  fail("invalid-input", "battle/turn"),
);
{
  const { client, calls, change } = game([status]);
  const unbound = await client.capturePokemon(18);
  await client.bootstrap();
  change({ ...session, continuity: "replacement" });
  check(
    "capture requires the original session",
    [unbound, await client.capturePokemon(18), calls],
    [
      fail("session-required", "battle/capture"),
      fail("session-changed", "battle/capture"),
      [statusRequest],
    ],
  );
}
{
  const { client, calls, change } = game([
    status,
    () => {
      change({ ...session, continuity: "replacement" });
      return ok(scene);
    },
  ]);
  await client.bootstrap();
  check(
    "login lost after dispatch yields uncertainty once",
    [await client.startBattle(3), calls],
    [
      uncertain("battle/start"),
      [statusRequest, request("POST", "battle", "start", {}, { map_id: 3 })],
    ],
  );
}
await exercise(
  "excess purchase quantity cannot establish requested effect",
  (c) => c.buyShopItem(30, 2),
  [ok({ ...itemPurchase, items_purchased: 3 })],
  uncertain("shop/buy"),
  request("POST", "shop", "buy", {}, { item_id: 30, quantity: 2 }),
);
await exercise(
  "type filter zero and empty availability are meaningful",
  (c) => c.getShop({ type: 0 }),
  [ok({ page: 1, items: [] })],
  success({ page: 1, items: [] }),
  request("GET", "shop", "list", { page: "1", type: "0" }),
);
{
  const page = {
    response: {
      contentType: "text/html",
      body: '<script>const formhash = "a1b2c3d4";</script>',
    },
  };
  const { client, calls } = game([page, ok(shopPage), ok(null), ok(selection)]);
  const ready = await client.bootstrapFromGamePage();
  const shop = await client.getShop();
  const roster = await client.useItem(30, { pokemonId: 7 });
  const battle = await client.useBattleItem(30);
  const expected = [
    ["GET", { id: "pokemon:game" }, {}, null, false],
    request("GET", "shop", "list", { page: "1" }),
    request("POST", "user", "use_item", {}, { item_id: 30, pokemon_id: 7 }),
    request("POST", "battle", "use_item", {}, { item_id: 30 }),
  ];
  for (const row of expected.slice(1)) row[2]["X-Pm-Formhash"] = "a1b2c3d4";
  check(
    "native bootstrap shares its binding across shop, roster item and battle item",
    [ready, shop, roster.kind, battle, calls],
    [
      { kind: "ready", session: { uid: 31, source: "game-page" } },
      success(shopPage),
      "success",
      { kind: "skill-selection", data: selection },
      expected,
    ],
  );
}
console.log(JSON.stringify({ results }));
