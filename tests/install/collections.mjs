import assert from "node:assert/strict";
import * as sdk from "tsdm-sdk";

const origin = "https://forum.example.test";
const actor = { memberId: "71", continuity: "fixture-session" };
const base = "/forum.php?mod=collection";
const view = (id) => `${base}&action=view&ctid=${id}`;
const commentView = `${base}&action=view&op=comment&ctid=91`;
const shell = (html, uid = 71) => `<script>var discuz_uid = '${uid}';</script>
<a href="member.php?mod=logging&amp;action=logout&amp;formhash=fixturehash">Exit</a><div id="ct">${html}</div>`;
const createLink = `<li><a href="${base}&action=edit">Create</a></li>`;
const row = (id, name, relation = "", extra = "") => `<div class="xld"><dl>
<dd class="m"><strong>7</strong></dd><dt>${relation}<a href="${view(id)}${extra}">${name}</a></dt>
<dd><p>About this collection</p><p>2, 3</p><p class="xg1"><a href="home.php?mod=space&uid=71">Alex Example</a> 2026-1-1</p></dd></dl></div>`;
const listing = (active, rows, more = "") =>
  shell(
    `<div class="tb"><ul>${createLink}<li class="a"><a href="${active}">Current</a></li></ul></div><div class="clct_list">${rows}</div>${more}`,
  );
const head = (id, links = "") =>
  `<div class="bm bml"><div class="bm_h"><h1><a href="${view(id)}">Example Archive</a></h1></div><div class="bm_c">${links}</div></div>`;
const detail = (id, links = "", pagination = "") =>
  shell(
    `${head(id, links)}<div class="tl"><form method="POST" action="${base}&action=edit&op=delthread"><input name="ctid" value="${id}"><input name="formhash" value="fixturehash"><div class="bm_c"><table><tr><td><input type="checkbox" name="delthread[]" value="501"></td><th title="Reason: Fictitious example"><a class="xst" href="forum.php?mod=viewthread&tid=501&ctid=${id}">Example thread</a></th></tr></table></div></form></div>${pagination}`,
  );
const comments = shell(
  `${head(91)}<div class="xld"><dl><dt><a href="home.php?mod=space&uid=72">Pat Example</a><span class="xg1">Yesterday</span></dt><dd class="cl"><span class="star star4"></span></dd><dd>Example comment</dd></dl></div><form method="POST" action="${base}&action=comment&ctid=91"><textarea name="message"></textarea><input name="ratescore"></form>`,
);
const receipt = [];
let session = actor;
const steps = [];
const client = sdk.createCollectionClient({
  origin,
  session: () => session,
  transport: {
    async request(url, options) {
      const step = steps.shift();
      assert.ok(step, `unexpected request for ${url}`);
      const [path, method, effect, response, body, change] = step;
      const actual = {
        url,
        ...options,
        ...(options.body && {
          body: Object.fromEntries(new URLSearchParams(options.body)),
        }),
      };
      assert.deepEqual(actual, {
        url: origin + path,
        method,
        effect,
        fresh: true,
        session,
        ...(body && { body }),
      });
      receipt.at(-1).requests.push(actual);
      if (change) change();
      if (response instanceof Error) throw response;
      if (response?.http)
        return {
          status: response.http,
          redirect: response.redirect ?? "none",
          url: response.url ?? url,
          body: response.body ?? "",
        };
      return {
        status: 200,
        redirect: "none",
        url,
        body:
          typeof response === "string" ? response : JSON.stringify(response),
      };
    },
  },
});
const get = (path, response) => [path, "GET", false, response];
async function check(name, expected, invoke, observe, ...requests) {
  steps.push(...requests);
  const entry = { name, expected, requests: [] };
  receipt.push(entry);
  const result = await invoke();
  entry.observed = observe(result);
  assert.deepEqual(entry.observed, expected, name);
  assert.equal(steps.length, 0, name);
  assert.equal(entry.requests.length, requests.length, name);
  return result;
}
const kind = (result) => result.kind;
const listResult = (result) => [
  result.kind,
  result.items?.map((x) => [x.id, x.relation]),
  result.page,
];
const mine = `${base}&op=my`;
const myPage = listing(
  mine,
  row(91, "Created", '<span class="ctag ctag0"></span>') +
    row(92, "Team", '<span class="ctag ctag1"></span>') +
    row(93, "Subscription", '<span class="ctag ctag2"></span>'),
);
await check(
  "recommended",
  ["list", [["91", null]], 1],
  () => client.readList({ tab: "recommended" }),
  listResult,
  get(base, listing(base, row(91, "Example"))),
);
const sorted = `${base}&op=all&order=follownum`;
await check(
  "all ordered",
  ["list", 2, 7, 3],
  () => client.readList({ tab: "all", order: "follownum" }),
  (r) => [
    r.kind,
    r.items?.[0]?.threadCount,
    r.items?.[0]?.followCount,
    r.items?.[0]?.commentCount,
  ],
  get(
    sorted,
    listing(
      sorted,
      row(91, "Example"),
      `<a class="a" href="${sorted}">By followers</a>`,
    ),
  ),
);
const createdList = await check(
  "owned and team",
  [
    "list",
    [
      ["91", "created"],
      ["92", "team"],
    ],
    1,
  ],
  () => client.readList({ tab: "owned" }),
  listResult,
  get(mine, myPage),
);
await check(
  "subscriptions",
  ["list", [["93", "subscribed"]], 1],
  () => client.readList({ tab: "subscribed" }),
  listResult,
  get(mine, myPage),
);
const misleadingDirectory = await check(
  "unrelated edit link cannot authorize create",
  false,
  () => client.readList({ tab: "owned" }),
  (r) => r.canCreate,
  get(
    mine,
    myPage.replace(
      createLink,
      `<li><a href="${base}&action=edit&op=remove&ctid=91">Delete</a></li>`,
    ),
  ),
);
await check(
  "create from an unqualified directory skips dispatch",
  "invalid",
  () => client.createCollection(misleadingDirectory, { title: "Example" }),
  kind,
);
const related = `${base}&tid=501`;
await check(
  "related thread",
  ["list", [["91", null]], 1],
  () => client.readRelated("501"),
  listResult,
  get(related, listing(related, row(91, "Example", "", "&fromtid=501"))),
);
await check(
  "wrong related thread",
  "invalid-response",
  () => client.readRelated("501"),
  kind,
  get(
    related,
    listing(`${base}&tid=502`, row(91, "Example", "", "&fromtid=502")),
  ),
);
const editLinks = `<a href="${base}&action=edit&op=edit&ctid=91&formhash=fixturehash">Edit</a><a href="${base}&action=edit&op=remove&ctid=91&formhash=fixturehash">Delete</a>`;
const owned = await check(
  "detail page 2",
  ["detail", "91", 2, 3, "501", "Fictitious example", true],
  () => client.readDetail("91", 2),
  (r) => [
    r.kind,
    r.id,
    r.page,
    r.totalPages,
    r.threads?.[0]?.id,
    r.threads?.[0]?.reason,
    r.canManage,
  ],
  get(`${view(91)}&page=2`, {
    document: detail(
      91,
      editLinks,
      `<div class="pg"><strong>2</strong><a class="last" href="${view(91)}&page=3">3</a></div>`,
    ),
  }),
);
await check(
  "wrong detail target",
  "invalid-response",
  () => client.readDetail("98"),
  kind,
  get(view(98), detail(91)),
);
const commented = await check(
  "collection comments",
  ["comments", "91", "Example comment", 4, true],
  () => client.readComments("91"),
  (r) => [
    r.kind,
    r.id,
    r.comments?.[0]?.message,
    r.comments?.[0]?.rating,
    r.canRate,
  ],
  get(commentView, comments),
);
await check(
  "native missing collection",
  "refused",
  () => client.readDetail("98"),
  kind,
  get(view(98), '<div id="messagetext"><p>No such collection</p></div>'),
);

const status = "/plugin.php?id=tsdmapp%3Aapi&action=status";
const statusV4 = { ok: 1, v4: 1, uid: 71, forms: ["collection"] };
const add = `${base}&action=edit&op=addthread`;
const dialogV4 = `${add}&tid=501&handlekey=k_collect&inajax=1&tsdmapp=json&tsdmv=4&tsdmform=1&nodoc=1`;
const dialogWeb = `${add}&tid=501&inajax=1&tsdmapp=json`;
const write = (query) => `${base}&${query}&inajax=1&tsdmapp=json`;
const xml = (value) => `<?xml version="1.0"?><root><![CDATA[${value}]]></root>`;
const outcome = (message_key, extra = {}) => ({
  ok: 1,
  type: "result",
  schema: 13,
  uid: 71,
  kind: "handle",
  alert: "right",
  login: 0,
  message: "Fixture verdict",
  message_key,
  url: "",
  values: {},
  ...extra,
});
const v4Fields = {
  inajax: "1",
  handlekey: "k_collect",
  formhash: "fixturehash",
  addthread: "1",
};
const formV4 = {
  ok: 1,
  type: "form",
  schema: 17,
  form: "collection",
  uid: 71,
  tid: 501,
  hook_fields: [],
  unsupported: [],
  collections: [
    { ctid: 91, name: "Example Archive" },
    { ctid: 92, name: "Example Team" },
  ],
  remain_create: 3,
  create: {
    submit: {
      method: "POST",
      enctype: "application/x-www-form-urlencoded",
      url: `${base}&action=edit&op=add`,
      fields: {
        formhash: "fixturehash",
        collectionsubmit: "1",
        submitcollection: "1",
      },
    },
  },
  submit: {
    method: "POST",
    enctype: "application/x-www-form-urlencoded",
    url: `${add}&`,
    fields: v4Fields,
    lists: { "tids[]": ["501"] },
  },
};
const nativeForm = (tid = 501) =>
  `<script>var remaincreateable = 2;</script><form method="post" id="form_addcollectionthread" action="${add}"><select name="ctid"><option value="91">Example Archive</option></select><textarea name="reason"></textarea><input name="tids[]" value="${tid}"><input name="formhash" value="fixturehash"><input name="addthread" value="1"></form>`;
const dialogResult = (r) => [
  r.kind,
  r.threadId,
  r.choices?.map((c) => c.id),
  r.remainingCreate,
];
const form = await check(
  "structured add dialog",
  ["add-dialog", "501", ["91", "92"], 3],
  () => client.readAddDialog("501"),
  dialogResult,
  get(status, statusV4),
  get(dialogV4, formV4),
);
const post = (path, response, body, change) => [
  path,
  "POST",
  true,
  response,
  body,
  change,
];
const effectGet = (path, response, change) => [
  path,
  "GET",
  true,
  response,
  undefined,
  change,
];
const addResult = outcome("collection_collect_succ", {
  handlekey: "k_collect",
});
const addBody = {
  ...v4Fields,
  "tids[0]": "501",
  "ctid[0]": "91",
  "ctid[1]": "92",
  reason: "Sort this thread",
};
await check(
  "add to two collections",
  "confirmed",
  () => client.addThread(form, ["91", "92"], "Sort this thread"),
  kind,
  post(`${add}&tsdmapp=json&tsdmv=4`, addResult, addBody),
);
await check(
  "outside offered collections",
  "invalid",
  () => client.addThread(form, ["99"]),
  kind,
);
await check(
  "copied dialog cannot authorize write",
  "invalid",
  () => client.addThread({ ...form }, ["91"]),
  kind,
);
await check(
  "v4 redisplay is ambiguous",
  "uncertain",
  () => client.addThread(form, ["91", "92"], "Sort this thread"),
  kind,
  post(`${add}&tsdmapp=json&tsdmv=4`, formV4, addBody),
);
await check(
  "v4 response from a different member",
  "uncertain",
  () => client.addThread(form, ["91", "92"], "Sort this thread"),
  kind,
  post(`${add}&tsdmapp=json&tsdmv=4`, { ...addResult, uid: 72 }, addBody),
);
await check(
  "structured submission requires its operation key",
  "uncertain",
  () => client.addThread(form, ["91", "92"], "Sort this thread"),
  kind,
  post(
    `${add}&tsdmapp=json&tsdmv=4`,
    xml("<script>succeedhandle_k_collect('', 'Added', {});</script>"),
    addBody,
  ),
);
await check(
  "v4 wrong receipt thread",
  "uncertain",
  () => client.addThread(form, ["91", "92"], "Sort this thread"),
  kind,
  post(
    `${add}&tsdmapp=json&tsdmv=4`,
    { ...addResult, values: { tid: "502" } },
    addBody,
  ),
);
const native = await check(
  "structured target rejected then legacy dialog",
  ["add-dialog", "501", ["91"], 2],
  () => client.readAddDialog("501"),
  dialogResult,
  get(status, statusV4),
  get(dialogV4, {
    ...formV4,
    submit: { ...formV4.submit, url: "https://other.example.test" + add },
  }),
  get(dialogWeb, xml(nativeForm())),
);
await check(
  "native add request and callback",
  "confirmed",
  () => client.addThread(native, ["91"]),
  kind,
  post(
    write("action=edit&op=addthread"),
    xml("<script>succeedhandle_k_collect('', 'Added', {});</script>"),
    {
      formhash: "fixturehash",
      addthread: "1",
      handlekey: "k_collect",
      reason: "",
      "ctid[0]": "91",
      "tids[0]": "501",
    },
  ),
);
await check(
  "schema 13 wrapped add dialog",
  ["add-dialog", "501", ["91"], 2],
  () => client.readAddDialog("501"),
  dialogResult,
  get(status, { http: 404 }),
  get(dialogWeb, outcome("", { kind: "page", document: nativeForm() })),
);
await check(
  "wrong native dialog target",
  "invalid-response",
  () => client.readAddDialog("501"),
  kind,
  get(status, { http: 404 }),
  get(dialogWeb, xml(nativeForm(502))),
);
await check(
  "dialog login",
  "login",
  () => client.readAddDialog("501"),
  kind,
  get(status, { http: 404 }),
  get(
    dialogWeb,
    outcome("login_before_enter_home", {
      ok: 0,
      uid: 0,
      kind: "redirect",
      login: 1,
    }),
  ),
);
await check(
  "dialog rate limit is terminal",
  "rate-limited",
  () => client.readAddDialog("501"),
  kind,
  get(status, { http: 429 }),
);

const create = write("action=edit&op=add");
const fields = {
  formhash: "fixturehash",
  collectionsubmit: "1",
  submitcollection: "1",
  title: "Example Archive",
  desc: "An example",
  keyword: "anime music",
};
const metadata = {
  title: "Example Archive",
  description: "An example",
  keywords: " anime、 music ",
};
await check(
  "create and return exact new page",
  ["confirmed", "94", origin + view(94)],
  () => client.createCollection(createdList, metadata),
  (r) => [r.kind, r.collectionId, r.collectionURL],
  post(
    create,
    outcome("collection_create_succ", {
      url: view(94),
      values: { ctid: "94" },
    }),
    fields,
  ),
);
await check(
  "create from thread dialog",
  ["confirmed", "94"],
  () => client.createCollection(form, metadata),
  (r) => [r.kind, r.collectionId],
  post(
    create,
    xml(
      `<script>succeedhandle_createcollection('${view(94)}', 'Created', {'ctid':'94'});</script>`,
    ),
    fields,
  ),
);
await check(
  "create with conflicting receipt target",
  "uncertain",
  () => client.createCollection(createdList, metadata),
  kind,
  post(
    create,
    outcome("collection_create_succ", {
      url: view(95),
      values: { ctid: "94" },
    }),
    fields,
  ),
);
const edit = write("action=edit&op=edit&ctid=91");
await check(
  "edit collection",
  "confirmed",
  () => client.editCollection(owned, metadata),
  kind,
  post(edit, outcome("collection_edit_succ", { url: view(91) }), fields),
);
await check(
  "edit explicitly refused",
  "refused",
  () => client.editCollection(owned, metadata),
  kind,
  post(
    edit,
    outcome("collection_permission_deny", { ok: 0, alert: "error" }),
    fields,
  ),
);
await check(
  "stale form hash refused",
  "refused",
  () => client.editCollection(owned, metadata),
  kind,
  post(
    edit,
    '<div id="container"><h1>Discuz! System Error</h1><div class="info"><li>Invalid form hash</li></div></div>',
    fields,
  ),
);
await check(
  "remove selected thread",
  "confirmed",
  () => client.removeThreads(owned, ["501"]),
  kind,
  post(
    write("action=edit&op=delthread"),
    outcome("collection_remove_thread", { url: view(91) }),
    { formhash: "fixturehash", ctid: "91", "delthread[0]": "501" },
  ),
);
await check(
  "remove unoffered thread",
  "invalid",
  () => client.removeThreads(owned, ["502"]),
  kind,
);
await check(
  "delete collection deliberately",
  "confirmed",
  () => client.deleteCollection(owned),
  kind,
  effectGet(
    write("action=edit&op=remove&ctid=91&formhash=fixturehash"),
    outcome("collection_delete_succ", { url: mine, alert: "info" }),
  ),
);
const commentBody = {
  formhash: "fixturehash",
  handlekey: "k_addComment",
  message: "My thoughts",
  ratescore: "5",
};
const comment = write("action=comment&ctid=91");
await check(
  "comment and rate",
  "confirmed",
  () => client.comment(commented, "My thoughts", 5),
  kind,
  post(
    comment,
    outcome("collection_comment_succ", { handlekey: "addComment" }),
    commentBody,
  ),
);
await check(
  "comment flood control",
  ["rate-limited", 15],
  () => client.comment(commented, "My thoughts", 5),
  (r) => [r.kind, r.retryAfterSeconds],
  post(
    comment,
    outcome("operating_too_fast", {
      ok: 0,
      alert: "error",
      values: { waittime: "15" },
    }),
    commentBody,
  ),
);
const followPath = (op) =>
  write(`action=follow&op=${op}&ctid=91&formhash=fixturehash`);
const unrelatedFollow = await check(
  "off-origin subscription control",
  "unavailable",
  () => client.readDetail("91"),
  (r) => r.followState,
  get(
    view(91),
    detail(
      91,
      '<a id="followlink" href="https://elsewhere.example.test/">Follow</a>',
    ),
  ),
);
await check(
  "off-origin subscription control skips dispatch",
  "invalid",
  () => client.subscribe(unrelatedFollow),
  kind,
);
const ableToFollow = await check(
  "subscription available",
  "can-follow",
  () => client.readDetail("91"),
  (r) => r.followState,
  get(
    view(91),
    detail(91, '<a id="followlink" href="javascript:;"><i>Follow</i></a>'),
  ),
);
await check(
  "subscribe deliberately",
  "confirmed",
  () => client.subscribe(ableToFollow),
  kind,
  effectGet(
    followPath("follow"),
    outcome("collection_follow_succ", { values: { status: "1" } }),
  ),
);
await check(
  "already followed response is ambiguous",
  "uncertain",
  () => client.subscribe(ableToFollow),
  kind,
  effectGet(followPath("follow"), outcome("", { kind: "page" })),
);
await check(
  "duplicate destination target is ambiguous",
  "uncertain",
  () => client.subscribe(ableToFollow),
  kind,
  effectGet(
    followPath("follow"),
    outcome("collection_follow_succ", {
      url: `${view(91)}&ctid=92`,
      values: { status: "1" },
    }),
  ),
);
await check(
  "off-origin receipt handoff is ambiguous",
  "uncertain",
  () => client.subscribe(ableToFollow),
  kind,
  effectGet(
    followPath("follow"),
    outcome("collection_follow_succ", {
      url: "https://elsewhere.example.test/",
      values: { status: "1" },
    }),
  ),
);
await check(
  "reverse subscription receipt is ambiguous",
  "uncertain",
  () => client.subscribe(ableToFollow),
  kind,
  effectGet(
    followPath("follow"),
    outcome("collection_follow_succ", { values: { status: "2" } }),
  ),
);
await check(
  "lost effectful GET response is never retried",
  "uncertain",
  () => client.subscribe(ableToFollow),
  kind,
  effectGet(followPath("follow"), new Error("fixture response lost")),
);
await check(
  "redirect of effectful GET remains uncertain",
  "uncertain",
  () => client.subscribe(ableToFollow),
  kind,
  effectGet(followPath("follow"), {
    http: 302,
    redirect: "followed",
    url: "https://elsewhere.example.test/",
  }),
);
const followed = await check(
  "current subscription readback",
  "following",
  () => client.readDetail("91"),
  (r) => r.followState,
  get(
    view(91),
    detail(
      91,
      '<a id="followlink" href="javascript:;"><i class="u">Unfollow</i></a>',
    ),
  ),
);
await check(
  "unsubscribe deliberately via legacy callback",
  "confirmed",
  () => client.unsubscribe(followed),
  kind,
  effectGet(
    followPath("unfo"),
    xml(
      "<script>succeedhandle_followcollection('', 'Unsubscribed', {'status':'2'});</script>",
    ),
  ),
);
owned.id = "92";
await check(
  "edited display ID cannot retarget a write",
  "confirmed",
  () => client.editCollection(owned, metadata),
  kind,
  post(edit, outcome("collection_edit_succ", { url: view(91) }), fields),
);
owned.id = "91";
await check(
  "native comment rate limit",
  ["rate-limited", 15],
  () => client.comment(commented, "My thoughts", 5),
  (r) => [r.kind, r.retryAfterSeconds],
  post(
    comment,
    xml("<script>errorhandle_addComment('Wait', {'waittime':'15'});</script>"),
    commentBody,
  ),
);
await check(
  "no deletion without its signed link",
  "invalid",
  () => client.deleteCollection(followed),
  kind,
);
await check(
  "session changes after dispatch",
  "uncertain",
  () => client.subscribe(ableToFollow),
  kind,
  effectGet(
    followPath("follow"),
    outcome("collection_follow_succ", { values: { status: "1" } }),
    () => {
      session = { ...actor, continuity: "other-session" };
    },
  ),
);
await check(
  "same UID after re-login cannot reuse page authority",
  "session-changed",
  () => client.deleteCollection(owned),
  kind,
);
session = null;
await check(
  "guest public list",
  ["list", [["91", null]], 1],
  () => client.readList({ tab: "recommended" }),
  listResult,
  get(
    base,
    shell(
      `<div class="tb"><li class="a"><a href="${base}">Current</a></li></div><div class="clct_list">${row(91, "Example")}</div>`,
      0,
    ),
  ),
);
await check(
  "guest cannot load member dialog",
  "login",
  () => client.readAddDialog("501"),
  kind,
);
console.log(JSON.stringify(receipt));
