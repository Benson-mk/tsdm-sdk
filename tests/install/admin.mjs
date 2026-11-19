import assert from "node:assert/strict";
import { createAdminClient, createModeratorPanelClient } from "tsdm-sdk";

const origin = "https://admin.example";
const actor = { memberId: "31", continuity: "fictional-admin-viewer" };
const privateValue = (identity) => ["fictional", identity, "+& 4"].join("-");
const fixtureToken = privateValue("token").replace(/[+& ]/g, "x");
const fixturePassword = privateValue("password");
const fixtureAnswer = privateValue("answer");
const formhash = "fictional-formhash";
const headers = { "X-Tsdmapp-Admin": fixtureToken };
const actions = Object.fromEntries(
  ["admincredit", "admingroup", "adminreport", "adminban"].map((k) => [
    k,
    { read: 1, write: 1 },
  ]),
);
const capabilities = Object.fromEntries(
  Object.keys(actions).map((k) => [k, { read: true, write: true }]),
);
const now = 1700000000;
const standard = (data) => ({ ok: 1, uid: 31, time: now, formhash, ...data });
const access = (data = {}) =>
  standard({
    type: "admin",
    schema: 25,
    enabled: 1,
    eligible: 1,
    founder: 0,
    header: "X-Tsdmapp-Admin",
    session: { active: 0, ttl: 900, max: 7200, expires: 0 },
    actions,
    login: { locked: 0, retry_after: 0, tries_left: 4, secques: 0 },
    ...data,
  });
const loginReply = (data = {}) =>
  access({
    op: "login",
    token: fixtureToken,
    actions: {},
    session: { active: 1, ttl: 900, max: 7200, expires: now + 900 },
    ...data,
  });
const status = (admin = 1) => standard({ admin });
const step = (
  action,
  reply,
  { query = {}, form, authorized = false, ...behavior } = {},
) => ({ action, reply, query, form, authorized, behavior });
const openSteps = (entry = access(), login = loginReply()) => [
  step("status", status()),
  step("admin", entry),
  step("admin", login, {
    form: { op: "login", password: fixturePassword, formhash },
  }),
];
const discovered = {
  kind: "admin-access",
  enabled: true,
  eligible: true,
  founder: false,
  sessionActive: false,
  capabilities,
  login: {
    locked: false,
    retryAfter: 0,
    triesLeft: 4,
    securityQuestion: false,
  },
};
const results = [];
function redact(request) {
  return {
    ...request,
    headers: Object.fromEntries(
      Object.keys(request.headers).map((k) => [k, "[masked]"]),
    ),
    ...(request.body !== undefined
      ? {
          body: [...new URLSearchParams(request.body)].map(([k, v]) => [
            k,
            ["password", "answer", "formhash"].includes(k) ? "[masked]" : v,
          ]),
        }
      : {}),
  };
}
async function scenario(name, steps, expected, run) {
  const observedRequests = [];
  let clock = 50000;
  let session = actor;
  const control = {
    replace: () => {
      session = { memberId: "31", continuity: "replacement-viewer" };
    },
    advance: (ms) => {
      clock += ms;
    },
  };
  const options = {
    origin,
    now: () => clock,
    session: () => session,
    transport: {
      async request(url, req) {
        const next = steps[observedRequests.length];
        observedRequests.push({ url, ...req });
        if (!next || next.behavior.drop)
          throw new Error("controlled unavailable transport");
        if (next.behavior.replace) control.replace();
        return {
          url,
          status: next.behavior.status ?? 200,
          redirect: next.behavior.redirect ?? "none",
          contentType: "application/json",
          body: JSON.stringify(next.reply),
        };
      },
    },
  };
  const observed = await run(createAdminClient(options), control, options);
  const expectedRequests = steps.map(({ action, query, form, authorized }) => ({
    url: `${origin}/plugin.php?id=tsdmapp%3Aapi&action=${action}${Object.keys(query).length ? "&" + new URLSearchParams(query) : ""}`,
    fresh: true,
    session: actor,
    headers: authorized ? headers : {},
    method: form ? "POST" : "GET",
    effect: Boolean(form),
    ...(form && { body: new URLSearchParams(form).toString() }),
  }));
  // Compare raw bytes and the header in memory without printing private values on mismatch.
  try {
    assert.deepEqual(observedRequests, expectedRequests);
  } catch {
    assert.fail(
      `${name}: controlled raw request mismatch\n${JSON.stringify(observedRequests.map(redact))}\n${JSON.stringify(expectedRequests.map(redact))}`,
    );
  }
  for (const value of [
    fixtureToken,
    fixturePassword,
    fixtureAnswer,
    formhash,
  ]) {
    assert.ok(
      !JSON.stringify(observed).includes(value),
      `${name}: private value in result`,
    );
  }
  assert.deepEqual(observed, expected, name);
  results.push({
    name,
    expected,
    observed,
    expectedRequests: expectedRequests.map(redact),
    requests: observedRequests.map(redact),
  });
}
const open = async (client) => {
  assert.equal((await client.discoverAdmin()).kind, "admin-access");
  assert.deepEqual(
    await client.openAdminSession({ password: fixturePassword }, true),
    { kind: "admin-opened" },
  );
};
await scenario(
  "deployment switch off stops before entry",
  [step("status", status(0))],
  {
    kind: "admin-access",
    enabled: false,
    eligible: false,
    founder: false,
    capabilities: {},
    sessionActive: false,
    login: null,
  },
  (c) => c.discoverAdmin(),
);
await scenario(
  "discovers only this viewer’s permissions",
  openSteps().slice(0, 2),
  discovered,
  (c) => c.discoverAdmin(),
);
await scenario(
  "declining the separate login does not send credentials",
  openSteps().slice(0, 2),
  { kind: "not-confirmed" },
  async (c) => {
    await c.discoverAdmin();
    return c.openAdminSession({ password: fixturePassword }, false);
  },
);
await scenario(
  "login retains the token in memory and logout sends it only in the header",
  [
    ...openSteps(),
    step("admin", standard({ type: "admin", op: "logout" }), {
      authorized: true,
      form: { op: "logout", formhash },
    }),
  ],
  { kind: "admin-closed" },
  async (c) => {
    await open(c);
    assert.deepEqual(await c.closeAdminSession(false), {
      kind: "not-confirmed",
    });
    const result = await c.closeAdminSession(true);
    assert.deepEqual(await c.closeAdminSession(true), { kind: "admin-closed" });
    return result;
  },
);
const challenge = { locked: 0, tries_left: 3, retry_after: 0, secques: 1 };
await scenario(
  "honors the served security question requirement",
  [
    step("status", status()),
    step("admin", access({ login: challenge })),
    step("admin", loginReply(), {
      form: {
        op: "login",
        password: fixturePassword,
        questionid: "3",
        answer: fixtureAnswer,
        formhash,
      },
    }),
  ],
  { kind: "admin-opened" },
  async (c) => {
    await c.discoverAdmin();
    assert.deepEqual(
      await c.openAdminSession({ password: fixturePassword }, true),
      { kind: "invalid-input" },
    );
    return c.openAdminSession(
      { password: fixturePassword, question: { id: 3, answer: fixtureAnswer } },
      true,
    );
  },
);
await scenario(
  "an expired local token is discarded with no logout request",
  openSteps(),
  { kind: "admin-closed" },
  async (c, x) => {
    await open(c);
    x.advance(871000);
    return c.closeAdminSession(true);
  },
);
await scenario(
  "a replaced viewer drops old authorization without sending the token",
  openSteps(),
  { kind: "session-changed" },
  async (c, x) => {
    await open(c);
    x.replace();
    return c.closeAdminSession(true);
  },
);
const targetMember = (uid, extra = {}) => ({
  uid,
  username: `Fictional member ${uid}`,
  groupid: 10,
  group: "Fictional base group",
  adminid: 0,
  status: 0,
  self: 0,
  founder: 0,
  ...extra,
});
const creditPage = standard({
  type: "admincredit",
  schema: 26,
  credits: [{ id: 2, title: "Fictional coins", unit: "" }],
  limits: { users: 50, delta: 99, reason: 40 },
  reason_required: 1,
  members: [targetMember(71, { credits: { 2: 10 } })],
  missing: ["Missing fictitious member"],
});
const creditRead = step("admincredit", creditPage, {
  authorized: true,
  query: { uids: "71", usernames: "Missing fictitious member" },
});
const creditArgs = {
  memberIds: ["71"],
  deltas: { 2: -3 },
  reason: "Fictional correction",
  notify: true,
  operationId: "fictional-credit-0001",
};
const creditForm = {
  uids: "71",
  "credits[2]": "-3",
  reason: "Fictional correction",
  notify: "1",
  opid: "fictional-credit-0001",
  formhash,
};
const memberView = {
  memberId: "71",
  username: "Fictional member 71",
  groupId: "10",
  group: "Fictional base group",
  adminId: 0,
  locked: false,
  self: false,
  founder: false,
};
const creditLookup = async (c) => {
  const data = await c.readAdminCredits({
    memberIds: ["71"],
    usernames: ["Missing fictitious member"],
  });
  assert.equal(data.kind, "admin-credits");
  assert.deepEqual(data.members, [{ member: memberView, balances: { 2: 10 } }]);
  assert.deepEqual(data.missing, ["Missing fictitious member"]);
  assert.deepEqual(data.creditTypes, [
    { id: "2", title: "Fictional coins", unit: "" },
  ]);
  return data;
};
const creditReceipt = standard({
  type: "admincredit",
  schema: 26,
  op: "reward",
  changed: { 2: -3 },
  notified: 1,
  members: [targetMember(71, { credits: { 2: 7 } })],
});
await scenario(
  "reads credit terms and independently qualifies an approved adjustment",
  [
    ...openSteps(),
    creditRead,
    step("admincredit", creditReceipt, { authorized: true, form: creditForm }),
  ],
  {
    kind: "credits-adjusted",
    operationId: "fictional-credit-0001",
    changed: { 2: -3 },
    notified: 1,
    members: [{ member: memberView, balances: { 2: 7 } }],
  },
  async (c) => {
    await open(c);
    const credits = await creditLookup(c);
    assert.deepEqual(await c.adjustAdminCredits(credits, creditArgs, false), {
      kind: "not-confirmed",
    });
    assert.deepEqual(
      await c.adjustAdminCredits(
        credits,
        { ...creditArgs, memberIds: ["72"] },
        true,
      ),
      { kind: "invalid-input" },
    );
    assert.deepEqual(
      await c.adjustAdminCredits({ ...credits }, creditArgs, true),
      { kind: "invalid-input" },
    );
    return c.adjustAdminCredits(credits, creditArgs, true);
  },
);
for (const [name, reply, behavior, expected] of [
  [
    "server-level action refusal",
    standard({ ok: 0, error: "admin_noperm", why: "perm" }),
    {},
    {
      kind: "refused",
      code: "admin_noperm",
      why: "perm",
      action: "admincredit",
    },
  ],
  [
    "lost credit receipt",
    {},
    { drop: true },
    {
      kind: "uncertain",
      operation: "reward",
      operationId: "fictional-credit-0001",
    },
  ],
  [
    "duplicate is distinct from a new credit receipt",
    standard({ ok: 0, error: "duplicate" }),
    {},
    {
      kind: "duplicate",
      operation: "reward",
      operationId: "fictional-credit-0001",
    },
  ],
  [
    "the actor UID cannot stand in for the adjusted member",
    { ...creditReceipt, members: [targetMember(31, { credits: { 2: 7 } })] },
    {},
    {
      kind: "uncertain",
      operation: "reward",
      operationId: "fictional-credit-0001",
    },
  ],
]) {
  await scenario(
    name,
    [
      ...openSteps(),
      creditRead,
      step("admincredit", reply, {
        authorized: true,
        form: creditForm,
        ...behavior,
      }),
    ],
    expected,
    async (c) => {
      await open(c);
      return c.adjustAdminCredits(await creditLookup(c), creditArgs, true);
    },
  );
}
const readOnly = {
  ...actions,
  admincredit: { read: 1, write: 0 },
  admingroup: { read: 0, write: 0 },
};
await scenario(
  "a read-only credit capability does not authorize mutation",
  [...openSteps(access({ actions: readOnly })), creditRead],
  { kind: "refused", code: "admin_noperm", why: "perm", action: "admincredit" },
  async (c) => {
    await open(c);
    return c.adjustAdminCredits(await creditLookup(c), creditArgs, true);
  },
);
await scenario(
  "an expired token blocks the private data read locally",
  openSteps(),
  { kind: "refused", code: "admin_login", action: "admincredit" },
  async (c, x) => {
    await open(c);
    x.advance(871000);
    return c.readAdminCredits({ memberIds: ["71"] });
  },
);
await scenario(
  "server token expiry invalidates only the held admin authorization",
  [
    ...openSteps(),
    step("admincredit", standard({ ok: 0, error: "admin_login" }), {
      authorized: true,
      query: { uids: "71" },
    }),
  ],
  { kind: "refused", code: "admin_login", action: "admincredit" },
  async (c) => {
    await open(c);
    assert.deepEqual(await c.readAdminCredits({ memberIds: ["71"] }), {
      kind: "refused",
      code: "admin_login",
      action: "admincredit",
    });
    return c.readAdminCredits({ memberIds: ["71"] });
  },
);
const groupPage = standard({
  type: "admingroup",
  schema: 27,
  can: 1,
  reason_required: 1,
  admin_grant: 1,
  member: targetMember(71, {
    credits: 42,
    extgroupids: [15],
    expiry: { time: 0, date: "", groupid: 0, adminid: 0 },
    ext_expiry: [],
  }),
  groups: [
    { groupid: 10, title: "Fictional base group", type: "member", allowed: 1 },
    {
      groupid: 22,
      title: "Fictional selected group",
      type: "special",
      allowed: 1,
      related_adminid: 1,
    },
    { groupid: 23, title: "Protected group", allowed: 0 },
  ],
  extgroups: [
    { groupid: 15, title: "Fictional extension A", allowed: 1 },
    { groupid: 16, title: "Fictional extension B", allowed: 1 },
  ],
  expgroups: [
    { groupid: 0, title: "Fictional expiry group" },
    { groupid: 22, title: "Fictional expiry related", type: "member" },
  ],
  adminids: [0, 1, 2, 3],
  limits: { extgroups_len: 30, reason: 40 },
});
const groupRead = step("admingroup", groupPage, {
  query: { uid: "71" },
  authorized: true,
});
const groupArgs = {
  groupId: "22",
  adminId: 2,
  expiry: { date: "2030-02-28", groupId: "22", adminId: 3 },
  extendedGroups: [
    { groupId: "15" },
    { groupId: "16", expiresOn: "2030-02-27" },
  ],
  reason: "Fictional reclassification",
  notify: true,
  operationId: "fictional-group-0001",
};
const groupForm = {
  uid: "71",
  groupid: "22",
  adminid: "2",
  expiry: "2030-02-28",
  expgroupid: "22",
  expadminid: "3",
  "extgroupids[0]": "15",
  "extgroupids[1]": "16",
  "extexpiry[16]": "2030-02-27",
  reason: "Fictional reclassification",
  notify: "1",
  opid: "fictional-group-0001",
  formhash,
};
const groupLookup = async (c) => {
  const view = await c.readAdminGroup({ memberId: "71" });
  assert.equal(view.kind, "admin-group");
  assert.deepEqual(view.member, memberView);
  assert.deepEqual(view.extendedGroups, [{ groupId: "15", expiresOn: "" }]);
  assert.equal(view.groups.find(({ id }) => id === "23").allowed, false);
  return view;
};
await scenario(
  "reads current group state and confirms the approved full replacement",
  [
    ...openSteps(),
    groupRead,
    step(
      "admingroup",
      standard({ type: "admingroup", schema: 27, op: "group" }),
      { authorized: true, form: groupForm },
    ),
  ],
  {
    kind: "group-acknowledged",
    memberId: "71",
    operationId: "fictional-group-0001",
  },
  async (c) => {
    await open(c);
    const group = await groupLookup(c);
    assert.deepEqual(
      await c.changeAdminGroup(group, { ...groupArgs, groupId: "23" }, true),
      { kind: "invalid-input" },
    );
    assert.deepEqual(
      await c.changeAdminGroup(
        group,
        { ...groupArgs, expiry: { ...groupArgs.expiry, date: "2030-02-30" } },
        true,
      ),
      { kind: "invalid-input" },
    );
    return c.changeAdminGroup(group, groupArgs, true);
  },
);
await scenario(
  "a protected member has a viewable group but no group mutation",
  [
    ...openSteps(),
    step(
      "admingroup",
      { ...groupPage, can: 0, why: "founder_only" },
      { query: { uid: "71" }, authorized: true },
    ),
  ],
  {
    kind: "refused",
    code: "admin_noperm",
    why: "founder_only",
    action: "admingroup",
  },
  async (c) => {
    await open(c);
    return c.changeAdminGroup(await groupLookup(c), groupArgs, true);
  },
);
await scenario(
  "a mismatched member cannot supply group choices",
  [
    ...openSteps(),
    step(
      "admingroup",
      { ...groupPage, member: targetMember(72) },
      { query: { uid: "71" }, authorized: true },
    ),
  ],
  { kind: "invalid-response" },
  async (c) => {
    await open(c);
    return c.readAdminGroup({ memberId: "71" });
  },
);
const reportRow = (id, extra = {}) => ({
  id,
  uid: 72,
  username: "Fictional reporter",
  message: "Fictional moderation report",
  url: "forum.php?mod=viewthread&tid=91",
  tid: 91,
  pid: 0,
  fid: 18,
  forum: "Fictional board",
  dateline: now,
  num: 1,
  ...extra,
});
const reportPage = (op, reports) =>
  standard({
    type: "adminreport",
    schema: 29,
    op,
    page: op === "resolved" ? 2 : 1,
    pages: 2,
    count: 3,
    reports,
    reward: {
      enabled: 1,
      min: -3,
      max: 3,
      options: [-3, 0, 3],
      credit: { id: 2, title: "Fictional coins", unit: "" },
    },
    limits: { msg: 25 },
  });
const pending = step(
  "adminreport",
  reportPage("new", [reportRow(91), reportRow(92)]),
  { authorized: true, query: { op: "new" } },
);
const resolved = step(
  "adminreport",
  reportPage("resolved", [
    reportRow(93, {
      opuid: 31,
      opname: "Fictional administrator",
      optime: now + 30,
      result: {
        type: "credit",
        value: 3,
        credit: { id: 2, title: "Fictional coins" },
      },
    }),
  ]),
  { authorized: true, query: { op: "resolved", page: "2" } },
);
const reportKey = "fictional-report-0001";
const decisions = [
  { reportId: "91", reward: 3, message: "Fictitious finding" },
  { reportId: "92" },
];
await scenario(
  "lists pending reports and keeps explicitly skipped resolutions distinct",
  [
    ...openSteps(),
    pending,
    step(
      "adminreport",
      standard({
        type: "adminreport",
        schema: 29,
        op: "resolve",
        resolved: [91],
        skipped: [92],
      }),
      {
        authorized: true,
        form: {
          op: "resolve",
          "ids[0]": "91",
          "credits[91]": "3",
          "msg[91]": "Fictitious finding",
          "ids[1]": "92",
          opid: reportKey,
          formhash,
        },
      },
    ),
  ],
  {
    kind: "reports-resolved",
    resolved: ["91"],
    skipped: ["92"],
    unreported: [],
    operationId: reportKey,
  },
  async (c) => {
    await open(c);
    const list = await c.readAdminReports("pending");
    assert.equal(list.kind, "admin-reports");
    assert.equal(list.reports[0].reporterId, "72");
    assert.deepEqual(
      await c.resolveAdminReports(list, [{ reportId: "99" }], reportKey, true),
      { kind: "invalid-input" },
    );
    assert.deepEqual(
      await c.resolveAdminReports(
        list,
        [{ reportId: "91", reward: 4 }],
        reportKey,
        true,
      ),
      { kind: "invalid-input" },
    );
    return c.resolveAdminReports(list, decisions, reportKey, true);
  },
);
await scenario(
  "reads the resolved tab and deletes only the confirmed report IDs",
  [
    ...openSteps(),
    resolved,
    step(
      "adminreport",
      standard({ type: "adminreport", op: "delete", deleted: [93] }),
      {
        authorized: true,
        form: { op: "delete", "ids[0]": "93", opid: reportKey, formhash },
      },
    ),
  ],
  {
    kind: "reports-deleted",
    deleted: ["93"],
    unreported: [],
    operationId: reportKey,
  },
  async (c) => {
    await open(c);
    const list = await c.readAdminReports("resolved", 2);
    assert.equal(list.kind, "admin-reports");
    assert.equal(list.scope, "resolved");
    assert.equal(list.page, 2);
    assert.deepEqual(list.reports[0].resolution, {
      operatorId: "31",
      operator: "Fictional administrator",
      time: now + 30,
      value: 3,
      creditTitle: "Fictional coins",
    });
    assert.deepEqual(
      await c.resolveAdminReports(list, [{ reportId: "93" }], reportKey, true),
      { kind: "invalid-input" },
    );
    return c.deleteAdminReports(list, ["93"], reportKey, true);
  },
);
await scenario(
  "a report-only administrator lacks group access and report write permission",
  [
    ...openSteps(access({ actions: { adminreport: { read: 1, write: 0 } } })),
    pending,
  ],
  { kind: "refused", code: "admin_noperm", why: "perm", action: "adminreport" },
  async (c) => {
    await open(c);
    assert.deepEqual(await c.readAdminGroup({ memberId: "71" }), {
      kind: "refused",
      code: "admin_noperm",
      why: "perm",
      action: "admingroup",
    });
    const list = await c.readAdminReports("pending");
    assert.equal(list.kind, "admin-reports");
    return c.deleteAdminReports(list, ["91"], reportKey, true);
  },
);
await scenario(
  "report success with no per-record result cannot prove the selected reports were changed",
  [
    ...openSteps(),
    pending,
    step(
      "adminreport",
      standard({ type: "adminreport", schema: 29, op: "delete" }),
      {
        authorized: true,
        form: { op: "delete", "ids[0]": "91", opid: reportKey, formhash },
      },
    ),
  ],
  { kind: "uncertain", operation: "delete", operationId: reportKey },
  async (c) => {
    await open(c);
    return c.deleteAdminReports(
      await c.readAdminReports("pending"),
      ["91"],
      reportKey,
      true,
    );
  },
);
const banPage = (extra = {}, memberExtra = {}) =>
  standard({
    type: "adminban",
    schema: 30,
    can: 1,
    member: targetMember(71, {
      banned: "",
      banexpiry: 0,
      posts: 6,
      threads: 1,
      post_rows: 6,
      post_left: 6,
      clear_pending: 0,
      ...memberExtra,
    }),
    bans: ["", "post", "visit", "status"],
    days: [0, 1, 7],
    clear: ["post", "postcomment", "avatar", "profile"],
    batch: 200,
    crimes: [
      {
        action: "warn",
        action_text: "Fictional warning",
        reason: "Fictional reason",
        dateline: now,
        operator: "Fictional operator",
      },
    ],
    limits: { days: 30, reason: 45 },
    reason_required: 1,
    ...extra,
  });
const banRead = step("adminban", banPage(), {
  authorized: true,
  query: { uid: "71" },
});
const banKey = "fictional-ban-0001";
const banArgs = {
  ban: "post",
  days: 7,
  reason: "Fictional moderation reason",
  clear: ["post", "postcomment", "avatar", "profile"],
  operationId: banKey,
};
const banForm = {
  op: "ban",
  uid: "71",
  bannew: "post",
  banexpirynew: "7",
  reason: "Fictional moderation reason",
  "clear[0]": "post",
  "clear[1]": "postcomment",
  "clear[2]": "avatar",
  "clear[3]": "profile",
  opid: banKey,
  formhash,
};
const banResult = standard({
  type: "adminban",
  schema: 30,
  op: "ban",
  member: targetMember(71, { banned: "post", banexpiry: now + 604800 }),
  cleared: ["postcomment", "avatar", "profile"],
  clear_posts: { pending: 1, cursor: "0-0", remaining: 6, batch: 200 },
});
const batchResult = (extra = {}) =>
  standard({
    type: "adminban",
    schema: 30,
    op: "clear",
    target_uid: 71,
    done: 0,
    cursor: "0-5",
    remaining: 2,
    posts: 4,
    threads: 1,
    ...extra,
  });
const batchStep = (cursor, reply) =>
  step("adminban", reply, {
    authorized: true,
    form: { op: "clear", uid: "71", cursor, formhash },
  });
await scenario(
  "ban, immediate cleanup, continued batches and explicit completion have distinct outcomes",
  [
    ...openSteps(),
    banRead,
    step("adminban", banResult, { authorized: true, form: banForm }),
    batchStep("0-0", batchResult()),
    batchStep(
      "0-5",
      batchResult({ done: 1, cursor: "", remaining: 0, posts: 2, threads: 0 }),
    ),
  ],
  {
    kind: "cleanup-complete",
    memberId: "71",
    remaining: 0,
    posts: 2,
    threads: 0,
  },
  async (c) => {
    await open(c);
    const member = await c.readAdminMemberState({ memberId: "71" });
    assert.equal(member.kind, "admin-member-state");
    assert.deepEqual(member.member, memberView);
    assert.equal(member.postRows, 6);
    assert.deepEqual(member.cleanupChoices, [
      "post",
      "postcomment",
      "avatar",
      "profile",
    ]);
    assert.equal(member.crimes[0].text, "Fictional warning");
    assert.deepEqual(await c.stepAdminCleanup(member, true), {
      kind: "invalid-input",
    });
    assert.deepEqual(
      await c.changeAdminBan(member, { ...banArgs, days: 60 }, true),
      { kind: "invalid-input" },
    );
    assert.deepEqual(await c.changeAdminBan(member, banArgs, false), {
      kind: "not-confirmed",
    });
    const ban = await c.changeAdminBan(member, banArgs, true);
    assert.equal(ban.kind, "ban-acknowledged");
    assert.equal(ban.memberId, "71");
    assert.deepEqual(ban.cleared, ["postcomment", "avatar", "profile"]);
    assert.deepEqual(ban.cleanup, {
      kind: "cleanup-checkpoint",
      memberId: "71",
      cursor: "0-0",
      remaining: 6,
    });
    assert.deepEqual(await c.stepAdminCleanup(ban.cleanup, false), {
      kind: "not-confirmed",
    });
    const first = await c.stepAdminCleanup(ban.cleanup, true);
    assert.equal(first.kind, "cleanup-progress");
    assert.equal(first.remaining, 2);
    assert.deepEqual(await c.stepAdminCleanup(ban.cleanup, true), {
      kind: "invalid-input",
    });
    return c.stepAdminCleanup(first.next, true);
  },
);
await scenario(
  "a protected member state explains why a ban is unavailable",
  [
    ...openSteps(),
    step("adminban", banPage({ can: 0, why: "protected" }), {
      authorized: true,
      query: { uid: "71" },
    }),
  ],
  {
    kind: "refused",
    code: "admin_noperm",
    why: "protected",
    action: "adminban",
  },
  async (c) => {
    await open(c);
    const member = await c.readAdminMemberState({ memberId: "71" });
    assert.equal(member.canChange, false);
    return c.changeAdminBan(member, banArgs, true);
  },
);
const readPendingCleanup = step(
  "adminban",
  banPage({}, { banned: "post", post_left: 2, clear_pending: 1 }),
  { authorized: true, query: { uid: "71" } },
);
for (const [name, result, expected] of [
  [
    "resumes from fresh server state",
    batchResult({ done: 1, remaining: 0, cursor: "", posts: 2, threads: 0 }),
    {
      kind: "cleanup-complete",
      memberId: "71",
      remaining: 0,
      posts: 2,
      threads: 0,
    },
  ],
  [
    "refusal to continue is visible",
    standard({ ok: 0, error: "clear_start", target_uid: 71 }),
    { kind: "refused", code: "clear_start", action: "adminban" },
  ],
  [
    "nonadvancing cursor cannot confirm progress",
    batchResult({ cursor: "0-0", remaining: 2 }),
    { kind: "uncertain", operation: "clear" },
  ],
  [
    "cleanup must identify the distinct target UID",
    batchResult({ done: 1, remaining: 0, target_uid: 31 }),
    { kind: "uncertain", operation: "clear" },
  ],
]) {
  await scenario(
    "cleanup " + name,
    [...openSteps(), readPendingCleanup, batchStep("0-0", result)],
    expected,
    async (c) => {
      await open(c);
      return c.stepAdminCleanup(
        await c.readAdminMemberState({ memberId: "71" }),
        true,
      );
    },
  );
}
for (const [name, ban, days] of [
  ["visit restriction", "visit", 7],
  ["member status restriction", "status", 0],
  ["lift ban", "", 0],
]) {
  const form = {
    op: "ban",
    uid: "71",
    bannew: ban,
    ...(days && { banexpirynew: String(days) }),
    reason: "Fictional reason",
    opid: banKey,
    formhash,
  };
  await scenario(
    name,
    [
      ...openSteps(),
      banRead,
      step(
        "adminban",
        standard({
          type: "adminban",
          schema: 30,
          op: "ban",
          target_uid: 71,
          cleared: [],
          clear_posts: null,
        }),
        { authorized: true, form },
      ),
    ],
    {
      kind: "ban-acknowledged",
      memberId: "71",
      operationId: banKey,
      cleared: [],
      cleanup: null,
    },
    async (c) => {
      await open(c);
      return c.changeAdminBan(
        await c.readAdminMemberState({ memberId: "71" }),
        { ban, days, reason: "Fictional reason", operationId: banKey },
        true,
      );
    },
  );
}
const example = await import("./example.mjs");
await scenario(
  "packaged TypeScript reads reports and closes the separate session",
  [
    ...openSteps(),
    pending,
    step("admin", standard({ type: "admin", op: "logout" }), {
      authorized: true,
      form: { op: "logout", formhash },
    }),
  ],
  { kind: "admin-reports", reportIds: ["91", "92"] },
  async (_c, _x, options) => {
    const reports = await example.inspectPendingReports(
      options,
      async () => true,
      async () => ({ password: fixturePassword }),
    );
    return {
      kind: reports.kind,
      reportIds: reports.reports.map((report) => report.id),
    };
  },
);
await scenario(
  "a server-requested security question becomes a local login requirement",
  [
    step("status", status()),
    step("admin", access()),
    step(
      "admin",
      standard({ ok: 0, error: "admin_secques", token: fixtureToken }),
      { form: { op: "login", password: fixturePassword, formhash } },
    ),
    step("admin", loginReply(), {
      form: {
        op: "login",
        password: fixturePassword,
        questionid: "3",
        answer: fixtureAnswer,
        formhash,
      },
    }),
  ],
  { kind: "admin-opened" },
  async (c) => {
    await c.discoverAdmin();
    assert.deepEqual(
      await c.openAdminSession({ password: fixturePassword }, true),
      { kind: "refused", code: "admin_secques" },
    );
    assert.deepEqual(
      await c.openAdminSession({ password: fixturePassword }, true),
      { kind: "invalid-input" },
    );
    return c.openAdminSession(
      { password: fixturePassword, question: { id: 3, answer: fixtureAnswer } },
      true,
    );
  },
);
await scenario(
  "rate-limit response is never retried without an explicit new call",
  [
    ...openSteps(),
    creditRead,
    step(
      "admincredit",
      { ok: 0, error: "busy", retry_after: 4 },
      { status: 429, authorized: true, form: creditForm },
    ),
  ],
  { kind: "refused", code: "busy", retryAfter: 4, action: "admincredit" },
  async (c) => {
    await open(c);
    return c.adjustAdminCredits(await creditLookup(c), creditArgs, true);
  },
);
await scenario(
  "an action permission refusal keeps other actions and the separate token usable",
  [
    ...openSteps(),
    creditRead,
    step(
      "admincredit",
      standard({ ok: 0, error: "admin_noperm", why: "allowpost" }),
      { authorized: true, form: creditForm },
    ),
    pending,
  ],
  { kind: "admin-reports", ids: ["91", "92"] },
  async (c) => {
    await open(c);
    assert.deepEqual(
      await c.adjustAdminCredits(await creditLookup(c), creditArgs, true),
      {
        kind: "refused",
        code: "admin_noperm",
        why: "allowpost",
        action: "admincredit",
      },
    );
    const reports = await c.readAdminReports("pending");
    return {
      kind: reports.kind,
      ids: reports.reports.map((report) => report.id),
    };
  },
);

const moderator = {
  memberId: "44",
  continuity: "separate-fictional-moderator",
};
const moderatorRequests = [];
const panel = createModeratorPanelClient({
  origin,
  session: () => moderator,
  transport: {
    async request(url, request) {
      moderatorRequests.push({ url, ...request });
      return {
        url,
        status: 200,
        redirect: "none",
        contentType: "application/json",
        body: JSON.stringify({
          ok: 1,
          uid: 44,
          type: "modcp_report",
          schema: 28,
          fid: 12,
          page: 1,
          pages: 1,
          reports: [reportRow(91, { fid: 12 })],
        }),
      };
    },
  },
});
const moderatorPage = await panel.readReports("12");
assert.equal(moderatorPage.kind, "reports");
assert.deepEqual(
  await panel.prepareReportDeletion(moderatorPage.page, ["91"], false),
  { kind: "not-confirmed" },
);
const handoff = await panel.prepareReportDeletion(
  moderatorPage.page,
  ["91"],
  true,
);
const expectedHandoff = {
  kind: "admin-report-deletion",
  origin,
  forumId: "12",
  reportIds: ["91"],
};
assert.deepEqual(handoff, expectedHandoff);
const expectedModeratorRequests = [
  {
    url:
      origin + "/forum.php?mod=modcp&action=report&fid=12&tsdmapp=json&nodoc=1",
    method: "GET",
    effect: false,
    fresh: true,
    session: moderator,
  },
];
assert.deepEqual(moderatorRequests, expectedModeratorRequests);
results.push({
  name: "moderator report selection contains no credential or effect",
  expected: expectedHandoff,
  observed: handoff,
  expectedRequests: expectedModeratorRequests,
  requests: moderatorRequests,
});
const handoffRead = step(
  "adminreport",
  reportPage("new", [reportRow(91, { fid: 12 }), reportRow(92)]),
  { authorized: true, query: { op: "new" } },
);
const deleteOnce = step(
  "adminreport",
  standard({ type: "adminreport", schema: 29, op: "delete", deleted: [91] }),
  {
    authorized: true,
    form: { op: "delete", "ids[0]": "91", opid: reportKey, formhash },
  },
);
const logout = step("admin", standard({ type: "admin", op: "logout" }), {
  authorized: true,
  form: { op: "logout", formhash },
});
const useHandoff = (
  options,
  selection,
  approveDeletion = async (rows) => {
    assert.deepEqual(
      rows.map((report) => [report.id, report.forumId]),
      [["91", "12"]],
    );
    return true;
  },
) =>
  example.completeReportDeletion(
    options,
    selection,
    1,
    reportKey,
    async () => true,
    async () => ({ password: fixturePassword }),
    approveDeletion,
  );
await scenario(
  "the installed administrator independently confirms and deletes the moderator’s exact selection under a distinct member session",
  [...openSteps(), handoffRead, deleteOnce, logout],
  {
    kind: "reports-deleted",
    deleted: ["91"],
    unreported: [],
    operationId: reportKey,
  },
  (_c, _x, options) => useHandoff(options, handoff),
);
await scenario(
  "same report ID in a different forum cannot complete a moderator handoff",
  [...openSteps(), pending, logout],
  { kind: "invalid-input" },
  (_c, _x, options) => useHandoff(options, handoff),
);
await scenario(
  "declined administrator report deletion still closes the separately opened session",
  [...openSteps(), handoffRead, logout],
  { kind: "not-confirmed" },
  (_c, _x, options) => useHandoff(options, handoff, async () => false),
);
await scenario(
  "another origin’s handoff opens no administrator session",
  [],
  { kind: "invalid-input" },
  (_c, _x, options) =>
    useHandoff(options, { ...handoff, origin: "https://unrelated.example" }),
);

console.log(JSON.stringify(results));
