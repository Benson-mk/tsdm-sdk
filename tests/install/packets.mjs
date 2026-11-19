import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPacketClient } from "tsdm-sdk";

const origin = "https://forum.test";
const results = [];
const fixture = (name) =>
  readFileSync(join(process.argv[2], "test/data", name), "utf8");
const packet = (name) => JSON.parse(fixture(`tsdmapp/hongbao/${name}.json`));
const html = (body, overrides = {}) => ({
  raw: true,
  body,
  contentType: "text/html",
  ...overrides,
});
const call = (method, path, query, fields = null) => [
  method,
  path,
  query,
  fields,
];
const plugin = (name, fields = {}) => ({ id: `hongbao:${name}`, ...fields });
function forum(replies, memberId = "1033") {
  const calls = [];
  const effects = [];
  let continuity = "first";
  const client = createPacketClient({
    origin,
    session: () => ({ memberId, continuity }),
    transport: {
      async request(url, request) {
        assert.equal(request.fresh, true);
        effects.push(request.effect);
        assert.deepEqual(request.session, { memberId, continuity });
        const target = new URL(url);
        assert.equal(target.origin, origin);
        calls.push(
          call(
            request.method,
            target.pathname,
            Object.fromEntries(target.searchParams),
            request.method === "POST"
              ? Object.fromEntries(new URLSearchParams(request.body))
              : null,
          ),
        );
        assert.ok(replies.length, "unexpected dispatch");
        const reply = replies.shift();
        if (reply instanceof Error) throw reply;
        return {
          url,
          status: 200,
          redirect: "none",
          contentType: "application/json",
          body: JSON.stringify(reply),
          ...(reply?.raw ? reply : {}),
        };
      },
    },
  });
  return {
    client,
    calls,
    effects,
    relogin: () => {
      continuity = "second";
    },
  };
}
function check(name, actual, expected) {
  assert.deepEqual(actual, expected, name);
  results.push({ name, expected, actual });
}
const openLive = {
  ok: true,
  tid: 1265042,
  from: "Fixture sender",
  bless: "Good luck",
  haspw: 0,
  cond: 0,
  appoint: 0,
  splitmode: 1,
  unit: "天使币",
  state: "open",
  is_sender: 0,
  mine: { claimed: 0 },
};
{
  const { client, calls } = forum([
    openLive,
    { ok: false, error: "這裡沒有紅包" },
  ]);
  const result = await client.open("1265042");
  const missing = await client.open("1265043");
  check(
    "opening exposes status and is distinct from claiming",
    [
      result.kind,
      result.threadId,
      result.state,
      result.blessing,
      result.requiresPassword,
      missing.kind,
      calls,
    ],
    [
      "packet-open",
      "1265042",
      "open",
      "Good luck",
      false,
      "packet-absent",
      [
        call("GET", "/plugin.php", plugin("open", { tid: "1265042" })),
        call("GET", "/plugin.php", plugin("open", { tid: "1265043" })),
      ],
    ],
  );
}
const structured = { tsdmapp: "json", nodoc: "1" };
const threadCall = (tid, lean = true) =>
  call("GET", "/forum.php", {
    mod: "viewthread",
    tid,
    ...(lean ? structured : {}),
  });
const pluginCall = (operation, query, fields) =>
  call(
    fields ? "POST" : "GET",
    "/plugin.php",
    plugin(operation, query),
    fields ?? null,
  );
const passwordThread = packet("thread_password_active");
const senderThread = packet("thread_sender_active");
const resultsFixture = packet("results");
const recordsFixture = packet("records");
{
  const { client, calls } = forum([
    passwordThread,
    resultsFixture.g_pw_success,
    {
      ...openLive,
      tid: 9202761,
      haspw: 1,
      state: "claimed",
      mine: { claimed: 1, amount: 1, best: 1 },
      unit: "威望",
    },
    recordsFixture.rec_denied,
  ]);
  const viewed = await client.readThreadPacket("9202761");
  const prepared = client.prepareClaim(viewed);
  const omitted = await client.submit(prepared.form);
  const result = await client.submit(prepared.form, "fixture-passphrase-33");
  const replay = await client.submit(prepared.form, "fixture-passphrase-33");
  const observed = await client.open("9202761");
  const records = await client.readRecords("9202761");
  check(
    "password claim, prior consent, single POST, separate observed share and denied records",
    [
      viewed.kind,
      viewed.packetId,
      viewed.canClaim,
      prepared.form.requiresPassword,
      omitted.kind,
      result,
      replay.kind,
      observed.mine,
      records.kind,
      calls,
    ],
    [
      "thread-packet",
      "102",
      true,
      true,
      "invalid-input",
      {
        kind: "claimed",
        operation: "claim",
        threadId: "9202761",
        packetId: "102",
        amount: "1",
        unit: "威望",
        best: true,
      },
      "invalid-input",
      { amount: "1", best: true },
      "refused",
      [
        threadCall("9202761"),
        pluginCall(
          "grab",
          { tsdmapp: "json" },
          {
            tid: "9202761",
            formhash: "f1f2f3f4",
            password: "fixture-passphrase-33",
          },
        ),
        pluginCall("open", { tid: "9202761" }),
        pluginCall("record", { tid: "9202761", ...structured }),
      ],
    ],
  );
}
{
  const { client, calls } = forum(
    [
      senderThread,
      resultsFixture.w_success,
      { ...openLive, tid: 9202754, state: "withdrawn", is_sender: 1 },
    ],
    "1031",
  );
  const viewed = await client.readThreadPacket("9202754");
  const result = await client.submit(client.prepareWithdrawal(viewed).form);
  const observed = await client.open("9202754");
  check(
    "sender withdrawal reports refunded amount and a separate read observes withdrawal",
    [viewed.canWithdraw, result, observed.state, calls],
    [
      true,
      {
        kind: "withdrawn",
        operation: "withdraw",
        threadId: "9202754",
        packetId: "100",
        refunded: "1",
      },
      "withdrawn",
      [
        threadCall("9202754"),
        pluginCall(
          "withdraw",
          { tsdmapp: "json" },
          { tid: "9202754", formhash: "f1f2f3f4" },
        ),
        pluginCall("open", { tid: "9202754" }),
      ],
    ],
  );
}
for (const [name, reply, kind, reason] of [
  ["incorrect phrase", resultsFixture.g_badpw, "refused", "badpw"],
  [
    "already claimed",
    { ...resultsFixture.g_already, uid: 1033 },
    "already-claimed",
    null,
  ],
  ["lost response", new Error("lost"), "unknown", null],
  [
    "unrelated callback",
    { ...resultsFixture.g_pw_success, handlekey: "hongbao_withdraw" },
    "unknown",
    null,
  ],
  [
    "redrawn form",
    {
      ...resultsFixture.g_pw_success,
      kind: "page",
      document: '<form action="plugin.php?id=hongbao:grab"></form>',
    },
    "redrawn",
    null,
  ],
]) {
  const { client, calls } = forum([passwordThread, reply]);
  const viewed = await client.readThreadPacket("9202761");
  const prepared = client.prepareClaim(viewed);
  const result = await client.submit(prepared.form, "fixture-passphrase-33");
  const replay = await client.submit(prepared.form, "fixture-passphrase-33");
  check(
    `${name} stays distinct and consumes the approval`,
    [
      result.kind,
      result.reason ?? null,
      result.threadId,
      replay.kind,
      calls.map((row) => row[0]),
    ],
    [kind, reason, "9202761", "invalid-input", ["GET", "POST"]],
  );
}
{
  const hostile = {
    ...passwordThread,
    special: {
      ...passwordThread.special,
      grab: {
        ...passwordThread.special.grab,
        action: "https://unrelated.test/plugin.php?id=hongbao:grab",
      },
    },
  };
  const { client, calls, relogin } = forum([hostile, passwordThread]);
  const foreign = client.prepareClaim(await client.readThreadPacket("9202761"));
  const view = await client.readThreadPacket("9202761");
  const forged = client.prepareClaim({ ...view });
  const prepared = client.prepareClaim(view);
  relogin();
  const stale = await client.submit(prepared.form, "fixture-passphrase-33");
  check(
    "foreign, forged and stale packet forms do not authorize an effect",
    [foreign.kind, forged.kind, stale.kind, calls],
    [
      "refused",
      "invalid-input",
      "session-changed",
      [threadCall("9202761"), threadCall("9202761")],
    ],
  );
}
{
  const { client, calls } = forum([recordsFixture.rec_sender_pw], "1035");
  const read = await client.readRecords("9202761");
  check(
    "structured records preserve packet target, total and share details",
    [
      read.kind,
      read.packetId,
      read.shares,
      read.claimed,
      read.complete,
      read.records.map(({ memberId, amount, best, epochSeconds }) => [
        memberId,
        amount,
        best,
        epochSeconds,
      ]),
      calls,
    ],
    [
      "packet-records",
      "102",
      3,
      1,
      true,
      [["1033", "1", true, 1794058956]],
      [pluginCall("record", { tid: "9202761", ...structured })],
    ],
  );
}
{
  const legacy = {
    ok: true,
    shares: 10,
    claimed: 1,
    unit: "天使币",
    recs: [
      { username: "Fixture member", time: "9-6 03:45", amount: 17, isbest: 1 },
    ],
  };
  const { client, calls } = forum([legacy]);
  const read = await client.readRecords("1265042");
  check(
    "legacy records keep server times and unknown member IDs without another request",
    [read.kind, read.records[0], calls],
    [
      "packet-records",
      {
        username: "Fixture member",
        memberId: null,
        amount: "17",
        best: true,
        epochSeconds: null,
        serverTime: "9-6 03:45",
      },
      [pluginCall("record", { tid: "1265042", ...structured })],
    ],
  );
}
{
  const page =
    html(`<script>var discuz_uid = '1033';</script><input type="hidden" name="formhash" value="abcd1234">
    <div class="hb-entry" data-tid="1265042"><div class="t1">Good luck</div></div>`);
  const { client, calls } = forum([
    { ok: 0, error: "off" },
    page,
    openLive,
    { ok: true, amount: 17, unit: "天使币", best: true, already: false },
  ]);
  const viewed = await client.readThreadPacket("1265042");
  const result = await client.submit(client.prepareClaim(viewed).form);
  check(
    "legacy marker and open status qualify a raw plugin claim but no withdrawal",
    [viewed.kind, viewed.canWithdraw, result.kind, result.amount, calls],
    [
      "thread-packet",
      false,
      "claimed",
      "17",
      [
        threadCall("1265042"),
        threadCall("1265042", false),
        pluginCall("open", { tid: "1265042" }),
        pluginCall(
          "grab",
          {},
          { tid: "1265042", formhash: "abcd1234", password: "" },
        ),
      ],
    ],
  );
}
const dailyConfig = {
  entry: 2,
  dateflag: "20260906",
  from: "Fixture daily",
  bless: "Good luck",
  unit: "天使币",
};
const dailyIndex = {
  ok: 1,
  type: "index",
  schema: 5,
  uid: 1033,
  formhash: "f1f2f3f4",
  red_packet: dailyConfig,
  checknewpm: "home.php?mod=spacecp&ac=pm&op=checknewpm&rand=4",
};
const homepage = (native = false) =>
  call("GET", "/forum.php", native ? {} : structured);
for (const [answer, expected, amount] of [
  [{ ok: true, amount: 5, unit: "天使币", redirect: "" }, "claimed", "5"],
  [
    { ok: false, already: 1, amount: 5, error: "今天已經領過囉,明天再來" },
    "already-claimed",
    "5",
  ],
  [{ ok: false, error: "Today unavailable" }, "refused", null],
  [new Error("lost"), "unknown", null],
]) {
  const { client, calls, effects } = forum([dailyIndex, answer]);
  const view = await client.readDaily();
  const prepared = client.prepareDaily(view);
  const result = await client.submit(prepared.form);
  const replay = await client.submit(prepared.form);
  check(
    `daily inspection and ${expected} are separate from homepage login-credit action`,
    [
      view.kind,
      view.day,
      view.unit,
      result.kind,
      result.amount ?? null,
      result.day,
      replay.kind,
      calls,
      effects,
    ],
    [
      "daily-packet",
      "20260906",
      "天使币",
      expected,
      amount,
      "20260906",
      "invalid-input",
      [homepage(), pluginCall("daily", {}, { formhash: "f1f2f3f4" })],
      [false, true],
    ],
  );
}
{
  const { client, calls } = forum(
    [
      { ok: 0, error: "off" },
      html(fixture("forum_index_x5.html")),
      { ok: true, amount: 5, unit: "天使币" },
    ],
    "1000",
  );
  const view = await client.readDaily();
  const outcome = await client.submit(client.prepareDaily(view).form);
  check(
    "daily native homepage literal config is read without executing scripts",
    [view.kind, view.day, outcome.kind, calls],
    [
      "daily-packet",
      "20260909",
      "claimed",
      [
        homepage(),
        homepage(true),
        pluginCall("daily", {}, { formhash: "XXXXXXXX" }),
      ],
    ],
  );
}
{
  const { client, calls } = forum([{ ...dailyIndex, red_packet: null }]);
  const view = await client.readDaily();
  check(
    "absent daily offer establishes unavailable rather than claimed",
    [view.kind, client.prepareDaily(view).kind, calls],
    ["daily-unavailable", "invalid-input", [homepage()]],
  );
}
const awardLink =
  "/plugin.php?id=tsdmbet:awardPacket&action=getaward&tid=1265042&awardid=11";
const awardQuery = {
  id: "tsdmbet:awardPacket",
  action: "getaward",
  tid: "1265042",
  awardid: "11",
};
{
  const table = html(
    '<table class="pure-table"><thead><tr><th>ID</th></tr></thead><tbody><tr>' +
      "<td>8</td><td>1033</td><td>Fixture member</td><td>17</td><td>2026-09-06 03:45:00</td></tr></tbody></table>",
  );
  const { client, calls, effects } = forum([table]);
  const detail = await client.readAwardDetails("1265042");
  check(
    "award detail table is a separate read with server wall time",
    [detail.kind, detail.threadId, detail.records, calls, effects],
    [
      "award-details",
      "1265042",
      [
        {
          id: "8",
          memberId: "1033",
          username: "Fixture member",
          coins: "17",
          serverTime: "2026-09-06 03:45:00",
        },
      ],
      [
        call("GET", "/plugin.php", {
          id: "tsdmbet:awardPacket",
          action: "showaward",
          tid: "1265042",
        }),
      ],
      [false],
    ],
  );
}
for (const [name, reply, expected] of [
  ["arrival", html("<main>Packet destination</main>"), "award-arrived"],
  [
    "plugin confirmation",
    html('<div id="messagetext" class="alert_right"><p>领取成功</p></div>'),
    "claimed",
  ],
  [
    "duplicate",
    html('<div id="messagetext" class="alert_info"><p>您已经领取过</p></div>'),
    "already-claimed",
  ],
  [
    "taken away",
    html(
      '<div id="messagetext" class="alert_error"><p>err_packet_has_gone_away</p></div>',
    ),
    "refused",
  ],
  [
    "failed success wording",
    html('<div id="messagetext" class="alert_error"><p>未领取成功</p></div>'),
    "refused",
  ],
  ["redirect", html("", { status: 302 }), "unknown"],
  ["response lost", new Error("gone"), "unknown"],
]) {
  const { client, calls, effects } = forum([reply]);
  const prepared = client.prepareAwardClaim("1265042", awardLink);
  const before = calls.length;
  const outcome = await client.submit(prepared.form);
  const replay = await client.submit(prepared.form);
  check(
    `award ${name} qualifies exact supplied destination and no automatic replay`,
    [
      prepared.form.destination,
      before,
      outcome.kind,
      outcome.effect ?? null,
      outcome.threadId,
      replay.kind,
      calls,
      effects,
    ],
    [
      origin + awardLink,
      0,
      expected,
      expected === "award-arrived" ? "unknown" : null,
      "1265042",
      "invalid-input",
      [call("GET", "/plugin.php", awardQuery)],
      [true],
    ],
  );
}
{
  const { client, calls } = forum([]);
  const forms = [
    client.prepareAwardClaim("1265042", "https://other.test" + awardLink),
    client.prepareAwardClaim("1265043", awardLink),
    client.prepareAwardClaim(
      "1265042",
      awardLink.replace("getaward", "showaward"),
    ),
    client.prepareAwardClaim("1265042", awardLink + "&tid=1265043"),
  ];
  check(
    "foreign, mismatched, duplicate or read-only award routes produce no GET",
    [forms.map((f) => f.kind), calls],
    [["invalid-input", "invalid-input", "invalid-input", "invalid-input"], []],
  );
}
const specials = packet("specials");
for (const [name, tid, state, problem] of [
  ["needreply", "9202762", "open", "needreply"],
  ["expired", "9202762", "expired", "expired"],
  ["closed", "9202756", "closed", "closed"],
  ["claimed_password", "9202761", "claimed", "claimed"],
  ["sender_withdrawn", "9202753", "withdrawn", "withdrawn"],
]) {
  const example = specials[name];
  const body = {
    ...example,
    ok: 1,
    type: "thread",
    schema: 18,
    thread: { tid: Number(tid), special: 127 },
  };
  const { client, calls } = forum([body], String(example.uid));
  const view = await client.readThreadPacket(tid);
  const claim = client.prepareClaim(view);
  const withdraw = client.prepareWithdrawal(view);
  check(
    `returned ${name} status cannot authorize claim or withdrawal`,
    [view.state, claim.kind, claim.reason, withdraw.kind, calls],
    [state, "refused", problem, "refused", [threadCall(tid)]],
  );
}
{
  const partial = {
    ...recordsFixture.rec_ok_9202752,
    records: recordsFixture.rec_ok_9202752.records.slice(0, 1),
  };
  const { client, calls } = forum(
    [partial, { ...partial, tid: 9202753 }],
    "1031",
  );
  const read = await client.readRecords("9202752");
  const mismatch = await client.readRecords("9202752");
  check(
    "credited row count may be partial and a mismatched target is rejected",
    [
      read.complete,
      read.records.length,
      read.claimed,
      mismatch.kind,
      calls.length,
    ],
    [false, 1, 3, "invalid-response", 2],
  );
}
{
  const native = html(
    `<script>var discuz_uid = '1033';</script>${fixture("red_packet_post_x5.html")}`,
  );
  const { client, calls } = forum([
    { ok: 0, error: "off" },
    native,
    { ...openLive, tid: 1264928, state: "done" },
  ]);
  const view = await client.readThreadPacket("1264928");
  check(
    "captured native packet marker still needs a fresh open result to qualify claim",
    [view.kind, view.state, client.prepareClaim(view).kind, calls],
    [
      "thread-packet",
      "done",
      "refused",
      [
        threadCall("1264928"),
        threadCall("1264928", false),
        pluginCall("open", { tid: "1264928" }),
      ],
    ],
  );
}
{
  const { client, calls } = forum([
    dailyIndex,
    new Error("lost"),
    { ...dailyIndex, red_packet: null },
  ]);
  const view = await client.readDaily();
  const result = await client.submit(client.prepareDaily(view).form);
  const observed = await client.readDaily();
  check(
    "daily loss and subsequent missing offer leave attribution unknown",
    [result.kind, observed.kind, calls],
    [
      "unknown",
      "daily-unavailable",
      [
        homepage(),
        pluginCall("daily", {}, { formhash: "f1f2f3f4" }),
        homepage(),
      ],
    ],
  );
}
{
  const { client, calls } = forum([
    dailyIndex,
    { ok: false, uid: 0, login: 1, already: 1, amount: 5 },
  ]);
  const view = await client.readDaily();
  const result = await client.submit(client.prepareDaily(view).form);
  check(
    "daily login refusal takes precedence over old claimed data",
    [result.kind, result.reason, calls.length],
    ["refused", "login", 2],
  );
}
console.log(JSON.stringify(results));
