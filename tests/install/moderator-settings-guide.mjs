import assert from "node:assert/strict";
import { saveForumRules } from "./guide.js";
const calls = [];
let content = "Original";
const host = {
  origin: "https://forum.test",
  session: () => ({ memberId: "31", continuity: "fictional-guide-login" }),
  transport: {
    async request(url, request) {
      const target = new URL(url);
      const action = target.searchParams.get("action");
      const fields = new URLSearchParams(request.body);
      calls.push([
        request.method,
        action,
        request.effect,
        request.body ?? null,
      ]);
      if (request.method === "POST") content = fields.get("rulesnew");
      const data =
        action === "status"
          ? { ok: 1, uid: 31, v4: 1, modcp_pages_v4: ["editforum"] }
          : {
              ok: 1,
              uid: 31,
              type: "modcp_editforum",
              schema: 46,
              fid: 10,
              need_forum: 0,
              editable: 1,
              rules: content,
              updated: request.method === "POST" ? 1 : 0,
              submit: {
                url: "forum.php?mod=modcp&action=forum&op=editforum",
                method: "POST",
                fields: { formhash: "abcdef12", fid: "10", editsubmit: "true" },
                rules_field: "rulesnew",
              },
            };
      return {
        url,
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(data),
        redirect: "none",
      };
    },
  },
};
const declined = await saveForumRules(host, "10", "Updated", async () => false);
const shown = [];
const accepted = await saveForumRules(host, "10", "Updated", async (change) => {
  shown.push(change);
  return true;
});
const read = [
  ["GET", "status", false, null],
  ["GET", "forum", false, null],
];
const expected = [
  { kind: "not-confirmed", operation: "save-rules" },
  { kind: "completed", operation: "save-rules" },
  [{ forumId: "10", before: "Original", after: "Updated" }],
  [
    ...read,
    ...read,
    [
      "POST",
      "forum",
      true,
      "formhash=abcdef12&fid=10&editsubmit=true&rulesnew=Updated",
    ],
  ],
];
const actual = [declined, accepted, shown, calls];
assert.deepEqual(actual, expected);
console.log(
  JSON.stringify({
    name: "packaged TypeScript confirms shown rule change before one scoped dispatch",
    expected,
    actual,
  }),
);
