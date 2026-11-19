import assert from "node:assert/strict";
import { createForumClient } from "tsdm-sdk";

const [deployment, boardId] = process.argv.slice(2);
assert.ok(
  deployment && /^[1-9]\d*$/.test(boardId ?? ""),
  "Usage: node check-live-guest.ts https://forum.example BOARD_ID",
);
const origin = new URL(deployment).origin;
assert.equal(deployment, origin);
assert.equal(new URL(origin).protocol, "https:");

const requests: { url: string; status: number }[] = [];
const client = createForumClient({
  origin,
  transport: {
    async request(url, { fresh }) {
      const target = new URL(url);
      assert.equal(target.origin, origin);
      assert.equal(target.pathname, "/forum.php");
      assert.equal(
        target.searchParams.get("mod"),
        requests.length === 0 ? "forumdisplay" : "viewthread",
      );
      assert.ok(requests.length < 2);
      const response = await fetch(url, {
        method: "GET",
        credentials: "omit",
        cache: fresh ? "no-store" : "default",
        redirect: "manual",
        signal: AbortSignal.timeout(20_000),
      });
      requests.push({ url, status: response.status });
      const redirect = response.status >= 300 && response.status < 400;
      return {
        status: response.status,
        url: response.url,
        contentType: response.headers.get("content-type") ?? "",
        body: redirect ? "" : await response.text(),
        redirect: redirect ? "opaque" : "none",
      };
    },
  },
});

const listing = await client.readBoard(
  `${origin}/forum.php?mod=forumdisplay&fid=${boardId}`,
  { representation: "native" },
);
assert.equal(
  listing.kind,
  "board",
  "message" in listing ? listing.message : undefined,
);
assert.notEqual(listing.account.kind, "member");
assert.equal(listing.board.id, boardId);
const row = listing.board.threads.find(
  (item) => !item.moved && !item.restriction,
);
assert.ok(row, "The board returned no eligible thread");
const opened = await client.readThread(row.url, { representation: "native" });
assert.equal(
  opened.kind,
  "thread",
  "message" in opened ? opened.message : undefined,
);
assert.notEqual(opened.account.kind, "member");
assert.equal(opened.thread.id, row.id);
assert.ok(opened.thread.posts.length > 0);
assert.equal(requests.length, 2);
console.log(
  JSON.stringify(
    {
      observedAt: new Date().toISOString(),
      origin,
      board: listing.board.id,
      thread: opened.thread.id,
      rows: listing.board.threads.length,
      session: "signed-out",
      boardViewer: listing.account.kind,
      threadViewer: opened.account.kind,
      posts: opened.thread.posts.length,
      requests,
    },
    null,
    2,
  ),
);
