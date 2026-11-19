import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createCreditsClient } from "tsdm-sdk";

const upstream = process.argv[2],
  origin = "https://forum.test";
const results = [];
const fixture = (name) =>
  readFileSync(join(upstream, "test/data", name), "utf8");
const app = (name) => JSON.parse(fixture(`tsdmapp/${name}.json`));
const answer =
  (value, extras = {}) =>
  (url) => ({
    url,
    status: 200,
    redirect: "none",
    contentType: typeof value === "string" ? "text/html" : "application/json",
    body: typeof value === "string" ? value : JSON.stringify(value),
    ...extras,
  });
function check(name, actual, expected) {
  assert.deepEqual(actual, expected, name);
  results.push({ name, actual, expected });
}
const capabilityURL = origin + "/plugin.php?id=tsdmapp%3Aapi&action=status";
function journey(memberId, ...replies) {
  const capabilityCalls=[];
  const capabilities={ ok:1, uid:Number(memberId), v4:1, credit_pages:["credit_base","usergroup_info"] };
  let continuity = "old";
  const calls = [];
  const client = createCreditsClient({
    origin,
    session: () => ({ memberId, continuity }),
    transport: {
      async request(url, opts) {
        assert.equal(new URL(url).origin, origin);
        assert.deepEqual(opts.session, { memberId, continuity });
        assert.equal(opts.fresh, true);
        if (url === capabilityURL) {
          capabilityCalls.push(url);
          assert.equal(opts.method, "GET");
          return answer(capabilities)(url);
        }
        calls.push({ url: new URL(url), ...opts });
        assert.ok(replies.length, "unexpected request or retry");
        return replies.shift()(url, opts);
      },
    },
  });
  return {
    client,
    calls, capabilityCalls, capabilities,
    drift: () => {
      continuity = "new";
    },
    done: () => assert.equal(replies.length, 0),
  };
}
const after = app("write_by_key/checkin_after");
const before = {
  ...after,
  checked_today: 0,
  can_checkin: 1,
  last_time: 1699900000,
};
const success = app("write_by_key/checkin_post"),
  again = app("write_by_key/checkin_post_again");
const checkinURL = "/plugin.php?id=tsdmapp%3Aapi&action=checkin";
const submission =
  "/plugin.php?id=dsu_paulsign%3Asign&operation=qiandao&infloat=1&inajax=1&tsdmapp=json";
const path = (call) => call.url.pathname + call.url.search;
const choice = { feeling: "kx", message: "Hello & 原文" };
async function prepared(j) {
  const r = await j.client.prepareCheckIn();
  assert.equal(r.kind, "checkin-ready", JSON.stringify(r));
  return r.form;
}
{
  const j = journey("31", answer(after));
  const r = await j.client.readAttendance();
  check(
    "attendance state is a read",
    [
      r.kind,
      r.checkedToday,
      r.canCheckIn,
      r.days,
      r.monthDays,
      r.dayStart,
      j.calls[0].method,
      path(j.calls[0]),
    ],
    ["attendance", true, false, 43, 12, 1699977600, "GET", checkinURL],
  );
  j.done();
}
{
  const j = journey("31", answer(before), answer(success), answer(after));
  const p = await prepared(j);
  const r = await j.client.submitCheckIn(p, choice);
  check(
    "check-in uses one deliberate plugin POST and verifies attendance",
    [
      r.kind,
      r.checkedToday,
      j.calls.map((c) => [c.method, path(c)]),
      Object.fromEntries(new URLSearchParams(j.calls[1].body)),
    ],
    [
      "checked-in",
      true,
      [
        ["GET", checkinURL],
        ["POST", submission],
        ["GET", checkinURL],
      ],
      {
        formhash: "f1f2f3f4",
        qdxq: "kx",
        qdmode: "1",
        todaysay: "Hello & 原文",
        fastreply: "1",
      },
    ],
  );
  check(
    "check-in preparation is one-use",
    (await j.client.submitCheckIn(p, choice)).kind,
    "invalid-input",
  );
  j.done();
}
{
  const j = journey("31", answer(before), answer(again), answer(after));
  const r = await j.client.submitCheckIn(await prepared(j), choice);
  check(
    "duplicate receipt is distinct",
    [r.kind, r.checkedToday, j.calls.filter((c) => c.method === "POST").length],
    ["already-checked", true, 1],
  );
  j.done();
}
{
  const j = journey("31", answer(before), answer(success), answer(before));
  const r = await j.client.submitCheckIn(await prepared(j), choice);
  check(
    "success wording with missing stored attendance stays unknown",
    [r.kind, r.choice, j.calls.length],
    ["unknown", choice, 3],
  );
  j.done();
}
{
  const j = journey(
    "31",
    answer(before),
    () => {
      throw Error("lost after dispatch");
    },
    answer(after),
  );
  const r = await j.client.submitCheckIn(await prepared(j), choice);
  check(
    "readback after a lost check-in observes attendance without attribution",
    [r.kind, r.checkedToday, j.calls.filter((c) => c.method === "POST").length],
    ["attendance-observed", true, 1],
  );
  j.done();
}
{
  const j = journey("31", answer(before));
  const p = await prepared(j);
  j.drift();
  check(
    "same UID new session cannot send a prepared check-in",
    [(await j.client.submitCheckIn(p, choice)).kind, j.calls.length],
    ["session-changed", 1],
  );
  j.done();
}
{
  const closed = {
    ...before,
    can_checkin: 0,
    window: { ...before.window, enabled: 1, open_now: 0 },
  };
  const j = journey("31", answer(closed));
  const r = await j.client.prepareCheckIn();
  check(
    "closed window offers no submission",
    [r.kind, j.calls.map((c) => c.method)],
    ["closed", ["GET"]],
  );
  j.done();
}
{
  const legacy =
    '<html><head><script>var discuz_uid = "31";</script></head><body><div id="qdmsgt">今天已签到</div><h1 class="mt">您今天已经签到过了或者签到时间还未开始</h1></body></html>';
  const j = journey("31", answer({ ok: 0, error: "action" }), answer(legacy));
  const r = await j.client.readAttendance();
  check(
    "native desk settles legacy status",
    [r.kind, r.checkedToday, j.calls.map(path)],
    ["attendance", true, [checkinURL, "/plugin.php?id=dsu_paulsign%3Asign"]],
  );
  j.done();
}
const balance = app("v4/g3_credit_base_v52"),
  month = app("credit_v12_checkin_month"),
  log = app("credit_v12_log_filter");
const baseURL = "/home.php?mod=spacecp&ac=credit&op=base";
const logURL = "/home.php?mod=spacecp&ac=credit&op=log";
const v4 = "&tsdmapp=json&tsdmv=4&nodoc=1";
const jsonMode = "&tsdmapp=json&nodoc=1";
{
  const j = journey("31", answer(balance));
  const r = await j.client.readCreditBalance();
  check(
    "document-free credits, recent changes and native credit-rules handoff",
    [
      r.kind,
      r.total?.value,
      r.credits?.[0],
      r.recent?.[0]?.id,
      r.rules?.kind,
      r.rules?.destination,
      path(j.calls[0]),
    ],
    [
      "credit-balance",
      2644,
      { id: "2", title: "天使币", unit: "", value: 1504 },
      "7950",
      "browser-handoff",
      origin + "/home.php?mod=spacecp&ac=credit&op=rule",
      baseURL + v4,
    ],
  );
  j.done();
}
{
  const j = journey(
    "31",
    answer({ ok: 0, error: "unsupported" }),
    answer(fixture("tsdmapp/v4/g3_credit_base_web.html")),
  );
  const r = await j.client.readCreditBalance();
  check(
    "legacy balance after one unsupported structured read",
    [
      r.kind,
      r.source,
      r.total?.value,
      r.credits?.[3],
      r.recent?.[0]?.date,
      j.calls.map(path),
    ],
    [
      "credit-balance",
      "native",
      2644,
      { title: "腹黑", value: -470 },
      "2026-11-13",
      [baseURL + v4, baseURL],
    ],
  );
  j.done();
}
{
  const j = journey("35", answer(log));
  const r = await j.client.readCreditLog({ direction: 1, operation: "PRC" });
  check(
    "credit filter echo, signed changes and pagination",
    [
      r.kind,
      r.query,
      r.count,
      r.page,
      r.pages,
      r.hasNext,
      r.rows?.length,
      r.rows?.[0]?.changes?.[0]?.value,
      r.filters?.operation?.some((x) => x.value === "PRC"),
      path(j.calls[0]),
    ],
    [
      "credit-log",
      {
        creditId: "0",
        direction: 1,
        operation: "PRC",
        start: "",
        end: "",
        page: 1,
      },
      22,
      1,
      2,
      true,
      20,
      5,
      true,
      logURL +
        "&exttype=0&income=1&optype=PRC&starttime=&endtime=&page=1" +
        jsonMode,
    ],
  );
  j.done();
}
{
  const j = journey("31", answer(month));
  const r = await j.client.readAttendanceCalendar("2026-11");
  check(
    "calendar covers inclusive monthly bounds and deduplicates rewards",
    [
      r.kind,
      r.start,
      r.end,
      r.days,
      r.complete,
      path(j.calls[0]),
      j.calls[0].method,
    ],
    [
      "attendance-calendar",
      "2026-11-01",
      "2026-11-30",
      ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-05", "2026-11-06"],
      true,
      logURL +
        "&exttype=0&income=0&optype=&starttime=2026-11-01&endtime=2026-11-30&page=1" +
        jsonMode,
      "GET",
    ],
  );
  j.done();
}
{
  const j = journey(
    "31",
    answer({ ...month, pages: 2, has_next: 1, count: 21 }),
    answer({ ok: 0, error: "busy", retry_after: 6 }, { status: 429 }),
  );
  const r = await j.client.readAttendanceCalendar("2026-11");
  check(
    "rate-limited continuation retains partial calendar",
    [
      r.kind,
      r.complete,
      r.days?.length,
      r.interruption?.kind,
      r.interruption?.retryAfterSeconds,
      j.calls.map((c) => c.url.searchParams.get("page")),
    ],
    ["attendance-calendar", false, 5, "rate-limited", 6, ["1", "2"]],
  );
  j.done();
}
{
  const altered = {
    ...month,
    query: { ...month.query, endtime: "2026-11-29" },
  };
  const j = journey("31", answer(altered));
  const rejected = await j.client.readCreditLog({
    start: "2026-11-01",
    end: "2026-11-30",
  });
  const badDay = await j.client.readCreditLog({
    start: "2026-02-29",
    end: "2026-02-28",
  });
  check(
    "altered and impossible date bounds are rejected",
    [rejected.kind, badDay.kind, j.calls.length],
    ["invalid-response", "invalid-input", 1],
  );
  j.done();
}
const overview = app("v4/g3_usergroup_v54"),
  detail = app("v4/g3_usergroup_v54_gid15"),
  expiry = app("form_v17_usergroup"),
  switchForm = app("form_v17_usergroup_switch");
const groupURL = "/home.php?mod=spacecp&ac=usergroup";
const expiryURL = groupURL + "&do=expiry&tsdmapp=json&tsdmform=1&nodoc=1";
const switchURL = groupURL + "&do=switch&groupid=22";
const switchGet =
  switchURL +
  "&handlekey=switchgrouphk&infloat=yes&inajax=1&tsdmapp=json&tsdmform=1";
const switchPost = switchURL + "&inajax=1&tsdmapp=json";
const switchSuccess = {
  ok: 1,
  uid: 35,
  type: "result",
  schema: 13,
  kind: "handle",
  handlekey: "switchgrouphk",
  message_key: "usergroups_switch_succeed",
  login: 0,
  alert: "right",
  message: "Switch accepted",
};
{
  const j = journey("31", answer(overview));
  const r = await j.client.readGroups();
  check(
    "group list preserves categories and active membership",
    [
      r.kind,
      r.current?.id,
      r.current?.credits,
      r.menus?.map((m) => [m.key, m.groups.length]),
      path(j.calls[0]),
    ],
    [
      "groups",
      "23",
      2644,
      [
        ["my", 1],
        ["upgrade", 7],
        ["user", 9],
        ["admin", 8],
      ],
      groupURL + v4,
    ],
  );
  j.done();
}
{
  const j = journey("31", answer(detail));
  const r = await j.client.readGroupDetail("15");
  check(
    "group detail is separate from actual current membership",
    [
      r.kind,
      r.current?.id,
      r.viewed?.id,
      r.viewed?.threshold,
      r.viewed?.remaining,
      r.viewed?.permissions?.length,
      path(j.calls[0]),
    ],
    ["groups", "23", "15", 3000, 356, 4, groupURL + "&gid=15" + v4],
  );
  j.done();
}
{
  const j = journey(
    "31",
    answer({ ok: 0, error: "action" }),
    answer(fixture("usergroup_progress/default_member_mid.html")),
  );
  const r = await j.client.readGroupProgress();
  check(
    "native progress reads the actual offered next tier",
    [
      r.kind,
      r.current?.id,
      r.current?.title,
      r.current?.credits,
      r.next?.id,
      r.next?.remaining,
      r.next?.threshold,
      j.calls.map(path),
    ],
    [
      "group-progress",
      "13",
      "高级会员",
      700,
      "14",
      300,
      1000,
      [groupURL + v4, groupURL],
    ],
  );
  j.done();
}
{
  const j = journey("31", answer(fixture("usergroup_progress/gid_15.html")));
  const r = await j.client.readGroupDetail("15");
  check(
    "same-response native group detail",
    [
      r.kind,
      r.source,
      r.viewed?.title,
      r.viewed?.remaining,
      r.viewed?.threshold,
      j.calls.length,
    ],
    ["groups", "native", "论坛元老", 2300, 3000, 1],
  );
  j.done();
}
async function openExpiry(j) {
  const r = await j.client.readGroupExpiry();
  assert.equal(r.kind, "group-expiry", JSON.stringify(r));
  return r;
}
async function openSwitch(j) {
  const listing = await openExpiry(j);
  const r = await j.client.prepareGroupSwitch(listing, "22");
  assert.equal(r.kind, "switch-ready", JSON.stringify(r));
  return r.form;
}
{
  const j = journey("35", answer(expiry));
  const r = await openExpiry(j);
  check(
    "expiry preserves date, balance and offered switch eligibility",
    [
      r.currentTitle,
      r.balance?.value,
      r.groups.map((g) => [g.id, g.expiry, g.expired, g.canSwitch]),
      r.expiredNotice,
      path(j.calls[0]),
      j.calls[0].method,
    ],
    [
      "AG低權組",
      1000,
      [
        ["22", "2023-11-25", false, true],
        ["20", "", false, false],
        ["24", "", false, true],
      ],
      true,
      expiryURL,
      "GET",
    ],
  );
  const refused = await j.client.prepareGroupSwitch(r, "20");
  check(
    "purchase-only group does not open a switch form",
    [refused.kind, j.calls.length],
    ["invalid-input", 1],
  );
  j.done();
}
{
  const j = journey(
    "35",
    answer(expiry),
    answer(switchForm),
    answer(switchSuccess),
  );
  const p = await openSwitch(j);
  check(
    "switch opening is a read with old and offered membership",
    [p.from, p.to, p.groupId, j.calls.map((c) => [path(c), c.method])],
    [
      "AG低權組",
      "字幕組",
      "22",
      [
        [expiryURL, "GET"],
        [switchGet, "GET"],
      ],
    ],
  );
  const r = await j.client.submitGroupSwitch(p);
  check(
    "switch uses returned destination and fields once",
    [
      r.kind,
      r.groupId,
      path(j.calls[2]),
      j.calls[2].method,
      Object.fromEntries(new URLSearchParams(j.calls[2].body)),
    ],
    [
      "switched",
      "22",
      switchPost,
      "POST",
      {
        referer: "https://www.tsdm39.com/./",
        groupsubmit: "true",
        gid: "",
        handlekey: "switchgrouphk",
        formhash: "f1f2f3f4",
        editsubmit_btn: "true",
      },
    ],
  );
  check(
    "switch approval cannot replay",
    (await j.client.submitGroupSwitch(p)).kind,
    "invalid-input",
  );
  j.done();
}
for (const [result, label, expected] of [
  [
    {
      ...switchSuccess,
      ok: 0,
      alert: "error",
      message_key: "usergroups_switch_denied",
    },
    "explicit switch refusal",
    "refused",
  ],
  [
    {
      ...switchSuccess,
      kind: "page",
      document:
        '<form method="post" action="home.php?mod=spacecp&ac=usergroup&do=switch&groupid=22"><input name="groupsubmit" value="true"></form>',
    },
    "redrawn switch form",
    "redrawn",
  ],
  [
    {
      ...switchSuccess,
      kind: "redirect",
      url: "home.php?mod=spacecp&ac=usergroup&do=expiry",
    },
    "continuation after switch",
    "switch-handoff",
  ],
  [null, "lost switch response", "unknown"],
]) {
  const j = journey(
    "35",
    answer(expiry),
    answer(switchForm),
    result
      ? answer(result)
      : () => {
          throw Error("lost switch response");
        },
  );
  const r = await j.client.submitGroupSwitch(await openSwitch(j));
  check(
    label,
    [r.kind, j.calls.filter((c) => c.method === "POST").length],
    [expected, 1],
  );
  j.done();
}
{
  const j = journey(
    "35",
    answer(expiry),
    answer({ ...switchForm, groupid: 24 }),
  );
  const e = await openExpiry(j),
    p = await j.client.prepareGroupSwitch(e, "22");
  check(
    "mismatched window cannot authorize switch",
    [p.kind, j.calls.length],
    ["invalid-response", 2],
  );
  j.done();
}
{
  const nativeBefore =
    '<html><head><script>var discuz_uid = "31";</script></head><body><div id="qdmsgt">今天未签到</div><form id="qiandao" method="post" action="plugin.php?id=dsu_paulsign%3Asign&amp;operation=qiandao"><input type="hidden" name="formhash" value="f1f2f3f4"><textarea name="todaysay"></textarea></form></body></html>';
  const nativeAfter = nativeBefore.replace("今天未签到", "今天已签到");
  const posted =
    '<?xml version="1.0"?><root><![CDATA[<div class="c" id="dsu_ps_msg">恭喜你签到成功！</div>]]></root>';
  const j = journey(
    "31",
    answer({ ok: 0, error: "off" }),
    answer(nativeBefore),
    answer(posted, { contentType: "text/xml" }),
    answer(nativeAfter),
  );
  const p = await prepared(j),
    r = await j.client.submitCheckIn(p, choice);
  check(
    "native check-in form and XML receipt qualify with native readback",
    [p.source, r.kind, r.checkedToday, j.calls.map((c) => [path(c), c.method])],
    [
      "native",
      "checked-in",
      true,
      [
        [checkinURL, "GET"],
        ["/plugin.php?id=dsu_paulsign%3Asign", "GET"],
        [submission, "POST"],
        ["/plugin.php?id=dsu_paulsign%3Asign", "GET"],
      ],
    ],
  );
  j.done();
}
{
  const j = journey(
    "31",
    answer(before),
    answer(success),
    answer({ ok: 0, error: "busy", retry_after: 4 }, { status: 429 }),
  );
  const r = await j.client.submitCheckIn(await prepared(j), choice);
  check(
    "rate-limited readback leaves check-in unknown and keeps advice",
    [
      r.kind,
      r.interruption?.kind,
      r.interruption?.retryAfterSeconds,
      j.calls.filter((c) => c.method === "POST").length,
    ],
    ["unknown", "rate-limited", 4, 1],
  );
  j.done();
}
{
  const j = journey(
    "31",
    answer(before),
    answer({
      ok: 0,
      type: "result",
      schema: 13,
      uid: 0,
      kind: "message",
      login: 1,
      message: "您需要先登录",
    }),
  );
  const r = await j.client.submitCheckIn(await prepared(j), choice);
  check(
    "explicit login refusal after POST ends without another request",
    [r.kind, r.code, j.calls.length],
    ["refused", "login", 2],
  );
  j.done();
}
{
  const expiryHtml =
    '<html><head><script>var discuz_uid = "35";</script></head><body><div id="ct"><p class="tbmu"><span class="xi1">1000 天使币</span>当前用户组: <font>AG低權組</font></p><input name="formhash" type="hidden" value="f1f2f3f4"><table class="dt"><tr><td><a href="home.php?mod=spacecp&amp;ac=usergroup&amp;gid=22">字幕組</a></td><td>免费</td><td>2023-11-25</td><td><a href="home.php?mod=spacecp&amp;ac=usergroup&amp;do=switch&amp;groupid=22&amp;handlekey=group">切换</a></td></tr></table></div></body></html>';
  const controls = Object.entries({
    ...switchForm.submit.fields,
    handlekey: "group",
  })
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${v}">`)
    .join("");
  const win = `<?xml version="1.0"?><root><![CDATA[<form method="post" action="${switchForm.submit.url.replaceAll("&", "&amp;")}">字幕組${controls}</form>]]></root>`;
  const done = `<?xml version="1.0"?><root><![CDATA[<script>succeedhandle_group('home.php?mod=spacecp&ac=usergroup','Switched',{});</script>]]></root>`;
  const j = journey(
    "35",
    answer({ ok: 0, error: "off" }),
    answer(expiryHtml),
    answer(win, { contentType: "text/xml" }),
    answer(done, { contentType: "text/xml" }),
  );
  const p = await openSwitch(j),
    r = await j.client.submitGroupSwitch(p);
  check(
    "native expiry, switch confirmation and X3 callback",
    [
      p.from,
      p.to,
      r.kind,
      Object.fromEntries(new URLSearchParams(j.calls[3].body)).handlekey,
      j.calls.map((c) => c.method),
    ],
    ["AG低權組", "字幕組", "switched", "group", ["GET", "GET", "GET", "POST"]],
  );
  j.done();
}
{
  const j = journey("35", answer(expiry), answer(switchForm));
  const p = await openSwitch(j);
  j.drift();
  const result = await j.client.submitGroupSwitch(p);
  check(
    "same UID re-login invalidates switch authority",
    [result.kind, j.calls.length],
    ["session-changed", 2],
  );
  j.done();
}
{
  const html =
    '<html><head><script>var discuz_uid = "31";</script></head><body><select id="exttype"><option value="0">全部</option></select><input id="starttime" value="2026-11-01"><input id="endtime" value="2026-11-30"><table class="dt"><tr><th>操作</th><th>积分变更</th><th>变更后</th><th>详情</th><th>变更时间</th></tr><tr><td>每日签到</td><td>天使币 +8</td><td>天使币 1398</td><td>随机奖励</td><td>2026-11-06 18:50:00</td></tr></table></body></html>';
  const j = journey("31", answer(html));
  const r = await j.client.readAttendanceCalendar("2026-11");
  check(
    "native history with unestablished pagination keeps observed day and partial coverage",
    [r.kind, r.days, r.complete, j.calls.length],
    ["attendance-calendar", ["2026-11-06"], false, 1],
  );
  j.done();
}
{
  const j = journey("35", answer({ ...expiry, do: "list" }));
  const r = await j.client.readGroupExpiry("list");
  check(
    "offered group list view is a separate read",
    [
      r.kind,
      r.view,
      r.groups?.length,
      j.calls[0].method,
      j.calls[0].url.searchParams.get("do"),
    ],
    ["group-expiry", "list", 3, "GET", "list"],
  );
  j.done();
}
for (const [method, file, kind] of [
  ["readCreditBalance","g3_credit_base_web.html","credit-balance"],
  ["readGroups","g3_usergroup_web.html","groups"],
]) {
  const j = journey("31", answer(fixture("tsdmapp/v4/"+file)));
  j.capabilities.credit_pages = ["unrelated"];
  const result = await j.client[method]();
  check("only an advertised credit page selects v4: " + method,
    [result.kind, result.source, j.capabilityCalls, j.calls.map(r=>r.url.searchParams.has("tsdmv"))],
    [kind,"native",[capabilityURL],[false]]);
  j.done();
}
console.log(JSON.stringify(results));
