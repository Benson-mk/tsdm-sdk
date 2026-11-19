import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createForumClient } from "tsdm-sdk";

const fixtureRoot = process.env.TSDM_READ_FIXTURES;
const pins = JSON.parse(
  readFileSync(new URL("./board-thread-pins.json", import.meta.url)),
);
const fixture = (name) => {
  const path = `${name.includes("/") ? name.replace(/^\.\//, "") : `tsdmapp/${name}`}`;
  const body = readFileSync(join(fixtureRoot, path), "utf8");
  assert.equal(
    createHash("sha256").update(body).digest("hex"),
    pins.files[path],
  );
  return body;
};
const json = (name) => JSON.parse(fixture(`${name}.json`));
const origin = "https://forum.test";
const board = (id, query = "") =>
  `${origin}/forum.php?mod=forumdisplay&fid=${id}${query}`;
const thread = (id, query = "") =>
  `${origin}/forum.php?mod=viewthread&tid=${id}${query}`;
const exact = (pid, tid) =>
  `${origin}/forum.php?mod=redirect&goto=findpost${tid ? `&ptid=${tid}` : ""}&pid=${pid}`;
const last = (id) => `${origin}/forum.php?mod=redirect&goto=lastpost&tid=${id}`;
const structured = { representation: "structured" };
const native = { representation: "native" };
const observations = [];
const visible = (nodes) =>
  nodes.map((n) => (n.kind === "text" ? n.text : visible(n.children))).join("");

function setup(name, ...answers) {
  const requests = [];
  const client = createForumClient({
    origin,
    transport: {
      async request(url, { fresh }) {
        assert.equal(fresh, true);
        const target = new URL(url);
        assert.equal(target.origin, origin);
        const request = { path: target.pathname, query: {} };
        for (const [key, value] of target.searchParams) {
          // Record which representation was dispatched without retaining the detector value.
          request.query[key] = key === "tsdmapp" ? "present" : value;
        }
        requests.push(request);
        const answer = answers.shift();
        assert.ok(answer, "no unplanned GET");
        const { body, ...options } = answer;
        return {
          status: 200,
          url,
          redirect: "none",
          contentType:
            typeof body === "string" ? "text/html" : "application/json",
          body: typeof body === "string" ? body : JSON.stringify(body),
          ...options,
        };
      },
    },
  });
  return {
    client,
    requests,
    done(result, observed) {
      assert.equal(answers.length, 0);
      assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
      observations.push({ name, observed, requests });
    },
  };
}
function resultOf(result, kind) {
  assert.equal(result.kind, kind, result.message);
  return result[kind];
}

{
  const run = setup("FID 12 document-free", { body: json("forum_v2_fid12") });
  const result = await run.client.readBoard(board(12), structured);
  const view = resultOf(result, "board");
  const ids = view.threads.map((row) => row.id);
  assert.deepEqual(
    ids,
    [
      9199945, 9199944, 9199943, 9199884, 9199882, 9199881, 9199868, 9199833,
      9199832, 9199831, 9199665, 9199648, 9199623, 9199607, 9199587, 9199572,
      9199553, 9199360, 9199355, 9199354,
    ].map(String),
  );
  assert.equal(view.title, "繪圖・插畫");
  assert.equal(view.pages.current, "1");
  assert.equal(view.pages.total, "10");
  assert.equal(result.account.id, "35");
  assert.equal(run.requests[0].query.nodoc, "1");
  run.done(result, {
    id: view.id,
    ids,
    page: view.pages.current,
    total: view.pages.total,
    viewer: result.account.id,
  });
}
{
  const run = setup(
    "Guest homepage, section, board, subforum link and returned thread",
    { body: json("index_v5_guest") },
    { body: json("index_v5_guest") },
    { body: json("forum_v2_fid2_guest") },
    { body: json("thread_v3_plain_guest") },
  );
  const result = await run.client.readHomepage(undefined, structured);
  const home = resultOf(result, "homepage");
  assert.equal(result.account.kind, "guest");
  assert.equal(home.groups.length, 5);
  const selected = await run.client.readHomepage(
    home.groups[0].sourceURL,
    structured,
  );
  const section = resultOf(selected, "homepage");
  assert.equal(section.groups.length, 1);
  const view = resultOf(
    await run.client.readBoard(section.groups[0].boards[0].url, structured),
    "board",
  );
  assert.equal(view.id, "2");
  assert.equal(view.boards[0].id, "15");
  const opened = await run.client.readThread(
    view.threads.find((row) => row.id === "9199345").url,
    structured,
  );
  const posts = resultOf(opened, "thread").posts;
  assert.equal(opened.account.kind, "guest");
  assert.deepEqual(
    posts.map((p) => p.id),
    [3938, 3954, 3940, 3942, 3950, 3951, 3952, 3953, 3955].map(String),
  );
  assert.equal(posts.find((p) => p.id === "3940").restriction, "locked");
  assert.match(visible(posts[2].content), /此帖仅作者可见/);
  assert.equal(posts[0].url, exact(3938, 9199345));
  run.done(opened, {
    groups: home.groups.length,
    board: view.id,
    subforum: view.boards[0].id,
    thread: opened.thread.id,
    posts: posts.map((p) => p.id),
    viewer: opened.account.kind,
  });
}
{
  const payload = json("thread_v3_long_p1");
  delete payload.posts[0].message;
  const run = setup("Ten structured posts with rendered content", {
    body: payload,
  });
  const result = await run.client.readThread(thread(1120), structured);
  const view = resultOf(result, "thread");
  assert.deepEqual(
    view.posts.map((p) => p.id),
    Array.from({ length: 10 }, (_, n) => String(100019 + n)),
  );
  assert.match(visible(view.posts[0].content), /本期年終獎申報/);
  assert.equal(view.parent.url, board(6));
  assert.equal(result.account.id, "35");
  run.done(result, {
    id: view.id,
    posts: view.posts.map((p) => p.id),
    viewer: result.account.id,
    rendered: true,
  });
}
for (const [name, url, fixtureName, page, total, expected] of [
  [
    "Board page wraps",
    board(11, "&page=23"),
    "forum_v2_282_beyond",
    "1",
    "18",
    "board",
  ],
  [
    "Thread page clamps",
    thread(1120, "&page=99"),
    "thread_v3_overpage",
    "31",
    "31",
    "thread",
  ],
  [
    "Reverse order",
    thread(1120, "&ordertype=1"),
    "thread_v3_long_reverse",
    "1",
    "31",
    "thread",
  ],
  [
    "Author filter",
    thread(1120, "&authorid=31"),
    "thread_v3_long_author",
    "1",
    "1",
    "thread",
  ],
]) {
  const run = setup(name, { body: json(fixtureName) });
  const result =
    expected === "board"
      ? await run.client.readBoard(url, structured)
      : await run.client.readThread(url, structured);
  const data = resultOf(result, expected);
  assert.equal(data.pages.current, page);
  assert.equal(data.pages.total, total);
  if (name === "Reverse order") {
    assert.equal(data.order, "descending");
    assert.deepEqual(
      data.posts.slice(0, 4).map((post) => post.id),
      ["100019", "4043", "100319", "100318"],
    );
  }
  if (name === "Author filter") {
    assert.equal(data.authorId, "31");
    assert.deepEqual(
      data.posts.map((post) => post.id),
      ["4043"],
    );
  }
  run.done(result, {
    current: page,
    total,
    order: data.order,
    authorId: data.authorId,
  });
}
{
  const filter = board(13, "&filter=typeid&typeid=3");
  const payload = json("forum_v2_fid13_type3");
  const run = setup(
    "Empty filter, missing list, and native fallback keeps criteria",
    { body: payload },
    { body: { ...payload, threads: undefined } },
    { body: "<p>Unavailable</p>" },
  );
  const result = await run.client.readBoard(filter, structured);
  const data = resultOf(result, "board");
  assert.deepEqual(data.threads, []);
  assert.equal(data.count, 0);
  assert.equal(data.query.typeid, "3");
  assert.ok(
    data.filters.some(
      (link) => new URL(link.url).searchParams.get("typeid") === "4",
    ),
  );
  const missing = await run.client.readBoard(filter, structured);
  assert.equal(missing.kind, "incomplete");
  assert.deepEqual(run.requests[2].query, {
    mod: "forumdisplay",
    fid: "13",
    filter: "typeid",
    typeid: "3",
  });
  run.done(result, { emptyCount: data.count, incomplete: missing.kind });
}
{
  const url = thread(9199345, "&page=1&ordertype=0");
  const legacy = JSON.parse(
    readFileSync(new URL("./thread_plain.json", import.meta.url)),
  );
  const run = setup(
    "Incomplete structured response falls back once",
    { body: { ...json("thread_v3_plain_guest"), posts: [] } },
    { body: legacy },
  );
  const result = await run.client.readThread(url, structured);
  const data = resultOf(result, "thread");
  assert.equal(data.posts.length, 9);
  assert.deepEqual(run.requests[1].query, {
    mod: "viewthread",
    tid: "9199345",
    page: "1",
    ordertype: "0",
  });
  run.done(result, { posts: data.posts.length });
}
{
  const legacy = JSON.parse(
    readFileSync(new URL("./thread_plain.json", import.meta.url)),
  );
  const run = setup("Usable legacy document from a generic error", {
    body: { ...legacy, ok: 0, error: "unknown" },
  });
  const result = await run.client.readThread(thread(9199345), structured);
  assert.equal(resultOf(result, "thread").posts.length, 9);
  run.done(result, { posts: 9 });
}
for (const [name, answer, kind] of [
  ["Login", { body: json("thread_v3_denied_guest") }, "login"],
  [
    "Permission",
    { body: "<div id=messagetext>抱歉，您没有权限访问该版块</div>" },
    "permission",
  ],
  [
    "Missing",
    { status: 404, body: "gone", contentType: "text/plain" },
    "missing",
  ],
  [
    "Rate limit",
    { status: 429, body: "slow down", contentType: "text/plain" },
    "limited",
  ],
  [
    "Challenge",
    { status: 403, body: "<title>Just a moment</title>" },
    "challenge",
  ],
]) {
  const run = setup(name, answer);
  const result = await run.client.readThread(thread(9199132), structured);
  assert.equal(result.kind, kind);
  run.done(result, kind);
}
{
  const payload = json("thread_v3_findpost");
  const landed = {
    body: payload,
    url: thread(1125, "&page=1#pid200010"),
    redirect: "followed",
  };
  const run = setup(
    "Exact PID, conflicting TID and opaque redirect",
    landed,
    landed,
    { body: "", status: 302, url: "", redirect: "opaque" },
  );
  const result = await run.client.readThread(exact(200010), structured);
  const data = resultOf(result, "thread");
  assert.equal(data.id, "1125");
  assert.equal(data.target, "200010");
  assert.equal(
    data.posts.find((post) => post.id === data.target).url,
    exact(200010, 1125),
  );
  const mismatch = await run.client.readThread(exact(200010, 1120), structured);
  assert.equal(mismatch.kind, "invalid");
  const handoff = await run.client.readThread(exact(200010), structured);
  assert.equal(handoff.kind, "document-navigation");
  assert.equal(handoff.destination, exact(200010));
  run.done(result, {
    thread: data.id,
    target: data.target,
    mismatch: mismatch.kind,
    handoff: handoff.destination,
  });
}
{
  const run = setup(
    "Last-post update, promoted occurrence and poll read data",
    {
      body: json("thread_v3_overpage"),
      url: thread(1120, "&page=31#pid4043"),
      redirect: "followed",
    },
    { body: json("thread_v15_282_hot") },
    { body: json("special_v15_poll_single_guest") },
  );
  const newest = await run.client.readThread(last(1120), structured);
  assert.equal(resultOf(newest, "thread").target, "4043");
  const hot = resultOf(
    await run.client.readThread(thread(9200647), structured),
    "thread",
  );
  assert.equal(hot.posts[2].id, "6742");
  assert.equal(hot.posts[2].promoted, true);
  const result = await run.client.readThread(thread(9200368), structured);
  const poll = resultOf(result, "thread").special;
  assert.equal(poll.type, "poll");
  assert.ok(poll.choices.length > 0);
  run.done(result, {
    latest: newest.thread.target,
    promoted: hot.posts[2].id,
    special: poll.type,
  });
}
{
  const url = board(8, "&orderby=dateline&forumdefstyle=yes");
  const run = setup(
    "Board monitoring reads newest subjects without preview fetches",
    { body: json("forum_watch_v2_fid8_before") },
    { body: json("forum_watch_v2_fid8_after") },
  );
  const before = resultOf(await run.client.readBoard(url, structured), "board");
  const next = await run.client.readBoard(url, structured);
  const after = resultOf(next, "board");
  assert.equal(before.query.orderby, "dateline");
  assert.equal(after.threads[0].id, "9202876");
  assert.equal(before.threads[0].id, "9202818");
  assert.equal(run.requests[0].query.tsdmpreview, undefined);
  run.done(next, { before: before.threads[0].id, after: after.threads[0].id });
}
{
  const url = board(13, "&filter=dateline&dateline=86400");
  const run = setup("Opt-in listing previews", {
    body: json("preview_v2_forum"),
  });
  const result = await run.client.readBoard(url, {
    ...structured,
    previews: true,
  });
  const view = resultOf(result, "board");
  assert.equal(run.requests[0].query.tsdmpreview, "1");
  assert.match(view.threads[0].preview.excerpt, /VIS_K01A_000000/);
  assert.equal(view.threads[0].preview.imageTotal, 4);
  assert.equal(
    view.threads.find((row) => row.id === "9990005").preview.reason,
    "password",
  );
  run.done(result, {
    firstPreview: view.threads[0].id,
    restrictedPreview: "password",
  });
}
{
  const url = board(2);
  const run = setup(
    "Native activities, board and legacy thread",
    { body: fixture("./activities_home_x5.html") },
    { body: fixture("tsdmapp/forum_fid2.html") },
    { body: fixture("tsdmapp/thread_plain.html") },
  );
  const home = resultOf(
    await run.client.readHomepage(undefined, native),
    "homepage",
  );
  assert.deepEqual(
    home.activities.map((item) => new URL(item.url).searchParams.get("tid")),
    [
      "906393",
      "1186692",
      "693531",
      "1092646",
      "1182918",
      "944494",
      "926985",
      "1170710",
      "1257827",
      "1196907",
      "1257292",
      "1257296",
      "1188016",
      "1262463",
      "1259113",
      "1235636",
      "1084274",
    ],
  );
  const view = resultOf(await run.client.readBoard(url, native), "board");
  assert.equal(view.threads.length, 20);
  const result = await run.client.readThread(thread(9199345), native);
  assert.equal(resultOf(result, "thread").posts.length, 9);
  assert.ok(
    run.requests.every((request) => !Object.hasOwn(request.query, "tsdmapp")),
  );
  run.done(result, {
    activities: home.activities.length,
    boardRows: view.threads.length,
    posts: result.thread.posts.length,
  });
}
{
  const payload = json("forum_v2_fid12");
  const malformed = { ...payload, threads: [null] };
  const unknown = {
    ...payload,
    uid: undefined,
    page: undefined,
    pages: undefined,
  };
  const run = setup(
    "Malformed rows, wrong board and unknown fields",
    { body: malformed },
    { body: "<p>Unavailable</p>" },
    { body: payload },
    { body: unknown },
  );
  assert.equal(
    (await run.client.readBoard(board(12), structured)).kind,
    "incomplete",
  );
  assert.equal(
    (await run.client.readBoard(board(2), structured)).kind,
    "invalid",
  );
  const result = await run.client.readBoard(board(12), structured);
  assert.equal(result.account.kind, "unknown");
  assert.equal(resultOf(result, "board").pages.current, "");
  assert.equal(result.board.pages.total, undefined);
  run.done(result, {
    rows: result.board.threads.length,
    viewer: result.account.kind,
    page: result.board.pages.current,
  });
}
{
  const payload = json("thread_v3_findpost");
  const run = setup(
    "Missing exact post and cross-origin redirect",
    { body: payload, url: thread(1125, "&page=1"), redirect: "followed" },
    {
      body: payload,
      url: "https://other.test/forum.php?mod=viewthread&tid=1125",
      redirect: "followed",
    },
  );
  const result = await run.client.readThread(exact(220000), structured);
  assert.equal(result.kind, "invalid");
  assert.equal(
    (await run.client.readThread(exact(200010), structured)).kind,
    "invalid",
  );
  run.done(result, { missingPid: result.kind, crossOrigin: "invalid" });
}
{
  const run = setup("Favorite boards from the homepage", {
    body: json("index_v5_favorites"),
  });
  const result = await run.client.readHomepage(undefined, structured);
  const home = resultOf(result, "homepage");
  assert.deepEqual(
    home.favoriteBoards.slice(0, 4).map((item) => item.id),
    ["15", "2", "26", "7"],
  );
  assert.equal(home.favoriteBoards[0].url, board(15));
  run.done(result, { favorites: home.favoriteBoards.map((item) => item.id) });
}
const specials = {
  activity_open_guest: ["activity", "PLACE_222088"],
  debate_open_guest: ["debate", "正方觀點 AFF_925316"],
  reward_open_guest: ["reward", 2],
  trade_guest: ["trade", 3],
};
for (const [name, key] of [
  ["activity_open_guest", "place"],
  ["debate_open_guest", "affirmpoint"],
  ["reward_open_guest", "price"],
  ["trade_guest", "count"],
]) {
  const body = json(`special_v15_${name}`);
  const run = setup(`Read ${name} special data`, { body });
  const result = await run.client.readThread(
    thread(body.thread.tid),
    structured,
  );
  const special = resultOf(result, "thread").special;
  assert.deepEqual([special.type, special.details[key]], specials[name]);
  assert.ok(!JSON.stringify(special).includes("formhash"));
  run.done(result, { type: special.type, [key]: special.details[key] });
}
console.log(
  JSON.stringify({ pin: pins.commit, fixtureSha256: pins.files, observations }),
);
