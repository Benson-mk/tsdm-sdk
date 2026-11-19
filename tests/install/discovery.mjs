import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createForumClient } from "tsdm-sdk";

const origin = "https://www.tsdm39.com";
const root = process.env.TSDM_DISCOVERY_FIXTURES;
const pins = JSON.parse(
  readFileSync(new URL("discovery-pins.json", import.meta.url)),
);
const inputs = new Set();
const observations = {};
const url = (path) => new URL(path, origin).href;
const app = (path) => {
  const target = new URL(path, origin);
  target.searchParams.set("tsdmapp", "json");
  return target.href;
};

function journey(steps) {
  const requests = [];
  const client = createForumClient({
    origin,
    transport: {
      async request(target, options) {
        const step = steps[requests.length];
        requests.push({ url: target, fresh: options.fresh });
        assert.ok(step, `Unexpected GET ${target}`);
        const [expected, input, optionsForResponse = {}] = step;
        assert.equal(target, url(expected));
        assert.deepEqual(options, { fresh: true });
        let body = input;
        let contentType = "application/json";
        if (typeof input === "string") {
          body = readFileSync(resolve(root, input), "utf8");
          assert.equal(
            createHash("sha256").update(body).digest("hex"),
            pins[input],
          );
          inputs.add(input);
          if (input.endsWith(".html")) contentType = "text/html";
          if (input.endsWith(".xml")) contentType = "text/xml";
        }
        return {
          status: 200,
          url: target,
          contentType,
          redirect: "none",
          body: typeof body === "string" ? body : JSON.stringify(body),
          ...optionsForResponse,
        };
      },
    },
  });
  return {
    client,
    done() {
      assert.equal(requests.length, steps.length);
      return requests;
    },
  };
}

const guide = (view) => `/forum.php?mod=guide&view=${view}`;
for (const [view, count, first] of [
  ["index", 0, undefined],
  ["hot", 5, "9199670"],
  ["digest", 0, undefined],
  ["new", 50, "9199961"],
  ["newthread", 50, "9199970"],
  ["sofa", 50, "9199970"],
  ["my", 50, "9199982"],
]) {
  const path = guide(view);
  const { client, done } = journey([
    [app(path), `tsdmapp/guide_v7_${view}.json`],
  ]);
  const result = await client.readGuide(path);
  assert.equal(result.kind, "guide");
  assert.equal(result.view, view);
  assert.equal(result.account.id, "35");
  assert.equal(result.rows.length, count);
  assert.equal(result.rows[0]?.id, first);
  if (view === "index") {
    assert.deepEqual(
      result.modules.map((module) => [module.view, module.more]),
      ["hot", "digest", "new", "newthread"].map((name) => [
        name,
        url(guide(name)),
      ]),
    );
    assert.equal(result.modules[0].rows[0].id, "9199670");
  }
  if (view === "new") assert.equal(result.nextURL, url(`${path}&page=2`));
  if (view === "my") assert.equal(result.pages.total, undefined);
  observations[`guide:${view}`] = {
    view,
    count,
    first,
    page: result.pages.current,
    next: result.nextURL,
    requests: done(),
  };
}
{
  const path = `${guide("my")}&type=reply`;
  const { client, done } = journey([
    [app(path), "tsdmapp/guide_v7_my_reply.json"],
    [app(guide("my")), "tsdmapp/guide_v7_guest_my.json"],
    [app(guide("new")), "guide_new_x5.html"],
    [app(`${guide("new")}&page=2`), "tsdmapp/guide_v7_new_p2.json"],
  ]);
  const replies = await client.readGuide(path);
  assert.equal(replies.rows[0].postId, "4719");
  assert.equal(
    replies.rows[0].url,
    url("/forum.php?mod=redirect&goto=findpost&ptid=9199982&pid=4719"),
  );
  assert.equal((await client.readGuide(guide("my"))).kind, "login");
  const legacy = await client.readGuide(guide("new"));
  assert.equal(legacy.kind, "guide");
  assert.equal(
    legacy.rows[0].url,
    url("/forum.php?mod=viewthread&tid=1264837&extra="),
  );
  assert.equal(legacy.nextURL, url(`${guide("new")}&page=2`));
  const next = await client.readGuide(legacy.nextURL);
  assert.equal(next.rows[0].id, "9199896");
  observations.guideContinuation = {
    reply: replies.rows[0].url,
    guest: "login",
    native: legacy.rows[0].url,
    page: next.pages.current,
    requests: done(),
  };
}

const search = "/search.php?mod=forum";
const searchSubmission = `${search}&srchtxt=%E7%BD%91%E7%9B%98&searchsubmit=yes`;
const searchResult = `${search}&searchid=1&orderby=lastpost&ascdesc=desc&searchsubmit=yes`;
{
  const { client, done } = journey([
    [app(search), "tsdmapp/search_v6_form.json"],
    [
      app(searchSubmission),
      "tsdmapp/search_v6_results.json",
      { url: url(app(searchResult)), redirect: "followed" },
    ],
    [app(`${searchResult}&page=2`), "tsdmapp/search_v6_p2.json"],
    [
      app(`${searchResult}&page=3`),
      { ok: 0, uid: 35, message: "搜索结果已过期" },
    ],
  ]);
  const form = await client.openSearch();
  assert.equal(form.kind, "document-navigation");
  assert.equal(form.destination, url(search));
  const first = await client.submitSearch({ keyword: "网盘" });
  assert.equal(first.kind, "search");
  assert.equal(first.searchId, "1");
  assert.equal(first.sourceURL, url(searchResult));
  assert.equal(first.count, 211);
  assert.equal(first.rows.length, 20);
  assert.equal(first.rows[0].id, "9199879");
  assert.equal(first.nextURL, url(`${searchResult}&page=2`));
  const second = await client.continueSearch(first);
  assert.equal(second.kind, "search");
  assert.equal(second.pages.current, "2");
  assert.equal(second.rows[0].id, "9199821");
  assert.equal((await client.continueSearch(second)).kind, "expired");
  observations.search = {
    form: form.destination,
    searchId: first.searchId,
    count: first.count,
    page1: first.rows[0].id,
    page2: second.rows[0].id,
    continuationRefusal: "expired",
    requests: done(),
  };
}
{
  const path = `${search}&srchtxt=%E6%B8%AC%E8%A9%A6&orderby=replies&ascdesc=asc&searchsubmit=yes`;
  const { client, done } = journey([[app(path), "search_filtered_x5.html"]]);
  const result = await client.submitSearch({
    keyword: "測試",
    orderBy: "replies",
    ascending: true,
  });
  assert.equal(result.kind, "search");
  assert.equal(result.searchId, "4");
  assert.equal(result.count, 54);
  assert.equal(
    result.rows[0].url,
    url("/forum.php?mod=viewthread&tid=9199401&highlight=%E6%B8%AC%E8%A9%A6"),
  );
  assert.equal(
    result.nextURL,
    url(
      `${search}&searchid=4&orderby=replies&ascdesc=asc&searchsubmit=yes&page=2`,
    ),
  );
  observations.nativeSearch = {
    searchId: result.searchId,
    firstURL: result.rows[0].url,
    next: result.nextURL,
    requests: done(),
  };
}
{
  const input = JSON.parse(
    readFileSync(resolve(root, "tsdmapp/search_v6_empty.json"), "utf8"),
  );
  const empty = { ...input, keyword: "no matches" };
  assert.equal(
    createHash("sha256")
      .update(readFileSync(resolve(root, "tsdmapp/search_v6_empty.json")))
      .digest("hex"),
    pins["tsdmapp/search_v6_empty.json"],
  );
  inputs.add("tsdmapp/search_v6_empty.json");
  const path = `${search}&srchtxt=no+matches&searchsubmit=yes`;
  const { client, done } = journey([
    [app(path), empty],
    [app(path), { ok: 0, uid: 35, message: "搜索过于频繁" }],
  ]);
  const result = await client.submitSearch({ keyword: "no matches" });
  assert.equal(result.kind, "search");
  assert.equal(result.count, 0);
  assert.deepEqual(result.rows, []);
  assert.equal(result.nextURL, null);
  assert.equal(
    (await client.submitSearch({ keyword: "no matches" })).kind,
    "throttle",
  );
  observations.emptySearch = {
    count: result.count,
    refusal: "throttle",
    requests: done(),
  };
}

{
  const continuation = `${searchResult}&page=2`;
  const otherOrder = continuation.replace("orderby=lastpost", "orderby=views");
  const { client, done } = journey([
    [app(searchSubmission), "tsdmapp/search_v6_results.json"],
    [app(continuation), "tsdmapp/search_v6_p2.json"],
    [
      app(continuation),
      "tsdmapp/search_v6_p2.json",
      { url: app(otherOrder), redirect: "followed" },
    ],
    [
      app(continuation),
      "tsdmapp/search_v6_p2.json",
      {
        url: app(continuation.replace("searchid=1", "searchid=8")),
        redirect: "followed",
      },
    ],
  ]);
  const first = await client.submitSearch({ keyword: "网盘" });
  assert.equal(first.kind, "search");
  assert.equal(
    (
      await client.continueSearch(
        first,
        "https://elsewhere.example/search.php?mod=forum&searchid=1",
      )
    ).kind,
    "invalid",
  );
  const second = await client.continueSearch(first);
  assert.equal(second.kind, "search");
  assert.ok(
    second.pages.links.some(
      (item) => item.url === url(`${searchResult}&page=1`),
    ),
  );
  assert.equal((await client.continueSearch(first)).kind, "invalid");
  assert.equal((await client.continueSearch(first)).kind, "invalid");
  observations.searchScope = {
    previous: second.pages.links.find((item) => item.label === "1").url,
    invalidOrder: "invalid",
    invalidId: "invalid",
    requests: done(),
  };
}

const activity = "/home.php?mod=space&do=thread&view=me";
const own = `${activity}&type=thread`;
const other = `${activity}&uid=31&type=reply`;
const drafts = `${own}&filter=save`;
{
  const { client, done } = journey([
    [app(own), "tsdmapp/mythread_v9_thread.json"],
    [app(`${own}&page=2`), "tsdmapp/mythread_v9_thread_p2.json"],
    [app(other), "tsdmapp/mythread_v9_other_reply.json"],
    [app(drafts), "tsdmapp/mythread_v9_draft.json"],
    [app(`${drafts}&page=2`), "tsdmapp/mythread_v9_draft_empty.json"],
    [app(other), "tsdmapp/mythread_v9_reply.json"],
    [app(own), "tsdmapp/mythread_v9_guest.json"],
    [
      app(`${activity}&uid=31&type=thread&fid=10`),
      {
        api: 1,
        ok: 1,
        uid: 35,
        type: "mythread",
        schema: 9,
        owner: { uid: 31, username: "member" },
        self: 0,
        view: "me",
        kind: "thread",
        filter: "",
        fid: 10,
        page: 1,
        pages: 0,
        has_next: 1,
        hidden: 0,
        threads: [{ tid: 7, pid: 0, fid: 10, subject: "Filtered" }],
      },
    ],
  ]);
  const threads = await client.readMemberActivity(own);
  assert.equal(threads.kind, "member-activity");
  assert.deepEqual(threads.owner, { id: "35", name: "ag_low2" });
  assert.equal(threads.rows.length, 20);
  assert.equal(threads.pages.total, undefined);
  assert.equal(threads.nextURL, url(`${own}&page=2`));
  const next = await client.readMemberActivity(threads.nextURL);
  assert.equal(next.rows[0].id, "9199876");
  const reply = await client.readMemberActivity(other);
  assert.equal(reply.kind, "member-activity");
  assert.equal(reply.account.id, "35");
  assert.equal(reply.owner.id, "31");
  assert.equal(reply.scope.kind, "reply");
  assert.equal(reply.hidden, 4);
  assert.equal(
    reply.rows[0].url,
    url("/forum.php?mod=redirect&goto=findpost&ptid=9199341&pid=3925"),
  );
  assert.equal(reply.nextURL, url(`${other}&page=2`));
  const saved = await client.readMemberActivity(drafts, { viewerId: "35" });
  assert.equal(saved.kind, "member-activity");
  assert.equal(saved.scope.kind, "draft");
  assert.equal(saved.rows[0].id, "9199982");
  assert.equal(saved.rows.length, 1);
  const empty = await client.readMemberActivity(`${drafts}&page=2`, {
    viewerId: "35",
  });
  assert.equal(empty.kind, "member-activity");
  assert.deepEqual(empty.rows, []);
  assert.equal(empty.nextURL, null);
  assert.equal((await client.readMemberActivity(other)).kind, "invalid");
  assert.equal((await client.readMemberActivity(own)).kind, "login");
  const filtered = await client.readMemberActivity(
    `${activity}&uid=31&type=thread&fid=10`,
  );
  assert.equal(filtered.scope.boardId, "10");
  assert.equal(
    filtered.nextURL,
    url(`${activity}&uid=31&type=thread&fid=10&page=2`),
  );
  observations.memberActivity = {
    own: threads.owner,
    page2: next.rows[0].id,
    replyOwner: reply.owner,
    hidden: reply.hidden,
    reply: reply.rows[0].url,
    draftIds: saved.rows.map((row) => row.id),
    emptyPage: empty.pages.current,
    wrongOwner: "invalid",
    guest: "login",
    filteredNext: filtered.nextURL,
    requests: done(),
  };
}

{
  const member = `${activity}&uid=1103&type=reply`;
  const next = `${member}&page=2`;
  const native = `<script>var discuz_uid = '35';</script><body>
    <div class="tl"><form id="delform"><table>
    <tr class="th"><th>Topics</th></tr>
    <tr class="bw0_all"><th><a href="forum.php?mod=viewthread&amp;tid=125&amp;from=member">Example</a></th>
      <td><a href="forum.php?mod=forumdisplay&amp;fid=4">Test forum</a></td></tr>
    <tr><td class="xg1"><a href="forum.php?mod=redirect&amp;goto=findpost&amp;ptid=125&amp;pid=1250#pid1250">Example reply</a></td></tr>
    </table></form></div><div class="pg"><strong>1</strong><a class="nxt" href="${next}">Next</a></div></body>`;
  const { client, done } = journey([
    [app(member), {}, { contentType: "text/html", body: native }],
    [
      app(member),
      {
        api: 1,
        ok: 1,
        type: "mythread",
        document: native.replace(/<script>.*?<\/script>/, ""),
      },
    ],
    [
      app(drafts),
      {
        api: 1,
        ok: 1,
        uid: 35,
        type: "mythread",
        document: "<div id='wp'>Unsupported layout</div>",
      },
    ],
  ]);
  const reply = await client.readMemberActivity(member);
  assert.equal(reply.kind, "member-activity");
  assert.equal(reply.account.id, "35");
  assert.deepEqual(reply.owner, { id: "1103", name: null });
  assert.equal(
    reply.rows[0].url,
    url("/forum.php?mod=redirect&goto=findpost&ptid=125&pid=1250#pid1250"),
  );
  assert.equal(reply.rows[0].summary, "Example reply");
  assert.equal(reply.nextURL, url(next));
  const wrapped = await client.readMemberActivity(member);
  assert.equal(wrapped.kind, "member-activity");
  assert.equal(wrapped.account.kind, "unknown");
  assert.equal(wrapped.rows[0].postId, "1250");
  const handoff = await client.readMemberActivity(drafts, { viewerId: "35" });
  assert.equal(handoff.kind, "document-navigation");
  assert.equal(handoff.destination, url(drafts));
  observations.legacyActivity = {
    owner: reply.owner,
    reply: reply.rows[0].url,
    next: reply.nextURL,
    envelopeViewer: wrapped.account,
    handoff: handoff.destination,
    requests: done(),
  };
}

const ranks = "/misc.php?mod=ranklist";
const rank = (type, view) => `${ranks}&type=${type}&view=${view}`;
const rankingCases = [
  ["member", "credit", "ranklist/member_credit_x5.html", "31", "2085118"],
  ["member", "post", "ranklist/member_post_x5.html", "31", "1041482"],
  [
    "member",
    "onlinetime",
    "ranklist/member_onlinetime_x5.html",
    "35",
    "11160 分钟",
  ],
  ["thread", "heats", "ranklist/thread_heats_x5.html", "1001", "88"],
  ["thread", "replies", "ranklist/thread_replies_x5.html", "1001", "301"],
  ...[
    ["views", "120"],
    ["favtimes", "23"],
  ].map(([view, value]) => [
    "thread",
    view,
    {},
    "72",
    value,
    {
      contentType: "text/html",
      body: `<div class="tl"><table><tr><td class="icn">1</td><th><a href="forum.php?mod=viewthread&amp;tid=72&amp;from=rank">Example</a></th><td>${value}</td></tr></table></div>`,
    },
  ]),
];
for (const [type, view, input, id, value, native] of rankingCases) {
  const path = rank(type, view);
  const { client, done } = journey([[path, input, native]]);
  const result = await client.readRankings(path);
  assert.equal(result.kind, "rankings");
  assert.equal(result.scope.type, type);
  assert.equal(result.scope.view, view);
  assert.equal(result.rows[0].id, id);
  assert.equal(result.rows[0].value, value);
  assert.equal(result.rows[0].rank, 1);
  if (view === "heats")
    assert.deepEqual(
      result.rows.map((row) => row.rank),
      [1, 2, 4],
    );
  if (native)
    assert.equal(
      result.rows[0].url,
      url("/forum.php?mod=viewthread&tid=72&from=rank"),
    );
  observations[`rankings:${view}`] = {
    first: result.rows[0],
    ranks: result.rows.map((row) => row.rank),
    requests: done(),
  };
}
{
  const path = rank("thread", "views");
  const { client, done } = journey([[path, "ranklist/thread_closed_x5.html"]]);
  const result = await client.readRankings(path);
  assert.equal(result.kind, "permission");
  observations.rankingClosed = { kind: result.kind, requests: done() };
}

const tag = "/misc.php?mod=tag";
{
  const { client, done } = journey([
    [tag, "tag/tag_cloud_x5.html"],
    [`${tag}&id=2`, "tag/tag_threads_preview_x5.html"],
    [`${tag}&id=15&type=thread`, "tag/tag_threads_page1_x5.html"],
    [`${tag}&id=15&type=thread&page=2`, "tag/tag_threads_page2_x5.html"],
  ]);
  const cloud = await client.readTags();
  assert.equal(cloud.kind, "tags");
  assert.equal(cloud.tags.length, 14);
  const lossless = cloud.tags.find((item) => item.id === "2");
  assert.deepEqual(lossless, {
    id: "2",
    label: "无损",
    count: 3,
    url: url(`${tag}&id=2`),
  });
  const preview = await client.readTags(lossless.url);
  assert.equal(preview.kind, "tag");
  assert.equal(preview.tagId, "2");
  assert.equal(preview.rows[0].id, "9199411");
  assert.equal(preview.moreURL, url(`${tag}&id=2&type=thread`));
  const first = await client.readTags(`${tag}&id=15&type=thread`);
  assert.equal(first.rows.length, 20);
  assert.equal(first.nextURL, url(`${tag}&id=15&type=thread&page=2`));
  const second = await client.readTags(first.nextURL);
  assert.equal(second.kind, "tag");
  assert.equal(second.tagId, "15");
  assert.equal(second.pages.current, "2");
  assert.equal(second.rows.length, 5);
  assert.equal(second.rows[0].id, "1134");
  assert.equal(second.nextURL, null);
  assert.ok(
    second.pages.links.some(
      (entry) => entry.url === url(`${tag}&id=15&type=thread&page=1`),
    ),
  );
  observations.tags = {
    count: cloud.tags.length,
    lossless,
    preview: preview.rows[0].id,
    more: preview.moreURL,
    firstPageCount: first.rows.length,
    secondPageCount: second.rows.length,
    firstOnPage2: second.rows[0].id,
    requests: done(),
  };
}

const stat = "/misc.php?mod=stat";
const statPath = (op) => `${stat}&op=${op}`;
const statsCases = [
  [stat, "site_stats/basic.html", "基本概况", "会员统计"],
  [statPath("forumstat"), "site_stats/forumstat.html", "版块统计"],
  [
    `${statPath("forumstat")}&fid=7&month=2026-11`,
    "site_stats/forumstat_fid.html",
    "版块统计日志 - 神作殿堂 - 2026-11",
  ],
  [statPath("team"), "site_stats/team.html", "管理团队"],
  [statPath("modworks"), "site_stats/modworks.html", "管理统计 - 全体管理人员"],
  [statPath("memberlist"), "site_stats/memberlist.html", "会员列表"],
];
for (const [path, input, title, firstTable] of statsCases) {
  const { client, done } = journey([[path, input]]);
  const result = await client.readStatistics(path);
  assert.equal(result.kind, "statistics");
  assert.equal(result.title, title);
  assert.ok(result.tables.length > 0);
  if (firstTable) assert.equal(result.tables[0].title, firstTable);
  if (path === stat)
    assert.ok(
      result.links.some((entry) => entry.url === url(statPath("trend"))),
    );
  if (path.includes("fid=7")) {
    assert.equal(result.trendURL, null);
    assert.equal(result.dailyTrend.labels[0], "2026-11-01");
    assert.ok(
      result.links.some(
        (entry) =>
          entry.url === url(`${statPath("forumstat")}&fid=7&month=2026-08`),
      ),
    );
  }
  if (path.endsWith("memberlist"))
    assert.equal(result.nextURL, url(`${path}&srchmem=&order=&asc=&page=2`));
  if (path.endsWith("modworks"))
    assert.ok(result.tables[0].rows[0].some((cell) => cell.text === "编辑"));
  observations[`statistics:${path}`] = {
    title,
    tables: result.tables.length,
    cellsInFirstRow: result.tables[0].rows[0].length,
    next: result.nextURL,
    dailyFirstDate: result.dailyTrend?.labels[0],
    requests: done(),
  };
}
{
  const page = statPath("trend");
  const xml = `${page}&xml=1&type=all&primarybegin=2026-10-11&primaryend=2026-11-10`;
  const { client, done } = journey([
    [page, "site_stats/trend.html"],
    [xml, "site_stats/trend.xml"],
    [page, "site_stats/guest.html"],
    [statPath("modworks"), "site_stats/no_permission.html"],
    [
      xml,
      {},
      {
        contentType: "text/xml",
        body: "<chart><xaxis><value xid='1'>1011</value></xaxis><graphs><graph gid='0' title='Incomplete'></graph></graphs></chart>",
      },
    ],
  ]);
  const stats = await client.readStatistics(page);
  assert.equal(stats.kind, "statistics");
  assert.equal(stats.trendURL, url(xml));
  const trend = await client.readTrend(stats);
  assert.equal(trend.kind, "trend");
  assert.equal(trend.sourceURL, url(xml));
  assert.equal(trend.labels.length, 30);
  assert.equal(trend.labels[0], "10-11");
  assert.equal(trend.labels.at(-1), "11-10");
  assert.equal(trend.series.length, 5);
  assert.equal(trend.series[0].title, "登录用户");
  assert.deepEqual(
    [trend.series[0].values[0], trend.series[0].values.at(-1)],
    [14, 27],
  );
  assert.equal((await client.readStatistics(page)).kind, "login");
  assert.equal(
    (await client.readStatistics(statPath("modworks"))).kind,
    "permission",
  );
  assert.equal(
    (
      await client.readTrend({
        ...stats,
        trendURL: "https://elsewhere.example/misc.php?mod=stat&xml=1",
      })
    ).kind,
    "invalid",
  );
  assert.equal((await client.readTrend(stats)).kind, "incomplete");
  observations.trend = {
    destination: stats.trendURL,
    labels: trend.labels.length,
    series: trend.series.length,
    first: trend.series[0].values[0],
    last: trend.series[0].values.at(-1),
    guest: "login",
    restricted: "permission",
    malformed: "incomplete",
    requests: done(),
  };
}

{
  const { explore } = await import("./discovery-guide.ts");
  const searchPath = `${search}&searchid=1&orderby=lastpost&ascdesc=desc&searchsubmit=yes&page=2`;
  const statsPath = "/misc.php?mod=stat&op=trend";
  const trendPath = `${statsPath}&xml=1&type=all&primarybegin=2026-10-11&primaryend=2026-11-10`;
  const { client, done } = journey([
    [app(guide("index")), "tsdmapp/guide_v7_index.json"],
    [app(guide("hot")), "tsdmapp/guide_v7_hot.json"],
    [app(search), "tsdmapp/search_v6_form.json"],
    [app(searchSubmission), "tsdmapp/search_v6_results.json"],
    [app(searchPath), "tsdmapp/search_v6_p2.json"],
    [app(own), "tsdmapp/mythread_v9_thread.json"],
    [app(other), "tsdmapp/mythread_v9_other_reply.json"],
    [app(drafts), "tsdmapp/mythread_v9_draft.json"],
    [rank("member", "credit"), "ranklist/member_credit_x5.html"],
    [rank("thread", "heats"), "ranklist/thread_heats_x5.html"],
    [tag, "tag/tag_cloud_x5.html"],
    [
      `${tag}&id=14`,
      {},
      {
        contentType: "text/html",
        body: `<div id="ct"><h1 class="mt">标签: 2026新番</h1><div class="bm tl"><table><tr><td class="icn"></td><th><a href="forum.php?mod=viewthread&amp;tid=72">Example</a></th></tr></table></div></div>`,
      },
    ],
    [statsPath, "site_stats/trend.html"],
    [trendPath, "site_stats/trend.xml"],
  ]);
  const results = await explore(client, "网盘", "31", "35");
  assert.equal(results.hot?.kind, "guide");
  assert.equal(results.form.kind, "document-navigation");
  assert.equal(results.next?.kind, "search");
  assert.equal(results.next.pages.current, "2");
  assert.equal(results.threads.kind, "member-activity");
  assert.equal(results.replies.rows[0].postId, "3925");
  assert.equal(results.drafts.rows[0].id, "9199982");
  assert.equal(results.members.rows[0].id, "31");
  assert.equal(results.rankedThreads.rows[0].id, "1001");
  assert.equal(results.tag?.tagId, "14");
  assert.equal(results.trend?.labels.length, 30);
  observations.packagedExample = {
    searchPage: results.next.pages.current,
    tag: results.tag.tagId,
    trendPoints: results.trend.labels.length,
    requests: done(),
  };
}

console.log(
  JSON.stringify({
    inputs: Object.fromEntries(
      [...inputs].sort().map((name) => [name, pins[name]]),
    ),
    observations,
  }),
);
