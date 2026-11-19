import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createForumClient } from "tsdm-sdk";

const fixture = readFileSync(process.argv[2]);
const fixtureSHA256 = createHash("sha256").update(fixture).digest("hex");
assert.equal(
  fixtureSHA256,
  "4c315c9baa628790c74c0eed3c477cea13fc6ef961b4fe78cef8080a2e01e1b1",
);
const origin = "https://forum.test";
const inputs = [
  [
    '<iframe src="about:blank" data-src="//player.test/watch?a=1&amp;b=2"></iframe>',
    "video",
    "https://player.test/watch?a=1&b=2",
  ],
  [
    '<object><param name="movie" value="/video.swf"></object>',
    "video",
    origin + "/video.swf",
  ],
  [
    '<embed src="/dewplayer.swf" flashvars="son=https%3A%2F%2Fmusic.test%2Ftrack.mp3">',
    "audio",
    "https://music.test/track.mp3",
  ],
  ['<video><source src="/movie.mp4"></video>', "video", origin + "/movie.mp4"],
  ['<audio src="/listen"></audio>', "audio", origin + "/listen"],
  [
    '<script>detectPlayer("p", "mp3", "https://music.test/song", "1", "2");</script>',
    "audio",
    "https://music.test/song",
  ],
  [
    '<script>AC_FL_RunContent("src", "https://player.test/clip.swf")</script>',
    "video",
    "https://player.test/clip.swf",
  ],
  [
    '<object><embed src="/nested.swf"></object>',
    "video",
    origin + "/nested.swf",
  ],
  [
    "<blockquote>https://www.bilibili.com/video/BV123456789B</blockquote><span hidden>https://www.bilibili.com/video/BV123456789C</span>https://m.bilibili.com/video/BV123456789A?p=2",
    "video",
    "https://www.bilibili.com/video/BV123456789A/?p=2",
  ],
];
const unsafe =
  '<iframe hidden src="https://hidden.test/"></iframe><object data="javascript:void(0)"></object><audio src="https://name@other.test/"></audio><script>window.location="https://unused.test/"</script>';
const page = JSON.parse(fixture);
page.document = page.document.replace(
  'id="postmessage_3938">',
  'id="postmessage_3938">' + inputs.map(([html]) => html).join("") + unsafe,
);
const calls = [];
const client = createForumClient({
  origin,
  transport: {
    async request(url) {
      calls.push(url);
      return {
        url,
        status: 200,
        contentType: "application/json",
        redirect: "none",
        body: JSON.stringify(page),
      };
    },
  },
});
const result = await client.readThread(
  origin + "/forum.php?mod=viewthread&tid=9199345",
);
assert.equal(result.kind, "thread");
function destinations(nodes) {
  return nodes.flatMap((node) => [
    ...(node.kind === "unsupported" && node.media ? [node.media] : []),
    ...destinations(node.children ?? []),
  ]);
}
const observed = destinations(result.thread.posts[0].content);
const expected = inputs.map(([, kind, url]) => ({ kind, url }));
assert.deepEqual(observed, expected);
assert.equal(calls.length, 1);
console.log(
  JSON.stringify(
    { fixtureSHA256, requests: calls, expected, observed },
    null,
    2,
  ),
);
