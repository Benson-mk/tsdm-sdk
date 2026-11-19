import {
  createForumClient,
  type ContentNode,
  type ForumTransport,
  type ThreadReadResult,
} from "tsdm-sdk";
// @ts-expect-error Historical write types are outside this installed contract.
import type { ThreadAttempt } from "tsdm-sdk";
// @ts-expect-error Historical runtime helpers are outside this installed contract.
import { postPermalink } from "tsdm-sdk";

declare const transport: ForumTransport;
const client = createForumClient({ origin: "https://forum.test", transport });
const read: Promise<ThreadReadResult> = client.readThread(
  "https://forum.test/forum.php?mod=viewthread&tid=9199345",
);
const board = await client.readBoard(
  "https://forum.test/forum.php?mod=forumdisplay&fid=2",
  { previews: true },
);
const homepage = await client.readHomepage();
if (board.kind === "board") void board.board.threads[0]?.preview;
if (homepage.kind === "homepage") void homepage.homepage.activities;
const result = await read;
if (result.kind === "thread") {
  const post = result.thread.posts[0];
  if (post) {
    const url: string = post.url;
    const nodes: readonly ContentNode[] = post.content;
    void [url, nodes];
    // @ts-expect-error An effect-specific target is outside the installed read contract.
    void post.reportURL;
  }
}
// @ts-expect-error The installed facade has the qualified public reads.
void client.readPage;
// @ts-expect-error A compiler configured without DOM types has no document global.
void document;
