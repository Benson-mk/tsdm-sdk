import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as sdk from "tsdm-sdk";

assert.deepEqual(Object.keys(sdk), [
  "createAccountClient",
  "createActivityClient",
  "createAwardsClient",
  "createBankClient",
  "createBatchRatingClient",
  "createCollectionClient",
  "createCreditsClient",
  "createForumClient",
  "createMediaClient",
  "createMemberClient",
  "createMessageClient",
  "createNoticeClient",
  "createPacketClient",
  "createPokemonClient",
  "createPostClient",
  "createProfileClient",
  "createReplyClient",
  "createSpaceClient",
  "createSpecialThreadClient",
  "createTaskMagicClient",
  "createTradeClient",
]);
await assert.rejects(import("tsdm-sdk/index.js"), {
  code: "ERR_PACKAGE_PATH_NOT_EXPORTED",
});
await assert.rejects(import("tsdm-sdk/types"), {
  code: "ERR_PACKAGE_PATH_NOT_EXPORTED",
});
for (const name of ["window", "document", "DOMParser"]) {
  assert.equal(typeof globalThis[name], "undefined");
}

const body = readFileSync(
  new URL("./thread_plain.json", import.meta.url),
  "utf8",
);
const fixtureSha256 = createHash("sha256").update(body).digest("hex");
assert.equal(
  fixtureSha256,
  "4c315c9baa628790c74c0eed3c477cea13fc6ef961b4fe78cef8080a2e01e1b1",
);
const origin = "https://forum.test";
const destination = `${origin}/forum.php?mod=viewthread&tid=9199345`;
const requests = [];
const transport = {
  session: "fixture-member-31",
  async request(url, options) {
    requests.push({ url, session: this.session, fresh: options.fresh });
    return {
      status: 200,
      url,
      contentType: "application/json",
      body,
      redirect: "none",
    };
  },
};
const client = sdk.createForumClient({ origin, transport });
for (const method of ["readHomepage", "readBoard", "readThread"]) {
  assert.equal(typeof client[method], "function");
}
assert.notEqual(client, sdk.createForumClient({ origin, transport }));
for (const unqualified of [
  `${origin}/forum.php?mod=forumdisplay&fid=2`,
  "https://other.test/forum.php?mod=viewthread&tid=9199345",
]) {
  assert.equal((await client.readThread(unqualified)).kind, "invalid");
}
assert.deepEqual(requests, []);
const { readThread } = client;
const result = await readThread(destination);
assert.deepEqual(requests, [
  {
    url: destination + "&tsdmapp=json",
    session: "fixture-member-31",
    fresh: true,
  },
]);
assert.equal(result.kind, "thread", result.message);
assert.deepEqual(result.account, {
  kind: "member",
  id: "31",
  name: "Member 31",
});
const { thread } = result;
assert.equal(thread.id, "9199345");
assert.equal(thread.url, destination);
assert.equal(
  thread.title,
  "[Rulebot multi fixture 20260930-101846] FID2 版規問答測試",
);
assert.deepEqual(thread.pages, { current: "1", links: [] });
const expected = [
  [
    "3938",
    "32",
    "ag_admin",
    "此主題僅供 Rulebot 1.1 多版塊隔離驗證，透過 Discuz 原生流程建立；驗證完畢保留測試證據。",
  ],
  ["3954", "33", "ag_mid", "NC984059ag_mid 粗體 廣告連結 紅字 @ag_low2"],
  ["3940", "31", "ag_low", "多版驗收怎麼算？"],
  ["3942", "35", "ag_low2", "此帖仅作者可见"],
  [
    "3950",
    "31",
    "ag_low",
    "NC650591ag_low 編輯 [\u200bi]斜體[\u200b/i] [\u200bsize=7]大字[\u200b/size]",
  ],
  ["3951", "33", "ag_mid", "NC650591ag_mid 粗體 廣告連結 紅字 @ag_low2"],
  ["3952", "31", "ag_low", "NC912001off 粗體"],
  [
    "3953",
    "31",
    "ag_low",
    "NC984059ag_low 編輯 [\u200bi]斜體[\u200b/i] [\u200bsize=7]大字[\u200b/size]",
  ],
  ["3955", "31", "ag_low", "NC048829off 粗體"],
];
const text = (node) =>
  node.kind === "text" ? node.text : node.children.map(text).join("");
const posts = thread.posts.map(
  ({ id, authorId, author, content, url, ...rest }) => {
    assert.equal(
      url,
      `${origin}/forum.php?mod=redirect&goto=findpost&ptid=9199345&pid=${id}`,
    );
    assert.equal(
      "rateURL" in rest || "reportURL" in rest || "redPacketThreadId" in rest,
      false,
    );
    return [
      id,
      authorId,
      author,
      content.map(text).join("").trim().replace(/\s+/g, " "),
    ];
  },
);
assert.deepEqual(posts, expected);
assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
console.log(
  JSON.stringify(
    {
      fixtureSha256,
      requests,
      thread: {
        id: thread.id,
        title: thread.title,
        page: thread.pages.current,
      },
      viewerId: result.account.id,
      posts,
    },
    null,
    2,
  ),
);
