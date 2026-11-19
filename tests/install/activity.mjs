import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createActivityClient } from "tsdm-sdk";

const upstream = process.argv[2];
const origin = "https://www.tsdm39.com";
const fixture = (file) =>
  readFileSync(join(upstream, "test/data", file), "utf8");
const v4 = (name) => `tsdmapp/v4/${name}.json`;
const results = [];
function check(name, actual, expected) {
  assert.deepEqual(actual, expected, name);
  results.push({ name, expected, actual });
}
const capabilityURL = origin + "/plugin.php?id=tsdmapp%3Aapi&action=status";
function journey(memberId, ...replies) {
  const capabilityCalls = [];
  const capabilities = {ok:1, uid:Number(memberId), v4:1, thread_lists:["ratings","poll_voters","thread_mod","payments"]};
  const requests = [];
  let continuity = "original";
  const client = createActivityClient({
    origin,
    session: () => ({ memberId, continuity }),
    transport: {
      async request(url, options) {
        if (url === capabilityURL) {
          capabilityCalls.push(url);
          assert.equal(options.method, "GET");
          return response(capabilities)(url);
        }
        requests.push({ url: new URL(url), ...options });
        assert.equal(options.fresh, true);
        assert.deepEqual(options.session, { memberId, continuity });
        assert.ok(replies.length, "unexpected request or retry");
        const make = replies.shift();
        return make(url, options);
      },
    },
  });
  return {
    client,
    requests, capabilityCalls, capabilities,
    drift: () => {
      continuity = "new";
    },
    end: () => assert.equal(replies.length, 0),
  };
}
const response =
  (value, contentType = "application/json") =>
  (url) => ({
    url,
    status: 200,
    redirect: "none",
    contentType,
    body: typeof value === "string" ? value : JSON.stringify(value),
  });
const replay = (file) =>
  response(
    fixture(file),
    file.endsWith(".xml") ? "text/xml" : "application/json",
  );

async function read(name, query, files, expected, project, routes) {
  const j = journey("31", ...files.map(replay));
  const actual = await j.client.readActivity(query);
  check(name, project(actual), expected);
  assert.equal(j.capabilityCalls.length, ["ratings","voters","moderation","payments"].includes(query.view) ? 1 : 0, name);
  check(
    `${name} requests`,
    j.requests.map(({ url, method, effect }) => [
      method,
      effect,
      url.pathname + url.search,
    ]),
    routes,
  );
  j.end();
}
const route = (path) => ["GET", false, "/forum.php?mod=misc&" + path];
const structured = "&tsdmapp=json&tsdmv=4&nodoc=1";
await read(
  "rating ledger",
  { view: "ratings", threadId: "9199193", postId: "3400" },
  [v4("ratings_v48")],
  ["ratings", 5, [-500, -500, -10, -9000, -50], 5],
  (r) => [r.kind, r.count, r.rows?.map((x) => x.score), r.totals?.length],
  [route("action=viewratings&tid=9199193&pid=3400" + structured)],
);
await read(
  "visible voters",
  { view: "voters", threadId: "1019", optionId: "3", page: 1 },
  [v4("voters_v49")],
  ["voters", "3", ["6", "7", "9", "11"], 10, 1, 1],
  (r) => [
    r.kind,
    r.optionId,
    r.rows?.map((x) => x.memberId),
    r.options?.length,
    r.page,
    r.pages,
  ],
  [route("action=viewvote&tid=1019&polloptionid=3&page=1" + structured)],
);
await read(
  "private voters",
  { view: "voters", threadId: "1019" },
  [v4("voters_v49_private")],
  ["refused", "thread_poll_nopermission"],
  (r) => [r.kind, r.code],
  [route("action=viewvote&tid=1019" + structured)],
);
await read(
  "moderation history",
  { view: "moderation", threadId: "9199453" },
  [v4("thread_mod_v50")],
  ["moderation", 63, false, "UDG", "32"],
  (r) => [
    r.kind,
    r.count,
    r.reasonsPublic,
    r.rows?.[0]?.action,
    r.rows?.[0]?.operator?.memberId,
  ],
  [route("action=viewthreadmod&tid=9199453" + structured)],
);
await read(
  "payments",
  { view: "payments", threadId: "9202665" },
  [v4("payments_v51")],
  ["payments", 7, "天使币", "35", 5],
  (r) => [
    r.kind,
    r.count,
    r.credit?.title,
    r.rows?.[0]?.memberId,
    r.rows?.[0]?.amount,
  ],
  [route("action=viewpayments&tid=9202665" + structured)],
);
await read(
  "warning history",
  { view: "warnings", threadId: "9199072", memberId: "31" },
  ["warning_log/staff.xml"],
  ["warnings", 2, "管理团队", "BU區警告46626"],
  (r) => [
    r.kind,
    r.rows?.length,
    r.rows?.[0]?.operator?.label,
    r.rows?.[0]?.reason,
  ],
  [route("action=viewwarning&tid=9199072&uid=31&inajax=1")],
);
await read(
  "warning empty",
  { view: "warnings", threadId: "9199072", memberId: "31" },
  ["warning_log/no_warning.xml"],
  ["warnings", 0],
  (r) => [r.kind, r.rows?.length],
  [route("action=viewwarning&tid=9199072&uid=31&inajax=1")],
);
await read(
  "additional comments",
  { view: "comments", threadId: "1234567", postId: "11263", page: 2 },
  ["post_comment/more_api.json"],
  ["comments", 2, 2, ["38", "37", "31"], 'CM測試 ag_t02 點評 & <tag> "q"'],
  (r) => [
    r.kind,
    r.page,
    r.pages,
    r.rows?.map((x) => x.memberId),
    r.rows?.[0]?.message,
  ],
  [
    route(
      "action=commentmore&tid=1234567&pid=11263&page=2&inajax=1&tsdmapp=json&tsdmform=1",
    ),
  ],
);
{
  const j = journey(
    "31",
    response({
      ok: 1,
      uid: 31,
      type: "ratings",
      schema: 48,
      tid: 9199193,
      pid: 3400,
    }),
    replay("tsdmapp/v4/ratings_v48_window.xml"),
  );
  const r = await j.client.readActivity({
    view: "ratings",
    threadId: "9199193",
    postId: "3400",
  });
  check(
    "one native read after missing rows",
    [r.kind, r.rows?.[0]?.score, j.requests.length],
    ["ratings", -500, 2],
  );
  j.end();
}

const formFile = (name) => `tsdmapp/form_v17_${name}.json`;
const writeFile = (name) => `tsdmapp/write_v13_${name}.json`;
const json = (file) => JSON.parse(fixture(file));
const threadURL = (tid) => `${origin}/forum.php?mod=viewthread&tid=${tid}`;
const effectTarget = (action, tid, pid) => ({
  action,
  threadURL: threadURL(tid),
  ...(pid ? { postId: pid } : {}),
});
const changeRoute = (action, tid, pid, fid) =>
  action === "report"
    ? `misc.php?mod=report&rtype=post&rid=${pid}&tid=${tid}&fid=${fid}`
    : `forum.php?mod=misc&action=${action}&tid=${tid}&pid=${pid}`;
function thread(memberId, tid, pid, action, allowed = 1) {
  const recommend = {
    shown: 1,
    can: allowed,
    add: { label: "Support", count: 3 },
    subtract: { label: "Oppose", count: 1 },
    urls: {
      add: `forum.php?mod=misc&action=recommend&do=add&tid=${tid}&hash=f1f2f3f4`,
      subtract: `forum.php?mod=misc&action=recommend&do=subtract&tid=${tid}&hash=f1f2f3f4`,
    },
  };
  return response({
    ok: 1,
    type: "thread",
    schema: 23,
    uid: Number(memberId),
    formhash: "f1f2f3f4",
    thread: { tid: Number(tid), fid: 7 },
    recommend,
    posts: pid
      ? [
          {
            pid: Number(pid),
            can: { [action]: allowed },
            urls: { [action]: changeRoute(action, tid, pid, 7) },
          },
        ]
      : [],
  });
}
async function opened(j, target) {
  const p = await j.client.prepareActivity(target);
  assert.equal(p.kind, "prepared", JSON.stringify(p));
  assert.ok(j.requests.every((r) => !r.effect));
  return p.prepared;
}
function effect(j) {
  const writes = j.requests.filter((r) => r.effect);
  assert.equal(writes.length, 1);
  return writes[0];
}
const rateTarget = effectTarget("rate", "9900001", "9910002");
const rateThread = thread("33", "9900001", "9910002", "rate");
const rateIntent = {
  action: "rate",
  scores: { score6: 12 },
  reason: "exact & reason",
  notify: false,
};
const rateReceipt = (name, extra = {}) =>
  response({
    ...json(writeFile(name)),
    uid: 33,
    url: "forum.php?mod=viewthread&tid=9900001",
    ...extra,
  });
{
  const j = journey(
    "33",
    rateThread,
    replay(formFile("rate")),
    rateReceipt("rate_ok"),
  );
  const p = await opened(j, rateTarget);
  check(
    "rate permission, remaining credits and default notification",
    p.rating,
    [
      {
        name: "score6",
        label: "精灵",
        minimum: -20,
        maximum: 100,
        remaining: 494,
        choices: [100, 88, 76, 64, 52, 40, 28, 16, 4, -8, -20],
      },
    ],
  );
  check(
    "rate invalid choice remains local",
    (
      await j.client.submitActivity(p, {
        ...rateIntent,
        scores: { score6: 101 },
      })
    ).kind,
    "invalid",
  );
  const r = await j.client.submitActivity(p, rateIntent),
    write = effect(j),
    fields = new URLSearchParams(write.body);
  check(
    "rate accepted",
    [
      r.kind,
      write.method,
      write.url.pathname + write.url.search,
      fields.get("score6"),
      fields.get("reason"),
      fields.has("sendreasonpm"),
      fields.get("tid"),
      fields.get("pid"),
    ],
    [
      "accepted",
      "POST",
      "/forum.php?mod=misc&action=rate&ratesubmit=yes&infloat=yes&inajax=1&tsdmapp=json",
      "12",
      "exact & reason",
      false,
      "9900001",
      "9910002",
    ],
  );
  check(
    "rate prepared action cannot dispatch twice",
    (await j.client.submitActivity(p, rateIntent)).kind,
    "invalid",
  );
  j.end();
}
{
  const j = journey(
    "33",
    rateThread,
    replay(formFile("rate")),
    rateReceipt("rate_dup", { url: "" }),
  );
  const r = await j.client.submitActivity(
    await opened(j, rateTarget),
    rateIntent,
  );
  check(
    "duplicate rate refusal",
    [r.kind, r.code, effect(j).method],
    ["refused", "thread_rate_duplicate", "POST"],
  );
  j.end();
}
{
  const j = journey("33", rateThread, replay(formFile("rate")), () => {
    throw Error("response lost");
  });
  const p = await opened(j, rateTarget),
    r = await j.client.submitActivity(p, rateIntent);
  check(
    "lost rate keeps supplied choices and dispatches once",
    [r.kind, r.intent, effect(j).method],
    ["unknown", rateIntent, "POST"],
  );
  check(
    "lost attempt cannot be replayed",
    (await j.client.submitActivity(p, rateIntent)).kind,
    "invalid",
  );
  j.end();
}
{
  const j = journey(
    "33",
    rateThread,
    response({ ...json(formFile("rate")), unsupported: ["captcha"] }),
  );
  const r = await j.client.prepareActivity(rateTarget);
  check(
    "unsupported rating form hands off safe thread",
    [r.kind, r.destination, j.requests.filter((q) => q.effect).length],
    ["handoff", rateTarget.threadURL + "#pid9910002", 0],
  );
  j.end();
}
{
  const j = journey("33", rateThread, replay(formFile("rate")));
  const p = await opened(j, rateTarget);
  j.drift();
  check(
    "same UID with a new session cannot dispatch",
    [
      (await j.client.submitActivity(p, rateIntent)).kind,
      j.requests.filter((r) => r.effect).length,
    ],
    ["session-changed", 0],
  );
  j.end();
}
const reportTarget = effectTarget("report", "9900001", "9910002");
const reportThread = thread("35", "9900001", "9910002", "report");
const reportIntent = {
  action: "report",
  message: "Reason exactly & <supplied>",
};
{
  const j = journey(
    "35",
    reportThread,
    replay(formFile("report")),
    replay(writeFile("report_ok")),
  );
  const p = await opened(j, reportTarget),
    r = await j.client.submitActivity(p, reportIntent),
    write = effect(j),
    fields = new URLSearchParams(write.body);
  check(
    "report accepted with supplied text and exact floor",
    [
      r.kind,
      write.method,
      write.url.pathname,
      fields.get("message"),
      fields.get("rid"),
      fields.get("fid"),
      p.reasons.length,
    ],
    ["accepted", "POST", "/misc.php", reportIntent.message, "9910002", "7", 5],
  );
  j.end();
}
{
  const j = journey(
    "35",
    reportThread,
    replay(formFile("report")),
    response({
      ok: 1,
      type: "result",
      schema: 13,
      kind: "page",
      uid: 35,
      document:
        '<form id="form_miscreport9910002"><textarea name="message"></textarea></form>',
    }),
  );
  const r = await j.client.submitActivity(
    await opened(j, reportTarget),
    reportIntent,
  );
  check(
    "redrawn report retains supplied text",
    [r.kind, r.intent, effect(j).method],
    ["redrawn", reportIntent, "POST"],
  );
  j.end();
}
const commentTarget = effectTarget("comment", "1234567", "11263");
const commentThread = thread("31", "1234567", "11263", "comment");
const commentIntent = {
  action: "comment",
  message: "Comment & 原文",
  items: { "commentitem[画质]": "4", "commentitem[剧情]": "" },
};
const commentForm = json("tsdmapp_380/comment_form_items.json");
const alignedCommentForm = response({
  ...commentForm,
  uid: 31,
  tid: 1234567,
  pid: 11263,
  submit: {
    ...commentForm.submit,
    url: commentForm.submit.url
      .replace("9199043", "1234567")
      .replace("3031", "11263"),
  },
});
{
  const j = journey(
    "31",
    commentThread,
    alignedCommentForm,
    replay("post_comment/comment_ok_api.json"),
  );
  const r = await j.client.submitActivity(
      await opened(j, commentTarget),
      commentIntent,
    ),
    write = effect(j),
    fields = new URLSearchParams(write.body);
  check(
    "comment accepted with explicit score and abstention",
    [
      r.kind,
      write.url.searchParams.get("pid"),
      fields.get("message"),
      fields.get("commentitem[画质]"),
      fields.get("commentitem[剧情]"),
    ],
    ["accepted", "11263", commentIntent.message, "4", ""],
  );
  j.end();
}
{
  const j = journey(
    "31",
    commentThread,
    alignedCommentForm,
    response({
      ...json("post_comment/comment_ok_api.json"),
      values: { tid: "1234567", pid: "11264" },
    }),
  );
  const r = await j.client.submitActivity(
    await opened(j, commentTarget),
    commentIntent,
  );
  check(
    "mismatched comment receipt remains unknown",
    [r.kind, r.intent, effect(j).method],
    ["unknown", commentIntent, "POST"],
  );
  j.end();
}
for (const [action, file, kind, code, delta] of [
  ["recommend", "recommend/result_add_succeed.json", "accepted", null, 1],
  ["subtract", "recommend/web_subtract_succeed.xml", "accepted", null, -1],
  [
    "recommend",
    "recommend/result_duplicate.json",
    "refused",
    "recommend_duplicate",
    null,
  ],
  [
    "recommend",
    "recommend/result_outoftimes.json",
    "refused",
    "recommend_outoftimes",
    null,
  ],
  ["subtract", "recommend/web_self_disallow.xml", "refused", "", null],
]) {
  const target = effectTarget(action, "1234567");
  const j = journey(
    "31",
    thread("31", "1234567", undefined, action),
    replay(file),
  );
  const r = await j.client.submitActivity(await opened(j, target), { action }),
    write = effect(j);
  check(
    `evaluation ${file}`,
    [
      r.kind,
      r.code ?? null,
      r.delta ?? null,
      write.method,
      write.url.searchParams.get("do"),
      write.url.searchParams.get("hash"),
    ],
    [
      kind,
      code,
      delta,
      "GET",
      action === "recommend" ? "add" : "subtract",
      "f1f2f3f4",
    ],
  );
  j.end();
}
{
  const j = journey("31", thread("31", "1234567", undefined, "recommend", 0));
  const r = await j.client.prepareActivity(
    effectTarget("recommend", "1234567"),
  );
  check(
    "disabled evaluation sends no effect",
    [r.kind, j.requests.length, j.requests[0].effect],
    ["refused", 1, false],
  );
  j.end();
}

for (const [view, threadId, fields, fixture, kind, expectedLength] of [
  ["voters", "1019", { optionId: "3" }, "voters_v49_window.xml", "voters", 4],
  ["moderation", "9199453", {}, "thread_mod_v50_window.xml", "moderation", 63],
  ["payments", "9202665", {}, "payments_v51_window.xml", "payments", 7],
]) {
  const j = journey("31", replay(`tsdmapp/v4/${fixture}`));
  const r = await j.client.readActivity({ view, threadId, ...fields });
  check(
    `native ${view} in same response`,
    [r.kind, r.rows?.length, j.requests.length],
    [kind, expectedLength, 1],
  );
  j.end();
}
for (const [file, page, length] of [
  ["comments_page2_member", 2, 3],
  ["comments_page3_past", 3, 0],
]) {
  const j = journey("31", replay(`tsdmapp_380/${file}.json`));
  const r = await j.client.readActivity({
    view: "comments",
    threadId: "9202819",
    postId: "11263",
    page,
  });
  check(
    `document-free comments page ${page}`,
    [r.kind, r.page, r.count, r.rows?.length, r.hasNext],
    ["comments", page, 8, length, false],
  );
  j.end();
}
{
  const j = journey("31", replay(v4("ratings_v48_none")));
  const r = await j.client.readActivity({
    view: "ratings",
    threadId: "9199193",
    postId: "3400",
  });
  check(
    "explicit empty rating ledger",
    [r.kind, r.count, r.rows?.length],
    ["ratings", 0, 0],
  );
  j.end();
}
{
  const j = journey("31", response({ ...json(v4("ratings_v48")), pid: 999 }));
  const r = await j.client.readActivity({
    view: "ratings",
    threadId: "9199193",
    postId: "3400",
  });
  check(
    "wrong read target ends without fallback",
    [r.kind, j.requests.length],
    ["invalid", 1],
  );
  j.end();
}
{
  const j = journey(
    "31",
    thread("31", "1264975", "77983792", "rate"),
    response(
      fixture("rate_window_x5.xml").replaceAll("XXXXXXXX", "f1f2f3f4"),
      "text/xml",
    ),
    replay("rate_submit_success_x5.xml"),
  );
  const p = await opened(j, effectTarget("rate", "1264975", "77983792"));
  const r = await j.client.submitActivity(p, {
    action: "rate",
    scores: { score2: 2 },
    reason: "Rate",
    notify: true,
  });
  check(
    "native rate form and success callback",
    [r.kind, new URLSearchParams(effect(j).body).get("sendreasonpm")],
    ["accepted", "on"],
  );
  j.end();
}
{
  const j = journey(
    "31",
    commentThread,
    replay("post_comment/window.xml"),
    replay("post_comment/comment_ok_api.json"),
  );
  const r = await j.client.submitActivity(await opened(j, commentTarget), {
    action: "comment",
    message: "Native form comment",
  });
  check(
    "native comment form",
    [r.kind, new URLSearchParams(effect(j).body).get("commentsubmit")],
    ["accepted", "true"],
  );
  j.end();
}
{
  const j = journey(
    "31",
    commentThread,
    alignedCommentForm,
    replay("post_comment/comment_flood_api.json"),
  );
  const r = await j.client.submitActivity(
    await opened(j, commentTarget),
    commentIntent,
  );
  check(
    "comment flood refusal",
    [r.kind, r.code, effect(j).method],
    ["refused", "post_flood_ctrl", "POST"],
  );
  j.end();
}
{
  const j = journey(
    "35",
    reportThread,
    replay(formFile("report")),
    response({
      ok: 1,
      type: "result",
      schema: 13,
      kind: "redirect",
      uid: 35,
      url: "forum.php?mod=viewthread&tid=9900001#pid9910002",
    }),
  );
  const r = await j.client.submitActivity(
    await opened(j, reportTarget),
    reportIntent,
  );
  check(
    "write continuation is a host handoff",
    [r.kind, r.effect, r.destination, effect(j).method],
    ["handoff", "unknown", reportTarget.threadURL + "#pid9910002", "POST"],
  );
  j.end();
}
{
  let j;
  j = journey(
    "35",
    reportThread,
    replay(formFile("report")),
    (url, options) => {
      j.drift();
      return replay(writeFile("report_ok"))(url, options);
    },
  );
  const r = await j.client.submitActivity(
    await opened(j, reportTarget),
    reportIntent,
  );
  check(
    "session drift after dispatch stays unknown",
    [r.kind, r.intent, effect(j).method],
    ["unknown", reportIntent, "POST"],
  );
  j.end();
}
{
  const j = journey("35", reportThread, replay(formFile("report")), (url) => ({
    ...response({})(url),
    status: 302,
    redirect: "opaque",
  }));
  const r = await j.client.submitActivity(
    await opened(j, reportTarget),
    reportIntent,
  );
  check(
    "opaque HTTP redirect stays unknown",
    [r.kind, j.requests.filter((q) => q.effect).length],
    ["unknown", 1],
  );
  j.end();
}
{
  const source = fixture("rate_submit_success_x5.xml");
  const document = source.split("<![CDATA[")[1].split("]]>")[0];
  const target = effectTarget("rate", "1264975", "77983792");
  const j = journey(
    "31",
    thread("31", "1264975", "77983792", "rate"),
    response(
      fixture("rate_window_x5.xml").replaceAll("XXXXXXXX", "f1f2f3f4"),
      "text/xml",
    ),
    response({
      ok: 1,
      type: "result",
      schema: 13,
      kind: "page",
      uid: 31,
      document,
    }),
  );
  const r = await j.client.submitActivity(await opened(j, target), {
    action: "rate",
    scores: { score2: 2 },
    reason: "Legacy",
    notify: false,
  });
  check(
    "schema 13 native rate callback",
    [r.kind, effect(j).method],
    ["accepted", "POST"],
  );
  j.end();
}
{
  const form = json(formFile("report"));
  const inputs = Object.entries(form.submit.fields)
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${name}" value="${value}">`,
    )
    .join("");
  const reportForm = `<root><![CDATA[<form method="post" id="form_miscreport9910002" action="misc.php?mod=report">${inputs}<textarea name="message"></textarea><button id="report_submit" type="submit" value="true">Report</button></form>]]></root>`;
  const receipt = `<root><![CDATA[<script>errorhandle_miscreport9910002('Report accepted', {});hideWindow('miscreport9910002');showDialog('Report accepted', 'right');</script>]]></root>`;
  const j = journey(
    "35",
    reportThread,
    response(reportForm, "text/xml"),
    response(receipt, "text/xml"),
  );
  const r = await j.client.submitActivity(
    await opened(j, reportTarget),
    reportIntent,
  );
  check(
    "native report dialog and exact recipient floor",
    [r.kind, r.message, new URLSearchParams(effect(j).body).get("rid")],
    ["accepted", "Report accepted", "9910002"],
  );
  j.end();
}
{
  const j = journey("31", response({ ...json(v4("voters_v49")), overt: 0 }));
  const r = await j.client.readActivity({ view: "voters", threadId: "1019" });
  check(
    "closed voter visibility is terminal",
    [r.kind, j.requests.length],
    ["refused", 1],
  );
  j.end();
}
for (const [query, file] of [
  [{view:"ratings",threadId:"9199193",postId:"3400"}, "ratings_v48_window.xml"],
  [{view:"voters",threadId:"1019",optionId:"3"}, "voters_v49_window.xml"],
  [{view:"moderation",threadId:"9199453"}, "thread_mod_v50_window.xml"],
  [{view:"payments",threadId:"9202665"}, "payments_v51_window.xml"],
]) {
  const j = journey("31", replay("tsdmapp/v4/"+file));
  j.capabilities.thread_lists = ["unrelated"];
  const result = await j.client.readActivity(query);
  check("only an advertised thread list selects v4: " + query.view,
    [result.kind, j.capabilityCalls, j.requests.map(r=>r.url.searchParams.has("tsdmv"))],
    [query.view,[capabilityURL],[false]]);
  j.end();
}
console.log(JSON.stringify(results));
