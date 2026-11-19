import assert from "node:assert/strict";
import { createModeratorPanelClient } from "tsdm-sdk";

const origin = "https://forum.test";
const moderator = { memberId: "31", continuity: "fictional-panel-session" };
const loginPage = `<script>var discuz_uid = '31';</script>
<form method="post" action="forum.php?mod=modcp&amp;action=login">
<input type="hidden" name="fid" value="0"><input type="hidden" name="formhash" value="abcdef12">
<input type="hidden" name="submit" value="yes"><input type="hidden" name="login_panel" value="yes">
<input type="password" name="cppwd"></form>`;
const home = {
  ok: 1,
  uid: 31,
  type: "modcp_home",
  schema: 39,
  fid: 0,
  ismoderator: 1,
  counts: { moderate: 3, notes: 0, forums: 1 },
  forums: [{ fid: 10, name: "Fixture forum" }],
  notes: [],
};
const results = [];
const check = (name, actual, expected) => {
  assert.deepEqual(actual, expected, name);
  results.push({ name, actual, expected });
};
const trace = (method, query, fields = null, effect = method === "POST") => [
  method,
  { mod: "modcp", ...query },
  fields,
  effect,
];
const dashboard = trace("GET", { action: "home", tsdmapp: "json", nodoc: "1" });
const login = trace("POST", { action: "login" }, [
  ["formhash", "abcdef12"],
  ["fid", "0"],
  ["submit", "yes"],
  ["login_panel", "yes"],
  ["cppwd", "fictional-password"],
]);
function controlled(replies) {
  let owner = moderator;
  const calls = [];
  const client = createModeratorPanelClient({
    origin,
    session: () => owner,
    transport: {
      async request(url, request) {
        assert.equal(request.fresh, true);
        assert.deepEqual(request.session, owner);
        const target = new URL(url);
        assert.equal(target.origin, origin);
        assert.equal(
          target.pathname,
          target.searchParams.get("id") === "tsdmapp:api"
            ? "/plugin.php"
            : "/forum.php",
        );
        calls.push([
          request.method,
          Object.fromEntries(target.searchParams),
          request.body ? [...new URLSearchParams(request.body)] : null,
          request.effect,
        ]);
        assert.ok(replies.length, "unexpected dispatch");
        let value = replies.shift();
        if (typeof value === "function") value = value();
        if (value instanceof Error) throw value;
        const body = typeof value === "string" ? value : JSON.stringify(value);
        return {
          url,
          status: 200,
          contentType:
            typeof value === "string" ? "text/html" : "application/json",
          body,
          redirect: "none",
          ...value?.response,
        };
      },
    },
  });
  return {
    client,
    calls,
    replaceSession() {
      owner = { ...owner, continuity: "replacement" };
    },
  };
}
{
  const { client, calls } = controlled([
    loginPage,
    { response: { status: 302, body: "" } },
    home,
  ]);
  const asked = await client.readDashboard();
  assert.equal(asked.kind, "panel-login");
  assert.equal(JSON.stringify(asked).includes("abcdef12"), false);
  const declined = await client.login(asked.form, "fictional-password", false);
  const opened = await client.login(asked.form, "fictional-password", true);
  const reused = await client.login(asked.form, "fictional-password", true);
  check(
    "login requires confirmation, single-use form and observed dashboard",
    [declined.kind, opened.kind, opened.page?.counts, reused.kind, calls],
    [
      "not-confirmed",
      "dashboard",
      home.counts,
      "stale",
      [dashboard, login, dashboard],
    ],
  );
}
{
  const { client, calls } = controlled([loginPage, loginPage]);
  const asked = await client.readDashboard();
  const refused = await client.login(asked.form, "fictional-password", true);
  check(
    "redrawn password form reports refusal after one attempt",
    [refused.kind, calls],
    ["refused", [dashboard, login]],
  );
}
{
  const { client, calls, replaceSession } = controlled([loginPage]);
  const asked = await client.readDashboard();
  replaceSession();
  check(
    "another login as the same member cannot use the panel form",
    [(await client.login(asked.form, "fictional-password", true)).kind, calls],
    ["session-changed", [dashboard]],
  );
}
{
  const { client, calls } = controlled([loginPage, new Error("lost reply")]);
  const asked = await client.readDashboard();
  check(
    "lost login reply is uncertain without resending",
    [(await client.login(asked.form, "fictional-password", true)).kind, calls],
    ["uncertain", [dashboard, login]],
  );
}

const structured = { tsdmapp: "json", nodoc: "1" };
const threadRoute = { action: "thread", op: "thread" };
const postRoute = { action: "thread", op: "post" };
const row = (pid) => ({
  pid,
  tid: 801,
  fid: 10,
  authorid: 99,
  subject: "fixture post",
});
const searches = {
  threads: {
    ok: 1,
    uid: 31,
    fid: 10,
    type: "modcp_thread",
    schema: 36,
    do: "list",
    page: 1,
    pages: 2,
    search: {
      url: "forum.php?mod=modcp&action=thread&op=thread",
      method: "GET",
      fields: { do: "search", submit: "true" },
      fid_field: "fid",
    },
    list_url: "forum.php?mod=modcp&action=thread&op=thread&do=list&fid=10",
    threads: [{ tid: 801, fid: 10, subject: "fixture thread" }],
  },
  posts: {
    ok: 1,
    uid: 31,
    fid: 10,
    type: "modcp_post",
    schema: 37,
    do: "list",
    page: 1,
    pages: 2,
    error: 0,
    allow_delete: 1,
    search: {
      url: "forum.php?mod=modcp&action=thread&op=post",
      method: "GET",
      fields: { do: "search", searchsubmit: "true", posttableid: "0" },
      fid_field: "fid",
    },
    delete: {
      url: "forum.php?mod=modcp&action=thread&op=post",
      method: "POST",
      fields: {
        formhash: "abcdef12",
        fid: "10",
        do: "delete",
        posttableid: "0",
        deletesubmit: "true",
      },
      ids_field: "delete[]",
      nocredit_field: "nocredit",
    },
    list_url:
      "forum.php?mod=modcp&action=thread&op=post&do=list&fid=10&posttableid=0",
    posts: [row(901), row(902)],
  },
};
for (const [kind, route, start, extra, ids] of [
  ["threads", threadRoute, searches.threads, { submit: "true" }, ["801"]],
  [
    "posts",
    postRoute,
    searches.posts,
    { searchsubmit: "true", posttableid: "0" },
    ["901", "902"],
  ],
]) {
  const { client, calls } = controlled([
    start,
    start,
    { ...start, page: 2 },
    start,
  ]);
  const offered = await client.readSearch(kind, "10");
  assert.equal(offered.kind, "search-page");
  const denied = await client.search(
    offered.page,
    { keywords: "fiction" },
    false,
  );
  const found = await client.search(
    offered.page,
    { keywords: "fiction" },
    true,
  );
  assert.equal(found.kind, "search-page");
  const more = await client.readSearchResults(found.page, 2);
  const again = await client.search(offered.page, { keywords: "new" }, true);
  const stale = await client.readSearchResults(found.page, 2);
  check(
    `${kind} search opens, retains results and invalidates old pagination`,
    [
      denied.kind,
      found.page.items.map((item) => item.id),
      more.page?.page,
      again.kind,
      stale.kind,
      calls,
    ],
    [
      "not-confirmed",
      ids,
      2,
      "search-page",
      "stale",
      [
        trace("GET", { ...route, fid: "10", ...structured }),
        trace(
          "GET",
          {
            ...route,
            do: "search",
            ...extra,
            fid: "10",
            keywords: "fiction",
            ...structured,
          },
          null,
          true,
        ),
        trace("GET", {
          ...route,
          do: "list",
          fid: "10",
          ...(kind === "posts" ? { posttableid: "0" } : {}),
          page: "2",
          ...structured,
        }),
        trace(
          "GET",
          {
            ...route,
            do: "search",
            ...extra,
            fid: "10",
            keywords: "new",
            ...structured,
          },
          null,
          true,
        ),
      ],
    ],
  );
}
{
  const { client, calls } = controlled([
    searches.posts,
    {
      ...searches.posts,
      pages: 1,
      posts: [row(902)],
      message_key: "modcp_thread_delete_succeed",
    },
  ]);
  const read = await client.readSearch("posts", "10");
  const unsafe = await client.deleteSelectedPosts(
    read.page,
    ["999"],
    true,
    true,
  );
  const declined = await client.deleteSelectedPosts(
    read.page,
    ["901", "902"],
    true,
    false,
  );
  const deleted = await client.deleteSelectedPosts(
    read.page,
    ["901", "902"],
    true,
    true,
  );
  check(
    "post deletion is selected, confirmed and reports a partial result",
    [unsafe.kind, declined.kind, deleted, calls],
    [
      "invalid-input",
      "not-confirmed",
      {
        kind: "partial",
        confirmedIds: ["901"],
        remainingIds: ["902"],
        unknownIds: [],
      },
      [
        trace("GET", { ...postRoute, fid: "10", ...structured }),
        trace("POST", { ...postRoute, tsdmapp: "json" }, [
          ["formhash", "abcdef12"],
          ["fid", "10"],
          ["do", "delete"],
          ["posttableid", "0"],
          ["deletesubmit", "true"],
          ["delete[0]", "901"],
          ["delete[1]", "902"],
          ["nocredit", "1"],
        ]),
      ],
    ],
  );
}
{
  const { client, calls } = controlled([
    { ...searches.posts, allow_delete: 0 },
  ]);
  const read = await client.readSearch("posts", "10");
  check(
    "post deletion needs returned permission",
    [
      (await client.deleteSelectedPosts(read.page, ["901"], false, true)).kind,
      calls,
    ],
    ["refused", [trace("GET", { ...postRoute, fid: "10", ...structured })]],
  );
}
const reportRoute = { action: "report", fid: "10" };
const listedReports = {
  ok: 1,
  uid: 31,
  type: "modcp_report",
  schema: 28,
  fid: 10,
  page: 1,
  pages: 1,
  reports: [
    { id: 501, uid: 77, pid: 901, fid: 10, message: "fixture report" },
    { id: 502, uid: 0, pid: 902, fid: 10, message: "missing reporter" },
  ],
  reward: { enabled: 1, min: -3, max: 3 },
  submit: {
    url: "forum.php?mod=modcp&action=report&fid=10",
    method: "POST",
    fields: { formhash: "abcdef12", reportsubmit: "true" },
    ids_field: "reportids[]",
    uid_field: "reportuids[{id}]",
    credit_field: "creditsvalue[{id}]",
    msg_field: "msg[{id}]",
  },
};
const receipt = (key, extra = {}) => ({
  ok: 1,
  uid: 31,
  type: "result",
  schema: 13,
  kind: "message",
  message_key: key,
  alert: "right",
  ...extra,
});
{
  const { client, calls } = controlled([
    listedReports,
    receipt("modcp_report_success"),
  ]);
  const page = await client.readReports("10");
  assert.equal(page.kind, "reports");
  const noDelete = await client.deleteReports(page.page, ["501"], true);
  const missing = await client.resolveReport(page.page, { id: "502" }, true);
  const outOfRange = await client.resolveReport(
    page.page,
    { id: "501", credit: 4 },
    true,
  );
  const denied = await client.resolveReport(page.page, { id: "501" }, false);
  const done = await client.resolveReport(
    page.page,
    { id: "501", credit: 2, message: " reviewed " },
    true,
  );
  check(
    "report read, unsupported panel deletion, validation and confirmed resolution",
    [
      page.page.items.map((item) => [item.id, item.reporterId]),
      noDelete,
      missing.kind,
      outOfRange.kind,
      denied.kind,
      done,
      calls,
    ],
    [
      [
        ["501", "77"],
        ["502", null],
      ],
      { kind: "refused", code: "panel-report-delete-unavailable" },
      "invalid-input",
      "invalid-input",
      "not-confirmed",
      { kind: "acknowledged", id: "501", code: "modcp_report_success" },
      [
        trace("GET", { ...reportRoute, ...structured }),
        trace("POST", reportRoute, [
          ["formhash", "abcdef12"],
          ["reportsubmit", "true"],
          ["reportids[0]", "501"],
          ["reportuids[501]", "77"],
          ["creditsvalue[501]", "2"],
          ["msg[501]", "reviewed"],
        ]),
      ],
    ],
  );
}
for (const [name, value, kind] of [
  [
    "server denial",
    receipt("quickclear_noperm", { alert: "error" }),
    "refused",
  ],
  [
    "redrawn panel login",
    receipt("", { kind: "page", document: loginPage }),
    "refused",
  ],
  ["blank acknowledgement", receipt(""), "uncertain"],
  ["lost response", new Error("lost reply"), "uncertain"],
]) {
  const { client, calls } = controlled([listedReports, value]);
  const page = await client.readReports("10");
  check(
    `report resolution ${name} sends once`,
    [
      (await client.resolveReport(page.page, { id: "501" }, true)).kind,
      calls.length,
    ],
    [kind, 2],
  );
}
const capabilities = {
  ok: 1,
  uid: 31,
  v4: 1,
  modcp_pages_v4: ["moderate", "recyclebin", "recyclebinpost"],
};
const status = ["GET", { id: "tsdmapp:api", action: "status" }, null, false];
const v4 = { ...structured, tsdmv: "4" };
const queue = (op, items) => ({
  ok: 1,
  uid: 31,
  type: "modcp_moderate",
  schema: 42,
  op,
  fid: op === "members" ? 0 : 10,
  forum: op === "members" ? "" : "Fixture forum",
  forums: [{ fid: 10, name: "Fixture forum" }],
  allowed: 1,
  filter: 0,
  page: 1,
  pages: 1,
  [op === "members" ? "members" : "items"]: items,
  submit: {
    url: `forum.php?mod=modcp&action=moderate&op=${op}`,
    method: "POST",
    fields: { formhash: "abcdef12", filter: "0", modsubmit: "1" },
    ids_field: "moderate[]",
    action_field: "modact",
    actions: ["validate", "delete", "ignore"],
    reason_field: "reason",
  },
});
for (const [op, item, decision] of [
  [
    "threads",
    {
      id: 801,
      fid: 10,
      thread_subject: "Fixture thread",
      authorid: 99,
      author: "fiction author",
    },
    "validate",
  ],
  [
    "replies",
    {
      id: 901,
      fid: 10,
      thread_subject: "Fixture thread",
      authorid: 0,
      author: "unknown author",
    },
    "ignore",
  ],
  [
    "members",
    { uid: 105, username: "fiction applicant", can_delete: 1 },
    "delete",
  ],
]) {
  const isMember = op === "members";
  const rowId = String(isMember ? item.uid : item.id);
  const forum = isMember ? {} : { fid: "10" };
  const route = { action: "moderate", op, ...forum };
  const read = trace("GET", { ...route, filter: "0", ...v4 });
  const write = trace(
    "POST",
    {
      ...route,
      ...(!isMember && { infloat: "yes", inajax: "1" }),
      tsdmapp: "json",
      tsdmv: "4",
    },
    isMember
      ? [
          ["formhash", "abcdef12"],
          ["filter", "0"],
          ["modact", decision],
          ["modsubmit", "1"],
          ["moderate[0]", rowId],
          ["reason", "fixture reason"],
        ]
      : [
          ["formhash", "abcdef12"],
          ["filter", "0"],
          ["fid", "10"],
          ["modact", decision],
          ["modsubmit", "1"],
          ["handlekey", "mods"],
          ["moderate[]", rowId],
          ["reason", "fixture reason"],
        ],
  );
  const { client, calls } = controlled([
    capabilities,
    queue(op, [item]),
    receipt("modcp_mod_succeed"),
    ...(isMember ? [queue(op, [])] : []),
  ]);
  const loaded = await client.readQueue(op, isMember ? "0" : "10");
  assert.equal(loaded.kind, "queue");
  const decline = await client.moderateQueue(
    loaded.page,
    rowId,
    decision,
    "fixture reason",
    false,
  );
  const applied = await client.moderateQueue(
    loaded.page,
    rowId,
    decision,
    "fixture reason",
    true,
  );
  check(
    `${op} queue read, confirmation and distinct outcome`,
    [
      loaded.page.items.map((item) => [item.id, item.authorId]),
      decline.kind,
      applied,
      calls,
    ],
    [
      [[rowId, op === "threads" ? "99" : null]],
      "not-confirmed",
      isMember
        ? {
            kind: "completed",
            confirmedIds: [rowId],
            remainingIds: [],
            unknownIds: [],
          }
        : { kind: "acknowledged", id: rowId, code: "modcp_mod_succeed" },
      [status, read, write, ...(isMember ? [read] : [])],
    ],
  );
}
{
  const { client, calls } = controlled([
    capabilities,
    queue("members", [
      { uid: 105, username: "fiction applicant", can_delete: 0 },
    ]),
  ]);
  const result = await client.readQueue("members");
  check(
    "registration account deletion requires per-item permission",
    [
      (await client.moderateQueue(result.page, "105", "delete", "", true)).kind,
      calls.length,
    ],
    ["refused", 2],
  );
}
{
  const nativeReply = `<ul class="tb"><li class="a"><a href="forum.php?mod=modcp&amp;action=moderate&amp;op=replies">Replies</a></li></ul>
  <select name="fid"><option value="10" selected>Fiction</option></select>
  <form method="post" id="moderate" action="forum.php?mod=modcp&amp;action=moderate&amp;op=replies">
  <input type="hidden" name="fid" value="10"><input type="hidden" name="formhash" value="abcdef12"><input type="hidden" name="filter" value="0">
  <input type="hidden" name="posttableid" value="0"><div class="um"><span class="xw1">Waiting reply</span><span class="xi2">anonymous fixture</span>
  <a href="forum.php?mod=modcp&amp;action=moderate&amp;op=replies&amp;moderate[]=901&amp;modact=validate">Approve</a>
  <input type="checkbox" name="moderate[]" value="901"></div></form>`;
  const { client, calls } = controlled([
    { ok: 1, uid: 31, v4: 0 },
    nativeReply,
    {
      response: {
        contentType: "text/xml",
        body: "<root><![CDATA[<script>succeedhandle_mods('', 'done', {});</script>]]></root>",
      },
    },
  ]);
  const result = await client.readQueue("replies", "10");
  assert.equal(result.kind, "queue");
  check(
    "native reply queue preserves missing author identity and uses AJAX verdict",
    [
      result.page.items[0]?.authorId,
      (await client.moderateQueue(result.page, "901", "validate", "", true))
        .kind,
      calls,
    ],
    [
      null,
      "acknowledged",
      [
        status,
        trace("GET", {
          action: "moderate",
          op: "replies",
          fid: "10",
          filter: "0",
        }),
        trace(
          "POST",
          {
            action: "moderate",
            op: "replies",
            fid: "10",
            infloat: "yes",
            inajax: "1",
          },
          [
            ["fid", "10"],
            ["formhash", "abcdef12"],
            ["filter", "0"],
            ["posttableid", "0"],
            ["modact", "validate"],
            ["modsubmit", "1"],
            ["handlekey", "mods"],
            ["moderate[]", "901"],
            ["reason", ""],
          ],
        ),
      ],
    ],
  );
}
const binRoute = (kind) => ({
  action: kind === "threads" ? "recyclebin" : "recyclebinpost",
});
const nativeBin = (
  kind,
  ids,
  { clear = false, next = false, fid = "10" } = {},
) => {
  const { action } = binRoute(kind);
  return `<script>var discuz_uid = '31';</script><ul class="tb"><li class="a"><a href="forum.php?mod=modcp&amp;action=${action}&amp;fid=${fid}">Bin</a></li></ul>
  <form method="post" action="forum.php?mod=modcp&amp;action=${action}&amp;op=search">
  <input type="hidden" name="formhash" value="abcdef12"><select name="fid"><option value="${fid}" selected>Fixture forum</option></select>
  <input name="keywords" type="text"><button type="submit" name="searchsubmit" value="true">Search</button></form>
  ${
    ids.length
      ? `<form method="post" id="moderate" action="forum.php?mod=modcp&amp;fid=${fid}&amp;action=${action}">
  <input type="hidden" name="formhash" value="abcdef12"><input type="hidden" name="oldop" value="list"><input type="hidden" name="dosubmit" value="submit">
  ${kind === "posts" ? `<input type="hidden" name="posttableid" value="0">` : ""}
  <table>${ids.map((id) => `<tr><td><input type="checkbox" name="moderate[]" value="${id}"></td><td><a href="forum.php?mod=redirect&amp;goto=findpost&amp;ptid=801&amp;pid=${id}">fixture ${id}</a></td></tr>`).join("")}</table>
  <button onclick="modthreads('restore')">Restore</button>${clear ? `<button onclick="modthreads('delete')">Delete</button>` : ""}</form>`
      : `<p class="emp">No results</p>`
  }
  ${next ? `<a class="nxt" href="forum.php?mod=modcp&amp;action=${action}&amp;fid=${fid}&amp;page=2">Next</a>` : ""}`;
};
for (const [kind, selected] of [
  ["threads", "801"],
  ["posts", "901"],
]) {
  const route = binRoute(kind);
  const read = trace("GET", { ...route, fid: "10" });
  const search = trace("POST", { ...route, op: "search" }, [
    ["formhash", "abcdef12"],
    ["fid", "10"],
    ["keywords", "fiction"],
    ["searchsubmit", "true"],
  ]);
  const apply = (op) =>
    trace("POST", { ...route, fid: "10", page: "1" }, [
      ["formhash", "abcdef12"],
      ...(kind === "posts" ? [["posttableid", "0"]] : []),
      ["op", op],
      ["oldop", "list"],
      ["dosubmit", "submit"],
      ["moderate[0]", selected],
    ]);
  const { client, calls } = controlled([
    nativeBin(kind, [selected]),
    nativeBin(kind, [selected]),
    nativeBin(kind, []),
    nativeBin(kind, []),
    nativeBin(kind, [selected], { clear: true }),
    nativeBin(kind, []),
    nativeBin(kind, []),
  ]);
  const shown = await client.readRecycleBin(kind, "10", 1, "native");
  assert.equal(shown.kind, "recycle-bin");
  const searchDenied = await client.searchRecycleBin(
    shown.page,
    { keywords: "fiction" },
    false,
  );
  const found = await client.searchRecycleBin(
    shown.page,
    { keywords: "fiction" },
    true,
  );
  assert.equal(found.kind, "recycle-bin");
  const noPermission = await client.permanentlyDeleteFromRecycleBin(
    found.page,
    [selected],
    true,
  );
  const decline = await client.restoreFromRecycleBin(
    found.page,
    [selected],
    false,
  );
  const restored = await client.restoreFromRecycleBin(
    found.page,
    [selected],
    true,
  );
  const privileged = await client.readRecycleBin(kind, "10", 1, "native");
  const deleted = await client.permanentlyDeleteFromRecycleBin(
    privileged.page,
    [selected],
    true,
  );
  check(
    `${kind} bin search, restore and permanent deletion use distinct selected requests`,
    [
      found.page.items.map((item) => item.id),
      searchDenied.kind,
      noPermission.kind,
      decline.kind,
      restored,
      deleted,
      calls,
    ],
    [
      [selected],
      "not-confirmed",
      "refused",
      "not-confirmed",
      {
        kind: "completed",
        confirmedIds: [selected],
        remainingIds: [],
        unknownIds: [],
      },
      {
        kind: "completed",
        confirmedIds: [selected],
        remainingIds: [],
        unknownIds: [],
      },
      [read, search, apply("restore"), read, read, apply("delete"), read],
    ],
  );
}
for (const [name, replies, expected] of [
  ["wrong forum reply", [nativeBin("posts", [], { fid: "11" })], "uncertain"],
  ["reply lost", [new Error("lost")], "uncertain"],
  [
    "selection remains listed",
    [nativeBin("posts", ["901"]), nativeBin("posts", ["901"])],
    "redrawn",
  ],
  [
    "incomplete follow-up",
    [nativeBin("posts", []), nativeBin("posts", ["905"], { next: true })],
    "uncertain",
  ],
  ["panel session ended", [loginPage], "refused"],
]) {
  const { client, calls } = controlled([
    nativeBin("posts", ["901"]),
    ...replies,
  ]);
  const shown = await client.readRecycleBin("posts", "10", 1, "native");
  const changed = await client.restoreFromRecycleBin(shown.page, ["901"], true);
  check(
    `post bin ${name}`,
    [changed.kind, calls.map((request) => request[0])],
    [expected, ["GET", "POST", ...(replies.length === 2 ? ["GET"] : [])]],
  );
}
{
  const route = { action: "recyclebinpost" };
  const structuredBin = (posts) => ({
    ok: 1,
    uid: 31,
    type: "modcp_recyclebinpost",
    schema: 45,
    op: "list",
    fid: 10,
    enabled: 1,
    need_forum: 0,
    can_delete: 1,
    page: 1,
    pages: 1,
    posttableid: 0,
    forums: [{ fid: 10, name: "Fixture forum" }],
    posts,
    search: {
      url: "forum.php?mod=modcp&action=recyclebinpost&op=search",
      method: "POST",
      fields: { formhash: "abcdef12", searchsubmit: "true" },
      fid_field: "fid",
      posttable_field: "posttableid",
    },
    submit: {
      url: "forum.php?mod=modcp&action=recyclebinpost&fid=10",
      method: "POST",
      fields: {
        formhash: "abcdef12",
        oldop: "list",
        dosubmit: "submit",
        posttableid: "0",
      },
      ids_field: "moderate[]",
      action_field: "op",
      actions: ["restore", "delete"],
    },
  });
  const { client, calls } = controlled([
    capabilities,
    structuredBin([row(901)]),
    { ...structuredBin([row(901)]), op: "search" },
    structuredBin([]),
    structuredBin([]),
  ]);
  const initial = await client.readRecycleBin("posts", "10");
  assert.equal(initial.kind, "recycle-bin");
  const found = await client.searchRecycleBin(
    initial.page,
    { keywords: "fiction" },
    true,
  );
  assert.equal(found.kind, "recycle-bin");
  const deleted = await client.permanentlyDeleteFromRecycleBin(
    found.page,
    ["901"],
    true,
  );
  check(
    "v4 post bin searches and verifies selected permanent deletion",
    [found.page.items[0]?.threadId, deleted.kind, calls],
    [
      "801",
      "completed",
      [
        status,
        trace("GET", { ...route, fid: "10", ...v4 }),
        trace("POST", { ...route, op: "search", tsdmapp: "json", tsdmv: "4" }, [
          ["formhash", "abcdef12"],
          ["fid", "10"],
          ["keywords", "fiction"],
          ["posttableid", "0"],
          ["searchsubmit", "true"],
        ]),
        trace(
          "POST",
          { ...route, fid: "10", page: "1", tsdmapp: "json", tsdmv: "4" },
          [
            ["formhash", "abcdef12"],
            ["posttableid", "0"],
            ["op", "delete"],
            ["oldop", "list"],
            ["dosubmit", "submit"],
            ["moderate[0]", "901"],
          ],
        ),
        trace("GET", { ...route, fid: "10", ...v4 }),
      ],
    ],
  );
}
{
  const { client, calls, replaceSession } = controlled([listedReports]);
  const report = await client.readReports("10");
  const declined = await client.prepareReportDeletion(
    report.page,
    ["501"],
    false,
  );
  const handoff = await client.prepareReportDeletion(
    report.page,
    ["501"],
    true,
  );
  const wrong = await client.prepareReportDeletion(report.page, ["999"], true);
  replaceSession();
  const stale = await client.prepareReportDeletion(report.page, ["501"], true);
  check(
    "report deletion hands only the scoped selection to a separate administrator host",
    [declined, handoff, wrong, stale, calls],
    [
      { kind: "not-confirmed" },
      {
        kind: "admin-report-deletion",
        origin,
        forumId: "10",
        reportIds: ["501"],
      },
      { kind: "invalid-input" },
      { kind: "session-changed" },
      [trace("GET", { ...reportRoute, ...structured })],
    ],
  );
}
for (const [kind, item, action] of [
  ["threads", { id: 801, fid: 10 }, "ignore"],
  ["threads", { id: 801, fid: 10 }, "delete"],
  ["replies", { id: 901, fid: 10 }, "validate"],
  ["replies", { id: 901, fid: 10 }, "delete"],
  ["members", { uid: 105, can_delete: 1 }, "validate"],
  ["members", { uid: 105, can_delete: 1 }, "ignore"],
]) {
  const member = kind === "members";
  const id = String(member ? item.uid : item.id);
  const { client, calls } = controlled([
    capabilities,
    queue(kind, [item]),
    receipt("modcp_mod_succeed"),
    ...(member ? [queue(kind, [])] : []),
  ]);
  const shown = await client.readQueue(kind, member ? "0" : "10");
  const outcome = await client.moderateQueue(
    shown.page,
    id,
    action,
    "fictional reason",
    true,
  );
  const sent = calls.filter(([method]) => method === "POST");
  check(
    `${kind} queue independently submits ${action}`,
    [outcome.kind, sent],
    [
      member ? "completed" : "acknowledged",
      [
        trace(
          "POST",
          {
            action: "moderate",
            op: kind,
            ...(!member && { fid: "10", infloat: "yes", inajax: "1" }),
            tsdmapp: "json",
            tsdmv: "4",
          },
          member
            ? [
                ["formhash", "abcdef12"],
                ["filter", "0"],
                ["modact", action],
                ["modsubmit", "1"],
                ["moderate[0]", id],
                ["reason", "fictional reason"],
              ]
            : [
                ["formhash", "abcdef12"],
                ["filter", "0"],
                ["fid", "10"],
                ["modact", action],
                ["modsubmit", "1"],
                ["handlekey", "mods"],
                ["moderate[]", id],
                ["reason", "fictional reason"],
              ],
        ),
      ],
    ],
  );
}
for (const [name, reply, result] of [
  ["explicit denial", receipt("modcp_noperm", { ok: 0 }), "refused"],
  ["panel expiry", loginPage, "refused"],
  ["redrawn queue", queue("threads", [{ id: 801, fid: 10 }]), "redrawn"],
  ["lost reply", new Error("dropped"), "uncertain"],
]) {
  const { client, calls } = controlled([
    capabilities,
    queue("threads", [{ id: 801, fid: 10 }]),
    reply,
  ]);
  const shown = await client.readQueue("threads", "10");
  const outcome = await client.moderateQueue(
    shown.page,
    "801",
    "validate",
    "",
    true,
  );
  check(
    `queue ${name} dispatches only once`,
    [outcome.kind, calls.map(([method]) => method)],
    [result, ["GET", "GET", "POST"]],
  );
}
{
  const foreign = loginPage.replace(
    'action="forum.php?',
    'action="https://wrong.test/forum.php?',
  );
  const { client, calls } = controlled([foreign]);
  check(
    "cross-origin login form sends no password and cannot be prepared",
    [(await client.readDashboard()).kind, calls],
    ["invalid-response", [dashboard]],
  );
}
{
  const { client, calls } = controlled([
    searches.posts,
    { ...searches.posts, pages: 1, posts: [] },
  ]);
  const shown = await client.readSearch("posts", "10");
  const outcome = await client.deleteSelectedPosts(
    shown.page,
    ["901"],
    false,
    true,
  );
  check(
    "post row disappearance without the deletion verdict stays uncertain",
    [outcome, calls.map(([method]) => method)],
    [
      {
        kind: "uncertain",
        confirmedIds: [],
        remainingIds: [],
        unknownIds: ["901"],
      },
      ["GET", "POST"],
    ],
  );
}
{
  const retable = (body) =>
    body.replace(
      'name="posttableid" value="0"',
      'name="posttableid" value="1"',
    );
  const { client, calls } = controlled([
    retable(nativeBin("posts", ["901"])),
    retable(nativeBin("posts", [])),
    nativeBin("posts", []),
  ]);
  const shown = await client.readRecycleBin("posts", "10", 1, "native");
  const outcome = await client.restoreFromRecycleBin(shown.page, ["901"], true);
  check(
    "post bin cannot verify absence on another or unidentified post table",
    [outcome.kind, calls.length],
    ["uncertain", 3],
  );
}
console.log(JSON.stringify({ results }));
