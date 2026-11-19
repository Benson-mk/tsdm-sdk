import assert from "node:assert/strict";
import { restoreSelectedReply } from "./guide.js";

const status = { ok: 1, uid: 31, v4: 1, modcp_pages_v4: ["recyclebinpost"] };
const selected = { pid: 901, tid: 801, fid: 10 };
const calls = [];
const host = {
  origin: "https://forum.test",
  session: () => ({ memberId: "31", continuity: "fictional-guide-login" }),
  transport: {
    async request(url, request) {
      const params = new URL(url).searchParams;
      calls.push([
        request.method,
        params.get("action"),
        request.effect,
        request.body ?? null,
      ]);
      if (request.method === "POST") records = [];
      const data =
        params.get("action") === "status"
          ? status
          : {
              ok: 1,
              uid: 31,
              type: "modcp_recyclebinpost",
              schema: 45,
              op: "list",
              fid: 10,
              enabled: 1,
              need_forum: 0,
              page: 1,
              pages: 1,
              posts: records,
              submit: {
                url: "forum.php?mod=modcp&action=recyclebinpost&fid=10",
                method: "POST",
                fields: {
                  formhash: "abcdef12",
                  oldop: "list",
                  dosubmit: "submit",
                  posttableid: "0",
                },
                ids_field: "moderate[]",
                action_field: "op",
                actions: ["restore"],
              },
            };
      return {
        url,
        status: 200,
        body: JSON.stringify(data),
        contentType: "application/json",
        redirect: "none",
      };
    },
  },
};
let records = [selected];
const denied = await restoreSelectedReply(host, "10", "901", async () => false);
const offered = [];
const applied = await restoreSelectedReply(
  host,
  "10",
  "901",
  async (selection) => {
    offered.push(selection);
    return true;
  },
);
const absent = await restoreSelectedReply(host, "10", "901", async () => {
  throw new Error("approval should not be requested");
});
const open = [
  ["GET", "status", false, null],
  ["GET", "recyclebinpost", false, null],
];
const expected = [
  { kind: "not-confirmed" },
  {
    kind: "completed",
    confirmedIds: ["901"],
    remainingIds: [],
    unknownIds: [],
  },
  { kind: "unavailable" },
  [{ forumId: "10", postId: "901" }],
  [
    ...open,
    ...open,
    [
      "POST",
      "recyclebinpost",
      true,
      "formhash=abcdef12&posttableid=0&op=restore&oldop=list&dosubmit=submit&moderate%5B0%5D=901",
    ],
    open[1],
    ...open,
  ],
];
const actual = [denied, applied, absent, offered, calls];
assert.deepEqual(actual, expected);
console.log(
  JSON.stringify({
    name: "packaged TypeScript approves one selected reply and observes scoped readback",
    actual,
    expected,
  }),
);
