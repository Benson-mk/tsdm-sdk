import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createPokemonClient } from "tsdm-sdk";

const origin = "https://forum.test";
const status = JSON.parse(
  readFileSync(new URL("./pokemon-status.json", import.meta.url), "utf8"),
);
const gamePage = '<input type="hidden" name="formhash" value="a1b2c3d4">';
const responses = {
  "config:global_config": {
    is_open: true,
    version: "3.0.0",
    medical_price: 10,
  },
  "evolution:evolution_path": {
    pokemon_id: 25,
    pokemon_name: "Pikachu",
    forward: [],
    backward: [],
  },
  "pokemon:list": {
    pokemons: [{ id: 7, name: "Squirtle", type_id: 7, level: 12 }],
  },
  "pokemon:detail": {
    id: 7,
    name: "Squirtle",
    type_id: 7,
    level: 12,
    stats: { hp: 44 },
  },
  "pokemon:learnable_skills": {
    pokemon_id: 7,
    available_skills: [],
    unlocked_skills: [],
  },
  "pokemon:equipment": {
    pokemon_id: 7,
    equipment_slots: [],
    owned_items: [],
    shop_items: [],
    user_money: 100,
  },
  "user:profile": { uid: 31, username: "Member 31", money: 100 },
  "user:inventory": {
    items: [],
    total: 0,
    page: 1,
    per_page: 20,
    total_pages: 1,
  },
  "user:badge_status": { hidden: false },
  "user:heal": { message: "healed", current_hp: 44, max_hp: 44, cost: 0 },
  "user:heal_and_flee": {
    message: "fled",
    current_hp: 44,
    max_hp: 44,
    cost: 0,
  },
  "user:refresh_badge": { hidden: true },
  "pokemon:set_first": {},
  "pokemon:move_pokemon": {},
  "pokemon:rename": {},
  "pokemon:release": {},
  "pokemon:learn_skill": {},
  "pokemon:forget_skill": {},
  "pokemon:equip_item": {},
  "pokemon:unequip_item": {},
  "user:use_item": {},
};
const expectedAccount = { memberId: "31", continuity: "first" };
const login = { success: false, error: "login", code: 401 };
const stale = {
  success: false,
  error: "formhash 校验失败，请刷新页面后重试",
  code: 419,
};
const ok = (data) => ({ success: true, data, error: null, code: 0 });
const success = (data) => ({ kind: "success", data });
const ready = (source, uid = 31) => ({
  kind: "ready",
  session: { uid, source },
});
const loop = [];
const statusCall = [
  "GET",
  { id: "tsdmapp:api", action: "status" },
  {},
  null,
  false,
];
const gameCall = ["GET", { id: "pokemon:game" }, {}, null, false];
const apiCall = (
  method,
  endpoint,
  action,
  query = {},
  body = null,
  hash = "f1f2f3f4",
) => [
  method,
  { id: "pokemon:pokemon", endpoint, action, ...query },
  {
    "X-Pm-Formhash": hash,
    ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
  },
  body,
  method === "POST",
];
function fixtureForum(responses) {
  const calls = [];
  let account = { ...expectedAccount };
  const client = createPokemonClient({
    origin,
    session: () => account,
    transport: {
      async request(url, options) {
        assert.deepEqual(options.session, account);
        assert.equal(options.fresh, true);
        const target = new URL(url);
        assert.equal(target.origin, origin);
        assert.equal(target.pathname, "/plugin.php");
        calls.push([
          options.method,
          Object.fromEntries(target.searchParams),
          options.headers,
          options.body === undefined ? null : JSON.parse(options.body),
          options.effect,
        ]);
        assert.ok(responses.length, "unexpected dispatch");
        let reply = responses.shift();
        if (typeof reply === "function") reply = reply();
        if (reply instanceof Error) throw reply;
        if (typeof reply === "string")
          return {
            url,
            status: 200,
            contentType: "text/html",
            body: reply,
            redirect: "none",
          };
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
      account = next;
    },
  };
}
function check(name, actual, expected) {
  assert.deepEqual(actual, expected, name);
  loop.push({ name, expected, actual });
}
const operations = [
  [
    "GET",
    "config",
    "global_config",
    {},
    null,
    (c) => c.getGlobalConfig(),
    (r) => r.data,
    responses["config:global_config"],
  ],
  [
    "GET",
    "evolution",
    "evolution_path",
    { pmid: "25" },
    null,
    (c) => c.getEvolutionPath(25),
    (r) => r.data?.pokemonId,
    25,
  ],
  [
    "GET",
    "pokemon",
    "list",
    {},
    null,
    (c) => c.getMyPokemon(),
    (r) => r.data?.[0].id,
    7,
  ],
  [
    "GET",
    "pokemon",
    "detail",
    { pokemon_id: "7" },
    null,
    (c) => c.getPokemonDetail(7),
    (r) => r.data?.stats.hp,
    44,
  ],
  [
    "GET",
    "pokemon",
    "learnable_skills",
    { pokemon_id: "7" },
    null,
    (c) => c.getLearnableSkills(7),
    (r) => r.data?.pokemonId,
    7,
  ],
  [
    "GET",
    "pokemon",
    "equipment",
    { pokemon_id: "7" },
    null,
    (c) => c.getEquipment(7),
    (r) => r.data?.pokemonId,
    7,
  ],
  [
    "GET",
    "user",
    "profile",
    {},
    null,
    (c) => c.getProfile(),
    (r) => r.data?.uid,
    31,
  ],
  [
    "GET",
    "user",
    "inventory",
    { page: "2", type: "4" },
    null,
    (c) => c.getInventory({ page: 2, type: 4 }),
    (r) => r.data?.page,
    1,
  ],
  [
    "GET",
    "user",
    "badge_status",
    {},
    null,
    (c) => c.badgeStatus(),
    (r) => r.data?.hidden,
    false,
  ],
  [
    "POST",
    "pokemon",
    "set_first",
    { pokemon_id: "7" },
    {},
    (c) => c.setFirst(7),
  ],
  [
    "POST",
    "pokemon",
    "move_pokemon",
    { pokemon_id: "7", site: "2" },
    {},
    (c) => c.movePokemon(7, 2),
  ],
  [
    "POST",
    "pokemon",
    "rename",
    {},
    { id: 7, name: "Blue" },
    (c) => c.rename(7, "Blue"),
  ],
  ["POST", "pokemon", "release", {}, { id: 7 }, (c) => c.release(7)],
  [
    "POST",
    "pokemon",
    "learn_skill",
    {},
    { pokemon_id: 7, skill_id: 15, slot_index: 1 },
    (c) => c.learnSkill(7, 15, { slotIndex: 1 }),
  ],
  [
    "POST",
    "pokemon",
    "forget_skill",
    {},
    { pokemon_id: 7, skill_id: 15 },
    (c) => c.forgetSkill(7, 15),
  ],
  [
    "POST",
    "pokemon",
    "equip_item",
    {},
    { pokemon_id: 7, myitem_id: 99, slot_index: 0 },
    (c) => c.equipItem(7, 99, { slotIndex: 0 }),
  ],
  [
    "POST",
    "pokemon",
    "unequip_item",
    {},
    { pokemon_id: 7, slot_index: 0 },
    (c) => c.unequipItem(7, 0),
  ],
  [
    "POST",
    "user",
    "heal",
    { pokemon_id: "7" },
    {},
    (c) => c.heal(7),
    (r) => r.data?.current_hp,
    44,
  ],
  [
    "POST",
    "user",
    "heal_and_flee",
    { pokemon_id: "7" },
    {},
    (c) => c.healAndFlee(7),
    (r) => r.data?.message,
    "fled",
  ],
  [
    "POST",
    "user",
    "refresh_badge",
    {},
    { hide: true },
    (c) => c.refreshBadge({ hide: true }),
    (r) => r.data?.hidden,
    true,
  ],
  [
    "POST",
    "user",
    "use_item",
    {},
    { item_id: 12, pokemon_id: 7 },
    (c) => c.useItem(12, { pokemonId: 7 }),
  ],
];
const main = fixtureForum([
  status,
  ...operations.map(([, endpoint, action]) =>
    ok(responses[`${endpoint}:${action}`]),
  ),
]);
check(
  "status bootstrap verifies host account and keeps plugin hash private",
  [await main.client.bootstrapFromStatus(), main.calls.splice(0)],
  [ready("status"), [statusCall]],
);
for (const [
  method,
  endpoint,
  action,
  query,
  body,
  invoke,
  project,
  expected,
] of operations) {
  const result = await invoke(main.client);
  check(
    `${method} ${endpoint}/${action}`,
    [result.kind, project?.(result) ?? null, main.calls.splice(0)],
    [
      "success",
      expected ?? null,
      [apiCall(method, endpoint, action, query, body)],
    ],
  );
}
{
  const { client, calls } = fixtureForum([
    { response: { status: 404 } },
    gamePage,
    ok({ hidden: false }),
  ]);
  const session = await client.bootstrap();
  const badge = await client.badgeStatus();
  check(
    "unavailable status falls back to the native game's hidden formhash",
    [session, badge, calls],
    [
      ready("game-page"),
      success({ hidden: false }),
      [
        statusCall,
        gameCall,
        apiCall("GET", "user", "badge_status", {}, null, "a1b2c3d4"),
      ],
    ],
  );
}
{
  const { client, calls } = fixtureForum([
    "<script>const formhash = '43749fab';</script>",
    ok(null),
  ]);
  const session = await client.bootstrapFromGamePage();
  const use = await client.useItem(12);
  check(
    "native inline value is parsed as data and omitted item target stays omitted",
    [session, use.kind, calls],
    [
      ready("game-page"),
      "success",
      [
        gameCall,
        apiCall("POST", "user", "use_item", {}, { item_id: 12 }, "43749fab"),
      ],
    ],
  );
}
{
  const { client, calls } = fixtureForum([
    status,
    stale,
    { ...status, formhash: "deadbeef" },
    ok(null),
  ]);
  await client.bootstrap();
  const outcome = await client.rename(7, "Blue");
  check(
    "explicit pre-execution formhash refusal refreshes once and reuses the exact authorized write",
    [outcome.kind, calls],
    [
      "success",
      [
        statusCall,
        apiCall("POST", "pokemon", "rename", {}, { id: 7, name: "Blue" }),
        statusCall,
        apiCall(
          "POST",
          "pokemon",
          "rename",
          {},
          { id: 7, name: "Blue" },
          "deadbeef",
        ),
      ],
    ],
  );
}
for (const [name, reply, kind, code] of [
  [
    "ordinary refusal",
    { success: false, error: "insufficient money", code: 402 },
    "refused",
    402,
  ],
  ["plugin login refusal", login, "refused", 401],
  ["response lost", new Error("lost"), "uncertain", null],
  ["malformed success", ok([1]), "uncertain", null],
  [
    "redirect",
    { response: { status: 302, redirect: "followed" } },
    "uncertain",
    null,
  ],
  [
    "unqualified formhash wording",
    { success: false, error: "Other formhash warning", code: 422 },
    "refused",
    422,
  ],
]) {
  const { client, calls } = fixtureForum([status, reply]);
  await client.bootstrap();
  const result = await client.release(7);
  check(
    `${name} dispatches no second write`,
    [result.kind, result.code ?? null, result.operation, calls],
    [
      kind,
      code,
      "pokemon/release",
      [statusCall, apiCall("POST", "pokemon", "release", {}, { id: 7 })],
    ],
  );
}
{
  const { client, calls, change } = fixtureForum([
    status,
    { ...status, formhash: "abba4321" },
    ok(responses["user:profile"]),
  ]);
  await client.bootstrap();
  change({ memberId: "31", continuity: "new-login" });
  const stale = await client.release(7);
  await client.bootstrap();
  const fresh = await client.getProfile();
  check(
    "same UID after re-login cannot reuse the old binding",
    [stale.kind, fresh.kind, calls],
    [
      "session-changed",
      "success",
      [
        statusCall,
        statusCall,
        apiCall("GET", "user", "profile", {}, null, "abba4321"),
      ],
    ],
  );
}
{
  const { client, calls } = fixtureForum([{ ...status, uid: 44 }]);
  const opened = await client.bootstrap();
  const skipped = await client.getMyPokemon();
  check(
    "conflicting status identity stops fallback and gameplay",
    [opened.kind, skipped.kind, calls],
    ["session-changed", "session-required", [statusCall]],
  );
}
{
  const { client, calls, change } = fixtureForum([
    status,
    () => {
      change({ memberId: "44", continuity: "next" });
      return ok(null);
    },
  ]);
  await client.bootstrap();
  const outcome = await client.release(7);
  check(
    "account change with a write in flight leaves old effect uncertain",
    [outcome.kind, calls],
    [
      "uncertain",
      [statusCall, apiCall("POST", "pokemon", "release", {}, { id: 7 })],
    ],
  );
}
{
  const { client, calls } = fixtureForum([status, stale, status]);
  await client.bootstrap();
  const denied = await client.rename(7, "Blue");
  const later = await client.getProfile();
  check(
    "unchanged refresh hash keeps original refusal and requires a new bootstrap",
    [denied.kind, later.kind, calls],
    [
      "refused",
      "session-required",
      [
        statusCall,
        apiCall("POST", "pokemon", "rename", {}, { id: 7, name: "Blue" }),
        statusCall,
      ],
    ],
  );
}
{
  const { client, calls } = fixtureForum([
    status,
    { ...stale, response: { status: 302 } },
  ]);
  await client.bootstrap();
  const result = await client.rename(7, "Blue");
  check(
    "a redirect with a formhash-looking body is uncertain and does not refresh",
    [result.kind, calls],
    [
      "uncertain",
      [
        statusCall,
        apiCall("POST", "pokemon", "rename", {}, { id: 7, name: "Blue" }),
      ],
    ],
  );
}
{
  const { client, calls } = fixtureForum([
    `<script>var discuz_uid = '31'; var discuz_uid = '44';</script>${gamePage}`,
  ]);
  const result = await client.bootstrapFromGamePage();
  check(
    "conflicting game-page identities cannot grant a binding",
    [result.kind, calls],
    ["session-changed", [gameCall]],
  );
}
{
  const { client, calls } = fixtureForum([status]);
  const opened = await Promise.all([client.bootstrap(), client.bootstrap()]);
  check(
    "concurrent bootstraps for one login share one status read",
    [opened, calls],
    [[ready("status"), ready("status")], [statusCall]],
  );
}
{
  const { client, calls } = fixtureForum([
    status,
    ok({ uid: 44, username: "Other" }),
  ]);
  await client.bootstrap();
  const wrong = await client.getProfile();
  const blocked = await client.release(7);
  check(
    "another account's profile invalidates the binding before later effects",
    [wrong.kind, blocked.kind, calls],
    [
      "session-changed",
      "session-required",
      [statusCall, apiCall("GET", "user", "profile")],
    ],
  );
}
console.log(
  JSON.stringify(
    {
      fixtureSha256: createHash("sha256")
        .update(JSON.stringify(status) + "\n")
        .digest("hex"),
      results: loop,
    },
    null,
    2,
  ),
);
