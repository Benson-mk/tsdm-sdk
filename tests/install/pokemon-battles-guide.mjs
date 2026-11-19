import assert from "node:assert/strict";
import { applyBattleItem } from "./guide.js";

const calls = [];
const approved = [];
let battleId = "battle_123.456";
const host = {
  origin: "https://forum.test",
  session: () => ({ memberId: "31", continuity: "sample" }),
  transport: {
    async request(url, request) {
      const { searchParams } = new URL(url);
      const action = searchParams.get("action");
      calls.push([
        request.method,
        action,
        request.effect,
        request.body ? JSON.parse(request.body) : null,
      ]);
      const data = {
        recover: { status: "active", battle_id: battleId },
        get_battle_items: { items: [{ id: 30 }] },
        use_item: {
          requires_skill_selection: true,
          available_skills: [{ id: 15 }],
        },
      }[action];
      const body =
        action === "status"
          ? { uid: 31, ok: 1, formhash: "abcdef12" }
          : { success: true, error: null, code: 0, data };
      return {
        url,
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
        redirect: "none",
      };
    },
  },
};
const denied = await applyBattleItem(host, 30, async () => false);
const accepted = await applyBattleItem(
  host,
  30,
  async (choice) => (approved.push(choice), true),
);
const replaced = await applyBattleItem(host, 30, async () => {
  battleId = "replacement";
  return true;
});
const view = [
  ["GET", "status", false, null],
  ["GET", "recover", false, null],
  ["GET", "get_battle_items", false, null],
];
const refresh = ["GET", "recover", false, null];
const expected = [
  { kind: "cancelled" },
  {
    kind: "skill-selection",
    data: { requires_skill_selection: true, available_skills: [{ id: 15 }] },
  },
  { kind: "unavailable" },
  [{ uid: 31, battleId: "battle_123.456", itemId: 30 }],
  [
    ...view,
    ...view,
    refresh,
    ["POST", "use_item", true, { item_id: 30 }],
    ...view,
    refresh,
  ],
];
const actual = [denied, accepted, replaced, approved, calls];
assert.deepEqual(actual, expected);
console.log(
  JSON.stringify({
    name: "packaged TypeScript checks consent and active encounter and stops at skill choice",
    expected,
    actual,
  }),
);
