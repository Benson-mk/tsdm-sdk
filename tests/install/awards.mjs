import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createAwardsClient } from "tsdm-sdk";

const origin = "https://forum.test";
const medal = "dsu_medalCenter:memcp";
const title = "tsdmtitle:tsdmtitle";
const results = [];
const fixture = (fields, uid = 35) => ({ ok: 1, installed: 1, uid, ...fields });
const form = (id, action, fields = {}) => ({
  url: `plugin.php?id=${id}&action=${action}`,
  fields: { formhash: "abcd1234", ...fields },
});
const plugin = (id, query = {}) => ["/plugin.php", { id, ...query }];
const api = (action, query = {}) => plugin("tsdmapp:api", { action, ...query });
const post = (id, action, fields, key = "action") => [
  "POST",
  ...plugin(id, { [key]: action, tsdmapp: "json" }),
  fields,
];
const get = (route) => ["GET", ...route, null];
const html = (body) => ({ body, contentType: "text/html" });
function forum(replies, memberId = "35") {
  const calls = [];
  let continuity = "first";
  const client = createAwardsClient({
    origin,
    session: () => ({ memberId, continuity }),
    transport: {
      async request(url, options) {
        assert.equal(options.fresh, true);
        assert.deepEqual(options.session, { memberId, continuity });
        const route = new URL(url);
        assert.equal(route.origin, origin);
        calls.push([
          options.method,
          route.pathname,
          Object.fromEntries(route.searchParams),
          options.method === "POST"
            ? Object.fromEntries(new URLSearchParams(options.body))
            : null,
        ]);
        assert.ok(replies.length, "unexpected request");
        const reply = replies.shift();
        if (reply instanceof Error) throw reply;
        return {
          url,
          status: 200,
          redirect: "none",
          contentType: "application/json",
          body: JSON.stringify(reply),
          ...(reply?.contentType ? reply : {}),
        };
      },
    },
  });
  return {
    client,
    calls,
    relogin: () => {
      continuity = "second";
    },
  };
}
function check(name, actual, expected) {
  assert.deepEqual(actual, expected, name);
  results.push({ name, expected, actual });
}
const query = { typeid: 3, filter: "all", sort: "order", q: "Event", page: 2 };
const medals = fixture({
  query: { ...query, pages: 2 },
  types: [{ typeid: 3, name: "Event" }],
  medals: [
    {
      id: 101,
      name: "Event medal",
      owned: 0,
      pending: 0,
      price_text: "300 credits",
      conds: [],
      actions: [
        {
          method: 5,
          credit: 2,
          label: "Buy",
          ok: true,
          confirm: "Spend 300 credits?",
        },
      ],
    },
    { id: 102, name: "Pending medal", owned: 0, pending: 1, actions: [] },
  ],
  claim_form: form(medal, "claim", { dsumcsubmit: "1" }),
});
{
  const { client, calls } = forum([medals]);
  const view = await client.read("medals", { typeid: 3, q: "Event", page: 2 });
  check(
    "medal catalogue keeps category, search, page, pending state and purchase terms",
    [
      view.kind,
      view.records.map(({ id, name, pending, price_text }) => ({
        id,
        name,
        pending,
        price_text,
      })),
      view.metadata.query.pages,
      calls,
    ],
    [
      "awards-view",
      [
        { id: 101, name: "Event medal", pending: 0, price_text: "300 credits" },
        { id: 102, name: "Pending medal", pending: 1, price_text: undefined },
      ],
      2,
      [
        get(
          api("medals", {
            typeid: "3",
            filter: "all",
            sort: "order",
            q: "Event",
            page: "2",
          }),
        ),
      ],
    ],
  );
}
const ack = html(
  '<div id="messagetext" class="alert_right"><p>操作成功</p></div>',
);
const pending = html(
  '<div id="messagetext" class="alert_info"><p>申请已提交，等待审核</p></div>',
);
const ownedMedals = fixture({
  medals: [{ id: 11, name: "Shown", hidden: 0 }],
  log: { page: 1, pages: 1, items: [{ id: 1, medalid: 11, kind: "bought" }] },
  hide_form: form(medal, "sethide", { dsumcsubmit: "1" }),
});
const allMedals = fixture({
  ...medals,
  query: { ...query, typeid: 0, page: 1, q: "" },
  medals: [
    ...medals.medals,
    {
      id: 6,
      name: "Manual",
      owned: 0,
      pending: 0,
      actions: [{ method: 2, credit: 0, ok: true }],
    },
    {
      id: 7,
      name: "Apply",
      owned: 0,
      pending: 0,
      actions: [{ method: 1, credit: 0, ok: true }],
    },
    {
      id: 8,
      name: "Claim",
      owned: 0,
      pending: 0,
      actions: [{ method: 6, credit: 0, ok: true }],
    },
  ],
});
const grant = fixture({
  can_grant: 1,
  supported: 1,
  limits: { users: 200, medals: 50, pairs: 1000, reason: 100 },
  medals: [{ id: 21, name: "Gift" }],
  records: {
    page: 1,
    batches: [
      {
        batch: 5,
        can_revoke: 1,
        items: [{ id: 6, uid: 45, medalid: 21, can_revoke: 1, revoked: 0 }],
      },
    ],
  },
  grant_form: form(medal, "grantgrid", { dsumcsubmit: "1", grantconfirm: "1" }),
  revoke_form: form(medal, "grantrevoke", { dsumcsubmit: "1" }),
  revoke_batch_form: form(medal, "grantrevokebatch", { dsumcsubmit: "1" }),
  lookup_url: form(medal, "grantlookup").url,
  thread_url: form(medal, "grantthread").url,
});
for (const [method, id, reply, outcome] of [
  [5, 101, ack, "acknowledged"],
  [1, 7, ack, "acknowledged"],
  [6, 8, ack, "acknowledged"],
  [2, 6, pending, "pending-review"],
]) {
  const { client, calls } = forum([allMedals, reply]);
  const view = await client.read("medals");
  const choice = {
    kind: "acquire-medal",
    id,
    method,
    ...(method === 2 ? { reason: "Please review" } : {}),
  };
  const prepared = client.prepare(view, choice);
  const result = await client.submit(prepared.form);
  const replay = await client.submit(prepared.form);
  check(
    `medal method ${method} is deliberate and single-use`,
    [prepared.kind, result.kind, result.choice, replay.kind, calls],
    [
      "awards-ready",
      outcome,
      choice,
      "invalid-input",
      [
        get(
          api("medals", {
            page: "1",
            typeid: "0",
            filter: "all",
            sort: "order",
          }),
        ),
        post(medal, "claim", {
          formhash: "abcd1234",
          dsumcsubmit: "1",
          medalid: String(id),
          method: String(method),
          credit: method === 5 ? "2" : "0",
          ...(method === 2 ? { reason: "Please review" } : {}),
        }),
      ],
    ],
  );
}
{
  const { client, calls } = forum([ownedMedals, ack]);
  const view = await client.read("mymedals");
  const prepared = client.prepare(view, {
    kind: "hide-medals",
    changes: [{ id: 11, hidden: true }],
  });
  const result = await client.submit(prepared.form);
  check(
    "owned medals, history and hide changes",
    [
      view.records[0].hidden,
      view.metadata.log.items[0].kind,
      result.kind,
      calls,
    ],
    [
      0,
      "bought",
      "acknowledged",
      [
        get(api("mymedals", { page: "1" })),
        post(medal, "sethide", {
          formhash: "abcd1234",
          dsumcsubmit: "1",
          "myMedalHide[11]": "1",
        }),
      ],
    ],
  );
}
{
  const { client, calls } = forum([
    grant,
    {
      ok: 1,
      users: [
        { uid: 44, has: [21] },
        { uid: 45, has: [] },
      ],
      missing: ["999"],
    },
    { ok: 1, uids: [45], total: 1, subject: "Fixture thread" },
    ack,
    ack,
    ack,
  ]);
  const view = await client.read("medalgrant");
  const lookup = await client.lookupMedalMembers(view, [44, 45, 999], [21]);
  const thread = await client.lookupMedalThread(view, {
    tid: 1120,
    from: 2,
    to: 8,
    noOwner: true,
  });
  const choices = [
    { kind: "grant-medals", recipients: [45], medals: [21], reason: "Event" },
    { kind: "revoke-medal", id: 6 },
    { kind: "revoke-medal-batch", id: 5 },
  ];
  const outcomes = [];
  for (const choice of choices)
    outcomes.push(
      (await client.submit(client.prepare(view, choice).form)).kind,
    );
  check(
    "grant catalogue, member and thread lookups, grant and single and batch revoke",
    [
      view.metadata.records.batches[0].batch,
      lookup.records.map((row) => row.uid),
      lookup.metadata.missing,
      thread.metadata,
      outcomes,
      calls,
    ],
    [
      5,
      [44, 45],
      ["999"],
      { uids: [45], total: 1, subject: "Fixture thread" },
      ["acknowledged", "acknowledged", "acknowledged"],
      [
        get(api("medalgrant", { page: "1" })),
        get(
          plugin(medal, {
            action: "grantlookup",
            uids: "44,45,999",
            mids: "21",
          }),
        ),
        get(
          plugin(medal, {
            action: "grantthread",
            tid: "1120",
            from: "2",
            to: "8",
            noowner: "1",
          }),
        ),
        post(medal, "grantgrid", {
          formhash: "abcd1234",
          dsumcsubmit: "1",
          grantconfirm: "1",
          grant_users: "45",
          grant_medalids: "21",
          grant_reason: "Event",
        }),
        post(medal, "grantrevoke", {
          formhash: "abcd1234",
          dsumcsubmit: "1",
          logid: "6",
        }),
        post(medal, "grantrevokebatch", {
          formhash: "abcd1234",
          dsumcsubmit: "1",
          batch: "5",
        }),
      ],
    ],
  );
}
const upstreamFile = (name) =>
  readFileSync(join(process.argv[2], "test/data", name), "utf8");
const json = (name) => JSON.parse(upstreamFile(name));
const bg = (name) => json(`tsdmapp_390/bggrant_${name}.json`);
const titlePage = (worn) =>
  fixture({
    formhash: "abcd1234",
    query: { page: 1, pages: 1 },
    titles: [
      { id: 1, name: "Current", worn: worn === 1 ? 1 : 0, expired: 0 },
      { id: 3, name: "Selected", worn: worn === 3 ? 1 : 0, expired: 0 },
      { id: 4, name: "Expired", worn: 0, expired: 1 },
    ],
  });
{
  const { client, calls } = forum(
    [{ok:1,uid:31,v4:1,achievement:1}, json("tsdmapp/v4/achievement_v68_empty.json")],
    "31",
  );
  const view = await client.read("achievements");
  check(
    "structured achievements independently establish unactivated empty list",
    [view.kind, view.records, view.metadata.activated, calls],
    [
      "awards-view",
      [],
      0,
      [
        get(api("status")),
        get(
          plugin("tsdmtitle:achi", { tsdmapp: "json", tsdmv: "4", nodoc: "1" }),
        ),
      ],
    ],
  );
}
for (const [before, after, kind, id] of [
  [1, 3, "wear-title", 3],
  [3, 0, "remove-title", 0],
]) {
  const { client, calls } = forum([titlePage(before), ack, titlePage(after)]);
  const view = await client.read("titles");
  const choice = kind === "wear-title" ? { kind, id } : { kind };
  const result = await client.submit(client.prepare(view, choice).form);
  check(
    `owned titles and independently observed ${kind}`,
    [view.records.map((row) => row.worn), result.kind, result.choice, calls],
    [
      [before === 1 ? 1 : 0, before === 3 ? 1 : 0, 0],
      "observed",
      choice,
      [
        get(api("titles", { page: "1", pp: "200" })),
        post(title, "settitle", {
          formhash: "abcd1234",
          settitlesubmit: "true",
          settitleid: String(id),
          tsdmtitle_return: "plugin.php?id=tsdmtitle:tsdmtitle&app=plugin",
        }),
        get(api("titles", { page: "1", pp: "200" })),
      ],
    ],
  );
}
const shopReturn = "plugin.php?id=tsdmtitle:tsdmtitle&action=shop";
const titleShop = fixture({
  query: { page: 1, pages: 1 },
  credit: { title: "Credits", balance: 500 },
  items: [
    {
      id: 11,
      name: "Title for purchase",
      price: 300,
      afford: 1,
      for_sale: 1,
      owned: 0,
    },
    {
      id: 12,
      name: "Too costly",
      price: 900,
      afford: 0,
      for_sale: 1,
      owned: 0,
    },
  ],
  buy_form: {
    ...form(title, "buy", { buysubmit: "true", tsdmtitle_return: shopReturn }),
    item_field: "buyid",
  },
});
const titleExchange = fixture({
  query: { page: 1, pages: 1, filter: "ready", q: "Event" },
  filters: [{ key: "ready", count: 1 }],
  items: [
    {
      id: 7,
      name: "Event exchange",
      ready: 1,
      owned: 0,
      consume: 1,
      medals: [{ id: 21, name: "Gift", owned: 1 }],
    },
  ],
  exchange_form: form(title, "exchange", {
    exchangesubmit: "true",
    tsdmtitle_return: "x",
  }),
});
const titleIssue = fixture({
  supported: 1,
  can_issue: 1,
  limits: { users: 200, titles: 30, days: 36500, note: 80 },
  titles: [{ id: 31, name: "Event title", enabled: 0 }],
  logs: [],
  issue_form: form(title, "issue", { issuesubmit: "true" }),
});
for (const [name, response, query, choice, plan, record] of [
  [
    "titleshop",
    titleShop,
    {},
    { kind: "buy-title", id: 11 },
    post(title, "buy", {
      formhash: "abcd1234",
      buysubmit: "true",
      tsdmtitle_return: shopReturn,
      buyid: "11",
    }),
    "Title for purchase",
  ],
  [
    "titleexchange",
    titleExchange,
    { filter: "ready", q: "Event" },
    { kind: "exchange-title", id: 7 },
    post(title, "exchange", {
      formhash: "abcd1234",
      exchangesubmit: "true",
      tsdmtitle_return: "x",
      exchangeid: "7",
    }),
    "Event exchange",
  ],
  ...["issue-title", "revoke-title"].map((kind) => [
    "titleissue",
    titleIssue,
    {},
    {
      kind,
      titles: [31],
      recipients: ["45", "fixture recipient"],
      days: 7,
      note: "Event",
    },
    post(title, "issue", {
      formhash: "abcd1234",
      issuesubmit: "true",
      issueop: kind === "issue-title" ? "grant" : "revoke",
      issuetitles: "31",
      issueusers: "45\nfixture recipient",
      issuedays: "7",
      issuenote: "Event",
    }),
    "Event title",
  ]),
]) {
  const { client, calls } = forum([response, ack]);
  const view = await client.read(name, query);
  const prepared = client.prepare(view, choice);
  const result = await client.submit(prepared.form);
  check(
    `${name} discovery and ${choice.kind}`,
    [view.kind, view.records[0].name, result.kind, result.choice, calls],
    [
      "awards-view",
      record,
      "acknowledged",
      choice,
      [
        get(api(name, name === "titleissue" ? {} : { page: "1", ...query })),
        plan,
      ],
    ],
  );
}
for (const [notify, recipients, response, expected, count] of [
  [true, [45, 999999], bg("result_success"), "partial", 1],
  [
    false,
    [45],
    {
      ...bg("result_success"),
      message: "已发放给 1 位会员，到期 2026-11-19 23:59；图片 1209-1.jpg",
    },
    "acknowledged",
    1,
  ],
  [false, [45], bg("result_noperm"), "refused", null],
]) {
  const { client, calls } = forum([bg("keyword"), response], "31");
  const view = await client.read("bggrant", { keyword: "夜空" });
  const choice = {
    kind: "grant-background",
    id: 1,
    recipients,
    expiry: "2026-11-19 23:59",
    notify,
  };
  const result = await client.submit(client.prepare(view, choice).form);
  check(
    `background grant preserves recipient, expiry and notify (${expected}, notify ${notify})`,
    [
      view.metadata.keyword,
      view.records[0].file,
      result.kind,
      result.choice,
      result.grantedCount ?? null,
      calls,
    ],
    [
      "夜空",
      "1209-1.jpg",
      expected,
      choice,
      count,
      [
        get(api("bggrant", { kw: "夜空" })),
        post(
          "background:memcp",
          "slotadd",
          {
            formhash: "f1f2f3f4",
            slotaddsubmit: "true",
            slotaddurl: "1209-1.jpg",
            slotadduid: recipients.join(","),
            slotaddtime: "2026-11-19 23:59",
            ...(notify ? { slotaddnotify: "1" } : {}),
          },
          "ac",
        ),
      ],
    ],
  );
}
{
  const { client, calls } = forum(
    [
      { ...allMedals, uid: 1000 },
      html(upstreamFile("medal_apply_form_v3_x5.html")),
      pending,
    ],
    "1000",
  );
  const view = await client.read("medals");
  const prepared = await client.openMedalApplication(view, 6, "Please review");
  const outcome = await client.submit(prepared.form);
  check(
    "native manual application opens offered item before sending the reason",
    [prepared.kind, outcome.kind, calls],
    [
      "awards-ready",
      "pending-review",
      [
        get(
          api("medals", {
            page: "1",
            typeid: "0",
            filter: "all",
            sort: "order",
          }),
        ),
        get(plugin(medal, { action: "apply", medalid: "6" })),
        post(medal, "claim", {
          formhash: "XXXXXXXX",
          dsumcsubmit: "1",
          medalid: "6",
          method: "2",
          reason: "Please review",
        }),
      ],
    ],
  );
}
const unavailable = { ok: 0, error: "action" };
const legacyCatalogue = plugin(medal);
for (const [file, expectPost] of [
  ["medal_catalog_v3_x5.html", true],
  ["medal_catalog_x5.html", false],
]) {
  const { client, calls } = forum(
    [
      unavailable,
      html(upstreamFile(file)),
      html(upstreamFile("medal_claim_success_v3_x5.html")),
    ],
    "1000",
  );
  const view = await client.read("medals");
  assert.equal(view.kind, "awards-view", JSON.stringify({ file, view, calls }));
  const choice = { kind: "acquire-medal", id: 593, method: 5 };
  const prepared = client.prepare(view, choice);
  const before = calls.length;
  const result = await client.submit(prepared.form);
  check(
    `native medal catalogue and deliberate ${expectPost ? "claim POST" : "legacy acquisition GET"}`,
    [
      view.kind,
      view.records.find((row) => row.id === 593).name,
      before,
      result.kind,
      result.choice,
      calls,
    ],
    [
      "awards-view",
      "【端午节】粽子勋章",
      2,
      "acknowledged",
      choice,
      [
        get(
          api("medals", {
            page: "1",
            typeid: "0",
            filter: "all",
            sort: "order",
          }),
        ),
        get(legacyCatalogue),
        expectPost
          ? post(medal, "claim", {
              formhash: "XXXXXXXX",
              dsumcsubmit: "1",
              medalid: "593",
              method: "5",
              credit: "0",
              typeid: "0",
            })
          : get(
              plugin(medal, {
                action: "apply",
                medalid: "593",
                applytype: "5",
              }),
            ),
      ],
    ],
  );
}
{
  const { client, calls } = forum(
    [
      { ...allMedals, uid: 1000 },
      html(upstreamFile("medal_apply_unmet_v3_x5.html")),
    ],
    "1000",
  );
  const view = await client.read("medals");
  const outcome = await client.openMedalApplication(view, 6, "Please review");
  check(
    "native manual application with unmet prerequisites sends no effect",
    [outcome.kind, calls],
    [
      "refused",
      [
        get(
          api("medals", {
            page: "1",
            typeid: "0",
            filter: "all",
            sort: "order",
          }),
        ),
        get(plugin(medal, { action: "apply", medalid: "6" })),
      ],
    ],
  );
}
for (const [name, response, result] of [
  ["lost response", new Error("lost"), "unknown"],
  [
    "form redraw",
    {
      uid: 35,
      ok: 1,
      type: "result",
      schema: 13,
      kind: "page",
      document:
        '<form action="plugin.php?id=tsdmtitle:tsdmtitle&action=buy"></form>',
    },
    "redrawn",
  ],
  [
    "unqualified message",
    html('<div id="messagetext" class="alert_info">Review this offer</div>'),
    "unknown",
  ],
  [
    "mismatched member",
    {
      uid: 44,
      ok: 1,
      type: "result",
      schema: 13,
      kind: "message",
      alert: "right",
      message: "Success",
    },
    "unknown",
  ],
]) {
  const { client, calls } = forum([titleShop, response]);
  const view = await client.read("titleshop");
  const choice = { kind: "buy-title", id: 11 };
  const prepared = client.prepare(view, choice);
  const outcome = await client.submit(prepared.form);
  const retry = await client.submit(prepared.form);
  check(
    `title purchase ${name} preserves choice and is never repeated`,
    [outcome.kind, outcome.choice, retry.kind, calls.map((row) => row[0])],
    [result, choice, "invalid-input", ["GET", "POST"]],
  );
}
{
  const { client, calls, relogin } = forum([titleShop]);
  const view = await client.read("titleshop");
  const forged = client.prepare({ ...view }, { kind: "buy-title", id: 11 });
  const expensive = client.prepare(view, { kind: "buy-title", id: 12 });
  const prepared = client.prepare(view, { kind: "buy-title", id: 11 });
  relogin();
  const outcome = await client.submit(prepared.form);
  check(
    "forged, unaffordable and stale approvals cause no effect",
    [forged.kind, expensive.kind, outcome.kind, calls],
    [
      "invalid-input",
      "refused",
      "session-changed",
      [get(api("titleshop", { page: "1" }))],
    ],
  );
}
{
  const { client, calls } = forum([bg("cannot")], "31");
  const view = await client.read("bggrant");
  const outcome = client.prepare(view, {
    kind: "grant-background",
    id: 1,
    recipients: [45],
    expiry: "0",
    notify: false,
  });
  check(
    "background catalogue with no grant permission refuses before dispatch",
    [view.kind, outcome.kind, calls],
    ["awards-view", "refused", [get(api("bggrant"))]],
  );
}
{
  const { client, calls } = forum(
    [bg("can"), { ...bg("result_success"), message: "已发放给 0 位会员" }],
    "31",
  );
  const view = await client.read("bggrant");
  const choice = {
    kind: "grant-background",
    image: "https://images.test/background.jpg",
    recipients: [45],
    expiry: "0",
    notify: false,
  };
  const outcome = await client.submit(client.prepare(view, choice).form);
  check(
    "custom background URL is supplied as data and zero granted is a refusal",
    [outcome.kind, outcome.choice, calls],
    [
      "refused",
      choice,
      [
        get(api("bggrant")),
        post(
          "background:memcp",
          "slotadd",
          {
            formhash: "f1f2f3f4",
            slotaddsubmit: "true",
            slotaddurl: choice.image,
            slotadduid: "45",
            slotaddtime: "0",
          },
          "ac",
        ),
      ],
    ],
  );
}
for (const [catalogue, native, envelope] of [
  ["titles", plugin(title), "s3_title"],
  ["titleshop", plugin(title, { action: "shop" }), "s3_shop"],
]) {
  const { client, calls } = forum([json(`tsdmapp/${envelope}.json`)], "31");
  const outcome = await client.read(catalogue);
  const target = new URL(outcome.url);
  check(
    `${catalogue} legacy page hands off to its own native surface`,
    [
      outcome.kind,
      target.origin,
      target.pathname,
      Object.fromEntries(target.searchParams),
      calls.length,
    ],
    ["awards-handoff", origin, ...native, 1],
  );
}
{
  const legacy =
    html(`<script>var discuz_uid = '35';</script><div id="ct" class="dsumc"><ul class="mlm mdl">
    <li class="pns"><img id="mc_medal6" src="medal.gif"><strong>Legacy manual medal</strong>
    <a href="plugin.php?id=dsu_medalCenter:specmedal&amp;action=newapply&amp;applymedalid=6">Apply</a></li></ul></div>`);
  const action =
    "plugin.php?id=dsu_medalCenter:specmedal&action=newapply&applymedalid=6";
  const application =
    html(`<form method="post" action="${action.replaceAll("&", "&amp;")}">
    <input type="hidden" name="formhash" value="abcd1234"><textarea name="applyreason"></textarea>
    <button type="submit">Apply</button></form>`);
  const { client, calls } = forum([unavailable, legacy, application, pending]);
  const view = await client.read("medals");
  const prepared = await client.openMedalApplication(view, 6, "Legacy reason");
  const result = await client.submit(prepared.form);
  const route = plugin("dsu_medalCenter:specmedal", {
    action: "newapply",
    applymedalid: "6",
  });
  check(
    "legacy manual apply opens specmedal and posts the exact returned reason form",
    [result.kind, calls],
    [
      "pending-review",
      [
        get(
          api("medals", {
            page: "1",
            typeid: "0",
            filter: "all",
            sort: "order",
          }),
        ),
        get(legacyCatalogue),
        get(route),
        [
          "POST",
          ...route,
          { formhash: "abcd1234", applyreason: "Legacy reason" },
        ],
      ],
    ],
  );
}
{
  const { client, calls } = forum([
    titlePage(3),
    ack,
    { ...titlePage(0), query: { page: 1, pages: 2 } },
  ]);
  const view = await client.read("titles");
  const approved = client.prepare(view, { kind: "remove-title" });
  const outcome = await client.submit(approved.form);
  check(
    "partial title readback cannot establish removal",
    [outcome.kind, calls.map((row) => row[0])],
    ["unknown", ["GET", "POST", "GET"]],
  );
}
{
  const redirected = {
    contentType: "text/html",
    status: 302,
    body: "",
    url: `${origin}/unexpected`,
    redirect: "followed",
  };
  const { client, calls } = forum([titleShop, redirected]);
  const view = await client.read("titleshop");
  const approved = client.prepare(view, { kind: "buy-title", id: 11 });
  const outcome = await client.submit(approved.form);
  check(
    "followed redirect is not a purchase result and is never retried",
    [outcome.kind, outcome.choice, calls.map((row) => row[0])],
    ["unknown", { kind: "buy-title", id: 11 }, ["GET", "POST"]],
  );
}
console.log(JSON.stringify(results));
